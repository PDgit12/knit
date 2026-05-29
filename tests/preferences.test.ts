import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { loadPreferences, savePreferences, type ProjectPreferences } from '../src/engine/preferences.js';
import { preferencesPath } from '../src/engine/paths.js';

let knitHome: string;
const ROOT = '/tmp/prefs-test-project';

beforeEach(() => {
  knitHome = mkdtempSync(join(tmpdir(), 'knit-prefs-'));
  process.env.KNIT_HOME = knitHome;
});
afterEach(() => {
  delete process.env.KNIT_HOME;
  try { rmSync(knitHome, { recursive: true, force: true }); } catch { /* best-effort */ }
});

const sample: ProjectPreferences = {
  version: 1,
  projectDescription: 'A TypeScript MCP server',
  intent: 'add a billing module',
  strictness: 'block',
  focusDomains: ['api', 'billing'],
  onboardedAt: '2026-05-29T00:00:00.000Z',
};

describe('preferences store', () => {
  it('returns null before onboarding', () => {
    expect(loadPreferences(ROOT)).toBeNull();
  });

  it('round-trips saved preferences', () => {
    savePreferences(ROOT, sample);
    expect(existsSync(preferencesPath(ROOT))).toBe(true);
    expect(loadPreferences(ROOT)).toEqual(sample);
  });

  it('coerces an invalid strictness to null and keeps known fields', () => {
    savePreferences(ROOT, { ...sample, strictness: 'bogus' as unknown as ProjectPreferences['strictness'] });
    const loaded = loadPreferences(ROOT);
    expect(loaded?.strictness).toBeNull();
    expect(loaded?.intent).toBe('add a billing module');
  });

  it('treats an empty-content record (no description AND no intent) as not-onboarded', () => {
    savePreferences(ROOT, { ...sample, projectDescription: '', intent: '' });
    expect(loadPreferences(ROOT)).toBeNull();
  });

  it('survives a corrupt (non-JSON) file — returns null, no throw', () => {
    const p = preferencesPath(ROOT);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, '{ this is not: valid json', 'utf-8');
    expect(loadPreferences(ROOT)).toBeNull();
  });
});
