import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * v0.9 #10 — knit_consolidate_learnings.
 *
 * Cluster similar learnings via tag-Jaccard ≥ 0.5, propose a single pattern
 * entry per cluster, optionally commit. Dry-run by default. The architectural
 * fix for "model has its own context limits" (limit D) — keep the working
 * set small by collapsing redundant learnings into patterns over time.
 */

let knitHome: string;
let projectRoot: string;

beforeEach(() => {
  knitHome = mkdtempSync(join(tmpdir(), 'knit-consol-test-'));
  process.env.KNIT_HOME = knitHome;
  projectRoot = mkdtempSync(join(tmpdir(), 'knit-consol-project-'));
});

afterEach(() => {
  delete process.env.KNIT_HOME;
  try { rmSync(knitHome, { recursive: true, force: true }); } catch { /* best-effort */ }
  try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* best-effort */ }
});

function buildBrain(entryConfigs: Array<{ id: string; summary: string; lesson: string; tags: string[]; access?: number }>) {
  const entries = entryConfigs.map((c) => ({
    id: c.id,
    date: '2026-05-19',
    summary: c.summary,
    domains: ['general'],
    approach: '',
    outcome: 'success' as const,
    lesson: c.lesson,
    tags: c.tags,
    accessCount: c.access ?? 0,
    lastAccessed: null,
  }));
  return {
    rootPath: projectRoot,
    knowledge: {
      generatedAt: new Date().toISOString(),
      summary: { totalFiles: 0, totalLines: 0, languageBreakdown: {}, entryPoints: [], highFanoutFiles: [], untestedFiles: [], largestFiles: [] },
      files: [], importGraph: {}, exports: {}, testMap: { tested: {}, untested: [], testFiles: [] },
    },
    reverseDeps: {},
    knowledgeBase: { version: 1, projectName: 'test', entries, metrics: { totalSessions: 0, totalLearnings: entries.length, cacheHits: 0, domainDistribution: {}, sessions: [] } },
    config: { name: 'test', packageManager: 'npm', stack: { language: 'typescript', dependencies: [], buildCommand: '', lintCommand: '', typecheckCommand: '' }, domains: [], targetAgent: 'claude-code', tokenOptimization: 'standard' },
    loadedAt: Date.now(),
    autoInitialized: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('knit_consolidate_learnings', () => {
  it('returns no-op when KB has fewer than min_cluster_size entries', async () => {
    const { handleConsolidateLearnings } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    const brain = buildBrain([
      { id: '1', summary: 'a', lesson: 'a', tags: ['#auth'] },
    ]);
    const resp = JSON.parse(handleConsolidateLearnings({}, brain));
    expect(resp.status).toBe('no-op');
    expect(resp.clusters).toEqual([]);
  });

  it('returns no-op when no cluster meets the Jaccard threshold', async () => {
    const { handleConsolidateLearnings } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    // Three entries with completely disjoint tags → no cluster forms.
    const brain = buildBrain([
      { id: '1', summary: 'a', lesson: 'a', tags: ['#auth'] },
      { id: '2', summary: 'b', lesson: 'b', tags: ['#payments'] },
      { id: '3', summary: 'c', lesson: 'c', tags: ['#testing'] },
    ]);
    const resp = JSON.parse(handleConsolidateLearnings({}, brain));
    expect(resp.status).toBe('no-op');
    // No-op path returns clusters: [] directly, not clusters_found: 0.
    expect(resp.clusters).toEqual([]);
  });

  it('clusters entries with high tag overlap (Jaccard ≥ 0.5) by default', async () => {
    const { handleConsolidateLearnings } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    const brain = buildBrain([
      { id: '1', summary: 'auth A', lesson: 'rotate', tags: ['#auth', '#security'], access: 5 },
      { id: '2', summary: 'auth B', lesson: 'invalidate', tags: ['#auth', '#security'] },
      { id: '3', summary: 'auth C', lesson: 'verify', tags: ['#auth', '#security'] },
      { id: '4', summary: 'unrelated', lesson: 'whatever', tags: ['#dx'] },
    ]);
    const resp = JSON.parse(handleConsolidateLearnings({}, brain));
    expect(resp.status).toBe('dry-run');
    expect(resp.clusters_found).toBe(1);
    expect(resp.proposals[0].cluster_size).toBe(3);
    expect(resp.proposals[0].member_ids).toEqual(expect.arrayContaining(['1', '2', '3']));
    // Seed = entry with highest accessCount
    expect(resp.proposals[0].seed_id).toBe('1');
  });

  it('dry-run does NOT modify the knowledge base', async () => {
    const { handleConsolidateLearnings } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    const brain = buildBrain([
      { id: '1', summary: 'a', lesson: 'a', tags: ['#auth', '#security'] },
      { id: '2', summary: 'b', lesson: 'b', tags: ['#auth', '#security'] },
      { id: '3', summary: 'c', lesson: 'c', tags: ['#auth', '#security'] },
    ]);
    const sizeBefore = brain.knowledgeBase.entries.length;
    const tagsBefore = brain.knowledgeBase.entries.flatMap((e: { tags: string[] }) => e.tags);

    handleConsolidateLearnings({}, brain);

    expect(brain.knowledgeBase.entries.length).toBe(sizeBefore);
    expect(brain.knowledgeBase.entries.flatMap((e: { tags: string[] }) => e.tags)).toEqual(tagsBefore);
  });

  it('commit=true persists pattern entry + tags originals as #consolidated', async () => {
    const { handleConsolidateLearnings } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    const brain = buildBrain([
      { id: '1', summary: 'a', lesson: 'a', tags: ['#auth', '#security'], access: 5 },
      { id: '2', summary: 'b', lesson: 'b', tags: ['#auth', '#security'] },
      { id: '3', summary: 'c', lesson: 'c', tags: ['#auth', '#security'] },
    ]);

    const resp = JSON.parse(handleConsolidateLearnings({ commit: 'true' }, brain));
    expect(resp.status).toBe('committed');
    expect(resp.committed).toBe(1);

    // Originals got the consolidated tag
    const originals = brain.knowledgeBase.entries.filter((e: { id: string }) => ['1', '2', '3'].includes(e.id));
    for (const e of originals) {
      expect(e.tags).toContain('#consolidated');
    }
    // A new pattern entry was added
    const patterns = brain.knowledgeBase.entries.filter((e: { tags: string[] }) => e.tags.includes('#pattern'));
    expect(patterns.length).toBe(1);
  });

  it('honors a custom min_cluster_size', async () => {
    const { handleConsolidateLearnings } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    const brain = buildBrain([
      { id: '1', summary: 'a', lesson: 'a', tags: ['#auth'] },
      { id: '2', summary: 'b', lesson: 'b', tags: ['#auth'] },
    ]);
    // Default min_cluster_size=3 → no clusters. min_cluster_size=2 → cluster forms.
    const respDefault = JSON.parse(handleConsolidateLearnings({}, brain));
    expect(respDefault.status).toBe('no-op');

    const respLowered = JSON.parse(handleConsolidateLearnings({ min_cluster_size: '2' }, brain));
    expect(respLowered.status).toBe('dry-run');
    expect(respLowered.clusters_found).toBe(1);
  });

  it('skips already-consolidated entries on subsequent runs', async () => {
    const { handleConsolidateLearnings } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    const brain = buildBrain([
      { id: '1', summary: 'a', lesson: 'a', tags: ['#auth', '#security', '#consolidated'] },
      { id: '2', summary: 'b', lesson: 'b', tags: ['#auth', '#security', '#consolidated'] },
      { id: '3', summary: 'c', lesson: 'c', tags: ['#auth', '#security'] },
    ]);
    const resp = JSON.parse(handleConsolidateLearnings({}, brain));
    // Only one non-consolidated entry — below threshold.
    expect(resp.status).toBe('no-op');
  });
});
