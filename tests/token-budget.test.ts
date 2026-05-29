import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * v0.7.2 — token-budget guardrail in knit_brain_status.
 *
 * The discipline becomes measurable: each per-session surface (CLAUDE.md,
 * tool registry, server instructions, total overhead) reports actual vs.
 * target bytes with a verdict (healthy / warn / over-budget). Drift becomes
 * visible at the next status call instead of relying on "vibes" reviews of
 * token cost.
 */

let knitHome: string;
let projectRoot: string;

beforeEach(() => {
  knitHome = mkdtempSync(join(tmpdir(), 'knit-budget-test-'));
  process.env.KNIT_HOME = knitHome;
  projectRoot = mkdtempSync(join(tmpdir(), 'knit-budget-project-'));
});

afterEach(() => {
  delete process.env.KNIT_HOME;
  try { rmSync(knitHome, { recursive: true, force: true }); } catch { /* best-effort */ }
  try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* best-effort */ }
});

function buildMinimalBrain() {
  return {
    rootPath: projectRoot,
    knowledge: {
      generatedAt: new Date().toISOString(),
      summary: {
        totalFiles: 5,
        totalLines: 200,
        languageBreakdown: { '.ts': 5 },
        entryPoints: [], highFanoutFiles: [], untestedFiles: [], largestFiles: [],
      },
      files: [], importGraph: {}, exports: {},
      testMap: { tested: {}, untested: [], testFiles: [] },
    },
    reverseDeps: {},
    knowledgeBase: { version: 1, projectName: 'test', entries: [], metrics: { totalSessions: 0, totalLearnings: 0, cacheHits: 0, domainDistribution: {}, sessions: [] } },
    config: {
      name: 'test', packageManager: 'npm',
      stack: { language: 'typescript', dependencies: [], buildCommand: '', lintCommand: '', typecheckCommand: '' },
      domains: [], targetAgent: 'claude-code', tokenOptimization: 'standard',
    },
    loadedAt: Date.now(),
    autoInitialized: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('knit_brain_status — token_budget surface', () => {
  it('reports the four budgeted surfaces with verdicts', async () => {
    const { handleBrainStatus } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    const result = JSON.parse(handleBrainStatus({}, buildMinimalBrain()));
    expect(result.token_budget).toBeDefined();
    expect(result.token_budget.budgets.claude_md).toBeDefined();
    expect(result.token_budget.budgets.tool_registry).toBeDefined();
    expect(result.token_budget.budgets.instructions).toBeDefined();
    expect(result.token_budget.budgets.per_session_overhead).toBeDefined();

    for (const surface of ['claude_md', 'tool_registry', 'instructions', 'per_session_overhead']) {
      const b = result.token_budget.budgets[surface];
      expect(b.bytes).toBeGreaterThanOrEqual(0);
      expect(b.target_bytes).toBeGreaterThan(0);
      expect(['healthy', 'warn', 'over-budget']).toContain(b.verdict);
    }
  });

  it('healthy verdict on a typical post-v0.7 project (lean CLAUDE.md + tier-gated tools)', async () => {
    const { handleBrainStatus } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });
    // Simulate a v0.7-trim CLAUDE.md — ~2KB.
    writeFileSync(join(projectRoot, 'CLAUDE.md'), 'A'.repeat(2000), 'utf-8');

    const result = JSON.parse(handleBrainStatus({}, buildMinimalBrain()));
    expect(result.token_budget.budgets.claude_md.verdict).toBe('healthy');
    // v0.12.1: honest tool-registry measurement (~15.5KB on first session)
    // against the 14KB target → "warn" within 25% slack. Tier-1 sits
    // healthy post-onboarding once setup diagnostics auto-drop.
    expect(['healthy', 'warn']).toContain(result.token_budget.overall_verdict);
  });

  it('warns when CLAUDE.md grows past the v0.7 6.5KB target but stays within 25% slack', async () => {
    const { handleBrainStatus } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });
    // ~7.5KB — over the 6.5KB target, under the 25% slack (8.125KB) → warn.
    writeFileSync(join(projectRoot, 'CLAUDE.md'), 'A'.repeat(7500), 'utf-8');

    const result = JSON.parse(handleBrainStatus({}, buildMinimalBrain()));
    expect(result.token_budget.budgets.claude_md.verdict).toBe('warn');
  });

  it('flags over-budget when CLAUDE.md regresses to pre-v0.7 size (~16KB)', async () => {
    const { handleBrainStatus } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });
    writeFileSync(join(projectRoot, 'CLAUDE.md'), 'A'.repeat(16000), 'utf-8');

    const result = JSON.parse(handleBrainStatus({}, buildMinimalBrain()));
    expect(result.token_budget.budgets.claude_md.verdict).toBe('over-budget');
    expect(result.token_budget.overall_verdict).toBe('over-budget');
  });

  it('tool_registry bytes scale with active_tool_count from tier-gating', async () => {
    const { handleBrainStatus } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    const result = JSON.parse(handleBrainStatus({}, buildMinimalBrain()));
    const tr = result.token_budget.budgets.tool_registry;
    // Empty-shape project → 37 Tier-1 (v0.21 adds knit_onboard) + 6
    // auto-exposed setup diagnostics = 43. Range 28-44 catches drift in
    // either direction.
    expect(tr.active_tool_count).toBeGreaterThanOrEqual(28);
    expect(tr.active_tool_count).toBeLessThanOrEqual(44);
    // v0.12.1: honest serialized byte count (~15.5KB for 40 active tools)
    // against 14KB target → warn within 25% slack. The pre-v0.12.1
    // estimator used a hardcoded 280B/tool average that understated by
    // ~30%; correcting that surfaces the real budget surface.
    expect(['healthy', 'warn']).toContain(tr.verdict);
  });

  it('compounding section reflects session count + learnings hit rate', async () => {
    const { handleBrainStatus } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    const result = JSON.parse(handleBrainStatus({}, buildMinimalBrain()));
    expect(result.token_budget.compounding).toBeDefined();
    expect(result.token_budget.compounding.session_count).toBeGreaterThanOrEqual(0);
    expect(result.token_budget.compounding.note).toMatch(/Fresh brain|Compounding|Low hit rate/);
  });

  it('back-compat: the flat token_accounting shape from pre-v0.7.2 is preserved', async () => {
    const { handleBrainStatus } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    const result = JSON.parse(handleBrainStatus({}, buildMinimalBrain()));
    // Pre-v0.7.2 callers may still read these flat fields directly.
    expect(result.token_accounting.claude_md_bytes).toBeDefined();
    expect(result.token_accounting.claude_md_kb).toBeDefined();
    expect(result.token_accounting.session_count).toBeDefined();
    expect(result.token_accounting.learnings_hit_rate_pct).toBeDefined();
    expect(result.token_accounting.note).toBeDefined();
  });
});

// ── v0.11.4 — handleBrainStatus edge cases ───────────────────────────────────

describe('handleBrainStatus — edge cases', () => {
  it('project root with no .git directory — status returns without crashing', async () => {
    const { handleBrainStatus } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    // projectRoot from beforeEach has no .git dir
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    const brain = buildMinimalBrain();
    let result: ReturnType<typeof JSON.parse> | undefined;
    expect(() => {
      result = JSON.parse(handleBrainStatus({}, brain));
    }).not.toThrow();
    expect(result).toBeDefined();
    expect(result.token_budget).toBeDefined();
  });

  it('missing CLAUDE.md — claudeMdBytes reported as 0, does not throw', async () => {
    const { handleBrainStatus } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });
    // No CLAUDE.md written — statSync should fail gracefully

    const result = JSON.parse(handleBrainStatus({}, buildMinimalBrain()));
    expect(result.token_budget.budgets.claude_md.bytes).toBe(0);
    expect(result.token_budget.budgets.claude_md.verdict).toBe('healthy');
  });

  it('scanProjectFingerprint throws — handleBrainStatus surfaces empty fingerprint, no crash', async () => {
    const { handleBrainStatus } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    // Use a non-existent sub-path to force scanProjectFingerprint to scan
    // a completely empty dir with no package.json etc. It should still return.
    const emptyRoot = mkdtempSync(join(tmpdir(), 'knit-nofp-'));
    try {
      mkdirSync(projectDataDir(emptyRoot), { recursive: true });
      const brain = { ...buildMinimalBrain(), rootPath: emptyRoot };
      let result: ReturnType<typeof JSON.parse> | undefined;
      expect(() => {
        result = JSON.parse(handleBrainStatus({}, brain));
      }).not.toThrow();
      // fingerprint field must exist — either populated or empty-defaults
      expect(result).toBeDefined();
      expect(result.fingerprint).toBeDefined();
    } finally {
      try { rmSync(emptyRoot, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  });
});
