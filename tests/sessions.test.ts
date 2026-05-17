import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  appendSession,
  searchSessions,
  getRecentSessions,
  sessionCount,
} from '../src/engine/sessions.js';
import { sessionsJsonlPath } from '../src/engine/paths.js';
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
  let engramHome: string;

  beforeAll(() => {
    engramHome = mkdtempSync(join(tmpdir(), 'engram-sessions-test-'));
    process.env.ENGRAM_HOME = engramHome;
  });

  afterAll(() => {
    delete process.env.ENGRAM_HOME;
    try { rmSync(engramHome, { recursive: true, force: true }); } catch { /* best effort */ }
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
});
