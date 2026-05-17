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

  it('merges engram hooks into a user-curated settings.local.json (no _engramHooks marker)', async () => {
    const settingsPath = join(projectRoot, '.claude', 'settings.local.json');
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    const userHookCmd = 'echo user-pre-hook';
    const userContent = {
      permissions: { allow: ['Bash(custom:*)'] },
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: userHookCmd }] },
        ],
      },
    };
    writeFileSync(settingsPath, JSON.stringify(userContent, null, 2), 'utf-8');

    const cacheMod = await import('../src/mcp/cache.js');
    (cacheMod as unknown as { refreshBrain: (p: string) => unknown }).refreshBrain(projectRoot);

    const after = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    expect(after._engramHooks).toMatchObject({ version: 2, merged: true });

    // User entry preserved, no _engramOwned tag
    const pre = after.hooks.PreToolUse as Array<Record<string, unknown>>;
    expect(pre.length).toBeGreaterThanOrEqual(2);
    const userEntry = pre.find((e) => {
      const inner = (e.hooks as Array<{ command: string }> | undefined)?.[0];
      return inner?.command === userHookCmd;
    });
    expect(userEntry).toBeDefined();
    expect(userEntry).not.toHaveProperty('_engramOwned');

    // Engram entries all tagged
    const engramEntries = pre.filter((e) => e._engramOwned === true);
    expect(engramEntries.length).toBeGreaterThan(0);

    // Stop array exists and engram entries tagged
    const stop = after.hooks.Stop as Array<Record<string, unknown>>;
    expect(stop.length).toBeGreaterThan(0);
    expect(stop.every((e) => e._engramOwned === true)).toBe(true);

    // User's permissions key preserved
    expect(after.permissions).toEqual({ allow: ['Bash(custom:*)'] });
  });

  it('regenerating a merged file replaces only engram entries, preserving user entries', async () => {
    const settingsPath = join(projectRoot, '.claude', 'settings.local.json');
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    const userHookCmd = 'echo user-pre-hook-v2';
    // Pre-seed the user-owned settings file with a user entry AND a stale engram
    // entry (as if a prior merge had run). On init, engram should preserve the
    // user entry, strip the stale engram entry, and append fresh engram entries.
    const seedContent = {
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: userHookCmd }] },
          {
            _engramOwned: true,
            matcher: 'Stale',
            hooks: [{ type: 'command', command: 'echo stale-engram-old' }],
          },
        ],
      },
    };
    writeFileSync(settingsPath, JSON.stringify(seedContent, null, 2), 'utf-8');

    const cacheMod = await import('../src/mcp/cache.js');
    (cacheMod as unknown as { refreshBrain: (p: string) => unknown }).refreshBrain(projectRoot);

    const after = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    const pre = after.hooks.PreToolUse as Array<Record<string, unknown>>;

    // User entry preserved
    const userEntry = pre.find((e) => {
      const inner = (e.hooks as Array<{ command: string }> | undefined)?.[0];
      return inner?.command === userHookCmd;
    });
    expect(userEntry).toBeDefined();
    expect(userEntry).not.toHaveProperty('_engramOwned');

    // Stale engram entry stripped
    const staleEntry = pre.find((e) => e.matcher === 'Stale');
    expect(staleEntry).toBeUndefined();

    // Fresh engram entries present
    expect(pre.some((e) => e._engramOwned === true)).toBe(true);
    expect(after._engramHooks).toMatchObject({ merged: true });
  });

  it('merge preserves top-level keys like mcpServers and permissions', async () => {
    const settingsPath = join(projectRoot, '.claude', 'settings.local.json');
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    const userContent = {
      mcpServers: { 'user-server': { command: 'foo', args: ['bar'] } },
      permissions: { allow: ['Bash(custom:*)'], deny: ['Bash(rm:*)'] },
      hooks: {
        PostToolUse: [
          { matcher: 'Write', hooks: [{ type: 'command', command: 'echo user-post' }] },
        ],
      },
    };
    writeFileSync(settingsPath, JSON.stringify(userContent, null, 2), 'utf-8');

    const cacheMod = await import('../src/mcp/cache.js');
    (cacheMod as unknown as { refreshBrain: (p: string) => unknown }).refreshBrain(projectRoot);

    const after = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    // User's mcpServers preserved verbatim (engram does NOT overwrite it during merge)
    expect(after.mcpServers).toEqual({ 'user-server': { command: 'foo', args: ['bar'] } });
    expect(after.permissions).toEqual({ allow: ['Bash(custom:*)'], deny: ['Bash(rm:*)'] });
    expect(after._engramHooks).toMatchObject({ merged: true });
    // User's PostToolUse entry preserved
    const post = after.hooks.PostToolUse as Array<Record<string, unknown>>;
    const userPost = post.find((e) => {
      const inner = (e.hooks as Array<{ command: string }> | undefined)?.[0];
      return inner?.command === 'echo user-post';
    });
    expect(userPost).toBeDefined();
    expect(userPost).not.toHaveProperty('_engramOwned');
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
