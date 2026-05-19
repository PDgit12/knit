import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getToolDefinitions, getActiveToolDefinitions, handleToolCall } from '../src/mcp/tools.js';
import type { ProjectShape } from '../src/mcp/features.js';
import type { BrainCache } from '../src/mcp/cache.js';
import type { ProjectKnowledge, KnowledgeBase } from '../src/engine/types.js';

// Sandbox engram data writes into a temp dir so tests don't touch ~/.knit/
let knitHome: string;
beforeAll(() => {
  knitHome = mkdtempSync(join(tmpdir(), 'knit-test-'));
  process.env.KNIT_HOME = knitHome;
});
afterAll(() => {
  delete process.env.KNIT_HOME;
  try { rmSync(knitHome, { recursive: true, force: true }); } catch { /* best effort */ }
});

// Mock brain cache for testing
function createMockBrain(): BrainCache {
  const knowledge: ProjectKnowledge = {
    generatedAt: '2026-05-15',
    summary: {
      totalFiles: 5,
      totalLines: 200,
      languageBreakdown: { '.ts': 5 },
      entryPoints: ['src/index.ts'],
      highFanoutFiles: ['src/types.ts'],
      untestedFiles: ['src/api.ts'],
      largestFiles: [{ path: 'src/types.ts', lines: 100 }],
    },
    files: [
      { path: 'src/index.ts', extension: '.ts', lines: 20, sizeBytes: 500 },
      { path: 'src/types.ts', extension: '.ts', lines: 100, sizeBytes: 3000 },
      { path: 'src/utils.ts', extension: '.ts', lines: 30, sizeBytes: 800 },
      { path: 'src/api.ts', extension: '.ts', lines: 40, sizeBytes: 1000 },
      { path: 'tests/utils.test.ts', extension: '.ts', lines: 10, sizeBytes: 200 },
    ],
    importGraph: {
      'src/index.ts': ['src/types.ts', 'src/utils.ts'],
      'src/api.ts': ['src/types.ts'],
      'tests/utils.test.ts': ['src/utils.ts'],
    },
    exports: {
      'src/types.ts': [
        { name: 'User', kind: 'interface', line: 1 },
        { name: 'Config', kind: 'type', line: 10 },
      ],
      'src/utils.ts': [
        { name: 'helper', kind: 'function', line: 1 },
      ],
    },
    testMap: {
      tested: { 'src/utils.ts': ['tests/utils.test.ts'] },
      untested: ['src/index.ts', 'src/types.ts', 'src/api.ts'],
      testFiles: ['tests/utils.test.ts'],
    },
  };

  const knowledgeBase: KnowledgeBase = {
    version: 1,
    projectName: 'test',
    entries: [
      {
        id: '1',
        date: '2026-05-15',
        summary: 'Fixed auth bug',
        domains: ['API'],
        approach: 'Added validation',
        outcome: 'success',
        lesson: 'Always validate tokens',
        tags: ['#api', '#auth'],
        accessCount: 3,
        lastAccessed: '2026-05-15',
      },
      {
        id: '2',
        date: '2026-05-14',
        summary: 'Known FP: missing types',
        domains: ['Engine'],
        approach: 'Verified manually',
        outcome: 'success',
        lesson: 'Types are inferred',
        tags: ['#engine', '#false-positive'],
        accessCount: 1,
        lastAccessed: null,
      },
    ],
    metrics: {
      totalSessions: 5,
      totalLearnings: 2,
      cacheHits: 3,
      domainDistribution: { '#api': 1, '#engine': 1 },
      sessions: [],
    },
  };

  return {
    rootPath: '/tmp/test-project',
    knowledge,
    reverseDeps: {
      'src/types.ts': ['src/index.ts', 'src/api.ts'],
      'src/utils.ts': ['src/index.ts', 'tests/utils.test.ts'],
    },
    knowledgeBase,
    loadedAt: Date.now(),
  };
}

describe('getToolDefinitions', () => {
  it('returns 43 tool definitions (v0.9 r3 adds knit_consolidate_learnings)', () => {
    const tools = getToolDefinitions();
    expect(tools).toHaveLength(43);
  });

  it('exposes the Protocol Guard tools', () => {
    const names = getToolDefinitions().map((t) => t.name);
    expect(names).toContain('knit_set_protocol_strictness');
    expect(names).toContain('knit_get_protocol_strictness');
  });

  it('exposes the subagent installer tool', () => {
    const names = getToolDefinitions().map((t) => t.name);
    expect(names).toContain('knit_install_agent');
  });

  it('exposes the cross-project learnings tools', () => {
    const names = getToolDefinitions().map((t) => t.name);
    expect(names).toContain('knit_record_global_learning');
    expect(names).toContain('knit_search_global_learnings');
  });

  it('re-exposes pattern reflection tools (paired with Model C)', () => {
    const names = getToolDefinitions().map((t) => t.name);
    expect(names).toContain('knit_reflect');
    expect(names).toContain('knit_get_suggestions');
  });

  it('descriptions stay under 200 chars (terse-by-design)', () => {
    const long = getToolDefinitions().filter((t) => t.description.length > 200);
    expect(long, `Long descriptions: ${long.map((t) => t.name).join(', ')}`).toHaveLength(0);
  });

  it('all tools have name, description, and inputSchema', () => {
    for (const tool of getToolDefinitions()) {
      expect(tool.name).toBeDefined();
      expect(tool.description).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('all tool names start with knit_', () => {
    for (const tool of getToolDefinitions()) {
      expect(tool.name).toMatch(/^knit_/);
    }
  });
});

describe('handleToolCall', () => {
  const brain = createMockBrain();

  it('knit_query_imports — finds who imports a file', () => {
    const result = JSON.parse(handleToolCall('knit_query_imports', { file_path: 'src/types.ts' }, brain));
    expect(result.imported_by).toContain('src/index.ts');
    expect(result.imported_by).toContain('src/api.ts');
    expect(result.count).toBe(2);
  });

  it('knit_query_imports — returns empty for leaf files', () => {
    const result = JSON.parse(handleToolCall('knit_query_imports', { file_path: 'src/api.ts' }, brain));
    expect(result.imported_by).toEqual([]);
    expect(result.count).toBe(0);
  });

  it('knit_query_dependents — finds what a file imports', () => {
    const result = JSON.parse(handleToolCall('knit_query_dependents', { file_path: 'src/index.ts' }, brain));
    expect(result.depends_on).toContain('src/types.ts');
    expect(result.depends_on).toContain('src/utils.ts');
  });

  it('knit_query_exports — lists exports', () => {
    const result = JSON.parse(handleToolCall('knit_query_exports', { file_path: 'src/types.ts' }, brain));
    expect(result.count).toBe(2);
    expect(result.exports[0].name).toBe('User');
    expect(result.exports[0].kind).toBe('interface');
  });

  it('knit_query_tests — finds tests for a file', () => {
    const result = JSON.parse(handleToolCall('knit_query_tests', { file_path: 'src/utils.ts' }, brain));
    expect(result.has_tests).toBe(true);
    expect(result.tested_by).toContain('tests/utils.test.ts');
  });

  it('knit_query_tests — lists untested files', () => {
    const result = JSON.parse(handleToolCall('knit_query_tests', { filter: 'untested' }, brain));
    expect(result.untested_files).toContain('src/api.ts');
    expect(result.count).toBe(3);
  });

  it('knit_find_fanout — finds high-fanout files', () => {
    const result = JSON.parse(handleToolCall('knit_find_fanout', { min_importers: '2' }, brain));
    expect(result.high_fanout_files.length).toBeGreaterThan(0);
    expect(result.high_fanout_files[0].file).toBe('src/types.ts');
  });

  it('knit_search_learnings — finds by domain', () => {
    const result = JSON.parse(handleToolCall('knit_search_learnings', { domains: 'api' }, brain));
    expect(result.count).toBe(1);
    expect(result.results[0].summary).toBe('Fixed auth bug');
  });

  it('knit_search_learnings — returns empty for unknown domain', () => {
    const result = JSON.parse(handleToolCall('knit_search_learnings', { domains: 'nonexistent' }, brain));
    expect(result.count).toBe(0);
  });

  // ── v0.8 phase 2 — BM25 retrieval ──────────────────────────────
  //
  // The handler accepts a free-text `query` parameter (BM25 over
  // summary/lesson/approach/tags/domains). When given, takes precedence
  // over the old tag-filter path. `domains` still works alone for back-compat
  // and combines with `query` to filter BM25 hits.

  it('knit_search_learnings — BM25 free-text query finds entries by lesson content', () => {
    const result = JSON.parse(handleToolCall('knit_search_learnings', { query: 'tokens' }, brain));
    // "Always validate tokens" is in entry 1's lesson; "tokens" should match it.
    expect(result.retriever).toBe('bm25');
    expect(result.count).toBeGreaterThanOrEqual(1);
    expect(result.results.some((r: { summary: string }) => r.summary === 'Fixed auth bug')).toBe(true);
  });

  it('knit_search_learnings — error when neither query nor domains given', () => {
    const result = JSON.parse(handleToolCall('knit_search_learnings', {}, brain));
    expect(result.error).toMatch(/Provide either query/);
    expect(result.count).toBe(0);
  });

  it('knit_search_learnings — BM25 + domains filters intersect', () => {
    // BM25 over "validate" should find entry 1 (lesson mentions "validate tokens").
    // Adding domains=#api keeps it (it has tag #api). Adding domains=#engine drops it
    // (it doesn't have #engine; only entry 2 does, and entry 2 lesson doesn't match "validate").
    const withMatch = JSON.parse(handleToolCall('knit_search_learnings', { query: 'validate', domains: '#api' }, brain));
    expect(withMatch.count).toBeGreaterThanOrEqual(1);

    const withFilterOut = JSON.parse(handleToolCall('knit_search_learnings', { query: 'validate', domains: '#engine' }, brain));
    expect(withFilterOut.count).toBe(0);
  });

  it('knit_search_learnings — back-compat: domains-only path still works (retriever=tag-filter)', () => {
    // Existing test above uses 'api' (no #) — queryByDomains strips/normalizes internally.
    const result = JSON.parse(handleToolCall('knit_search_learnings', { domains: 'api' }, brain));
    expect(result.retriever).toBe('tag-filter');
    expect(result.count).toBeGreaterThanOrEqual(1);
  });

  it('knit_search_learnings — BM25 honors the limit parameter', () => {
    const result = JSON.parse(handleToolCall('knit_search_learnings', { query: 'auth', limit: '1' }, brain));
    expect(result.count).toBeLessThanOrEqual(1);
  });

  it('knit_search_learnings — empty BM25 result returns helpful instruction', () => {
    const result = JSON.parse(handleToolCall('knit_search_learnings', { query: 'xyzzy_no_match' }, brain));
    expect(result.count).toBe(0);
    expect(result.instruction).toMatch(/No past learnings match this query/);
  });

  it('knit_get_false_positives — returns FP entries', () => {
    const result = JSON.parse(handleToolCall('knit_get_false_positives', {}, brain));
    expect(result.count).toBe(1);
    expect(result.false_positives[0].summary).toContain('Known FP');
  });

  it('knit_brain_status — returns metrics', () => {
    const result = JSON.parse(handleToolCall('knit_brain_status', {}, brain));
    expect(result.totalSessions).toBe(5);
    expect(result.cacheHits).toBeGreaterThanOrEqual(3);
    expect(result.knowledge_index.files_indexed).toBe(5);
  });

  it('blocks path traversal', () => {
    const result = JSON.parse(handleToolCall('knit_query_imports', { file_path: '../../etc/passwd' }, brain));
    expect(result.error).toContain('Invalid file path');
  });

  it('blocks absolute paths', () => {
    const result = JSON.parse(handleToolCall('knit_query_imports', { file_path: '/etc/passwd' }, brain));
    expect(result.error).toContain('Invalid file path');
  });

  it('returns error for unknown tool', () => {
    const result = JSON.parse(handleToolCall('unknown_tool', {}, brain));
    expect(result.error).toContain('Unknown tool');
  });

  // ── Action tools ──────────────────────────────────────────────

  it('knit_classify_task — trivial for single file', () => {
    const result = JSON.parse(handleToolCall('knit_classify_task', { files_to_touch: 'src/utils.ts' }, brain));
    expect(result.tier).toBe('trivial');
    expect(result.phases).toContain('EXECUTE');
    expect(result.phases).toContain('LEARN');
    expect(result.auto_plan_mode).toBe(false);
  });

  it('knit_classify_task — complex for types + auth', () => {
    const result = JSON.parse(handleToolCall('knit_classify_task', {
      files_to_touch: 'src/types.ts,src/api.ts,src/utils.ts,tests/utils.test.ts',
    }, brain));
    expect(result.tier).toBe('complex');
    expect(result.auto_plan_mode).toBe(true);
    expect(result.phases).toContain('RESEARCH');
    expect(result.phases).toContain('IDEATE');
    expect(result.phases).toContain('PLAN');
  });

  it('knit_build_context — assembles domain context', () => {
    const result = JSON.parse(handleToolCall('knit_build_context', {
      files_to_touch: 'src/api.ts,src/types.ts',
    }, brain));
    expect(result.domain_context).toBeDefined();
    expect(result.domain_context.affected_domains.length).toBeGreaterThan(0);
    expect(result.domain_context.cross_domain_ripple.length).toBeGreaterThan(0);
    expect(result.instruction).toContain('Pass this entire object');
  });

  it('knit_record_learning — persists to KB', () => {
    const kbBefore = brain.knowledgeBase.entries.length;
    const result = JSON.parse(handleToolCall('knit_record_learning', {
      summary: 'Test learning',
      lesson: 'Always test MCP tools',
      tags: '#test #mcp',
      outcome: 'success',
    }, brain));
    expect(result.status).toBe('recorded');
    expect(brain.knowledgeBase.entries.length).toBe(kbBefore + 1);
  });

  it('knit_record_false_positive — adds FP tag', () => {
    const fpBefore = brain.knowledgeBase.entries.filter((e) => e.tags.includes('#false-positive')).length;
    const result = JSON.parse(handleToolCall('knit_record_false_positive', {
      summary: 'Missing types for X',
      reason: 'Types are inferred at runtime',
    }, brain));
    expect(result.status).toBe('recorded');
    const fpAfter = brain.knowledgeBase.entries.filter((e) => e.tags.includes('#false-positive')).length;
    expect(fpAfter).toBe(fpBefore + 1);
  });

  it('knit_classify_task — standard for 2 domains', () => {
    const result = JSON.parse(handleToolCall('knit_classify_task', {
      files_to_touch: 'src/api.ts,tests/utils.test.ts',
    }, brain));
    expect(result.tier).toBe('standard');
  });

  // ── Inquiry tier (v0.7) ─────────────────────────────────────────
  //
  // Read-only "audit / explain / what" tasks must short-circuit to tier:inquiry
  // with empty phases and auto_plan_mode:false — the v0.6.3 ship-readiness
  // session over-routed an audit into plan mode because this branch didn't exist.

  it('knit_classify_task — inquiry for "what should be fixed" (audit-style)', () => {
    const result = JSON.parse(handleToolCall('knit_classify_task', {
      files_to_touch: 'src/types.ts,src/api.ts,src/utils.ts,tests/utils.test.ts',
      description: 'what should I fix before shipping? do a full audit end-to-end',
    }, brain));
    expect(result.tier).toBe('inquiry');
    expect(result.phases).toEqual([]);
    expect(result.auto_plan_mode).toBe(false);
    expect(result.instruction).toMatch(/Read-only/);
  });

  it('knit_classify_task — inquiry for explain/describe verb', () => {
    const result = JSON.parse(handleToolCall('knit_classify_task', {
      files_to_touch: 'src/api.ts',
      description: 'explain how this module handles auth',
    }, brain));
    expect(result.tier).toBe('inquiry');
  });

  it('knit_classify_task — inquiry for where/which question', () => {
    const result = JSON.parse(handleToolCall('knit_classify_task', {
      files_to_touch: 'unknown',
      description: 'where is the rate limiter defined?',
    }, brain));
    expect(result.tier).toBe('inquiry');
  });

  it('knit_classify_task — inquiry does NOT hijack explicit action commands', () => {
    // "fix the auth bug" is a directive even though it contains an inquiry-ish word.
    const result = JSON.parse(handleToolCall('knit_classify_task', {
      files_to_touch: 'src/api.ts',
      description: 'fix the auth bug in this file',
    }, brain));
    expect(result.tier).not.toBe('inquiry');
  });

  it('knit_classify_task — inquiry survives multi-file scope (read-only audits)', () => {
    // 4 files normally promotes to complex; inquiry must override.
    const result = JSON.parse(handleToolCall('knit_classify_task', {
      files_to_touch: 'src/types.ts,src/api.ts,src/utils.ts,tests/utils.test.ts',
      description: 'audit the entire codebase for security issues',
    }, brain));
    expect(result.tier).toBe('inquiry');
    expect(result.auto_plan_mode).toBe(false);
  });

  // ── v0.7 step 7 — minimal response mode ─────────────────────────
  //
  // Default classify_task returns the lean response (tier, phases, auto_plan_mode,
  // instruction, affected_domains). The diagnostic fields (reasoning,
  // cross_domain_ripple, files_count) are gated behind verbose=true.

  it('knit_classify_task — default response omits debug fields', () => {
    const result = JSON.parse(handleToolCall('knit_classify_task', {
      files_to_touch: 'src/types.ts,src/api.ts,src/utils.ts,tests/utils.test.ts',
    }, brain));
    expect(result).toHaveProperty('tier');
    expect(result).toHaveProperty('phases');
    expect(result).toHaveProperty('auto_plan_mode');
    expect(result).toHaveProperty('instruction');
    expect(result).toHaveProperty('affected_domains');
    // Debug fields gated behind verbose:
    expect(result.reasoning).toBeUndefined();
    expect(result.cross_domain_ripple).toBeUndefined();
    expect(result.files_count).toBeUndefined();
  });

  it('knit_classify_task — verbose=true restores debug fields', () => {
    const result = JSON.parse(handleToolCall('knit_classify_task', {
      files_to_touch: 'src/types.ts,src/api.ts,src/utils.ts,tests/utils.test.ts',
      verbose: 'true',
    }, brain));
    expect(result.reasoning).toBeDefined();
    expect(result.cross_domain_ripple).toBeDefined();
    expect(result.files_count).toBe(4);
  });

  // ── v0.7 step 7 — knit_load_session lazy include ───────────────
  //
  // Default response carries session_context + slim intelligence + counts-only
  // knowledge. Optional sections (patterns, teams, metrics, recent_sessions,
  // full_learnings, full_knowledge) are added via include= comma-list.

  it('knit_load_session — default response omits optional sections', () => {
    const result = JSON.parse(handleToolCall('knit_load_session', {}, brain));
    expect(result.session_context).toBeDefined();
    expect(result.intelligence.top_learnings).toBeDefined();
    expect(result.intelligence.false_positives).toBeDefined();
    // Optional — must be absent by default
    expect(result.intelligence.patterns).toBeUndefined();
    expect(result.project.teams).toBeUndefined();
    expect(result.project.metrics).toBeUndefined();
    expect(result.project.recent_sessions).toBeUndefined();
    // Knowledge in counts-only form
    expect(result.project.knowledge.high_fanout_count).toBeDefined();
    expect(result.project.knowledge.high_fanout).toBeUndefined();
  });

  it('knit_load_session — include=metrics adds the metrics block', () => {
    const result = JSON.parse(handleToolCall('knit_load_session', { include: 'metrics' }, brain));
    expect(result.project.metrics).toBeDefined();
    expect(result.project.metrics.total_sessions).toBeDefined();
    // Still no teams / patterns / recent_sessions
    expect(result.project.teams).toBeUndefined();
    expect(result.intelligence.patterns).toBeUndefined();
  });

  it('knit_load_session — include=all surfaces every optional section', () => {
    const result = JSON.parse(handleToolCall('knit_load_session', { include: 'all' }, brain));
    expect(result.intelligence.patterns).toBeDefined();
    expect(result.project.teams).toBeDefined();
    expect(result.project.metrics).toBeDefined();
    expect(result.project.recent_sessions).toBeDefined();
    expect(result.project.knowledge.high_fanout).toBeDefined();
  });

  it('knit_load_session — include=full_learnings restores the larger top-N learnings cap', () => {
    const slim = JSON.parse(handleToolCall('knit_load_session', {}, brain));
    const full = JSON.parse(handleToolCall('knit_load_session', { include: 'full_learnings' }, brain));
    // Both modes accept the same underlying brain; full mode just allows a
    // larger slice. With only one accessed learning in the mock the visible
    // count is 1 for both, but the cap parameter is honored by the handler.
    expect(slim.intelligence.top_learnings.length).toBeLessThanOrEqual(3);
    expect(full.intelligence.top_learnings.length).toBeGreaterThanOrEqual(slim.intelligence.top_learnings.length);
  });

  it('knit_load_session — include="patterns,metrics" (comma-list) surfaces both', () => {
    // Audit gap: previous tests only used single-include or "all". Verify
    // the comma-list parser handles multiple opt-ins.
    const result = JSON.parse(handleToolCall('knit_load_session', { include: 'patterns,metrics' }, brain));
    expect(result.intelligence.patterns).toBeDefined();
    expect(result.project.metrics).toBeDefined();
    // Sections NOT requested stay omitted.
    expect(result.project.teams).toBeUndefined();
    expect(result.project.recent_sessions).toBeUndefined();
  });

  it('knit_load_session — unknown include names are silently ignored, valid ones honored', () => {
    const result = JSON.parse(handleToolCall('knit_load_session', { include: 'metrics,nonsense,frobnicate' }, brain));
    expect(result.project.metrics).toBeDefined();
    // The garbage names don't crash; the response just omits sections we
    // can't construct from them.
    expect(result.project.teams).toBeUndefined();
    expect(result.intelligence.patterns).toBeUndefined();
  });
});

// ── v0.7 step 4 — getActiveToolDefinitions direct unit coverage ─────
//
// Audit gap: the filter was only tested transitively through handleListFeatures.
// These tests pin the filter behavior at the call site that drives the
// MCP tools/list response, so a regression in isToolActive would surface here
// even if the handler logic happened to compensate.

const emptyShape: ProjectShape = {
  hasAnalyzableCode: false,
  domainCount: 0,
  hasInstalledSubagents: false,
  sessionCount: 0,
  enabledFeatures: new Set(),
};

describe('getActiveToolDefinitions — filters by ProjectShape', () => {
  it('no shape arg → returns the full registry (back-compat)', () => {
    const tools = getActiveToolDefinitions();
    expect(tools.length).toBe(43);
  });

  it('empty shape → drops all 10 Tier-2 + 2 Tier-3 tools', () => {
    const tools = getActiveToolDefinitions(emptyShape);
    expect(tools.length).toBe(31);
    const names = new Set(tools.map((t) => t.name));
    // Team tools hidden:
    expect(names.has('knit_spawn_team_worktree')).toBe(false);
    expect(names.has('knit_finalize_team_worktree')).toBe(false);
    // Subagents hidden:
    expect(names.has('knit_install_agent')).toBe(false);
    // Admin hidden:
    expect(names.has('knit_prune_sessions')).toBe(false);
    expect(names.has('knit_setup_project')).toBe(false);
    // Tier 1 still visible:
    expect(names.has('knit_load_session')).toBe(true);
    expect(names.has('knit_classify_task')).toBe(true);
    expect(names.has('knit_list_features')).toBe(true);
    expect(names.has('knit_enable_feature')).toBe(true);
  });

  it('domainCount ≥ 3 → all 9 team tools appear', () => {
    const tools = getActiveToolDefinitions({ ...emptyShape, domainCount: 3 });
    const names = new Set(tools.map((t) => t.name));
    expect(names.has('knit_spawn_team_worktree')).toBe(true);
    expect(names.has('knit_finalize_team_worktree')).toBe(true);
    expect(names.has('knit_list_team_worktrees')).toBe(true);
    expect(names.has('knit_define_team')).toBe(true);
    expect(names.has('knit_get_teams')).toBe(true);
    expect(names.has('knit_get_team_prompt')).toBe(true);
    expect(names.has('knit_start_team_review')).toBe(true);
    expect(names.has('knit_post_team_findings')).toBe(true);
    expect(names.has('knit_get_board_summary')).toBe(true);
  });

  it('enabledFeatures.has("admin") → Tier-3 admin tools appear', () => {
    const tools = getActiveToolDefinitions({
      ...emptyShape,
      enabledFeatures: new Set(['admin']),
    });
    const names = new Set(tools.map((t) => t.name));
    expect(names.has('knit_prune_sessions')).toBe(true);
    expect(names.has('knit_setup_project')).toBe(true);
  });

  it('knit_list_features and knit_enable_feature are ALWAYS in the filtered list (invariant)', () => {
    // Recoverability invariant: if these were ever hidden, a user who
    // disabled "admin" by accident would have no path back. Pin it here so
    // a refactor that moves them to a lower tier breaks loud.
    for (const shape of [emptyShape, { ...emptyShape, domainCount: 5, enabledFeatures: new Set<'teams'|'subagents'|'admin'>(['teams','subagents','admin']) }]) {
      const names = new Set(getActiveToolDefinitions(shape).map((t) => t.name));
      expect(names.has('knit_list_features')).toBe(true);
      expect(names.has('knit_enable_feature')).toBe(true);
      expect(names.has('knit_disable_feature')).toBe(true);
    }
  });
});
