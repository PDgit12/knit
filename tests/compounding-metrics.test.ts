import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * v0.8.1 — knit_compounding_metrics.
 *
 * Tests the cold / warming / compounding / strong verdicts at boundary
 * conditions, plus the conservative estimate of tokens saved per cache
 * hit. These are directional signals, not exact accounting, so assertions
 * are bounds-based.
 */

let knitHome: string;
let projectRoot: string;

beforeEach(() => {
  knitHome = mkdtempSync(join(tmpdir(), 'knit-compound-test-'));
  process.env.KNIT_HOME = knitHome;
  projectRoot = mkdtempSync(join(tmpdir(), 'knit-compound-project-'));
});

afterEach(() => {
  delete process.env.KNIT_HOME;
  try { rmSync(knitHome, { recursive: true, force: true }); } catch { /* best-effort */ }
  try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* best-effort */ }
});

function buildBrain(opts: { entries?: number; accessed?: number; totalAccesses?: number; cacheHits?: number } = {}) {
  const entryCount = opts.entries ?? 0;
  const accessedCount = opts.accessed ?? 0;
  const totalAccesses = opts.totalAccesses ?? 0;
  const cacheHits = opts.cacheHits ?? 0;
  const entries = Array.from({ length: entryCount }, (_, i) => ({
    id: String(i),
    date: '2026-05-19',
    summary: `Entry ${i}`,
    domains: ['general'],
    approach: '',
    outcome: 'success' as const,
    lesson: `Lesson ${i}`,
    tags: [],
    accessCount: i < accessedCount ? Math.max(1, Math.floor(totalAccesses / Math.max(1, accessedCount))) : 0,
    lastAccessed: null,
  }));
  return {
    rootPath: projectRoot,
    knowledge: {
      generatedAt: new Date().toISOString(),
      summary: { totalFiles: 5, totalLines: 100, languageBreakdown: {}, entryPoints: [], highFanoutFiles: [], untestedFiles: [], largestFiles: [] },
      files: [], importGraph: {}, exports: {}, testMap: { tested: {}, untested: [], testFiles: [] },
    },
    reverseDeps: {},
    knowledgeBase: {
      version: 1, projectName: 'test', entries,
      metrics: { totalSessions: 0, totalLearnings: entries.length, cacheHits, domainDistribution: {}, sessions: [] },
    },
    config: { name: 'test', packageManager: 'npm', stack: { language: 'typescript', dependencies: [], buildCommand: '', lintCommand: '', typecheckCommand: '' }, domains: [], targetAgent: 'claude-code', tokenOptimization: 'standard' },
    loadedAt: Date.now(),
    autoInitialized: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('handleCompoundingMetrics', () => {
  it('cold verdict on fresh project (no sessions)', async () => {
    const { handleCompoundingMetrics } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    const result = JSON.parse(handleCompoundingMetrics({}, buildBrain()));
    expect(result.verdict).toBe('cold');
    expect(result.sessions_recorded).toBe(0);
    expect(result.note).toMatch(/Fresh project/);
  });

  it('returns the full shape — sessions, learnings, hit rate, density, estimate, verdict', async () => {
    const { handleCompoundingMetrics } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    const result = JSON.parse(handleCompoundingMetrics({}, buildBrain({ entries: 10, accessed: 6, totalAccesses: 20, cacheHits: 5 })));
    expect(result).toHaveProperty('sessions_recorded');
    expect(result).toHaveProperty('learnings_recorded');
    expect(result).toHaveProperty('learnings_per_session');
    expect(result).toHaveProperty('accessed_learnings');
    expect(result).toHaveProperty('total_accesses');
    expect(result).toHaveProperty('cache_hits');
    expect(result).toHaveProperty('reuse_ratio_pct');
    expect(result).toHaveProperty('access_density_pct');
    expect(result).toHaveProperty('estimated_tokens_saved');
    expect(result).toHaveProperty('verdict');
    expect(result).toHaveProperty('note');
  });

  it('access_density_pct = accessed / total * 100', async () => {
    const { handleCompoundingMetrics } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    // 10 entries, 6 accessed → 60%
    const result = JSON.parse(handleCompoundingMetrics({}, buildBrain({ entries: 10, accessed: 6 })));
    expect(result.access_density_pct).toBe(60);
  });

  it('estimated_tokens_saved scales linearly with cache_hits (5000 each)', async () => {
    const { handleCompoundingMetrics } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    const r1 = JSON.parse(handleCompoundingMetrics({}, buildBrain({ entries: 5, accessed: 2, cacheHits: 1 })));
    const r3 = JSON.parse(handleCompoundingMetrics({}, buildBrain({ entries: 5, accessed: 2, cacheHits: 3 })));
    expect(r3.estimated_tokens_saved).toBe(r1.estimated_tokens_saved * 3);
  });
});
