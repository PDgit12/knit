import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  FRESHNESS,
  ageDays,
  isStale,
  sourceExists,
  extractFileRefs,
} from '../src/engine/freshness.js';

const NOW = Date.parse('2026-05-29T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

describe('ageDays', () => {
  it('returns days elapsed for a full ISO timestamp', () => {
    expect(ageDays(daysAgo(10), NOW)).toBeCloseTo(10, 5);
  });
  it('accepts date-only strings', () => {
    expect(ageDays('2026-05-19', Date.parse('2026-05-29T00:00:00Z'))).toBeCloseTo(10, 5);
  });
  it('returns null for missing/unparseable input', () => {
    expect(ageDays(undefined)).toBeNull();
    expect(ageDays(null)).toBeNull();
    expect(ageDays('')).toBeNull();
    expect(ageDays('not-a-date')).toBeNull();
  });
});

describe('isStale', () => {
  it('is true past the window, false within it', () => {
    expect(isStale(daysAgo(20), 14, NOW)).toBe(true);
    expect(isStale(daysAgo(10), 14, NOW)).toBe(false);
  });
  it('treats unparseable/missing as NOT stale (conservative keep)', () => {
    expect(isStale(undefined, 14, NOW)).toBe(false);
    expect(isStale('garbage', 14, NOW)).toBe(false);
  });
  it('boundary: exactly at the window is not yet stale', () => {
    expect(isStale(daysAgo(14), 14, NOW)).toBe(false);
  });
});

describe('sourceExists', () => {
  const dir = join(tmpdir(), 'knit-test-freshness');
  beforeEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true });
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'real.ts'), 'export const x = 1;\n');
  });
  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true });
  });
  it('resolves relative refs against the project root', () => {
    expect(sourceExists(dir, 'src/real.ts')).toBe(true);
    expect(sourceExists(dir, 'src/ghost.ts')).toBe(false);
  });
  it('handles absolute refs and rejects empty', () => {
    expect(sourceExists(dir, join(dir, 'src', 'real.ts'))).toBe(true);
    expect(sourceExists(dir, '')).toBe(false);
    expect(sourceExists(dir, '   ')).toBe(false);
  });
});

describe('extractFileRefs', () => {
  it('pulls dotted source paths with a separator', () => {
    const refs = extractFileRefs('Fixed the bug in src/mcp/handlers.ts and webapp/index.html');
    expect(refs).toContain('src/mcp/handlers.ts');
    expect(refs).toContain('webapp/index.html');
  });
  it('does not match bare words or filenames without a path separator', () => {
    expect(extractFileRefs('refactored the handler logic thoroughly')).toEqual([]);
    expect(extractFileRefs('see handlers.ts')).toEqual([]);
  });
  it('dedupes repeated refs', () => {
    expect(extractFileRefs('src/a.ts then src/a.ts again')).toEqual(['src/a.ts']);
  });
});

describe('FRESHNESS constants', () => {
  it('exposes a sane, centralized policy', () => {
    expect(FRESHNESS.HANDOFF_TTL_DAYS).toBeGreaterThan(0);
    expect(FRESHNESS.GLOBAL_LEARNING_TTL_DAYS).toBeGreaterThanOrEqual(FRESHNESS.SESSION_TTL_DAYS);
  });
});
