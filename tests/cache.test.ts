/**
 * Direct unit coverage for src/mcp/cache.ts behaviors that the integration
 * test in tests/auto-init-hooks.test.ts doesn't reach:
 *
 *   1. maybeRefreshHooks idempotency — once per process per project
 *   2. malformed settings.local.json robustness — never throws
 *   3. detectProjectRoot fallback paths
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let engramHome: string;
let projectRoot: string;

beforeEach(() => {
  engramHome = mkdtempSync(join(tmpdir(), 'engram-cache-test-'));
  process.env.ENGRAM_HOME = engramHome;
  projectRoot = mkdtempSync(join(tmpdir(), 'engram-cache-proj-'));
  writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({ name: 'cache-test-proj' }), 'utf-8');
});

afterEach(() => {
  delete process.env.ENGRAM_HOME;
  try { rmSync(engramHome, { recursive: true, force: true }); } catch { /* */ }
  try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* */ }
});

describe('maybeRefreshHooks idempotency', () => {
  it('skips a second refresh on the same project within one process', async () => {
    // Pre-populate centralized knowledge so autoInitialize doesn't fire on first
    // getBrain (which would skip maybeRefreshHooks via the `autoInitialized` flag
    // and never add the project to the per-process Set we're trying to test).
    const { projectId } = await import('../src/engine/project-id.js');
    const hash = projectId(projectRoot);
    const projectData = join(engramHome, 'projects', hash);
    mkdirSync(projectData, { recursive: true });
    writeFileSync(
      join(projectData, 'knowledge.json'),
      JSON.stringify({ generatedAt: new Date().toISOString(), summary: { totalFiles: 0, totalLines: 0, languageBreakdown: {}, entryPoints: [], highFanoutFiles: [], untestedFiles: [], largestFiles: [] }, files: [], importGraph: {}, exports: {}, testMap: { tested: {}, untested: [], testFiles: [] } }),
      'utf-8',
    );

    // Seed a stale settings.local.json so the first maybeRefreshHooks call triggers a refresh.
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    const settingsPath = join(projectRoot, '.claude', 'settings.local.json');
    writeFileSync(
      settingsPath,
      JSON.stringify({ _engramHooks: { version: 1, generatedAt: '1970-01-01T00:00:00Z' } }, null, 2),
      'utf-8',
    );

    const cacheMod = await import('../src/mcp/cache.js');
    const refreshBrain = (cacheMod as unknown as { refreshBrain: (p: string) => unknown }).refreshBrain;

    // First call: autoInitialize skipped (centralized data exists) → maybeRefreshHooks fires → version 1 → 3.
    refreshBrain(projectRoot);
    const afterFirst = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    expect(afterFirst._engramHooks.version).toBe(3);

    // Tamper the file back to stale state. If maybeRefreshHooks ran again it would
    // bump version back to 3; the per-process Set must suppress the call.
    writeFileSync(
      settingsPath,
      JSON.stringify({ _engramHooks: { version: 1, generatedAt: 'sentinel' }, custom: 'preserved' }, null, 2),
      'utf-8',
    );
    const tamperedMtime = statSync(settingsPath).mtimeMs;

    // Second call on same project: maybeRefreshHooks short-circuits via hooksRefreshed.has(rootPath).
    refreshBrain(projectRoot);
    const afterSecond = JSON.parse(readFileSync(settingsPath, 'utf-8'));

    // File should be unchanged from the tampered state — no refresh attempted.
    expect(afterSecond._engramHooks.version).toBe(1);
    expect(afterSecond._engramHooks.generatedAt).toBe('sentinel');
    expect(afterSecond.custom).toBe('preserved');
    expect(statSync(settingsPath).mtimeMs).toBe(tamperedMtime);
  });
});

describe('malformed settings robustness', () => {
  it('does not crash getBrain when settings.local.json is corrupt', async () => {
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    const settingsPath = join(projectRoot, '.claude', 'settings.local.json');
    writeFileSync(settingsPath, '{ this is not valid json', 'utf-8');

    const cacheMod = await import('../src/mcp/cache.js');
    const refreshBrain = (cacheMod as unknown as { refreshBrain: (p: string) => unknown }).refreshBrain;

    // Must not throw — best-effort upgrade path swallows JSON.parse errors.
    expect(() => refreshBrain(projectRoot)).not.toThrow();
  });

  it('skips upgrade when settings.local.json is missing entirely', async () => {
    // No .claude/ dir at all.
    const cacheMod = await import('../src/mcp/cache.js');
    const refreshBrain = (cacheMod as unknown as { refreshBrain: (p: string) => unknown }).refreshBrain;

    refreshBrain(projectRoot);

    // autoInitialize runs because no centralized knowledge exists yet → it writes
    // settings.local.json on its own path. After that, maybeRefreshHooks should
    // see a fresh file and not double-fire (covered by the idempotency test above).
    const settingsPath = join(projectRoot, '.claude', 'settings.local.json');
    const content = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    expect(content._engramHooks.version).toBe(3);
  });
});

describe('detectProjectRoot fallback', () => {
  it('falls back to cwd when not inside a git repo', async () => {
    const cacheMod = await import('../src/mcp/cache.js');
    const detectProjectRoot = (cacheMod as unknown as { detectProjectRoot: () => string }).detectProjectRoot;

    // projectRoot is a fresh tmpdir without .git — detectProjectRoot should fall back.
    const prevCwd = process.cwd();
    try {
      process.chdir(projectRoot);
      const detected = detectProjectRoot();
      // On macOS tmpdir resolves through /private symlink; either form is acceptable.
      expect(detected === projectRoot || detected.endsWith(projectRoot)).toBe(true);
    } finally {
      process.chdir(prevCwd);
    }
  });
});
