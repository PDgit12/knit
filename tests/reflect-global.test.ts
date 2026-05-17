import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { reflect } from '../src/engine/reflect.js';
import { globalLearningsPath } from '../src/engine/paths.js';
import { appendGlobalLearning } from '../src/engine/global-learnings.js';
import type { KnowledgeBase, KBEntry, GlobalLearning } from '../src/engine/types.js';

function makeKBEntry(overrides: Partial<KBEntry>): KBEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    date: '2026-05-17',
    summary: 'a learning',
    domains: [],
    approach: '',
    outcome: 'success',
    lesson: 'a lesson',
    tags: [],
    accessCount: 0,
    lastAccessed: null,
    ...overrides,
  };
}

function makeKB(entries: KBEntry[]): KnowledgeBase {
  return {
    version: 1,
    projectName: 'test-project',
    entries,
    metrics: {
      totalSessions: 0,
      totalLearnings: entries.length,
      cacheHits: 0,
      domainDistribution: {},
      sessions: [],
    },
  };
}

function makeGlobal(overrides: Partial<GlobalLearning>): GlobalLearning {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    date: '2026-05-10',
    projectId: 'other-project-hash',
    projectName: 'other-project',
    summary: 'global learning',
    lesson: 'global lesson',
    tags: ['#global'],
    outcome: 'success',
    ...overrides,
  };
}

describe('reflect with global pool', () => {
  let engramHome: string;

  beforeAll(() => {
    engramHome = mkdtempSync(join(tmpdir(), 'engram-reflect-global-'));
    process.env.ENGRAM_HOME = engramHome;
  });

  afterAll(() => {
    delete process.env.ENGRAM_HOME;
    try { rmSync(engramHome, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  beforeEach(() => {
    // Clear the global pool between tests
    try {
      rmSync(globalLearningsPath(), { force: true });
    } catch { /* best effort */ }
  });

  it('returns empty when local is sparse AND global is empty', () => {
    const kb = makeKB([makeKBEntry({ tags: ['#auth'] })]);
    const patterns = reflect(kb);
    expect(patterns).toEqual([]);
  });

  it('reads from global pool when local has < 3 entries', () => {
    // Local: only 1 entry (sparse)
    const kb = makeKB([
      makeKBEntry({ id: 'local-1', tags: ['#stripe'], outcome: 'success' }),
    ]);

    // Global pool: 3 successes on #stripe — enough to form a success pattern
    appendGlobalLearning(makeGlobal({ tags: ['#stripe'], outcome: 'success', summary: 'g1' }));
    appendGlobalLearning(makeGlobal({ tags: ['#stripe'], outcome: 'success', summary: 'g2' }));
    appendGlobalLearning(makeGlobal({ tags: ['#stripe'], outcome: 'success', summary: 'g3' }));

    const patterns = reflect(kb);
    expect(patterns.length).toBeGreaterThan(0);

    const stripeSuccess = patterns.find((p) => p.id === 'success-#stripe');
    expect(stripeSuccess).toBeDefined();
    // 1 local success + 3 global successes all on #stripe
    expect(stripeSuccess!.occurrences).toBe(4);
  });

  it('annotates patterns with source: mixed when both local and global contribute', () => {
    const kb = makeKB([
      makeKBEntry({ id: 'local-1', tags: ['#payments'], outcome: 'success' }),
    ]);
    appendGlobalLearning(makeGlobal({ tags: ['#payments'], outcome: 'success' }));
    appendGlobalLearning(makeGlobal({ tags: ['#payments'], outcome: 'success' }));

    const patterns = reflect(kb);
    const success = patterns.find((p) => p.type === 'success-pattern' && p.domains.includes('#payments'));
    expect(success).toBeDefined();
    expect(success!.source).toBe('mixed');
  });

  it('annotates patterns with source: global when only global entries support them', () => {
    // Local has 1 entry but completely unrelated tags
    const kb = makeKB([
      makeKBEntry({ id: 'local-1', tags: ['#unrelated'], outcome: 'success' }),
    ]);
    appendGlobalLearning(makeGlobal({ tags: ['#webhook'], outcome: 'success' }));
    appendGlobalLearning(makeGlobal({ tags: ['#webhook'], outcome: 'success' }));
    appendGlobalLearning(makeGlobal({ tags: ['#webhook'], outcome: 'success' }));

    const patterns = reflect(kb);
    const webhook = patterns.find((p) => p.domains.includes('#webhook'));
    expect(webhook).toBeDefined();
    expect(webhook!.source).toBe('global');
  });

  it('does NOT merge global pool when local has >= 3 entries', () => {
    // Local: 3 successes on #local-only
    const kb = makeKB([
      makeKBEntry({ id: 'l1', tags: ['#local-only'], outcome: 'success' }),
      makeKBEntry({ id: 'l2', tags: ['#local-only'], outcome: 'success' }),
      makeKBEntry({ id: 'l3', tags: ['#local-only'], outcome: 'success' }),
    ]);

    // Global pool has many entries — must NOT be merged
    appendGlobalLearning(makeGlobal({ tags: ['#global-only'], outcome: 'success' }));
    appendGlobalLearning(makeGlobal({ tags: ['#global-only'], outcome: 'success' }));
    appendGlobalLearning(makeGlobal({ tags: ['#global-only'], outcome: 'success' }));

    const patterns = reflect(kb);
    // Local pattern should exist
    const local = patterns.find((p) => p.domains.includes('#local-only'));
    expect(local).toBeDefined();
    expect(local!.source).toBe('local');
    // Global pattern must NOT have leaked in
    const global = patterns.find((p) => p.domains.includes('#global-only'));
    expect(global).toBeUndefined();
  });

  it('local-only pattern (no global pool) carries source: local', () => {
    const kb = makeKB([
      makeKBEntry({ id: 'l1', tags: ['#api'], outcome: 'success' }),
      makeKBEntry({ id: 'l2', tags: ['#api'], outcome: 'success' }),
      makeKBEntry({ id: 'l3', tags: ['#api'], outcome: 'success' }),
    ]);
    const patterns = reflect(kb);
    const api = patterns.find((p) => p.domains.includes('#api'));
    expect(api).toBeDefined();
    expect(api!.source).toBe('local');
  });

  it('survives a corrupted global learnings file (falls back to local-only)', () => {
    const kb = makeKB([
      makeKBEntry({ id: 'l1', tags: ['#x'], outcome: 'success' }),
    ]);
    // Hand-write a malformed file. readAllLines guards against this and
    // returns []; reflect should not throw.
    const path = globalLearningsPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'not json\n{also not json\n', 'utf-8');

    expect(() => reflect(kb)).not.toThrow();
    // Still sparse (1 local + 0 valid globals) → no patterns
    expect(reflect(kb)).toEqual([]);
    expect(existsSync(path)).toBe(true);
  });
});
