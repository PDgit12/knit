import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendLearning,
  readLearnings,
  createLearningsFile,
  pruneLearningsByAge,
} from '../src/engine/learnings.js';
import type { LearningEntry } from '../src/engine/types.js';

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'knit-learn-d3d4-'));
  file = join(dir, 'learnings.md');
  createLearningsFile(file, 'Test Project');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function entry(date: string, summary: string, lesson: string, tags: string[] = []): LearningEntry {
  return {
    date,
    summary,
    domains: ['test'],
    approach: 'unit-test',
    outcome: 'success',
    lesson,
    tags,
  };
}

describe('D3 — readLearnings schema validation', () => {
  it('skips empty-shell entries (no summary or no lesson) and logs once', () => {
    appendLearning(file, entry('2026-05-28', 'real summary', 'real lesson'));

    // Inject an empty-shell entry directly (missing lesson body)
    const raw = readFileSync(file, 'utf-8');
    writeFileSync(file, raw + '\n## 2026-05-27 empty shell\n**Domain(s):** x\n**Approach:** y\n**Outcome:** success\n**Lesson:** \n**Tags:** #x\n');

    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const entries = readLearnings(file);
    expect(entries.length).toBe(1);
    expect(entries[0].summary).toBe('real summary');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('empty-shell'));
    spy.mockRestore();
  });

  it('keeps a well-formed entry and does not log when corpus is clean', () => {
    appendLearning(file, entry('2026-05-28', 'clean one', 'clean lesson'));
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const entries = readLearnings(file);
    expect(entries.length).toBe(1);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('D4 — pruneLearningsByAge', () => {
  const NOW = '2026-05-28';
  const days = (n: number): string => {
    const d = new Date(Date.now() - n * 86400000);
    return d.toISOString().slice(0, 10);
  };

  it('removes entries older than maxAgeDays, keeps fresh ones', () => {
    appendLearning(file, entry(days(200), 'old one', 'old lesson'));
    appendLearning(file, entry(days(10), 'fresh one', 'fresh lesson'));

    const result = pruneLearningsByAge(file, 90);
    expect(result.pruned).toBe(1);
    expect(result.kept).toBe(1);

    const after = readLearnings(file);
    expect(after.length).toBe(1);
    expect(after[0].summary).toBe('fresh one');
  });

  it('preserves #false-positive entries regardless of age (calibration signal)', () => {
    appendLearning(file, entry(days(500), 'old FP', 'fp lesson', ['#false-positive']));
    appendLearning(file, entry(days(200), 'old regular', 'old lesson'));

    const result = pruneLearningsByAge(file, 90);
    expect(result.pruned).toBe(1); // only the non-FP old one
    expect(result.kept).toBe(1);

    const after = readLearnings(file);
    expect(after.length).toBe(1);
    expect(after[0].tags).toContain('#false-positive');
  });

  it('returns no-op when nothing is stale (no file rewrite)', () => {
    appendLearning(file, entry(NOW, 'fresh', 'fresh lesson'));
    const before = readFileSync(file, 'utf-8');
    const result = pruneLearningsByAge(file, 90);
    expect(result.pruned).toBe(0);
    expect(readFileSync(file, 'utf-8')).toBe(before);
  });

  it('keeps entries with unparseable dates (never silently lose data)', () => {
    appendLearning(file, entry(days(10), 'fresh', 'fresh lesson'));
    // Inject an entry with a malformed date
    const raw = readFileSync(file, 'utf-8');
    writeFileSync(file, raw + '\n## not-a-date weird entry\n**Domain(s):** x\n**Approach:** y\n**Outcome:** success\n**Lesson:** preserved\n**Tags:** #weird\n');

    const result = pruneLearningsByAge(file, 30);
    // Unparseable date → kept; well-formed fresh → kept; no prune.
    expect(result.pruned).toBe(0);
  });

  it('no-op on missing file', () => {
    const r = pruneLearningsByAge(join(dir, 'nope.md'), 30);
    expect(r).toEqual({ kept: 0, pruned: 0 });
  });
});
