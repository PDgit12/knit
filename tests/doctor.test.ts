import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runDoctor } from '../src/commands/doctor.js';
import { HOOKS_VERSION } from '../src/generators/settings.js';
import { knowledgebasePath, projectDataDir } from '../src/engine/paths.js';

/**
 * v0.11.2 — `knit doctor` install health check.
 *
 * Tests the structured report (runDoctor) not the chalk-printed CLI output.
 * Each test sets up a controlled tmpdir state then asserts on the
 * specific check's status + detail.
 */

let knitHome: string;
let projectRoot: string;

beforeEach(() => {
  knitHome = mkdtempSync(join(tmpdir(), 'knit-doctor-test-'));
  process.env.KNIT_HOME = knitHome;
  projectRoot = mkdtempSync(join(tmpdir(), 'knit-doctor-project-'));
});

afterEach(() => {
  delete process.env.KNIT_HOME;
  try { rmSync(knitHome, { recursive: true, force: true }); } catch { /* best-effort */ }
  try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* best-effort */ }
});

function findCheck(report: ReturnType<typeof runDoctor>, name: string) {
  return report.checks.find((c) => c.name === name);
}

describe('runDoctor — fresh project', () => {
  it('includes version + node + HOOKS_VERSION in header', () => {
    const report = runDoctor(projectRoot);
    expect(report.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(report.nodeVersion).toMatch(/^v\d+/);
    expect(report.hooksVersion).toBe(HOOKS_VERSION);
    expect(report.rootPath).toBe(projectRoot);
  });

  it('flags missing settings.local.json as info (not error)', () => {
    const report = runDoctor(projectRoot);
    const c = findCheck(report, 'Hooks version');
    expect(c?.status).toBe('info');
    expect(c?.detail).toMatch(/no settings\.local\.json yet/);
  });

  it('flags missing knowledgebase as info (fresh project)', () => {
    const report = runDoctor(projectRoot);
    const c = findCheck(report, 'Knowledge base');
    expect(c?.status).toBe('info');
    expect(c?.detail).toMatch(/no learnings yet/);
  });

  it('flags missing project data dir as info (will be created)', () => {
    const report = runDoctor(projectRoot);
    const c = findCheck(report, 'Project data dir');
    expect(c?.status).toBe('info');
  });

  it('Node version check passes for the current runtime', () => {
    const report = runDoctor(projectRoot);
    const c = findCheck(report, 'Node version');
    expect(c?.status).toBe('ok');
  });
});

describe('runDoctor — HOOKS_VERSION drift detection', () => {
  it('OK when settings.local.json _knitHooks.version matches current', () => {
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.claude', 'settings.local.json'),
      JSON.stringify({ _knitHooks: { version: HOOKS_VERSION, generatedAt: new Date().toISOString() }, hooks: {} }),
      'utf-8',
    );
    const report = runDoctor(projectRoot);
    const c = findCheck(report, 'Hooks version');
    expect(c?.status).toBe('ok');
    expect(c?.detail).toMatch(/current/);
  });

  it('warns when project version is older (auto-upgrade pending)', () => {
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.claude', 'settings.local.json'),
      JSON.stringify({ _knitHooks: { version: HOOKS_VERSION - 1 }, hooks: {} }),
      'utf-8',
    );
    const report = runDoctor(projectRoot);
    const c = findCheck(report, 'Hooks version');
    expect(c?.status).toBe('warn');
    expect(c?.detail).toMatch(/auto-upgrade on next MCP call/);
  });

  it('warns when project version is NEWER than installed code (stale install)', () => {
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.claude', 'settings.local.json'),
      JSON.stringify({ _knitHooks: { version: HOOKS_VERSION + 5 }, hooks: {} }),
      'utf-8',
    );
    const report = runDoctor(projectRoot);
    const c = findCheck(report, 'Hooks version');
    expect(c?.status).toBe('warn');
    expect(c?.detail).toMatch(/stale install/);
  });

  it('warns when settings.local.json is unreadable', () => {
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    writeFileSync(join(projectRoot, '.claude', 'settings.local.json'), 'not valid json', 'utf-8');
    const report = runDoctor(projectRoot);
    const c = findCheck(report, 'Hooks version');
    expect(c?.status).toBe('warn');
    expect(c?.detail).toMatch(/unreadable/);
  });
});

describe('runDoctor — knowledgebase health', () => {
  it('OK with entry count when KB is present + valid', () => {
    mkdirSync(projectDataDir(projectRoot), { recursive: true });
    writeFileSync(
      knowledgebasePath(projectRoot),
      JSON.stringify({ version: 1, projectName: 'test', entries: [{ id: '1' }, { id: '2' }, { id: '3' }], metrics: { totalSessions: 0, totalLearnings: 3, cacheHits: 0, domainDistribution: {}, sessions: [] } }),
      'utf-8',
    );
    const report = runDoctor(projectRoot);
    const c = findCheck(report, 'Knowledge base');
    expect(c?.status).toBe('ok');
    expect(c?.detail).toMatch(/3 learning/);
    expect(c?.detail).toMatch(/v1/);
  });

  it('ERROR when KB is corrupt JSON', () => {
    mkdirSync(projectDataDir(projectRoot), { recursive: true });
    writeFileSync(knowledgebasePath(projectRoot), 'not valid json at all', 'utf-8');
    const report = runDoctor(projectRoot);
    const c = findCheck(report, 'Knowledge base');
    expect(c?.status).toBe('error');
    expect(c?.detail).toMatch(/unreadable/);
  });
});

describe('runDoctor — broken symlink detection', () => {
  it('detects dangling node_modules symlink (the exact bug from v0.11.1 audit)', () => {
    const target = join(tmpdir(), 'knit-doctor-symlink-target-does-not-exist-' + Date.now());
    symlinkSync(target, join(projectRoot, 'node_modules'));
    const report = runDoctor(projectRoot);
    const c = findCheck(report, 'Symlink node_modules');
    expect(c?.status).toBe('error');
    expect(c?.detail).toMatch(/dangling symlink/);
  });

  it('OK when no symlinks exist', () => {
    const report = runDoctor(projectRoot);
    const c = findCheck(report, 'Symlink node_modules');
    // Missing entry → no check appended (no false-positive on absent file)
    expect(c).toBeUndefined();
  });

  it('OK when symlink target exists', () => {
    const realDir = mkdtempSync(join(tmpdir(), 'knit-doctor-symlink-real-'));
    try {
      symlinkSync(realDir, join(projectRoot, 'node_modules'));
      const report = runDoctor(projectRoot);
      const c = findCheck(report, 'Symlink node_modules');
      // Symlink resolves → no error
      expect(c).toBeUndefined();
    } finally {
      try { rmSync(realDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  });
});

describe('runDoctor — overall structure', () => {
  it('returns a non-empty checks array', () => {
    const report = runDoctor(projectRoot);
    expect(report.checks.length).toBeGreaterThan(0);
  });

  it('every check has name + status + detail', () => {
    const report = runDoctor(projectRoot);
    for (const c of report.checks) {
      expect(c.name.length).toBeGreaterThan(0);
      expect(['ok', 'warn', 'error', 'info']).toContain(c.status);
      expect(c.detail.length).toBeGreaterThan(0);
    }
  });
});
