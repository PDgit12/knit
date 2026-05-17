import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// We need to (re)load cache.ts after setting ENGRAM_HOME, because some
// path resolutions are evaluated at call time but the cache singleton
// persists across calls. Use dynamic import + module-cache reset.

describe('auto-init hooks integration', () => {
  let engramHome: string;
  let projectRoot: string;

  beforeAll(() => {
    engramHome = mkdtempSync(join(tmpdir(), 'engram-hooks-test-'));
    process.env.ENGRAM_HOME = engramHome;
  });

  afterAll(() => {
    delete process.env.ENGRAM_HOME;
    try { rmSync(engramHome, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'engram-proj-'));
    // Minimal project shape: package.json so name detection works
    writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({ name: 'fake-test-proj' }), 'utf-8');
  });

  afterEach(() => {
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  it('first MCP call writes <project>/.claude/settings.local.json with engram hooks', async () => {
    const cacheMod = await import('../src/mcp/cache.js');
    // Force a fresh cache lookup for this project root
    (cacheMod as unknown as { refreshBrain: (p: string) => unknown }).refreshBrain(projectRoot);

    const settingsPath = join(projectRoot, '.claude', 'settings.local.json');
    expect(existsSync(settingsPath)).toBe(true);

    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    expect(settings).toHaveProperty('hooks');
    expect(settings).toHaveProperty('mcpServers');
    expect(settings).toHaveProperty('_engramHooks');
    expect((settings._engramHooks as { version: number }).version).toBe(2);
    expect(settings.hooks).toHaveProperty('Stop');
    expect(Array.isArray(settings.hooks.Stop)).toBe(true);
    expect((settings.hooks.Stop as unknown[]).length).toBeGreaterThan(0);
  });

  it('does not clobber a user-curated settings.local.json (no _engramHooks marker)', async () => {
    const settingsPath = join(projectRoot, '.claude', 'settings.local.json');
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    const userContent = { permissions: { allow: ['Bash(custom:*)'] } };
    writeFileSync(settingsPath, JSON.stringify(userContent, null, 2), 'utf-8');

    const cacheMod = await import('../src/mcp/cache.js');
    (cacheMod as unknown as { refreshBrain: (p: string) => unknown }).refreshBrain(projectRoot);

    const after = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    expect(after).toEqual(userContent);
    expect(after).not.toHaveProperty('_engramHooks');
    expect(after).not.toHaveProperty('hooks');
  });

  it('never touches the team-shared settings.json (engram only writes settings.local.json)', async () => {
    // Simulate a team-curated settings.json
    const teamSettings = join(projectRoot, '.claude', 'settings.json');
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    const teamContent = { hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo team' }] }] } };
    writeFileSync(teamSettings, JSON.stringify(teamContent, null, 2), 'utf-8');

    const cacheMod = await import('../src/mcp/cache.js');
    (cacheMod as unknown as { refreshBrain: (p: string) => unknown }).refreshBrain(projectRoot);

    const settingsAfter = JSON.parse(readFileSync(teamSettings, 'utf-8'));
    expect(settingsAfter).toEqual(teamContent);

    // And the engram-managed settings.local.json should exist alongside it
    const engramLocal = join(projectRoot, '.claude', 'settings.local.json');
    expect(existsSync(engramLocal)).toBe(true);
    const engramContent = JSON.parse(readFileSync(engramLocal, 'utf-8'));
    expect(engramContent).toHaveProperty('_engramHooks');
  });

  it('regenerates over its own previous output (has _engramHooks marker)', async () => {
    const settingsPath = join(projectRoot, '.claude', 'settings.local.json');
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    // Existing engram-owned file: stale generatedAt that we expect to be replaced
    writeFileSync(
      settingsPath,
      JSON.stringify({ _engramHooks: { version: 1, generatedAt: '1970-01-01T00:00:00Z' }, hooks: {} }, null, 2),
      'utf-8',
    );

    const cacheMod = await import('../src/mcp/cache.js');
    (cacheMod as unknown as { refreshBrain: (p: string) => unknown }).refreshBrain(projectRoot);

    const after = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    expect((after._engramHooks as { generatedAt: string }).generatedAt).not.toBe('1970-01-01T00:00:00Z');
    expect(after.hooks).toHaveProperty('Stop');
  });
});
