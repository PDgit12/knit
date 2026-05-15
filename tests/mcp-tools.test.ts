import { describe, it, expect } from 'vitest';
import { getToolDefinitions, handleToolCall } from '../src/mcp/tools.js';
import type { BrainCache } from '../src/mcp/cache.js';
import type { ProjectKnowledge, KnowledgeBase } from '../src/engine/types.js';

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
  it('returns 19 tool definitions', () => {
    const tools = getToolDefinitions();
    expect(tools).toHaveLength(19);
  });

  it('all tools have name, description, and inputSchema', () => {
    for (const tool of getToolDefinitions()) {
      expect(tool.name).toBeDefined();
      expect(tool.description).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('all tool names start with engram_', () => {
    for (const tool of getToolDefinitions()) {
      expect(tool.name).toMatch(/^engram_/);
    }
  });
});

describe('handleToolCall', () => {
  const brain = createMockBrain();

  it('engram_query_imports — finds who imports a file', () => {
    const result = JSON.parse(handleToolCall('engram_query_imports', { file_path: 'src/types.ts' }, brain));
    expect(result.imported_by).toContain('src/index.ts');
    expect(result.imported_by).toContain('src/api.ts');
    expect(result.count).toBe(2);
  });

  it('engram_query_imports — returns empty for leaf files', () => {
    const result = JSON.parse(handleToolCall('engram_query_imports', { file_path: 'src/api.ts' }, brain));
    expect(result.imported_by).toEqual([]);
    expect(result.count).toBe(0);
  });

  it('engram_query_dependents — finds what a file imports', () => {
    const result = JSON.parse(handleToolCall('engram_query_dependents', { file_path: 'src/index.ts' }, brain));
    expect(result.depends_on).toContain('src/types.ts');
    expect(result.depends_on).toContain('src/utils.ts');
  });

  it('engram_query_exports — lists exports', () => {
    const result = JSON.parse(handleToolCall('engram_query_exports', { file_path: 'src/types.ts' }, brain));
    expect(result.count).toBe(2);
    expect(result.exports[0].name).toBe('User');
    expect(result.exports[0].kind).toBe('interface');
  });

  it('engram_query_tests — finds tests for a file', () => {
    const result = JSON.parse(handleToolCall('engram_query_tests', { file_path: 'src/utils.ts' }, brain));
    expect(result.has_tests).toBe(true);
    expect(result.tested_by).toContain('tests/utils.test.ts');
  });

  it('engram_query_tests — lists untested files', () => {
    const result = JSON.parse(handleToolCall('engram_query_tests', { filter: 'untested' }, brain));
    expect(result.untested_files).toContain('src/api.ts');
    expect(result.count).toBe(3);
  });

  it('engram_find_fanout — finds high-fanout files', () => {
    const result = JSON.parse(handleToolCall('engram_find_fanout', { min_importers: '2' }, brain));
    expect(result.high_fanout_files.length).toBeGreaterThan(0);
    expect(result.high_fanout_files[0].file).toBe('src/types.ts');
  });

  it('engram_search_learnings — finds by domain', () => {
    const result = JSON.parse(handleToolCall('engram_search_learnings', { domains: 'api' }, brain));
    expect(result.count).toBe(1);
    expect(result.results[0].summary).toBe('Fixed auth bug');
  });

  it('engram_search_learnings — returns empty for unknown domain', () => {
    const result = JSON.parse(handleToolCall('engram_search_learnings', { domains: 'nonexistent' }, brain));
    expect(result.count).toBe(0);
  });

  it('engram_get_false_positives — returns FP entries', () => {
    const result = JSON.parse(handleToolCall('engram_get_false_positives', {}, brain));
    expect(result.count).toBe(1);
    expect(result.false_positives[0].summary).toContain('Known FP');
  });

  it('engram_brain_status — returns metrics', () => {
    const result = JSON.parse(handleToolCall('engram_brain_status', {}, brain));
    expect(result.totalSessions).toBe(5);
    expect(result.cacheHits).toBeGreaterThanOrEqual(3);
    expect(result.knowledge_index.files_indexed).toBe(5);
  });

  it('blocks path traversal', () => {
    const result = JSON.parse(handleToolCall('engram_query_imports', { file_path: '../../etc/passwd' }, brain));
    expect(result.error).toContain('Invalid file path');
  });

  it('blocks absolute paths', () => {
    const result = JSON.parse(handleToolCall('engram_query_imports', { file_path: '/etc/passwd' }, brain));
    expect(result.error).toContain('Invalid file path');
  });

  it('returns error for unknown tool', () => {
    const result = JSON.parse(handleToolCall('unknown_tool', {}, brain));
    expect(result.error).toContain('Unknown tool');
  });

  // ── Action tools ──────────────────────────────────────────────

  it('engram_classify_task — trivial for single file', () => {
    const result = JSON.parse(handleToolCall('engram_classify_task', { files_to_touch: 'src/utils.ts' }, brain));
    expect(result.tier).toBe('trivial');
    expect(result.phases).toContain('EXECUTE');
    expect(result.phases).toContain('LEARN');
    expect(result.auto_plan_mode).toBe(false);
  });

  it('engram_classify_task — complex for types + auth', () => {
    const result = JSON.parse(handleToolCall('engram_classify_task', {
      files_to_touch: 'src/types.ts,src/api.ts,src/utils.ts,tests/utils.test.ts',
    }, brain));
    expect(result.tier).toBe('complex');
    expect(result.auto_plan_mode).toBe(true);
    expect(result.phases).toContain('RESEARCH');
    expect(result.phases).toContain('IDEATE');
    expect(result.phases).toContain('PLAN');
  });

  it('engram_build_context — assembles domain context', () => {
    const result = JSON.parse(handleToolCall('engram_build_context', {
      files_to_touch: 'src/api.ts,src/types.ts',
    }, brain));
    expect(result.domain_context).toBeDefined();
    expect(result.domain_context.affected_domains.length).toBeGreaterThan(0);
    expect(result.domain_context.cross_domain_ripple.length).toBeGreaterThan(0);
    expect(result.instruction).toContain('Pass this entire object');
  });

  it('engram_record_learning — persists to KB', () => {
    const kbBefore = brain.knowledgeBase.entries.length;
    const result = JSON.parse(handleToolCall('engram_record_learning', {
      summary: 'Test learning',
      lesson: 'Always test MCP tools',
      tags: '#test #mcp',
      outcome: 'success',
    }, brain));
    expect(result.status).toBe('recorded');
    expect(brain.knowledgeBase.entries.length).toBe(kbBefore + 1);
  });

  it('engram_record_false_positive — adds FP tag', () => {
    const fpBefore = brain.knowledgeBase.entries.filter((e) => e.tags.includes('#false-positive')).length;
    const result = JSON.parse(handleToolCall('engram_record_false_positive', {
      summary: 'Missing types for X',
      reason: 'Types are inferred at runtime',
    }, brain));
    expect(result.status).toBe('recorded');
    const fpAfter = brain.knowledgeBase.entries.filter((e) => e.tags.includes('#false-positive')).length;
    expect(fpAfter).toBe(fpBefore + 1);
  });

  it('engram_classify_task — standard for 2 domains', () => {
    const result = JSON.parse(handleToolCall('engram_classify_task', {
      files_to_touch: 'src/api.ts,tests/utils.test.ts',
    }, brain));
    expect(result.tier).toBe('standard');
  });
});
