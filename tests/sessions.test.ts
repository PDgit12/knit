import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  appendSession,
  searchSessions,
  getRecentSessions,
  sessionCount,
  pruneSessionsByAge,
} from '../src/engine/sessions.js';
import { sessionsJsonlPath, projectDataDir } from '../src/engine/paths.js';
import type { SessionSummary } from '../src/engine/types.js';

const PROJECT = '/tmp/sessions-test-project';

function makeEntry(overrides: Partial<SessionSummary>): SessionSummary {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    date: '2026-05-17',
    outcome: 'unknown',
    ...overrides,
  };
}

describe('sessions', () => {
  let knitHome: string;

  beforeAll(() => {
    knitHome = mkdtempSync(join(tmpdir(), 'knit-sessions-test-'));
    process.env.KNIT_HOME = knitHome;
  });

  afterAll(() => {
    delete process.env.KNIT_HOME;
    try { rmSync(knitHome, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  beforeEach(() => {
    // Wipe the project's sessions.jsonl between tests to avoid cross-test contamination
    try {
      rmSync(sessionsJsonlPath(PROJECT), { force: true });
    } catch { /* best effort */ }
  });

  describe('appendSession', () => {
    it('creates sessions.jsonl on first append', () => {
      const path = sessionsJsonlPath(PROJECT);
      expect(existsSync(path)).toBe(false);
      appendSession(PROJECT, makeEntry({ summary: 'first', outcome: 'shipped' }));
      expect(existsSync(path)).toBe(true);
    });

    it('writes one JSON object per line', () => {
      appendSession(PROJECT, makeEntry({ id: 'a', summary: 'one' }));
      appendSession(PROJECT, makeEntry({ id: 'b', summary: 'two' }));
      appendSession(PROJECT, makeEntry({ id: 'c', summary: 'three' }));

      const content = readFileSync(sessionsJsonlPath(PROJECT), 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      expect(lines).toHaveLength(3);
      const parsed = lines.map((l) => JSON.parse(l));
      expect(parsed.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    });
  });

  describe('searchSessions', () => {
    beforeEach(() => {
      appendSession(PROJECT, makeEntry({ id: '1', summary: 'fix stripe webhook signature verification', tags: ['#payments', '#stripe'], outcome: 'shipped' }));
      appendSession(PROJECT, makeEntry({ id: '2', summary: 'refactor auth middleware', tags: ['#auth'], outcome: 'shipped' }));
      appendSession(PROJECT, makeEntry({ id: '3', summary: 'add user profile page', tags: ['#ui'], outcome: 'wip' }));
      appendSession(PROJECT, makeEntry({ id: '4', summary: 'stripe subscription upgrade flow', tags: ['#payments', '#stripe'], outcome: 'shipped' }));
    });

    it('returns matches by free text from summary', () => {
      const results = searchSessions(PROJECT, 'stripe');
      expect(results).toHaveLength(2);
      // Recency-first: id 4 then id 1
      expect(results[0].id).toBe('4');
      expect(results[1].id).toBe('1');
    });

    it('matches by tag', () => {
      const results = searchSessions(PROJECT, '#auth');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('2');
    });

    it('is case-insensitive', () => {
      const results = searchSessions(PROJECT, 'STRIPE');
      expect(results).toHaveLength(2);
    });

    it('returns empty when no matches', () => {
      expect(searchSessions(PROJECT, 'kubernetes')).toHaveLength(0);
    });

    it('respects limit', () => {
      const results = searchSessions(PROJECT, 'stripe', 1);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('4'); // most recent match
    });

    it('returns empty array when sessions.jsonl does not exist', () => {
      rmSync(sessionsJsonlPath(PROJECT), { force: true });
      expect(searchSessions(PROJECT, 'anything')).toEqual([]);
    });

    it('skips malformed lines without throwing', () => {
      // Hand-corrupt the file
      const path = sessionsJsonlPath(PROJECT);
      const original = readFileSync(path, 'utf-8');
      const corrupted = original + 'this is not json\n{"also not valid"\n';
      writeFileSync(path, corrupted, 'utf-8');

      const results = searchSessions(PROJECT, 'stripe');
      expect(results.length).toBeGreaterThan(0); // valid lines still found
    });
  });

  describe('getRecentSessions', () => {
    it('returns most recent first', () => {
      appendSession(PROJECT, makeEntry({ id: 'old', summary: 'old' }));
      appendSession(PROJECT, makeEntry({ id: 'mid', summary: 'mid' }));
      appendSession(PROJECT, makeEntry({ id: 'new', summary: 'new' }));

      const recent = getRecentSessions(PROJECT, 2);
      expect(recent).toHaveLength(2);
      expect(recent[0].id).toBe('new');
      expect(recent[1].id).toBe('mid');
    });

    it('returns all when n exceeds count', () => {
      appendSession(PROJECT, makeEntry({ id: 'a' }));
      appendSession(PROJECT, makeEntry({ id: 'b' }));
      const recent = getRecentSessions(PROJECT, 100);
      expect(recent).toHaveLength(2);
    });

    it('returns empty when no sessions', () => {
      expect(getRecentSessions(PROJECT, 3)).toEqual([]);
    });
  });

  describe('sessionCount', () => {
    it('counts entries', () => {
      expect(sessionCount(PROJECT)).toBe(0);
      appendSession(PROJECT, makeEntry({ id: '1' }));
      expect(sessionCount(PROJECT)).toBe(1);
      appendSession(PROJECT, makeEntry({ id: '2' }));
      expect(sessionCount(PROJECT)).toBe(2);
    });
  });

  describe('pruneSessionsByAge', () => {
    function isoDaysAgo(days: number): string {
      const d = new Date(Date.now() - days * 86400000);
      return d.toISOString().split('T')[0];
    }

    it('returns 0/0 when sessions.jsonl does not exist', () => {
      const result = pruneSessionsByAge(PROJECT, 30);
      expect(result).toEqual({ kept: 0, pruned: 0 });
    });

    it('prunes entries older than the cutoff and keeps newer ones', () => {
      appendSession(PROJECT, makeEntry({ id: 'ancient', date: isoDaysAgo(120), summary: 'ancient' }));
      appendSession(PROJECT, makeEntry({ id: 'old', date: isoDaysAgo(100), summary: 'old' }));
      appendSession(PROJECT, makeEntry({ id: 'recent', date: isoDaysAgo(10), summary: 'recent' }));
      appendSession(PROJECT, makeEntry({ id: 'today', date: isoDaysAgo(0), summary: 'today' }));

      const result = pruneSessionsByAge(PROJECT, 90);
      expect(result.pruned).toBe(2);
      expect(result.kept).toBe(2);

      const remaining = getRecentSessions(PROJECT, 10);
      const ids = remaining.map((r) => r.id).sort();
      expect(ids).toEqual(['recent', 'today']);
    });

    it('keeps entries with corrupted or missing dates', () => {
      const path = sessionsJsonlPath(PROJECT);
      mkdirSync(dirname(path), { recursive: true });
      const lines = [
        JSON.stringify({ id: 'bad-date', date: 'not-a-date', outcome: 'unknown', summary: 'corrupt' }),
        JSON.stringify({ id: 'ancient', date: isoDaysAgo(200), outcome: 'unknown', summary: 'ancient' }),
        JSON.stringify({ id: 'fresh', date: isoDaysAgo(1), outcome: 'unknown', summary: 'fresh' }),
      ];
      writeFileSync(path, lines.join('\n') + '\n', 'utf-8');

      const result = pruneSessionsByAge(PROJECT, 90);
      expect(result.pruned).toBe(1); // only 'ancient' is provably stale
      expect(result.kept).toBe(2);   // 'bad-date' kept conservatively + 'fresh'

      const content = readFileSync(path, 'utf-8');
      expect(content).toContain('bad-date');
      expect(content).toContain('fresh');
      expect(content).not.toContain('ancient');
    });

    it('returns correct counts and rewrites file with one JSON per line', () => {
      appendSession(PROJECT, makeEntry({ id: 'a', date: isoDaysAgo(200), summary: 'a' }));
      appendSession(PROJECT, makeEntry({ id: 'b', date: isoDaysAgo(150), summary: 'b' }));
      appendSession(PROJECT, makeEntry({ id: 'c', date: isoDaysAgo(5), summary: 'c' }));

      const result = pruneSessionsByAge(PROJECT, 90);
      expect(result).toEqual({ kept: 1, pruned: 2 });

      const content = readFileSync(sessionsJsonlPath(PROJECT), 'utf-8');
      // File ends with a single newline; no double newlines mid-file.
      expect(content.endsWith('\n')).toBe(true);
      expect(content).not.toMatch(/\n\n/);
      const parsedLines = content.split('\n').filter(Boolean);
      expect(parsedLines).toHaveLength(1);
      const parsed = JSON.parse(parsedLines[0]);
      expect(parsed.id).toBe('c');
    });

    it('no-op when nothing is older than cutoff (file unchanged)', () => {
      appendSession(PROJECT, makeEntry({ id: 'a', date: isoDaysAgo(2), summary: 'a' }));
      appendSession(PROJECT, makeEntry({ id: 'b', date: isoDaysAgo(1), summary: 'b' }));

      const before = readFileSync(sessionsJsonlPath(PROJECT), 'utf-8');
      const result = pruneSessionsByAge(PROJECT, 90);
      expect(result).toEqual({ kept: 2, pruned: 0 });
      const after = readFileSync(sessionsJsonlPath(PROJECT), 'utf-8');
      expect(after).toBe(before);
    });

    it('produces an empty file when every entry is stale', () => {
      appendSession(PROJECT, makeEntry({ id: 'a', date: isoDaysAgo(500), summary: 'a' }));
      appendSession(PROJECT, makeEntry({ id: 'b', date: isoDaysAgo(400), summary: 'b' }));

      const result = pruneSessionsByAge(PROJECT, 90);
      expect(result).toEqual({ kept: 0, pruned: 2 });

      const content = readFileSync(sessionsJsonlPath(PROJECT), 'utf-8');
      expect(content).toBe('');
      expect(sessionCount(PROJECT)).toBe(0);
    });
  });

  describe('parseLine resilience', () => {
    it('defaults outcome to "unknown" when missing', () => {
      const path = sessionsJsonlPath(PROJECT);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify({ id: 'x', date: '2026-05-17', summary: 'no outcome' }) + '\n', 'utf-8');
      const results = searchSessions(PROJECT, 'no outcome');
      expect(results).toHaveLength(1);
      expect(results[0].outcome).toBe('unknown');
    });

    it('rejects entries missing required fields', () => {
      const path = sessionsJsonlPath(PROJECT);
      mkdirSync(dirname(path), { recursive: true });
      // Missing id
      writeFileSync(path, JSON.stringify({ date: '2026-05-17', summary: 'no id' }) + '\n', 'utf-8');
      expect(searchSessions(PROJECT, 'no id')).toEqual([]);
    });
  });

  describe('appendSession error handling (C2)', () => {
    it('rethrows fs failures rather than swallowing them silently', () => {
      // Force a real fs failure: plant a regular file at the exact path
      // where the project's data directory would live. mkdirSync({recursive:
      // true}) will then fail with ENOTDIR because an intermediate path
      // segment is a file, not a directory.
      const blockedRoot = join(knitHome, '__c2-blocked__');
      const dataDir = projectDataDir(blockedRoot);
      mkdirSync(dirname(dataDir), { recursive: true });
      writeFileSync(dataDir, '', 'utf-8'); // file where the dir should be

      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      try {
        expect(() => appendSession(blockedRoot, makeEntry({ id: 'x', summary: 'fail' })))
          .toThrow();
      } finally {
        stderrSpy.mockRestore();
      }
    });
  });
});
