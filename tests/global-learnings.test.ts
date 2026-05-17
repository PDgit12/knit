import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  appendGlobalLearning,
  searchGlobalLearnings,
  getRecentGlobalLearnings,
  globalLearningCount,
  buildGlobalLearning,
} from '../src/engine/global-learnings.js';
import { globalLearningsPath } from '../src/engine/paths.js';
import type { GlobalLearning } from '../src/engine/types.js';

const PROJECT_A = '/tmp/global-learnings-test-proj-a';
const PROJECT_B = '/tmp/global-learnings-test-proj-b';

function makeEntry(overrides: Partial<GlobalLearning>): GlobalLearning {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    date: '2026-05-17',
    projectId: 'aaaa1111',
    projectName: 'proj-a',
    summary: 'placeholder',
    lesson: 'placeholder lesson',
    tags: ['#test'],
    ...overrides,
  };
}

describe('global-learnings', () => {
  let engramHome: string;

  beforeAll(() => {
    engramHome = mkdtempSync(join(tmpdir(), 'engram-global-test-'));
    process.env.ENGRAM_HOME = engramHome;
  });

  afterAll(() => {
    delete process.env.ENGRAM_HOME;
    try { rmSync(engramHome, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  beforeEach(() => {
    try { rmSync(globalLearningsPath(), { force: true }); } catch { /* best */ }
  });

  describe('appendGlobalLearning', () => {
    it('creates the global learnings file on first append', () => {
      expect(existsSync(globalLearningsPath())).toBe(false);
      appendGlobalLearning(makeEntry({ summary: 'first global' }));
      expect(existsSync(globalLearningsPath())).toBe(true);
    });

    it('writes one JSON object per line, append-only', () => {
      appendGlobalLearning(makeEntry({ id: '1', summary: 'a' }));
      appendGlobalLearning(makeEntry({ id: '2', summary: 'b' }));
      const content = readFileSync(globalLearningsPath(), 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]).id).toBe('1');
      expect(JSON.parse(lines[1]).id).toBe('2');
    });
  });

  describe('searchGlobalLearnings', () => {
    beforeEach(() => {
      appendGlobalLearning(makeEntry({
        id: '1', projectName: 'proj-a', summary: 'stripe signature check', lesson: 'always verify the timestamp', tags: ['#payments', '#stripe'],
      }));
      appendGlobalLearning(makeEntry({
        id: '2', projectName: 'proj-b', summary: 'auth token expiry', lesson: 'tokens silently expire after 24h', tags: ['#auth'],
      }));
      appendGlobalLearning(makeEntry({
        id: '3', projectName: 'proj-a', summary: 'stripe webhook order', lesson: 'webhooks may arrive out of order', tags: ['#payments', '#stripe'],
      }));
    });

    it('finds matches across project boundaries', () => {
      const results = searchGlobalLearnings('stripe');
      expect(results).toHaveLength(2);
      // Most recent first
      expect(results[0].id).toBe('3');
      expect(results[1].id).toBe('1');
      // Different projects appear together
      expect(new Set(results.map((r) => r.projectName))).toContain('proj-a');
    });

    it('matches by tag', () => {
      const results = searchGlobalLearnings('#auth');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('2');
    });

    it('matches over lesson text', () => {
      const results = searchGlobalLearnings('silently expire');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('2');
    });

    it('respects limit', () => {
      const results = searchGlobalLearnings('stripe', 1);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('3');
    });

    it('returns empty when no matches', () => {
      expect(searchGlobalLearnings('kubernetes')).toEqual([]);
    });
  });

  describe('getRecentGlobalLearnings', () => {
    it('returns most recent first', () => {
      appendGlobalLearning(makeEntry({ id: 'old' }));
      appendGlobalLearning(makeEntry({ id: 'mid' }));
      appendGlobalLearning(makeEntry({ id: 'new' }));
      const recent = getRecentGlobalLearnings(2);
      expect(recent.map((e) => e.id)).toEqual(['new', 'mid']);
    });

    it('returns empty when none recorded', () => {
      expect(getRecentGlobalLearnings(5)).toEqual([]);
    });
  });

  describe('globalLearningCount', () => {
    it('counts entries', () => {
      expect(globalLearningCount()).toBe(0);
      appendGlobalLearning(makeEntry({ id: '1' }));
      appendGlobalLearning(makeEntry({ id: '2' }));
      expect(globalLearningCount()).toBe(2);
    });
  });

  describe('buildGlobalLearning', () => {
    it('tags entries with the source project id + name', () => {
      // We need a real path-like input; use the test dir tmpdir
      const entry = buildGlobalLearning(PROJECT_A, {
        summary: 's', lesson: 'l', tags: ['#x'],
      });
      expect(entry.projectId).toMatch(/^[a-f0-9]{16}$/);
      expect(typeof entry.projectName).toBe('string');
      expect(entry.projectName.length).toBeGreaterThan(0);
      expect(entry.tags).toEqual(['#x']);
    });

    it('attaches outcome when provided', () => {
      const entry = buildGlobalLearning(PROJECT_B, {
        summary: 's', lesson: 'l', tags: ['#x'], outcome: 'success',
      });
      expect(entry.outcome).toBe('success');
    });
  });

  describe('parse resilience', () => {
    it('skips malformed lines silently', () => {
      const path = globalLearningsPath();
      mkdirSync(dirname(path), { recursive: true });
      const good = JSON.stringify(makeEntry({ id: 'good', summary: 'real entry' }));
      writeFileSync(path, `${good}\nnot json at all\n{"broken": json}\n`, 'utf-8');
      const results = searchGlobalLearnings('real entry');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('good');
    });

    it('rejects entries missing required fields', () => {
      const path = globalLearningsPath();
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify({ id: 'x', summary: 'no lesson, no tags' }) + '\n', 'utf-8');
      expect(searchGlobalLearnings('no lesson')).toEqual([]);
    });
  });
});
