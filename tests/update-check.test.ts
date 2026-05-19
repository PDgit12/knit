import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isNewerVersion,
  getCachedLatestVersion,
  __setCachedLatestForTests,
  __resetUpdateCheckForTests,
} from '../src/mcp/update-check.js';

/**
 * v0.7.2 — in-band update notification.
 *
 * The check itself is best-effort and side-effecting (HTTP, timeouts).
 * These tests focus on the deterministic pieces — the semver comparator,
 * the cached read, and the handler integration — without invoking the
 * network. Real network paths are exercised by manual smoke tests, not unit.
 */

let knitHome: string;
let projectRoot: string;

beforeEach(() => {
  knitHome = mkdtempSync(join(tmpdir(), 'knit-update-test-'));
  process.env.KNIT_HOME = knitHome;
  projectRoot = mkdtempSync(join(tmpdir(), 'knit-update-project-'));
  __resetUpdateCheckForTests();
});

afterEach(() => {
  delete process.env.KNIT_HOME;
  __resetUpdateCheckForTests();
  try { rmSync(knitHome, { recursive: true, force: true }); } catch { /* best-effort */ }
  try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('isNewerVersion — semver comparator', () => {
  it('detects major bump', () => {
    expect(isNewerVersion('1.0.0', '0.9.99')).toBe(true);
  });

  it('detects minor bump', () => {
    expect(isNewerVersion('0.8.0', '0.7.99')).toBe(true);
  });

  it('detects patch bump', () => {
    expect(isNewerVersion('0.7.2', '0.7.1')).toBe(true);
  });

  it('returns false for equal versions', () => {
    expect(isNewerVersion('0.7.1', '0.7.1')).toBe(false);
  });

  it('returns false when current is newer than latest (shouldn\'t happen in practice but be defensive)', () => {
    expect(isNewerVersion('0.7.0', '0.7.2')).toBe(false);
  });

  it('ignores prerelease suffixes when comparing', () => {
    // A stable release equal to current shouldn't show as "downgrade" just because
    // current is the same x.y.z with a -alpha tag.
    expect(isNewerVersion('0.7.1', '0.7.1-alpha.3')).toBe(false);
    expect(isNewerVersion('0.7.2', '0.7.1-alpha.3')).toBe(true);
  });

  it('handles missing segments gracefully', () => {
    expect(isNewerVersion('1.2', '1.1')).toBe(true);
    expect(isNewerVersion('1', '0')).toBe(true);
  });
});

describe('getCachedLatestVersion — sync read', () => {
  it('returns null before any successful fetch', () => {
    expect(getCachedLatestVersion()).toBeNull();
  });

  it('returns the seeded value after __setCachedLatestForTests', () => {
    __setCachedLatestForTests('0.8.0');
    expect(getCachedLatestVersion()).toBe('0.8.0');
  });

  it('returns null when explicitly cleared', () => {
    __setCachedLatestForTests('0.8.0');
    __setCachedLatestForTests(null);
    expect(getCachedLatestVersion()).toBeNull();
  });
});

describe('knit_brain_status — update_available surface', () => {
  function buildMinimalBrain() {
    return {
      rootPath: projectRoot,
      knowledge: {
        generatedAt: new Date().toISOString(),
        summary: {
          totalFiles: 5, totalLines: 200, languageBreakdown: { '.ts': 5 },
          entryPoints: [], highFanoutFiles: [], untestedFiles: [], largestFiles: [],
        },
        files: [], importGraph: {}, exports: {},
        testMap: { tested: {}, untested: [], testFiles: [] },
      },
      reverseDeps: {},
      knowledgeBase: { version: 1, projectName: 'test', entries: [], metrics: { totalSessions: 0, totalLearnings: 0, cacheHits: 0, domainDistribution: {}, sessions: [] } },
      config: {
        name: 'test', packageManager: 'npm',
        stack: { language: 'typescript', dependencies: [], buildCommand: '', lintCommand: '', typecheckCommand: '' },
        domains: [], targetAgent: 'claude-code', tokenOptimization: 'standard',
      },
      loadedAt: Date.now(),
      autoInitialized: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  it('omits update_available when no cached latest yet (cold first call)', async () => {
    const { handleBrainStatus } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    const result = JSON.parse(handleBrainStatus({}, buildMinimalBrain()));
    expect(result.update_available).toBeUndefined();
  });

  it('omits update_available when cached latest equals installed VERSION', async () => {
    const { handleBrainStatus } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    const { VERSION } = await import('../src/version.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    __setCachedLatestForTests(VERSION); // same as installed
    const result = JSON.parse(handleBrainStatus({}, buildMinimalBrain()));
    expect(result.update_available).toBeUndefined();
  });

  it('surfaces update_available with current + latest + upgrade hint when newer', async () => {
    const { handleBrainStatus } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    const { VERSION } = await import('../src/version.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    // Construct a strictly-greater version: bump patch by 1.
    const [maj, min, patch] = VERSION.split('.').map((n) => parseInt(n, 10));
    const newer = `${maj}.${min}.${(patch ?? 0) + 1}`;
    __setCachedLatestForTests(newer);

    const result = JSON.parse(handleBrainStatus({}, buildMinimalBrain()));
    expect(result.update_available).toBeDefined();
    expect(result.update_available.current).toBe(VERSION);
    expect(result.update_available.latest).toBe(newer);
    expect(result.update_available.upgrade).toMatch(/Restart Claude Code/);
    expect(result.update_available.changelog).toMatch(/CHANGELOG\.md/);
  });

  it('omits update_available when registry latest is older than installed (defensive)', async () => {
    const { handleBrainStatus } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    const { VERSION } = await import('../src/version.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    // Construct a strictly-older version.
    const [maj, min, patch] = VERSION.split('.').map((n) => parseInt(n, 10));
    const older = patch > 0 ? `${maj}.${min}.${patch - 1}` : `${maj}.${Math.max(0, (min ?? 0) - 1)}.0`;
    __setCachedLatestForTests(older);

    const result = JSON.parse(handleBrainStatus({}, buildMinimalBrain()));
    expect(result.update_available).toBeUndefined();
  });
});
