/**
 * v0.22 Batch B — full tool-use. classify returns an ordered tool_plan,
 * build_context returns suggested_tools, get_workflow returns a phase→tool map,
 * and learnings are surfaced as token-lean headlines (id + preview) not full
 * lesson bodies.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  handleClassifyTask,
  handleBuildContext,
  handleGetWorkflow,
  handleSearchLearnings,
  handleGetLearning,
  handleOnboard,
} from '../src/mcp/handlers.js';
import { savePreferences } from '../src/engine/preferences.js';
import { setActiveHost, resetActiveHost, classifyHost } from '../src/mcp/host.js';
import type { BrainCache } from '../src/mcp/cache.js';
import type { ProjectKnowledge, KnowledgeBase, KnitConfig } from '../src/engine/types.js';

let knitHome: string;
beforeAll(() => { knitHome = mkdtempSync(join(tmpdir(), 'knit-ftu-')); process.env.KNIT_HOME = knitHome; });
afterAll(() => { delete process.env.KNIT_HOME; try { rmSync(knitHome, { recursive: true, force: true }); } catch { /* */ } });

function mockBrain(): BrainCache {
  const knowledge: ProjectKnowledge = {
    generatedAt: new Date().toISOString(),
    summary: {
      totalFiles: 6, totalLines: 600, languageBreakdown: { '.ts': 6 },
      entryPoints: [], highFanoutFiles: ['src/api/auth.ts'], untestedFiles: ['src/api/auth.ts'],
      largestFiles: [],
    },
    files: [
      { path: 'src/api/auth.ts', extension: '.ts', lines: 100, sizeBytes: 3000 },
      { path: 'src/components/Button.tsx', extension: '.tsx', lines: 50, sizeBytes: 1500 },
      { path: 'src/lib/util.ts', extension: '.ts', lines: 40, sizeBytes: 1000 },
    ],
    importGraph: { 'src/api/auth.ts': ['src/lib/util.ts'] },
    exports: { 'src/api/auth.ts': [{ name: 'login', kind: 'function', line: 1 }] },
    testMap: { tested: {}, untested: ['src/api/auth.ts'], testFiles: [] },
  };
  const knowledgeBase: KnowledgeBase = {
    version: 1, projectName: 'ftu',
    entries: [{
      id: 'L1', date: '2026-05-20', summary: 'Auth token refresh race',
      domains: ['API & Security'], approach: 'mutex', outcome: 'success',
      lesson: 'The token refresh had a race condition. ' + 'x'.repeat(400),
      tags: ['#api', '#auth'], accessCount: 0, lastAccessed: null,
    }],
    metrics: { totalSessions: 1, totalLearnings: 1, cacheHits: 0, domainDistribution: {}, sessions: [] },
  };
  const config = { name: 'ftu', packageManager: 'npm', stack: {}, domains: [], targetAgent: 'claude-code', tokenOptimization: 'standard' } as unknown as KnitConfig;
  return {
    rootPath: '/tmp/ftu-project',
    knowledge,
    // auth.ts has 3 dependents → high-fanout (ripple) trigger.
    reverseDeps: { 'src/api/auth.ts': ['src/x.ts', 'src/y.ts', 'src/z.ts'] },
    knowledgeBase, config, loadedAt: Date.now(),
  } as unknown as BrainCache;
}

const MULTI = 'src/api/auth.ts, src/components/Button.tsx, src/lib/util.ts';

describe('classify tool_plan', () => {
  it('emits an ordered, signal-gated tool_plan for a multi-domain, high-fanout task', () => {
    const res = JSON.parse(handleClassifyTask({ files_to_touch: MULTI, description: 'rework the auth/session flow across UI and lib' }, mockBrain()));
    expect(Array.isArray(res.tool_plan)).toBe(true);
    const tools = res.tool_plan.map((s: { tool: string }) => s.tool);
    expect(tools).toContain('knit_query_imports');       // auth.ts is high-fanout
    expect(tools).toContain('knit_query_dependents');    // auth → security blast radius
    expect(tools).toContain('knit_spawn_team_worktree'); // ≥3 domains
    expect(tools).toContain('knit_record_learning');     // standard+ LEARN gate
    // Every step carries a phase + a why.
    for (const step of res.tool_plan) {
      expect(step.phase).toBeTruthy();
      expect(step.why).toBeTruthy();
    }
  });

  it('drops tool_plan entirely under budget pressure (token discipline)', () => {
    const res = JSON.parse(handleClassifyTask({ files_to_touch: MULTI, description: 'rework auth', context_budget_remaining: '10' }, mockBrain()));
    expect(res.degraded_for_budget).toBe(true);
    expect(res.tool_plan).toBeUndefined();
  });

  it('right-sizes: a single trivial docs file gets no graph/team tools', () => {
    const res = JSON.parse(handleClassifyTask({ files_to_touch: 'README.md', description: 'fix a typo' }, mockBrain()));
    const tools = (res.tool_plan || []).map((s: { tool: string }) => s.tool);
    expect(tools).not.toContain('knit_spawn_team_worktree');
    expect(tools).not.toContain('knit_query_imports');
  });
});

describe('classify host_orchestration (Batch C)', () => {
  afterAll(() => resetActiveHost());

  it('attaches a host-tailored directive on a complex cross-cutting task', () => {
    setActiveHost(classifyHost({ name: 'cursor' }));
    const res = JSON.parse(handleClassifyTask({ files_to_touch: MULTI, description: 'architect a new cross-domain system spanning auth, UI and lib over many commits' }, mockBrain()));
    expect(res.tier).toBe('complex');
    expect(res.host_orchestration).toMatch(/parallel worktree agents/i);
  });

  it('switches the directive when the host changes', () => {
    setActiveHost(classifyHost({ name: 'claude-code' }));
    const res = JSON.parse(handleClassifyTask({ files_to_touch: MULTI, description: 'architect a new cross-domain system spanning auth, UI and lib over many commits' }, mockBrain()));
    expect(res.host_orchestration).toMatch(/dynamic workflow/i);
  });

  it('omits host_orchestration for a non-complex single-domain task', () => {
    setActiveHost(classifyHost({ name: 'cursor' }));
    const res = JSON.parse(handleClassifyTask({ files_to_touch: 'src/lib/util.ts', description: 'tweak a helper' }, mockBrain()));
    expect(res.host_orchestration).toBeUndefined();
  });
});

describe('onboarding prefs steer classify (Batch E)', () => {
  const ROOT = '/tmp/ftu-project'; // matches mockBrain().rootPath
  const basePrefs = {
    version: 1 as const, projectDescription: 'p', intent: 'i', strictness: null,
    focusDomains: [], orchestration: 'auto' as const, tokenMode: 'standard' as const,
    onboardedAt: '2026-05-30T00:00:00Z',
  };
  afterAll(() => resetActiveHost());

  it('orchestration=off suppresses host_orchestration even on a complex cross-cutting task', () => {
    setActiveHost(classifyHost({ name: 'cursor' }));
    savePreferences(ROOT, { ...basePrefs, orchestration: 'off' });
    const res = JSON.parse(handleClassifyTask({ files_to_touch: MULTI, description: 'architect a new cross-domain system spanning auth, UI and lib over many commits' }, mockBrain()));
    expect(res.tier).toBe('complex');
    expect(res.host_orchestration).toBeUndefined();
    savePreferences(ROOT, basePrefs); // restore for other tests
  });

  it('token_mode=lean surfaces at most ONE pre-emptive learning headline', () => {
    savePreferences(ROOT, { ...basePrefs, tokenMode: 'lean' });
    const res = JSON.parse(handleClassifyTask({ files_to_touch: 'src/api/auth.ts', description: 'fix the auth token refresh race condition' }, mockBrain()));
    if (res.pre_emptive_learnings) expect(res.pre_emptive_learnings.length).toBeLessThanOrEqual(1);
    savePreferences(ROOT, basePrefs);
  });

  it('emits a proactive handoff_nudge when the context budget is low', () => {
    const res = JSON.parse(handleClassifyTask({ files_to_touch: MULTI, description: 'rework auth', context_budget_remaining: '15' }, mockBrain()));
    expect(res.handoff_nudge).toMatch(/knit_save_handoff/);
  });

  it('onboard accepts + echoes orchestration + token_mode', () => {
    const res = JSON.parse(handleOnboard({ project_description: 'p', intent: 'i', orchestration: 'off', token_mode: 'lean' }, mockBrain()));
    expect(res.orchestration).toBe('off');
    expect(res.token_mode).toBe('lean');
    savePreferences(ROOT, basePrefs);
  });
});

describe('classify pre_emptive_learnings are headlines, not full lessons', () => {
  it('returns id + summary + short preview, never the full lesson body', () => {
    const res = JSON.parse(handleClassifyTask({ files_to_touch: 'src/api/auth.ts', description: 'fix the auth token refresh race condition' }, mockBrain()));
    if (res.pre_emptive_learnings) {
      for (const l of res.pre_emptive_learnings) {
        expect(l.id).toBeTruthy();
        expect(l).not.toHaveProperty('lesson');
        expect(l.lesson_preview.length).toBeLessThanOrEqual(170);
      }
    }
  });
});

describe('build_context suggested_tools', () => {
  it('names graph/coverage tools gated by ripple + untested + domain count', () => {
    const res = JSON.parse(handleBuildContext({ files_to_touch: MULTI }, mockBrain()));
    const dc = res.domain_context;
    expect(Array.isArray(dc.suggested_tools)).toBe(true);
    const names = dc.suggested_tools.map((t: { name: string }) => t.name);
    expect(names).toContain('knit_query_imports');       // auth.ts ripple
    expect(names).toContain('knit_query_tests');         // auth.ts untested
    expect(names).toContain('knit_spawn_team_worktree'); // ≥3 domains
    // pitfalls are previews with an id, not full lessons
    for (const p of dc.known_pitfalls) expect(p).toMatch(/^\[L\d+\]/);
  });
});

describe('get_workflow phase→tool map', () => {
  it('attaches tools_for_phase for a known phase', () => {
    const res = JSON.parse(handleGetWorkflow({ phase: 'review' }, mockBrain()));
    expect(Array.isArray(res.tools_for_phase)).toBe(true);
    expect(res.tools_for_phase.map((t: { tool: string }) => t.tool)).toContain('knit_verify_claim');
  });
});

describe('search_learnings hierarchical retrieval', () => {
  it('returns headlines (id + preview) and get_learning pays for the full lesson', () => {
    const brain = mockBrain();
    const search = JSON.parse(handleSearchLearnings({ query: 'auth token refresh' }, brain));
    expect(search.count).toBeGreaterThanOrEqual(1);
    const hit = search.results[0];
    expect(hit.id).toBe('L1');
    expect(hit).not.toHaveProperty('lesson');
    expect(hit.lesson_preview.length).toBeLessThanOrEqual(170);

    const full = JSON.parse(handleGetLearning({ id: 'L1' }, brain));
    expect(full.lesson.length).toBeGreaterThan(200); // the real body, on demand
  });
});
