/**
 * v0.22 — regression coverage for the warm-cache staleness bug.
 *
 * The bug: getBrain served the warm in-process cache without checking whether
 * the source tree had changed, so a file added mid-session was invisible to
 * knit_query_imports until an explicit knit_refresh_index. These tests drive the
 * REAL scenario end-to-end: build the index, mutate the tree, query again.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probeSourceTree } from '../src/engine/knowledge.js';

let knitHome: string;
let projectRoot: string;

beforeEach(() => {
  knitHome = mkdtempSync(join(tmpdir(), 'knit-stale-home-'));
  projectRoot = mkdtempSync(join(tmpdir(), 'knit-stale-proj-'));
  process.env.KNIT_HOME = knitHome;
  process.env.KNIT_INDEX_STALENESS_MS = '0'; // disable throttle → probe every call
  writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({ name: 'stale-proj' }), 'utf-8');
  mkdirSync(join(projectRoot, 'src'), { recursive: true });
  // Seed two source files with a real import edge: b imports a.
  writeFileSync(join(projectRoot, 'src', 'a.ts'), 'export const a = 1;\n', 'utf-8');
  writeFileSync(join(projectRoot, 'src', 'b.ts'), "import { a } from './a.js';\nexport const b = a + 1;\n", 'utf-8');
});

afterEach(() => {
  delete process.env.KNIT_HOME;
  delete process.env.KNIT_INDEX_STALENESS_MS;
  try { rmSync(knitHome, { recursive: true, force: true }); } catch { /* */ }
  try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* */ }
});

describe('probeSourceTree', () => {
  it('counts source files and reports the newest mtime, ignoring skip-dirs', () => {
    mkdirSync(join(projectRoot, 'node_modules', 'x'), { recursive: true });
    writeFileSync(join(projectRoot, 'node_modules', 'x', 'junk.ts'), 'export const junk = 1;\n', 'utf-8');
    const probe = probeSourceTree(projectRoot);
    expect(probe.sourceCount).toBe(2); // a.ts + b.ts; node_modules skipped
    expect(probe.newestMtimeMs).toBeGreaterThan(0);
  });

  it('sees a newer mtime after a file is touched', () => {
    const before = probeSourceTree(projectRoot).newestMtimeMs;
    const future = new Date(Date.now() + 60_000);
    utimesSync(join(projectRoot, 'src', 'a.ts'), future, future);
    expect(probeSourceTree(projectRoot).newestMtimeMs).toBeGreaterThan(before);
  });
});

describe('getBrain auto-refresh on source drift', () => {
  it('picks up a NEW file + import without an explicit refresh', async () => {
    const { getBrain } = await import('../src/mcp/cache.js');

    const first = getBrain(projectRoot);
    expect(first.reverseDeps['src/a.ts'] || []).toContain('src/b.ts');
    expect(first.knowledge.importGraph['src/c.ts']).toBeUndefined();

    // Add c.ts importing a.ts — and bump a.ts mtime into the future so the probe
    // is unambiguous regardless of filesystem mtime granularity.
    writeFileSync(join(projectRoot, 'src', 'c.ts'), "import { a } from './a.js';\nexport const c = a + 2;\n", 'utf-8');
    const future = new Date(Date.now() + 60_000);
    utimesSync(join(projectRoot, 'src', 'c.ts'), future, future);

    const second = getBrain(projectRoot);
    // The warm cache must have been invalidated and rebuilt: c.ts is now indexed
    // and a.ts gains a second dependent — WITHOUT calling refreshBrain.
    expect(second.knowledge.importGraph['src/c.ts']).toBeDefined();
    expect(second.reverseDeps['src/a.ts'] || []).toContain('src/c.ts');
  });

  it('rebuilds when a file is DELETED (count drift, mtime would not move)', async () => {
    const { getBrain } = await import('../src/mcp/cache.js');
    const first = getBrain(projectRoot);
    expect(first.knowledge.files.some((f) => f.path === 'src/b.ts')).toBe(true);

    rmSync(join(projectRoot, 'src', 'b.ts'));
    const second = getBrain(projectRoot);
    expect(second.knowledge.files.some((f) => f.path === 'src/b.ts')).toBe(false);
  });

  it('serves the warm cache (no rebuild) while the throttle window is open', async () => {
    process.env.KNIT_INDEX_STALENESS_MS = '60000'; // 60s window
    const { getBrain, resetStalenessThrottle } = await import('../src/mcp/cache.js');
    resetStalenessThrottle();

    const first = getBrain(projectRoot); // primes cache + opens throttle window
    writeFileSync(join(projectRoot, 'src', 'd.ts'), 'export const d = 1;\n', 'utf-8');
    const future = new Date(Date.now() + 60_000);
    utimesSync(join(projectRoot, 'src', 'd.ts'), future, future);

    // Within the window the probe is skipped → d.ts not yet visible (by design).
    const second = getBrain(projectRoot);
    expect(second.knowledge.files.some((f) => f.path === 'src/d.ts')).toBe(false);
    expect(second).toBe(first); // exact same cached object

    // Reopen the window → next call probes, sees drift, rebuilds.
    resetStalenessThrottle();
    const third = getBrain(projectRoot);
    expect(third.knowledge.files.some((f) => f.path === 'src/d.ts')).toBe(true);
  });
});

describe('stale_index_hint on query handlers', () => {
  it('hints when a queried file exists on disk but is absent from the index', async () => {
    const { handleQueryImports } = await import('../src/mcp/handlers.js');
    // Build a brain, then write a file but DON'T let getBrain refresh it: craft a
    // brain whose index omits the file, simulating the throttle-window edge case.
    const { getBrain } = await import('../src/mcp/cache.js');
    const brain = getBrain(projectRoot);
    writeFileSync(join(projectRoot, 'src', 'fresh.ts'), 'export const fresh = 1;\n', 'utf-8');

    const res = JSON.parse(handleQueryImports({ file_path: 'src/fresh.ts' }, brain));
    expect(res.count).toBe(0);
    expect(res.stale_index_hint).toMatch(/index may be stale/i);
  });

  it('does NOT hint for a known file with genuinely zero importers', async () => {
    const { handleQueryImports } = await import('../src/mcp/handlers.js');
    const { getBrain } = await import('../src/mcp/cache.js');
    const brain = getBrain(projectRoot);
    // b.ts is indexed and imported by nobody → empty, but NOT stale.
    const res = JSON.parse(handleQueryImports({ file_path: 'src/b.ts' }, brain));
    expect(res.count).toBe(0);
    expect(res.stale_index_hint).toBeUndefined();
  });

  it('does NOT hint for a file that does not exist on disk at all', async () => {
    const { handleQueryImports } = await import('../src/mcp/handlers.js');
    const { getBrain } = await import('../src/mcp/cache.js');
    const brain = getBrain(projectRoot);
    const res = JSON.parse(handleQueryImports({ file_path: 'src/nope.ts' }, brain));
    expect(res.stale_index_hint).toBeUndefined();
  });
});

describe('verify_claim staleness defense', () => {
  it('downgrades a false "contradicted" to "stale_index" when the file was edited after the index built', async () => {
    const { handleVerifyClaim } = await import('../src/mcp/handlers.js');
    const { getBrain } = await import('../src/mcp/cache.js');
    const brain = getBrain(projectRoot); // index built now

    // a.ts IS indexed, but we modify it AFTER the build — exactly the session
    // failure (a freshly-added export the stale index can't see).
    const future = new Date(Date.now() + 60_000);
    utimesSync(join(projectRoot, 'src', 'a.ts'), future, future);

    const res = JSON.parse(handleVerifyClaim({ claim: 'src/a.ts exports brandNewSymbol' }, brain));
    expect(res.verdict).toBe('stale_index');
    expect(res.stale_index_hint).toMatch(/predates a recent change/i);
    expect(res.instruction).toMatch(/refresh/i);
  });

  it('still returns a confident "contradicted" for a file NOT modified after the build', async () => {
    const { handleVerifyClaim } = await import('../src/mcp/handlers.js');
    const { getBrain } = await import('../src/mcp/cache.js');
    const brain = getBrain(projectRoot);
    // b.ts is indexed and unmodified → a genuine contradiction stays confident.
    const res = JSON.parse(handleVerifyClaim({ claim: 'src/b.ts exports notARealExport' }, brain));
    expect(res.verdict).toBe('contradicted');
    expect(res.stale_index_hint).toBeUndefined();
  });
});

describe('brain_status surfaces index freshness', () => {
  it('reports generated_at + age_minutes + a freshness note so staleness is observable', async () => {
    const { handleBrainStatus } = await import('../src/mcp/handlers.js');
    const { getBrain } = await import('../src/mcp/cache.js');
    const brain = getBrain(projectRoot);
    const res = JSON.parse(handleBrainStatus({}, brain));
    expect(res.knowledge_index.generated_at).toBe(brain.knowledge.generatedAt);
    expect(res.knowledge_index.age_minutes).toBeGreaterThanOrEqual(0);
    expect(res.knowledge_index.freshness_note).toMatch(/knit_refresh_index/);
  });
});
