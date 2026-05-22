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

interface BuildBrainOpts {
  entries?: number;
  accessed?: number;
  totalAccesses?: number;
  cacheHits?: number;
  // v0.10 slice 3 — new counters.
  totalClassifications?: number;
  planModeTriggers?: number;
  classificationsByTier?: Partial<Record<'inquiry' | 'trivial' | 'standard' | 'complex', number>>;
  fpSuppressions?: number;
  graphQueries?: number;
  highScoreHits?: number;
  totalRetrievalQueries?: number;
  fpEntries?: number;
}

function buildBrain(opts: BuildBrainOpts = {}) {
  const entryCount = opts.entries ?? 0;
  const accessedCount = opts.accessed ?? 0;
  const totalAccesses = opts.totalAccesses ?? 0;
  const cacheHits = opts.cacheHits ?? 0;
  const fpEntries = opts.fpEntries ?? 0;
  const entries = Array.from({ length: entryCount }, (_, i) => ({
    id: String(i),
    date: '2026-05-19',
    summary: `Entry ${i}`,
    domains: ['general'],
    approach: '',
    outcome: 'success' as const,
    lesson: `Lesson ${i}`,
    tags: i < fpEntries ? ['#false-positive'] : [],
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
      metrics: {
        totalSessions: 0, totalLearnings: entries.length, cacheHits,
        domainDistribution: {}, sessions: [],
        totalClassifications: opts.totalClassifications,
        planModeTriggers: opts.planModeTriggers,
        classificationsByTier: opts.classificationsByTier,
        fpSuppressions: opts.fpSuppressions,
        graphQueries: opts.graphQueries,
        highScoreHits: opts.highScoreHits,
        totalRetrievalQueries: opts.totalRetrievalQueries,
      },
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

  it('estimated_tokens_saved scales linearly with cache_hits', async () => {
    const { handleCompoundingMetrics } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    const r1 = JSON.parse(handleCompoundingMetrics({}, buildBrain({ entries: 5, accessed: 2, cacheHits: 1 })));
    const r3 = JSON.parse(handleCompoundingMetrics({}, buildBrain({ entries: 5, accessed: 2, cacheHits: 3 })));
    expect(r3.estimated_tokens_saved).toBe(r1.estimated_tokens_saved * 3);
  });

  // ── v0.10 slice 3 — token-economics fields ────────────────────────

  it('v0.10 — response includes the new economic fields', async () => {
    const { handleCompoundingMetrics } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    const r = JSON.parse(handleCompoundingMetrics({}, buildBrain({
      entries: 5, accessed: 2, cacheHits: 4,
      totalClassifications: 10, planModeTriggers: 3,
      classificationsByTier: { inquiry: 2, trivial: 4, standard: 3, complex: 1 },
      fpSuppressions: 2, graphQueries: 5, highScoreHits: 8, totalRetrievalQueries: 10,
    })));
    expect(r.total_classifications).toBe(10);
    expect(r.plan_mode_triggers).toBe(3);
    expect(r.plan_mode_trigger_rate_pct).toBe(30);
    expect(r.fp_suppressions).toBe(2);
    expect(r.graph_queries).toBe(5);
    expect(r.total_retrieval_queries).toBe(10);
    expect(r.retrieval_high_score_rate_pct).toBe(80);
    expect(r.classifications_by_tier).toEqual({ inquiry: 2, trivial: 4, standard: 3, complex: 1 });
  });

  it('v0.10 — tokens_spent_estimate = inquiry×200 + trivial×1500 + standard×8000 + complex×25000', async () => {
    const { handleCompoundingMetrics } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    const r = JSON.parse(handleCompoundingMetrics({}, buildBrain({
      classificationsByTier: { inquiry: 1, trivial: 2, standard: 1, complex: 1 },
    })));
    expect(r.tokens_spent_estimate).toBe(200 + 2 * 1500 + 8000 + 25000);
  });

  it('v0.10 — tokens_saved_estimate = cache×15000 + fp×5000 + graph×3000', async () => {
    const { handleCompoundingMetrics } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    const r = JSON.parse(handleCompoundingMetrics({}, buildBrain({
      cacheHits: 4, fpSuppressions: 2, graphQueries: 5,
    })));
    expect(r.tokens_saved_estimate).toBe(4 * 15000 + 2 * 5000 + 5 * 3000);
    // Back-compat: estimated_tokens_saved matches the new tokens_saved_estimate.
    expect(r.estimated_tokens_saved).toBe(r.tokens_saved_estimate);
  });

  it('v0.10 — net_token_delta = saved − spent', async () => {
    const { handleCompoundingMetrics } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    const r = JSON.parse(handleCompoundingMetrics({}, buildBrain({
      cacheHits: 10,
      classificationsByTier: { trivial: 5 },
    })));
    expect(r.net_token_delta).toBe(r.tokens_saved_estimate - r.tokens_spent_estimate);
  });

  it('v0.10 — classification_accuracy_pct drops as FP entries accumulate', async () => {
    const { handleCompoundingMetrics } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    // 10 classifications, 2 FP entries → 80% accuracy
    const r = JSON.parse(handleCompoundingMetrics({}, buildBrain({
      entries: 5, fpEntries: 2, totalClassifications: 10,
    })));
    expect(r.classification_accuracy_pct).toBe(80);
  });

  it('v0.10 — appends a metrics snapshot on first call', async () => {
    const { handleCompoundingMetrics } = await import('../src/mcp/handlers.js');
    const { projectDataDir, metricsHistoryPath } = await import('../src/engine/paths.js');
    const { existsSync, readFileSync } = await import('node:fs');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    handleCompoundingMetrics({}, buildBrain({ entries: 2, cacheHits: 1 }));
    const histPath = metricsHistoryPath(projectRoot);
    expect(existsSync(histPath)).toBe(true);
    const lines = readFileSync(histPath, 'utf-8').trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    const snapshot = JSON.parse(lines[0]);
    expect(snapshot).toHaveProperty('ts');
    expect(snapshot).toHaveProperty('tokens_saved_estimate');
    expect(snapshot.cache_hits).toBe(1);
  });

  it('v0.10 — does NOT append a second snapshot within 7 days', async () => {
    const { handleCompoundingMetrics } = await import('../src/mcp/handlers.js');
    const { projectDataDir, metricsHistoryPath } = await import('../src/engine/paths.js');
    const { readFileSync } = await import('node:fs');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    handleCompoundingMetrics({}, buildBrain({ entries: 2, cacheHits: 1 }));
    handleCompoundingMetrics({}, buildBrain({ entries: 2, cacheHits: 2 }));
    const lines = readFileSync(metricsHistoryPath(projectRoot), 'utf-8').trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
  });
});

// ── knit_get_metrics_history ──────────────────────────────────────

describe('handleGetMetricsHistory', () => {
  it('returns empty when no history exists', async () => {
    const { handleGetMetricsHistory } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    const r = JSON.parse(handleGetMetricsHistory({}, buildBrain()));
    expect(r.snapshots).toEqual([]);
    expect(r.deltas).toEqual([]);
    expect(r.count).toBe(0);
  });

  it('returns snapshots + week-over-week deltas after multiple weeks accumulate', async () => {
    const { handleGetMetricsHistory } = await import('../src/mcp/handlers.js');
    const { projectDataDir, metricsHistoryPath } = await import('../src/engine/paths.js');
    const { appendFileSync } = await import('node:fs');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    // Hand-plant 3 weekly snapshots so we can assert deltas without sleeping for 14 days.
    const histPath = metricsHistoryPath(projectRoot);
    const week1 = { ts: '2026-04-01T00:00:00Z', sessions_recorded: 5, learnings_recorded: 3, cache_hits: 1, total_classifications: 10, plan_mode_triggers: 2, fp_suppressions: 0, graph_queries: 0, high_score_hits: 5, total_retrieval_queries: 10, tokens_spent_estimate: 5000, tokens_saved_estimate: 15000 };
    const week2 = { ts: '2026-04-08T00:00:00Z', sessions_recorded: 12, learnings_recorded: 8, cache_hits: 5, total_classifications: 22, plan_mode_triggers: 4, fp_suppressions: 2, graph_queries: 3, high_score_hits: 15, total_retrieval_queries: 22, tokens_spent_estimate: 15000, tokens_saved_estimate: 95000 };
    const week3 = { ts: '2026-04-15T00:00:00Z', sessions_recorded: 20, learnings_recorded: 14, cache_hits: 12, total_classifications: 35, plan_mode_triggers: 5, fp_suppressions: 4, graph_queries: 6, high_score_hits: 28, total_retrieval_queries: 35, tokens_spent_estimate: 25000, tokens_saved_estimate: 218000 };
    appendFileSync(histPath, JSON.stringify(week1) + '\n');
    appendFileSync(histPath, JSON.stringify(week2) + '\n');
    appendFileSync(histPath, JSON.stringify(week3) + '\n');

    const r = JSON.parse(handleGetMetricsHistory({}, buildBrain()));
    expect(r.count).toBe(3);
    expect(r.snapshots).toHaveLength(3);
    expect(r.deltas).toHaveLength(2);
    expect(r.deltas[0].tokens_saved_delta).toBe(95000 - 15000);
    expect(r.deltas[1].cache_hits_delta).toBe(12 - 5);
    expect(r.deltas[1].plan_mode_triggers_delta).toBe(5 - 4);
  });

  it('honors the limit parameter (default 12)', async () => {
    const { handleGetMetricsHistory } = await import('../src/mcp/handlers.js');
    const { projectDataDir, metricsHistoryPath } = await import('../src/engine/paths.js');
    const { appendFileSync } = await import('node:fs');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    const histPath = metricsHistoryPath(projectRoot);
    for (let i = 0; i < 20; i++) {
      appendFileSync(histPath, JSON.stringify({ ts: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`, sessions_recorded: i, learnings_recorded: i, cache_hits: i, total_classifications: i, plan_mode_triggers: 0, fp_suppressions: 0, graph_queries: 0, high_score_hits: 0, total_retrieval_queries: 0, tokens_spent_estimate: i * 100, tokens_saved_estimate: i * 200 }) + '\n');
    }

    const r12 = JSON.parse(handleGetMetricsHistory({}, buildBrain()));
    expect(r12.count).toBe(12);
    const r5 = JSON.parse(handleGetMetricsHistory({ limit: '5' }, buildBrain()));
    expect(r5.count).toBe(5);
    // Latest 5 means snapshots 16..20 (0-indexed: 15..19).
    expect(r5.snapshots[0].sessions_recorded).toBe(15);
    expect(r5.snapshots[4].sessions_recorded).toBe(19);
  });
});
