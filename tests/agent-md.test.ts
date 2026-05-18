import { describe, it, expect } from 'vitest';
import {
  personalizeAgent,
  buildContextBlock,
  selectRelevantLearnings,
  ENGRAM_AGENT_MARKER_START,
  ENGRAM_AGENT_MARKER_END,
} from '../src/generators/agent-md.js';
import type { KnitConfig, KBEntry, ProjectKnowledge } from '../src/engine/types.js';

const BASE_AGENT_MD = `---
name: typescript-pro
description: "ts expert"
tools: Read, Write, Edit, Bash, Glob, Grep
model: sonnet
---

You are a senior TypeScript developer.

When invoked:
1. Review the code.
2. Identify type issues.
`;

const TEST_CONFIG: KnitConfig = {
  name: 'demo-project',
  packageManager: 'npm',
  stack: {
    language: 'typescript',
    framework: 'nextjs',
    dependencies: [],
    testFramework: 'vitest',
    buildCommand: 'npm run build',
    lintCommand: 'npm run lint',
    typecheckCommand: 'npm run typecheck',
  },
  domains: [],
  targetAgent: 'claude-code',
  tokenOptimization: 'standard',
};

const TEST_KNOWLEDGE: ProjectKnowledge = {
  generatedAt: '2026-05-17',
  summary: {
    totalFiles: 42,
    totalLines: 1234,
    languageBreakdown: { '.ts': 30 },
    entryPoints: ['src/index.ts'],
    highFanoutFiles: ['src/types.ts', 'src/utils.ts'],
    untestedFiles: ['src/a.ts', 'src/b.ts'],
    largestFiles: [{ path: 'src/big.ts', lines: 500 }],
  },
  files: [],
  importGraph: {},
  exports: {},
  testMap: { tested: {}, untested: [], testFiles: [] },
};

function makeLearning(overrides: Partial<KBEntry>): KBEntry {
  return {
    id: 'test-id',
    date: '2026-05-17',
    summary: 'a learning',
    domains: [],
    approach: 'did the thing',
    outcome: 'success',
    lesson: 'next time, X',
    tags: ['#typescript'],
    accessCount: 0,
    lastAccessed: null,
    ...overrides,
  };
}

describe('agent-md', () => {
  describe('personalizeAgent', () => {
    it('appends an engram context block when none exists', () => {
      const out = personalizeAgent(BASE_AGENT_MD, { config: TEST_CONFIG, knowledge: TEST_KNOWLEDGE });
      expect(out).toContain('You are a senior TypeScript developer.');  // base preserved
      expect(out).toContain(ENGRAM_AGENT_MARKER_START);
      expect(out).toContain(ENGRAM_AGENT_MARKER_END);
      expect(out.indexOf(ENGRAM_AGENT_MARKER_START))
        .toBeGreaterThan(out.indexOf('You are a senior TypeScript developer.'));
    });

    it('replaces an existing engram context block on regeneration', () => {
      // First pass — append
      const first = personalizeAgent(BASE_AGENT_MD, { config: TEST_CONFIG });
      expect(first.match(new RegExp(ENGRAM_AGENT_MARKER_START, 'g'))?.length).toBe(1);

      // Second pass on the personalized output — should still have exactly one block
      const second = personalizeAgent(first, { config: { ...TEST_CONFIG, name: 'changed-name' } });
      expect(second.match(new RegExp(ENGRAM_AGENT_MARKER_START, 'g'))?.length).toBe(1);
      expect(second).toContain('**Project:** changed-name');
      expect(second).not.toContain('**Project:** demo-project');
    });

    it('preserves base agent prompt content during regen', () => {
      const out = personalizeAgent(personalizeAgent(BASE_AGENT_MD, { config: TEST_CONFIG }), { config: TEST_CONFIG });
      expect(out).toContain('You are a senior TypeScript developer.');
      expect(out).toContain('Identify type issues.');
    });
  });

  describe('buildContextBlock', () => {
    it('includes project name and stack', () => {
      const block = buildContextBlock({ config: TEST_CONFIG });
      expect(block).toContain('**Project:** demo-project');
      expect(block).toContain('**Stack:** typescript + nextjs');
    });

    it('lists high-fanout files when knowledge is provided', () => {
      const block = buildContextBlock({ config: TEST_CONFIG, knowledge: TEST_KNOWLEDGE });
      expect(block).toContain('High-fanout files');
      expect(block).toContain('src/types.ts');
      expect(block).toContain('src/utils.ts');
    });

    it('lists relevant learnings', () => {
      const block = buildContextBlock({
        config: TEST_CONFIG,
        relevantLearnings: [
          makeLearning({ summary: 'lesson A', lesson: 'do this' }),
          makeLearning({ summary: 'lesson B', lesson: 'avoid that' }),
        ],
      });
      expect(block).toContain('lesson A — do this');
      expect(block).toContain('lesson B — avoid that');
    });

    it('surfaces false positives separately from learnings', () => {
      const fp = makeLearning({ summary: 'fp-1', lesson: 'this is fine, do not flag', tags: ['#false-positive'] });
      const block = buildContextBlock({ config: TEST_CONFIG, falsePositives: [fp] });
      expect(block).toContain('DO NOT flag');
      expect(block).toContain('fp-1');
    });

    it('always lists engram MCP tools the agent can call', () => {
      const block = buildContextBlock({ config: TEST_CONFIG });
      expect(block).toContain('knit_query_dependents');
      expect(block).toContain('knit_search_learnings');
    });

    it('opens with the start marker and ends with the end marker', () => {
      const block = buildContextBlock({ config: TEST_CONFIG });
      expect(block.startsWith(ENGRAM_AGENT_MARKER_START)).toBe(true);
      expect(block.endsWith(ENGRAM_AGENT_MARKER_END)).toBe(true);
    });
  });

  describe('selectRelevantLearnings', () => {
    it('picks learnings whose tags match the agent name', () => {
      const all = [
        makeLearning({ summary: 'ts thing', tags: ['#typescript'] }),
        makeLearning({ summary: 'rust thing', tags: ['#rust'] }),
        makeLearning({ summary: 'ts other', tags: ['#typescript', '#refactor'] }),
        makeLearning({ summary: 'no tags', tags: [] }),
      ];
      const got = selectRelevantLearnings(all, 'typescript-pro');
      expect(got.map((e) => e.summary).sort()).toEqual(['ts other', 'ts thing']);
    });

    it('returns empty when nothing matches', () => {
      const all = [makeLearning({ tags: ['#unrelated'] })];
      expect(selectRelevantLearnings(all, 'typescript-pro')).toEqual([]);
    });

    it('respects limit', () => {
      const many = Array.from({ length: 10 }, (_, i) =>
        makeLearning({ summary: `ts ${i}`, tags: ['#typescript'] }),
      );
      expect(selectRelevantLearnings(many, 'typescript-pro', 3)).toHaveLength(3);
    });

    it('strips engram- prefix when matching', () => {
      const all = [makeLearning({ summary: 'rust thing', tags: ['#rust'] })];
      const got = selectRelevantLearnings(all, 'knit-rust-engineer');
      expect(got).toHaveLength(1);
    });
  });
});
