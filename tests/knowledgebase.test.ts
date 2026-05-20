import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createKnowledgeBase,
  loadKnowledgeBase,
  saveKnowledgeBase,
  addEntry,
  importFromMarkdown,
  queryByDomains,
  getFalsePositives,
  getTopEntries,
  getStaleEntries,
  recordSession,
  recordCacheHit,
  getKBSummary,
  generateSmartLearningsSection,
} from '../src/engine/knowledgebase.js';
import type { LearningEntry } from '../src/engine/types.js';

const TEST_DIR = join(tmpdir(), 'knit-test-kb');
const KB_PATH = join(TEST_DIR, 'knowledgebase.json');

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

const sampleEntry: LearningEntry = {
  date: '2026-05-15',
  summary: 'Fixed auth middleware',
  domains: ['API', 'Infrastructure'],
  approach: 'Renamed proxy.ts to middleware.ts',
  outcome: 'success',
  lesson: 'Next.js 16 requires middleware.ts in root',
  tags: ['#api', '#infra', '#middleware'],
};

describe('createKnowledgeBase', () => {
  it('creates empty knowledge base', () => {
    const kb = createKnowledgeBase('test-project');
    expect(kb.version).toBe(1);
    expect(kb.projectName).toBe('test-project');
    expect(kb.entries).toHaveLength(0);
    expect(kb.metrics.totalSessions).toBe(0);
  });
});

describe('save and load', () => {
  it('persists to disk and loads back', () => {
    const kb = createKnowledgeBase('test');
    addEntry(kb, sampleEntry);
    saveKnowledgeBase(KB_PATH, kb);

    const loaded = loadKnowledgeBase(KB_PATH, 'test');
    expect(loaded.entries).toHaveLength(1);
    expect(loaded.entries[0].summary).toBe('Fixed auth middleware');
  });

  it('creates new KB if file missing', () => {
    const loaded = loadKnowledgeBase(KB_PATH, 'fallback');
    expect(loaded.projectName).toBe('fallback');
    expect(loaded.entries).toHaveLength(0);
  });

  it('creates new KB if file is corrupt', async () => {
    const fs = await import('node:fs');
    fs.writeFileSync(KB_PATH, 'not json!!!');
    const loaded = loadKnowledgeBase(KB_PATH, 'fallback');
    expect(loaded.entries).toHaveLength(0);
  });
});

describe('addEntry', () => {
  it('adds entry with access tracking', () => {
    const kb = createKnowledgeBase('test');
    const kbEntry = addEntry(kb, sampleEntry);

    expect(kbEntry.accessCount).toBe(0);
    expect(kbEntry.lastAccessed).toBeNull();
    expect(kb.metrics.totalLearnings).toBe(1);
  });

  it('updates domain distribution', () => {
    const kb = createKnowledgeBase('test');
    addEntry(kb, sampleEntry);

    expect(kb.metrics.domainDistribution['#api']).toBe(1);
    expect(kb.metrics.domainDistribution['#infra']).toBe(1);
  });
});

describe('importFromMarkdown', () => {
  it('imports entries and skips duplicates', () => {
    const kb = createKnowledgeBase('test');
    const imported1 = importFromMarkdown(kb, [sampleEntry]);
    expect(imported1).toBe(1);
    expect(kb.entries).toHaveLength(1);

    // Import again — should skip
    const imported2 = importFromMarkdown(kb, [sampleEntry]);
    expect(imported2).toBe(0);
    expect(kb.entries).toHaveLength(1);
  });
});

describe('queryByDomains', () => {
  it('finds entries by domain tag', () => {
    const kb = createKnowledgeBase('test');
    addEntry(kb, sampleEntry);
    addEntry(kb, { ...sampleEntry, summary: 'UI fix', tags: ['#ui'] });

    const results = queryByDomains(kb, ['api']);
    expect(results).toHaveLength(1);
    expect(results[0].summary).toBe('Fixed auth middleware');
  });

  it('increments access count on query', () => {
    const kb = createKnowledgeBase('test');
    addEntry(kb, sampleEntry);

    queryByDomains(kb, ['api']);
    expect(kb.entries[0].accessCount).toBe(1);
    expect(kb.entries[0].lastAccessed).not.toBeNull();

    queryByDomains(kb, ['api']);
    expect(kb.entries[0].accessCount).toBe(2);
  });

  it('sorts by access count then recency', () => {
    const kb = createKnowledgeBase('test');
    addEntry(kb, { ...sampleEntry, date: '2026-05-10', summary: 'Old entry' });
    addEntry(kb, { ...sampleEntry, date: '2026-05-15', summary: 'New entry' });

    // Access old entry twice
    queryByDomains(kb, ['api']); // accesses both
    const oldEntry = kb.entries.find((e) => e.summary === 'Old entry')!;
    oldEntry.accessCount = 5; // simulate more access

    const results = queryByDomains(kb, ['api']);
    expect(results[0].summary).toBe('Old entry'); // higher access count
  });
});

describe('getFalsePositives', () => {
  it('finds false positive entries', () => {
    const kb = createKnowledgeBase('test');
    addEntry(kb, sampleEntry);
    addEntry(kb, { ...sampleEntry, summary: 'Known FP', tags: ['#api', '#false-positive'] });

    const fps = getFalsePositives(kb);
    expect(fps).toHaveLength(1);
    expect(fps[0].summary).toBe('Known FP');
  });
});

describe('getTopEntries', () => {
  it('returns most accessed entries', () => {
    const kb = createKnowledgeBase('test');
    addEntry(kb, { ...sampleEntry, summary: 'Rarely used' });
    addEntry(kb, { ...sampleEntry, summary: 'Often used' });
    kb.entries[1].accessCount = 10;

    const top = getTopEntries(kb, 1);
    expect(top).toHaveLength(1);
    expect(top[0].summary).toBe('Often used');
  });
});

describe('getStaleEntries', () => {
  it('finds old entries with zero access', () => {
    const kb = createKnowledgeBase('test');
    addEntry(kb, { ...sampleEntry, date: '2025-01-01', summary: 'Ancient' });
    addEntry(kb, { ...sampleEntry, date: '2026-05-15', summary: 'Recent' });

    const stale = getStaleEntries(kb, 30);
    expect(stale).toHaveLength(1);
    expect(stale[0].summary).toBe('Ancient');
  });

  it('does not flag accessed entries as stale', () => {
    const kb = createKnowledgeBase('test');
    addEntry(kb, { ...sampleEntry, date: '2025-01-01' });
    kb.entries[0].accessCount = 1;

    const stale = getStaleEntries(kb, 30);
    expect(stale).toHaveLength(0);
  });
});

describe('session tracking', () => {
  it('records sessions', () => {
    const kb = createKnowledgeBase('test');
    recordSession(kb, {
      date: '2026-05-15',
      branch: 'main',
      filesModified: 5,
      learningsAccessed: 2,
      learningsAdded: 1,
      domainsTouched: ['api', 'ui'],
    });

    expect(kb.metrics.totalSessions).toBe(1);
    expect(kb.metrics.sessions).toHaveLength(1);
  });

  it('keeps only last 20 sessions', () => {
    const kb = createKnowledgeBase('test');
    for (let i = 0; i < 25; i++) {
      recordSession(kb, {
        date: `2026-05-${String(i + 1).padStart(2, '0')}`,
        branch: 'main',
        filesModified: i,
        learningsAccessed: 0,
        learningsAdded: 0,
        domainsTouched: [],
      });
    }

    expect(kb.metrics.totalSessions).toBe(25);
    expect(kb.metrics.sessions).toHaveLength(20);
  });

  it('tracks cache hits', () => {
    const kb = createKnowledgeBase('test');
    recordCacheHit(kb);
    recordCacheHit(kb);
    expect(kb.metrics.cacheHits).toBe(2);
  });
});

describe('getKBSummary', () => {
  it('computes summary metrics', () => {
    const kb = createKnowledgeBase('test');
    addEntry(kb, sampleEntry);
    addEntry(kb, { ...sampleEntry, summary: 'Second', tags: ['#ui'] });
    kb.entries[0].accessCount = 3;
    recordCacheHit(kb);

    const summary = getKBSummary(kb);
    expect(summary.totalEntries).toBe(2);
    expect(summary.accessedEntries).toBe(1);
    expect(summary.neverAccessed).toBe(1);
    expect(summary.cacheHits).toBe(1);
    expect(summary.hitRate).toBe(50);
  });
});

describe('generateSmartLearningsSection', () => {
  it('returns empty for empty KB', () => {
    const kb = createKnowledgeBase('test');
    expect(generateSmartLearningsSection(kb)).toBe('');
  });

  it('includes false positives and top entries', () => {
    const kb = createKnowledgeBase('test');
    addEntry(kb, { ...sampleEntry, summary: 'Regular entry' });
    addEntry(kb, { ...sampleEntry, summary: 'Known FP', tags: ['#api', '#false-positive'] });

    const section = generateSmartLearningsSection(kb);
    expect(section).toContain('Known FP');
    expect(section).toContain('Regular entry');
    expect(section).toContain('Active Learnings');
    expect(section).toContain('DO NOT flag');
  });

  it('shows access counts', () => {
    const kb = createKnowledgeBase('test');
    addEntry(kb, sampleEntry);
    kb.entries[0].accessCount = 7;

    const section = generateSmartLearningsSection(kb);
    expect(section).toContain('accessed 7x');
  });

  it('limits output to maxEntries', () => {
    const kb = createKnowledgeBase('test');
    for (let i = 0; i < 20; i++) {
      addEntry(kb, { ...sampleEntry, summary: `Entry ${i}` });
    }

    const section = generateSmartLearningsSection(kb, 5);
    expect(section).toContain('5 of 20');
  });
});


// ────────────────────────────────────────────────────────────────────────
// Production-readiness tests: atomic write + corrupt-load protection
// (see audit findings C1, C3)
// ────────────────────────────────────────────────────────────────────────

import { writeFileSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { loadKnowledgeBaseSafe } from '../src/engine/knowledgebase.js';

describe('saveKnowledgeBase atomic write (C1)', () => {
  it('leaves no .tmp- files behind after a successful save', () => {
    const kb = createKnowledgeBase('atomic-test');
    addEntry(kb, sampleEntry);
    saveKnowledgeBase(KB_PATH, kb);

    const leftover = readdirSync(TEST_DIR).filter((f) => f.includes('.tmp-'));
    expect(leftover).toEqual([]);
  });

  it('produces a readable JSON file after save (no torn write)', () => {
    const kb = createKnowledgeBase('atomic-test');
    for (let i = 0; i < 50; i++) addEntry(kb, { ...sampleEntry, summary: `e${i}` });

    saveKnowledgeBase(KB_PATH, kb);

    // Round-trip parse must succeed — torn writes would throw here.
    const raw = readFileSync(KB_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.entries.length).toBe(50);
    expect(parsed.version).toBe(1);
  });

  it('replaces an existing file in place (target path unchanged)', () => {
    const kb1 = createKnowledgeBase('atomic-test');
    addEntry(kb1, { ...sampleEntry, summary: 'first' });
    saveKnowledgeBase(KB_PATH, kb1);
    const inode1 = statSync(KB_PATH).ino;

    const kb2 = createKnowledgeBase('atomic-test');
    addEntry(kb2, { ...sampleEntry, summary: 'second' });
    saveKnowledgeBase(KB_PATH, kb2);

    // File still exists at the same path with new contents
    const parsed = JSON.parse(readFileSync(KB_PATH, 'utf-8'));
    expect(parsed.entries[0].summary).toBe('second');
    // Inode changes on atomic rename; just assert the file is readable.
    void inode1;
  });
});

describe('loadKnowledgeBaseSafe corrupt-load protection (C3)', () => {
  it('returns loadFailed=false for a fresh project (no file)', () => {
    const result = loadKnowledgeBaseSafe(KB_PATH, 'fresh');
    expect(result.loadFailed).toBe(false);
    expect(result.kb.entries).toEqual([]);
  });

  it('returns loadFailed=true when file is malformed JSON', () => {
    writeFileSync(KB_PATH, '{ not valid json', 'utf-8');
    const result = loadKnowledgeBaseSafe(KB_PATH, 'corrupt');
    expect(result.loadFailed).toBe(true);
    expect(result.kb.entries).toEqual([]);
  });

  it('returns loadFailed=true when file is structurally invalid (wrong version)', () => {
    writeFileSync(KB_PATH, JSON.stringify({ version: 99, entries: [] }), 'utf-8');
    const result = loadKnowledgeBaseSafe(KB_PATH, 'wrong-version');
    expect(result.loadFailed).toBe(true);
  });

  it('returns loadFailed=true when entries is not an array', () => {
    writeFileSync(KB_PATH, JSON.stringify({
      version: 1,
      entries: 'not-an-array',
      metrics: { totalSessions: 0, totalLearnings: 0, cacheHits: 0, domainDistribution: {}, sessions: [] },
    }), 'utf-8');
    const result = loadKnowledgeBaseSafe(KB_PATH, 'bad-entries');
    expect(result.loadFailed).toBe(true);
  });

  it('returns loadFailed=false for a valid file', () => {
    const kb = createKnowledgeBase('valid');
    addEntry(kb, sampleEntry);
    saveKnowledgeBase(KB_PATH, kb);

    const result = loadKnowledgeBaseSafe(KB_PATH, 'valid');
    expect(result.loadFailed).toBe(false);
    expect(result.kb.entries.length).toBe(1);
  });
});
