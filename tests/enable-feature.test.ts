import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Integration coverage for the v0.7 step-4 enable/disable handlers:
 *
 *   - handleEnableFeature writes ~/.knit/projects/<hash>/features.json
 *   - handleListFeatures reads it back and reports `enabled_features`
 *   - handleDisableFeature removes it; persistence round-trips cleanly
 *
 * Uses a sandboxed KNIT_HOME so the test's enable-state never touches the
 * developer's real ~/.knit directory.
 */

let knitHome: string;
let projectRoot: string;

beforeEach(() => {
  knitHome = mkdtempSync(join(tmpdir(), 'knit-enable-test-'));
  process.env.KNIT_HOME = knitHome;
  projectRoot = mkdtempSync(join(tmpdir(), 'knit-enable-project-'));
});

afterEach(() => {
  delete process.env.KNIT_HOME;
  try { rmSync(knitHome, { recursive: true, force: true }); } catch { /* best-effort */ }
  try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('knit_enable_feature persistence', () => {
  it('writes features.json on enable, reads it back via list_features', async () => {
    // Import dynamically so KNIT_HOME above is in effect when paths.ts resolves.
    const { handleEnableFeature, handleListFeatures, handleDisableFeature, detectProjectShape } =
      await import('../src/mcp/handlers.js');
    const { featuresConfigPath, projectDataDir } = await import('../src/engine/paths.js');

    // Build a minimal BrainCache directly; we only need rootPath, knowledge, config
    // for the handlers under test.
    mkdirSync(projectDataDir(projectRoot), { recursive: true });
    const brain = {
      rootPath: projectRoot,
      knowledge: {
        generatedAt: new Date().toISOString(),
        summary: {
          totalFiles: 5,
          totalLines: 100,
          languageBreakdown: {},
          entryPoints: [],
          highFanoutFiles: [],
          untestedFiles: [],
          largestFiles: [],
        },
        files: [],
        importGraph: {},
        exports: {},
        testMap: { tested: {}, untested: [], testFiles: [] },
      },
      reverseDeps: {},
      knowledgeBase: { version: 1, projectName: 'test', entries: [], metrics: { totalSessions: 0, totalLearnings: 0, cacheHits: 0, domainDistribution: {}, sessions: [] } },
      config: { name: 'test', packageManager: 'npm', stack: { language: 'typescript', framework: undefined, dependencies: [], testFramework: undefined, buildCommand: '', lintCommand: '', typecheckCommand: '' }, domains: [], targetAgent: 'claude-code' as const, tokenOptimization: 'standard' as const },
      loadedAt: Date.now(),
      autoInitialized: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    // Pre-state: no features.json, ProjectShape reports empty enabledFeatures.
    expect(existsSync(featuresConfigPath(projectRoot))).toBe(false);
    expect([...detectProjectShape(brain).enabledFeatures]).toEqual([]);

    // Enable teams.
    const enableResp = JSON.parse(handleEnableFeature({ feature: 'teams' }, brain));
    expect(enableResp.status).toBe('enabled');
    expect(enableResp.enabled_features).toEqual(['teams']);

    // features.json now on disk with the right shape.
    expect(existsSync(featuresConfigPath(projectRoot))).toBe(true);
    const persisted = JSON.parse(readFileSync(featuresConfigPath(projectRoot), 'utf-8'));
    expect(persisted.enabled).toEqual(['teams']);
    expect(persisted.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // detectProjectShape now reflects the persisted flag.
    expect([...detectProjectShape(brain).enabledFeatures]).toEqual(['teams']);

    // list_features reports it under project_shape.
    const listResp = JSON.parse(handleListFeatures({}, brain));
    expect(listResp.project_shape.enabled_features).toEqual(['teams']);

    // And the team tools are now in `active`, not `available`.
    const activeNames = listResp.active.map((t: { name: string }) => t.name);
    expect(activeNames).toContain('knit_spawn_team_worktree');

    // Re-enabling is idempotent.
    const enableAgain = JSON.parse(handleEnableFeature({ feature: 'teams' }, brain));
    expect(enableAgain.status).toBe('already-enabled');

    // Disable round-trips.
    const disableResp = JSON.parse(handleDisableFeature({ feature: 'teams' }, brain));
    expect(disableResp.status).toBe('disabled');
    expect(disableResp.enabled_features).toEqual([]);
    expect([...detectProjectShape(brain).enabledFeatures]).toEqual([]);

    // Disabling-when-not-on is a no-op (not an error).
    const disableAgain = JSON.parse(handleDisableFeature({ feature: 'teams' }, brain));
    expect(disableAgain.status).toBe('already-disabled');
  });

  it('rejects invalid feature names', async () => {
    const { handleEnableFeature } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const brain = { rootPath: projectRoot, knowledge: { summary: { totalFiles: 0 } }, config: { domains: [] } } as any;
    const resp = JSON.parse(handleEnableFeature({ feature: 'typos' }, brain));
    expect(resp.status).toBe('error');
    expect(resp.error).toMatch(/Invalid feature/);
  });
});
