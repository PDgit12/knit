import type { BrainCache } from './cache.js';
import { queryByDomains, getFalsePositives, getKBSummary, recordCacheHit } from '../engine/knowledgebase.js';

/** MCP tool definition */
interface ToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

/** All tool definitions exposed by the Engram MCP server */
export function getToolDefinitions(): ToolDef[] {
  return [
    {
      name: 'engram_query_imports',
      description: 'Find which files import a given file. Returns the reverse dependency list — who depends on this file. Use BEFORE editing a file to understand the blast radius.',
      inputSchema: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Relative file path (e.g., src/engine/types.ts)' },
        },
        required: ['file_path'],
      },
    },
    {
      name: 'engram_query_dependents',
      description: 'Find what a given file depends on (its imports). Use to understand what a file needs to work.',
      inputSchema: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Relative file path' },
        },
        required: ['file_path'],
      },
    },
    {
      name: 'engram_query_exports',
      description: 'List what a file exports: functions, classes, interfaces, types, constants. Use to find the right function without reading the whole file.',
      inputSchema: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Relative file path' },
        },
        required: ['file_path'],
      },
    },
    {
      name: 'engram_query_tests',
      description: 'Find test coverage for a file, or list all untested files. Use to know what needs tests before shipping.',
      inputSchema: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Relative file path (optional — omit for untested list)' },
          filter: { type: 'string', description: '"untested" to list all untested files, or omit to query specific file' },
        },
      },
    },
    {
      name: 'engram_find_fanout',
      description: 'Find high-fanout files — files imported by many others. These are the contracts — change them carefully. Editing a high-fanout file affects many dependents.',
      inputSchema: {
        type: 'object',
        properties: {
          min_importers: { type: 'string', description: 'Minimum number of importers to qualify (default: 3)' },
        },
      },
    },
    {
      name: 'engram_search_learnings',
      description: 'Search the project knowledge base for learnings by domain tag. Returns past lessons, approaches that worked, and mistakes to avoid. Use BEFORE starting any task to check if we already solved this.',
      inputSchema: {
        type: 'object',
        properties: {
          domains: { type: 'string', description: 'Comma-separated domain tags to search (e.g., "api,auth,security")' },
        },
        required: ['domains'],
      },
    },
    {
      name: 'engram_get_false_positives',
      description: 'Get known false positives — issues that have been confirmed as non-issues. Include these in review agent prompts to prevent re-reporting.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'engram_brain_status',
      description: 'Get knowledge base health metrics: total learnings, hit rate, cache hits, top domains, session count. Use to understand how well the brain is working.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
  ];
}

/** Handle a tool call — route to the right engine function */
export function handleToolCall(
  toolName: string,
  params: Record<string, string>,
  brain: BrainCache,
): string {
  // Path validation — prevent directory traversal
  if (params.file_path) {
    const normalized = params.file_path.replace(/\\/g, '/');
    if (normalized.includes('..') || normalized.startsWith('/')) {
      return JSON.stringify({ error: 'Invalid file path — no traversal or absolute paths allowed' });
    }
  }

  switch (toolName) {
    case 'engram_query_imports': {
      const filePath = params.file_path;
      const importers = brain.reverseDeps[filePath] || [];
      return JSON.stringify({
        file: filePath,
        imported_by: importers,
        count: importers.length,
        risk: importers.length >= 5 ? 'HIGH — many dependents, change carefully' :
              importers.length >= 3 ? 'MEDIUM — several dependents' : 'LOW',
      });
    }

    case 'engram_query_dependents': {
      const filePath = params.file_path;
      const deps = brain.knowledge.importGraph[filePath] || [];
      return JSON.stringify({
        file: filePath,
        depends_on: deps,
        count: deps.length,
      });
    }

    case 'engram_query_exports': {
      const filePath = params.file_path;
      const exports = brain.knowledge.exports[filePath] || [];
      return JSON.stringify({
        file: filePath,
        exports: exports.map((e) => ({ name: e.name, kind: e.kind, line: e.line })),
        count: exports.length,
      });
    }

    case 'engram_query_tests': {
      if (params.filter === 'untested') {
        return JSON.stringify({
          untested_files: brain.knowledge.testMap.untested,
          count: brain.knowledge.testMap.untested.length,
        });
      }
      const filePath = params.file_path;
      if (filePath) {
        const tests = brain.knowledge.testMap.tested[filePath] || [];
        return JSON.stringify({
          file: filePath,
          tested_by: tests,
          has_tests: tests.length > 0,
        });
      }
      return JSON.stringify({
        tested_files: Object.keys(brain.knowledge.testMap.tested).length,
        untested_files: brain.knowledge.testMap.untested.length,
        test_files: brain.knowledge.testMap.testFiles.length,
      });
    }

    case 'engram_find_fanout': {
      const minImporters = parseInt(params.min_importers || '3') || 3;
      const fanout: Array<{ file: string; importers: number; imported_by: string[] }> = [];

      for (const [file, importers] of Object.entries(brain.reverseDeps)) {
        if (importers.length >= minImporters) {
          fanout.push({ file, importers: importers.length, imported_by: importers });
        }
      }

      fanout.sort((a, b) => b.importers - a.importers);
      return JSON.stringify({ high_fanout_files: fanout, count: fanout.length });
    }

    case 'engram_search_learnings': {
      const domainTags = params.domains.split(',').map((d) => `#${d.trim()}`);
      const results = queryByDomains(brain.knowledgeBase, domainTags.map((t) => t.replace('#', '')));

      if (results.length > 0) {
        recordCacheHit(brain.knowledgeBase);
      }

      return JSON.stringify({
        query: domainTags,
        results: results.map((r) => ({
          summary: r.summary,
          lesson: r.lesson,
          outcome: r.outcome,
          date: r.date,
          tags: r.tags,
          access_count: r.accessCount,
        })),
        count: results.length,
      });
    }

    case 'engram_get_false_positives': {
      const fps = getFalsePositives(brain.knowledgeBase);
      return JSON.stringify({
        false_positives: fps.map((fp) => ({
          summary: fp.summary,
          lesson: fp.lesson,
          date: fp.date,
        })),
        count: fps.length,
        instruction: 'Include these in review agent prompts as DO NOT FLAG items.',
      });
    }

    case 'engram_brain_status': {
      const summary = getKBSummary(brain.knowledgeBase);
      return JSON.stringify({
        ...summary,
        knowledge_index: {
          files_indexed: brain.knowledge.summary.totalFiles,
          total_lines: brain.knowledge.summary.totalLines,
          import_edges: Object.keys(brain.knowledge.importGraph).length,
          exports_mapped: Object.keys(brain.knowledge.exports).length,
        },
        cache_age_ms: Date.now() - brain.loadedAt,
      });
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
}
