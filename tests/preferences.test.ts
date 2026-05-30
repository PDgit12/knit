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
  orchestration: 'auto',
  tokenMode: 'standard',
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

  // v0.22 — orchestration + token_mode (no migration: pre-v0.22 files default).
  it('defaults orchestration=auto + tokenMode=standard when the fields are absent (no migration)', () => {
    const p = preferencesPath(ROOT);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify({ version: 1, projectDescription: 'x', intent: 'y' }), 'utf-8');
    const loaded = loadPreferences(ROOT);
    expect(loaded?.orchestration).toBe('auto');
    expect(loaded?.tokenMode).toBe('standard');
  });

  it('round-trips and coerces invalid orchestration/tokenMode to defaults', () => {
    savePreferences(ROOT, { ...sample, orchestration: 'off', tokenMode: 'lean' });
    expect(loadPreferences(ROOT)?.orchestration).toBe('off');
    expect(loadPreferences(ROOT)?.tokenMode).toBe('lean');
    savePreferences(ROOT, { ...sample, orchestration: 'bogus' as unknown as ProjectPreferences['orchestration'], tokenMode: 'bogus' as unknown as ProjectPreferences['tokenMode'] });
    expect(loadPreferences(ROOT)?.orchestration).toBe('auto');
    expect(loadPreferences(ROOT)?.tokenMode).toBe('standard');
  });
});
