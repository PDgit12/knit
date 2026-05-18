import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createLearningsFile,
  appendLearning,
  readLearnings,
  findByTags,
  findFalsePositives,
} from '../src/engine/learnings.js';
import type { LearningEntry } from '../src/engine/types.js';

const TEST_DIR = join(tmpdir(), 'knit-test-learnings');
const TEST_FILE = join(TEST_DIR, 'learnings.md');

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

const sampleEntry: LearningEntry = {
  date: '2026-05-15',
  summary: 'Fixed scanner detection for monorepos',
  domains: ['Engine', 'QA'],
  approach: 'Added workspace root detection using package.json workspaces field',
  outcome: 'success',
  lesson: 'Always check for workspaces field before assuming single-package repo',
  tags: ['#engine', '#scanner', '#monorepo'],
};

describe('createLearningsFile', () => {
  it('creates file with header', () => {
    createLearningsFile(TEST_FILE, 'Test Project');

    const content = readFileSync(TEST_FILE, 'utf-8');
    expect(content).toContain('# Project Learnings — Test Project');
    expect(content).toContain('Grep by `#tag`');
  });

  it('creates parent directories', () => {
    const deepPath = join(TEST_DIR, 'a', 'b', 'c', 'learnings.md');
    createLearningsFile(deepPath, 'Deep');

    expect(existsSync(deepPath)).toBe(true);
  });
});

describe('appendLearning', () => {
  it('appends formatted entry', () => {
    createLearningsFile(TEST_FILE, 'Test');
    appendLearning(TEST_FILE, sampleEntry);

    const content = readFileSync(TEST_FILE, 'utf-8');
    expect(content).toContain('## 2026-05-15 Fixed scanner detection for monorepos');
    expect(content).toContain('**Domain(s):** Engine, QA');
    expect(content).toContain('**Outcome:** success');
    expect(content).toContain('#engine #scanner #monorepo');
  });

  it('creates file if missing', () => {
    appendLearning(TEST_FILE, sampleEntry);

    expect(existsSync(TEST_FILE)).toBe(true);
    const content = readFileSync(TEST_FILE, 'utf-8');
    expect(content).toContain('2026-05-15');
  });
});

describe('readLearnings', () => {
  it('parses entries correctly', () => {
    createLearningsFile(TEST_FILE, 'Test');
    appendLearning(TEST_FILE, sampleEntry);

    const entries = readLearnings(TEST_FILE);
    expect(entries).toHaveLength(1);
    expect(entries[0].date).toBe('2026-05-15');
    expect(entries[0].summary).toBe('Fixed scanner detection for monorepos');
    expect(entries[0].outcome).toBe('success');
    expect(entries[0].tags).toContain('#engine');
  });

  it('returns empty for missing file', () => {
    expect(readLearnings('/nonexistent/file.md')).toEqual([]);
  });

  it('handles multiple entries', () => {
    createLearningsFile(TEST_FILE, 'Test');
    appendLearning(TEST_FILE, sampleEntry);
    appendLearning(TEST_FILE, {
      ...sampleEntry,
      date: '2026-05-16',
      summary: 'Second entry',
      tags: ['#cli', '#false-positive'],
    });

    const entries = readLearnings(TEST_FILE);
    expect(entries).toHaveLength(2);
  });
});

describe('findByTags', () => {
  it('filters by matching tags', () => {
    createLearningsFile(TEST_FILE, 'Test');
    appendLearning(TEST_FILE, sampleEntry);
    appendLearning(TEST_FILE, {
      ...sampleEntry,
      summary: 'CLI fix',
      tags: ['#cli', '#ui'],
    });

    const results = findByTags(TEST_FILE, ['#engine']);
    expect(results).toHaveLength(1);
    expect(results[0].summary).toBe('Fixed scanner detection for monorepos');
  });
});

describe('findFalsePositives', () => {
  it('finds false positive entries', () => {
    createLearningsFile(TEST_FILE, 'Test');
    appendLearning(TEST_FILE, sampleEntry);
    appendLearning(TEST_FILE, {
      ...sampleEntry,
      summary: 'Known FP: agent reports missing types',
      tags: ['#engine', '#false-positive'],
    });

    const fps = findFalsePositives(TEST_FILE);
    expect(fps).toHaveLength(1);
    expect(fps[0].summary).toContain('Known FP');
  });
});

describe('appendLearning concurrency', () => {
  it('preserves every entry under parallel appends (no truncation, no interleave)', async () => {
    createLearningsFile(TEST_FILE, 'Concurrent');

    const N = 100;
    const tasks = Array.from({ length: N }, (_, i) =>
      Promise.resolve().then(() =>
        appendLearning(TEST_FILE, {
          ...sampleEntry,
          summary: `Parallel entry ${i}`,
          tags: ['#concurrent'],
        }),
      ),
    );
    await Promise.all(tasks);

    const entries = readLearnings(TEST_FILE);
    expect(entries.length).toBe(N);
    const summaries = new Set(entries.map((e) => e.summary));
    expect(summaries.size).toBe(N);
  });
});
