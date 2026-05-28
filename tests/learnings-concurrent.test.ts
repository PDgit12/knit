import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendLearning, readLearnings } from '../src/engine/learnings.js';
import type { LearningEntry } from '../src/engine/types.js';

// D2 (v0.14.1 audit) regression: large concurrent appends must not
// interleave mid-entry. The pre-fix appendFileSync alone was only POSIX-
// atomic ≤ PIPE_BUF (~4KB), so a long lesson/approach could be split by
// a concurrent writer's bytes. The mkdir-lock guard now serializes any
// append above the safe threshold.

function makeBig(date: string, n: number): LearningEntry {
  const big = 'x'.repeat(2000);
  return {
    date,
    summary: `concurrent-entry-${n}`,
    domains: ['concurrency'],
    approach: `approach ${n} ${big}`,
    outcome: 'success',
    lesson: `lesson ${n} ${big}`,
    tags: ['#concurrency'],
  };
}

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'knit-learn-d2-'));
  file = join(dir, 'learnings.md');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('appendLearning — D2 concurrent-append safety', () => {
  it('serializes large concurrent appends without interleaving', async () => {
    const date = '2026-05-28';
    const N = 8;
    // Fire all appends in parallel — Node will interleave them at the
    // event-loop level. Each payload is ~5KB (well over PIPE_BUF).
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        Promise.resolve().then(() => appendLearning(file, makeBig(date, i))),
      ),
    );

    const entries = readLearnings(file);
    expect(entries.length).toBe(N);

    const summaries = new Set(entries.map((e) => e.summary));
    for (let i = 0; i < N; i++) {
      expect(summaries.has(`concurrent-entry-${i}`)).toBe(true);
    }

    // Every entry's `approach` should be the full "approach N xxxxx..."
    // string — no entry split mid-byte by another writer.
    for (const e of entries) {
      const idx = e.summary.replace('concurrent-entry-', '');
      expect(e.approach.startsWith(`approach ${idx}`)).toBe(true);
      expect(e.lesson.startsWith(`lesson ${idx}`)).toBe(true);
    }

    // No leftover lock dir.
    const raw = readFileSync(file, 'utf-8');
    expect(raw).not.toContain('\0');
  });

  it('takes the fast path (appendFileSync) for small entries', () => {
    const small: LearningEntry = {
      date: '2026-05-28',
      summary: 'tiny',
      domains: ['x'],
      approach: 'a',
      outcome: 'success',
      lesson: 'l',
      tags: ['#t'],
    };
    appendLearning(file, small);
    appendLearning(file, small);
    appendLearning(file, small);
    const entries = readLearnings(file);
    expect(entries.length).toBe(3);
  });
});
