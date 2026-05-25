/**
 * Direct unit coverage for src/mcp/cache.ts behaviors that the integration
 * test in tests/auto-init-hooks.test.ts doesn't reach:
 *
 *   1. maybeRefreshHooks idempotency — once per process per project
 *   2. malformed settings.local.json robustness — never throws
 *   3. detectProjectRoot fallback paths
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HOOKS_VERSION } from '../src/generators/settings.js';

let knitHome: string;
let projectRoot: string;

beforeEach(() => {
  knitHome = mkdtempSync(join(tmpdir(), 'knit-cache-test-'));
  process.env.KNIT_HOME = knitHome;
  projectRoot = mkdtempSync(join(tmpdir(), 'knit-cache-proj-'));
  writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({ name: 'cache-test-proj' }), 'utf-8');
});

afterEach(() => {
  delete process.env.KNIT_HOME;
  try { rmSync(knitHome, { recursive: true, force: true }); } catch { /* */ }
  try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* */ }
});

describe('maybeRefreshHooks idempotency', () => {
  it('skips a second refresh on the same project within one process', async () => {
    // Pre-populate centralized knowledge so autoInitialize doesn't fire on first
    // getBrain (which would skip maybeRefreshHooks via the `autoInitialized` flag
    // and never add the project to the per-process Set we're trying to test).
    const { projectId } = await import('../src/engine/project-id.js');
    const hash = projectId(projectRoot);
    const projectData = join(knitHome, 'projects', hash);
    mkdirSync(projectData, { recursive: true });
    writeFileSync(
      join(projectData, 'knowledge.json'),
      JSON.stringify({ generatedAt: new Date().toISOString(), summary: { totalFiles: 0, totalLines: 0, languageBreakdown: {}, entryPoints: [], highFanoutFiles: [], untestedFiles: [], largestFiles: [] }, files: [], importGraph: {}, exports: {}, testMap: { tested: {}, untested: [], testFiles: [] } }),
      'utf-8',
    );

    // Seed a stale settings.local.json so the first maybeRefreshHooks call triggers a refresh.
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    const settingsPath = join(projectRoot, '.claude', 'settings.local.json');
    writeFileSync(
      settingsPath,
      JSON.stringify({ _knitHooks: { version: 1, generatedAt: '1970-01-01T00:00:00Z' } }, null, 2),
      'utf-8',
    );

    const cacheMod = await import('../src/mcp/cache.js');
    const refreshBrain = (cacheMod as unknown as { refreshBrain: (p: string) => unknown }).refreshBrain;

    // First call: autoInitialize skipped (centralized data exists) → maybeRefreshHooks fires → version 1 → current.
    refreshBrain(projectRoot);
    const afterFirst = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    expect(afterFirst._knitHooks.version).toBe(HOOKS_VERSION);

    // Tamper the file back to stale state. If maybeRefreshHooks ran again it would
    // bump version back to current; the per-process Set must suppress the call.
    writeFileSync(
      settingsPath,
      JSON.stringify({ _knitHooks: { version: 1, generatedAt: 'sentinel' }, custom: 'preserved' }, null, 2),
      'utf-8',
    );
    const tamperedMtime = statSync(settingsPath).mtimeMs;

    // Second call on same project: maybeRefreshHooks short-circuits via hooksRefreshed.has(rootPath).
    refreshBrain(projectRoot);
    const afterSecond = JSON.parse(readFileSync(settingsPath, 'utf-8'));

    // File should be unchanged from the tampered state — no refresh attempted.
    expect(afterSecond._knitHooks.version).toBe(1);
    expect(afterSecond._knitHooks.generatedAt).toBe('sentinel');
    expect(afterSecond.custom).toBe('preserved');
    expect(statSync(settingsPath).mtimeMs).toBe(tamperedMtime);
  });
});

describe('malformed settings robustness', () => {
  it('does not crash getBrain when settings.local.json is corrupt', async () => {
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    const settingsPath = join(projectRoot, '.claude', 'settings.local.json');
    writeFileSync(settingsPath, '{ this is not valid json', 'utf-8');

    const cacheMod = await import('../src/mcp/cache.js');
    const refreshBrain = (cacheMod as unknown as { refreshBrain: (p: string) => unknown }).refreshBrain;

    // Must not throw — best-effort upgrade path swallows JSON.parse errors.
    expect(() => refreshBrain(projectRoot)).not.toThrow();
  });

  it('skips upgrade when settings.local.json is missing entirely', async () => {
    // No .claude/ dir at all.
    const cacheMod = await import('../src/mcp/cache.js');
    const refreshBrain = (cacheMod as unknown as { refreshBrain: (p: string) => unknown }).refreshBrain;

    refreshBrain(projectRoot);

    // autoInitialize runs because no centralized knowledge exists yet → it writes
    // settings.local.json on its own path. After that, maybeRefreshHooks should
    // see a fresh file and not double-fire (covered by the idempotency test above).
    const settingsPath = join(projectRoot, '.claude', 'settings.local.json');
    const content = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    expect(content._knitHooks.version).toBe(HOOKS_VERSION);
  });
});

describe('v0.11.2 — migration preserves user data', () => {
  it('v9.0-era upgrade preserves user permissions + non-knit-owned hooks + custom top-level keys', async () => {
    // Pre-populate centralized data so autoInitialize skips and the upgrade
    // path (maybeRefreshHooks) is what regenerates settings.local.json.
    const { projectId } = await import('../src/engine/project-id.js');
    const hash = projectId(projectRoot);
    const projectData = join(knitHome, 'projects', hash);
    mkdirSync(projectData, { recursive: true });
    writeFileSync(
      join(projectData, 'knowledge.json'),
      JSON.stringify({ generatedAt: new Date().toISOString(), summary: { totalFiles: 0, totalLines: 0, languageBreakdown: {}, entryPoints: [], highFanoutFiles: [], untestedFiles: [], largestFiles: [] }, files: [], importGraph: {}, exports: {}, testMap: { tested: {}, untested: [], testFiles: [] } }),
      'utf-8',
    );

    // Seed a realistic v0.9-era settings.local.json with:
    //   - stale v7 knit hooks (will be regenerated)
    //   - user-owned hook entry that MUST survive (no _knitOwned tag)
    //   - user-owned mcpServers entry that MUST survive (e.g. another MCP)
    //   - user-owned permissions block that MUST survive
    //   - custom top-level key (e.g. "my-org-config") that MUST survive
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    const settingsPath = join(projectRoot, '.claude', 'settings.local.json');
    const userSettings = {
      _knitHooks: { version: 7, generatedAt: '1970-01-01T00:00:00Z' },
      mcpServers: {
        'knit-brain': { command: 'npx', args: ['-y', 'knit-mcp@latest'] },
        'my-other-mcp': { command: '/usr/local/bin/my-server', args: ['--port', '8080'] },
      },
      hooks: {
        SessionStart: [
          // A user-authored hook (NOT _knitOwned) that must survive
          { hooks: [{ type: 'command', command: 'echo "user-authored startup"' }] },
        ],
        UserPromptSubmit: [],
        PreToolUse: [],
        PostToolUse: [
          // A stale _knitOwned entry from v0.9 — should be REPLACED
          { _knitOwned: true, hooks: [{ type: 'command', command: 'echo "old knit hook"' }] },
        ],
        Stop: [],
      },
      permissions: {
        allow: ['Bash(git status)', 'Bash(npm test)'],
        deny: ['Bash(rm -rf /)'],
      },
      'my-org-config': { team: 'platform', 'cost-center': 'CC-1234' },
    };
    writeFileSync(settingsPath, JSON.stringify(userSettings, null, 2), 'utf-8');

    const { refreshBrain } = await import('../src/mcp/cache.js');
    refreshBrain(projectRoot);

    const after = JSON.parse(readFileSync(settingsPath, 'utf-8'));

    // 1. Hooks version bumped.
    expect(after._knitHooks.version).toBe(HOOKS_VERSION);

    // 2. User-owned hook in SessionStart survived.
    const userStartHook = after.hooks.SessionStart.find(
      (e: { hooks?: Array<{ command?: string }>; _knitOwned?: boolean }) =>
        !e._knitOwned && e.hooks?.some((h) => h.command === 'echo "user-authored startup"'),
    );
    expect(userStartHook, 'user-authored SessionStart hook was wiped').toBeDefined();

    // 3. Stale _knitOwned PostToolUse hook was REPLACED, not appended.
    const stalePostHook = after.hooks.PostToolUse.find(
      (e: { hooks?: Array<{ command?: string }> }) =>
        e.hooks?.some((h) => h.command === 'echo "old knit hook"'),
    );
    expect(stalePostHook, 'stale _knitOwned hook should have been replaced').toBeUndefined();

    // 4. User's other MCP server entry survived.
    expect(after.mcpServers['my-other-mcp']).toBeDefined();
    expect(after.mcpServers['my-other-mcp'].args).toEqual(['--port', '8080']);

    // 5. User's permissions block survived intact.
    expect(after.permissions.allow).toContain('Bash(git status)');
    expect(after.permissions.allow).toContain('Bash(npm test)');
    expect(after.permissions.deny).toContain('Bash(rm -rf /)');

    // 6. User's custom top-level key survived.
    expect(after['my-org-config']).toEqual({ team: 'platform', 'cost-center': 'CC-1234' });

    // 7. The v0.11 hook payloads landed (security + verify gates).
    const allHookCommands = (['UserPromptSubmit', 'PostToolUse', 'Stop'] as const)
      .flatMap((section) => after.hooks[section] ?? [])
      .flatMap((entry: { hooks?: Array<{ command?: string }> }) => entry.hooks ?? [])
      .map((h: { command?: string }) => h.command ?? '')
      .join('\n');
    expect(allHookCommands).toContain('REVIEW gate'); // slice 1 claim gate
    expect(allHookCommands).toContain('verify: write landed'); // slice 2 diff verify
    expect(allHookCommands).toContain('drift detector'); // slice 3
    expect(allHookCommands).toContain('execFileSync'); // C2 shell-injection fix from v0.11.1
  });
});

describe('v0.11 HOOKS_VERSION migration (7 → current)', () => {
  it('regenerates v0.11 hook payloads when version=7 is seen on disk', async () => {
    // Pre-populate centralized data so autoInitialize skips and the upgrade path
    // (maybeRefreshHooks) is what regenerates settings.local.json.
    const { projectId } = await import('../src/engine/project-id.js');
    const hash = projectId(projectRoot);
    const projectData = join(knitHome, 'projects', hash);
    mkdirSync(projectData, { recursive: true });
    writeFileSync(
      join(projectData, 'knowledge.json'),
      JSON.stringify({ generatedAt: new Date().toISOString(), summary: { totalFiles: 0, totalLines: 0, languageBreakdown: {}, entryPoints: [], highFanoutFiles: [], untestedFiles: [], largestFiles: [] }, files: [], importGraph: {}, exports: {}, testMap: { tested: {}, untested: [], testFiles: [] } }),
      'utf-8',
    );

    // Seed an existing settings.local.json with stale v7 (pre-v0.11) hook stubs.
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    const settingsPath = join(projectRoot, '.claude', 'settings.local.json');
    writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          _knitHooks: { version: 7, generatedAt: '1970-01-01T00:00:00Z' },
          hooks: {
            SessionStart: [],
            UserPromptSubmit: [],
            PreToolUse: [],
            PostToolUse: [],
            Stop: [],
          },
        },
        null,
        2,
      ),
      'utf-8',
    );

    const cacheMod = await import('../src/mcp/cache.js');
    const refreshBrain = (cacheMod as unknown as { refreshBrain: (p: string) => unknown }).refreshBrain;
    refreshBrain(projectRoot);

    const after = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    expect(after._knitHooks.version).toBeGreaterThanOrEqual(10);
    expect(after._knitHooks.version).toBe(HOOKS_VERSION);

    // Pull every command string in any hook section and flatten — easier to
    // assert against than walking the nested entry shape.
    const allCommands: string[] = [];
    for (const section of ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'] as const) {
      const entries = after.hooks?.[section] ?? [];
      for (const entry of entries) {
        for (const h of entry.hooks ?? []) {
          if (typeof h.command === 'string') allCommands.push(h.command);
        }
      }
    }

    const userPromptCommands = (after.hooks?.UserPromptSubmit ?? [])
      .flatMap((e: { hooks?: Array<{ command?: string }> }) => e.hooks ?? [])
      .map((h: { command?: string }) => h.command ?? '')
      .join('\n');
    expect(userPromptCommands).toContain('.classified-current');
    expect(userPromptCommands).toContain('.searched-current');
    expect(userPromptCommands).toContain('.claim-verified-current');
    expect(userPromptCommands).toContain('.turn-edits.jsonl');

    const postToolUseCommands = (after.hooks?.PostToolUse ?? [])
      .flatMap((e: { hooks?: Array<{ command?: string }> }) => e.hooks ?? [])
      .map((h: { command?: string }) => h.command ?? '')
      .join('\n');
    expect(postToolUseCommands).toContain('verify: write landed');

    const stopCommands = (after.hooks?.Stop ?? [])
      .flatMap((e: { hooks?: Array<{ command?: string }> }) => e.hooks ?? [])
      .map((h: { command?: string }) => h.command ?? '')
      .join('\n');
    expect(stopCommands).toContain('REVIEW gate');
    expect(stopCommands).toContain('drift detector');
  });
});

describe('detectProjectRoot fallback', () => {
  it('falls back to cwd when not inside a git repo', async () => {
    const cacheMod = await import('../src/mcp/cache.js');
    const detectProjectRoot = (cacheMod as unknown as { detectProjectRoot: () => string }).detectProjectRoot;

    // projectRoot is a fresh tmpdir without .git — detectProjectRoot should fall back.
    const prevCwd = process.cwd();
    try {
      process.chdir(projectRoot);
      const detected = detectProjectRoot();
      // On macOS tmpdir resolves through /private symlink; either form is acceptable.
      expect(detected === projectRoot || detected.endsWith(projectRoot)).toBe(true);
    } finally {
      process.chdir(prevCwd);
    }
  });
});
