/**
 * v0.22 Batch D — per-host hook generators. Verifies the manifests reuse the
 * shared substrate, carry honest unverified caveats, and merge idempotently with
 * a user's existing host config (Knit-owned replaced, user hooks preserved).
 */
import { describe, it, expect } from 'vitest';
import {
  buildHostHookManifest,
  mergeHostHooks,
  HOST_HOOKS_VERSION,
  type HostHookId,
} from '../src/generators/host-hooks.js';

const ROOT = '/tmp/host-hooks-project';
const TS = '2026-05-30T00:00:00.000Z';
const HOSTS: HostHookId[] = ['cursor', 'codex', 'copilot'];

describe('buildHostHookManifest', () => {
  it.each(HOSTS)('emits a manifest for %s with the three adherence touchpoints', (host) => {
    const { file, manifest } = buildHostHookManifest(host, ROOT, TS);
    expect(file).toMatch(host === 'copilot' ? /\.github[\\/]hooks[\\/]knit\.json$/ : new RegExp(`\\.${host}[\\\\/]hooks\\.json$`));
    const hooks = manifest.hooks as Record<string, unknown[]>;
    // Exactly three events (session-start, pre-edit reminder, stop) — the
    // host-input-independent adherence touchpoints.
    expect(Object.keys(hooks)).toHaveLength(3);
    for (const entries of Object.values(hooks)) {
      expect(entries).toHaveLength(1);
      const e = entries[0] as { _knitOwned: boolean; command: string };
      expect(e._knitOwned).toBe(true);
      // Reuses the shared nodeHook compiler → portable `node -e '...'`.
      expect(e.command).toMatch(/^node -e '/);
    }
  });

  it.each(HOSTS)('%s manifest carries the honest unverified caveat', (host) => {
    const { manifest } = buildHostHookManifest(host, ROOT, TS);
    expect(manifest._knitUnverified).toBe(true);
    expect(typeof manifest._knitNote).toBe('string');
    expect((manifest._knitNote as string).length).toBeGreaterThan(20);
    expect(manifest._knitOwned).toBe(true);
    expect((manifest._knitHooks as { version: number }).version).toBe(HOST_HOOKS_VERSION);
  });

  it.each(HOSTS)('%s hook commands are valid JS that parse cleanly (no syntax errors)', (host) => {
    const { manifest } = buildHostHookManifest(host, ROOT, TS);
    for (const entries of Object.values(manifest.hooks as Record<string, Array<{ command: string }>>)) {
      for (const e of entries) {
        const m = e.command.match(/^node -e '([\s\S]*)'$/);
        expect(m).not.toBeNull();
        const body = (m as RegExpMatchArray)[1].replace(/'\\''/g, "'"); // un-POSIX-escape
        // Throws on a syntax error — proves the embedded payload is runnable.
        expect(() => new Function(body)).not.toThrow();
      }
    }
  });

  it('the pre-edit touchpoint is a REMINDER, never a hard block (no process.exit)', () => {
    const { manifest } = buildHostHookManifest('cursor', ROOT, TS);
    const cmds = Object.values(manifest.hooks as Record<string, Array<{ command: string }>>)
      .flat().map((e) => e.command).join(' ');
    expect(cmds).not.toMatch(/process\.exit\(2\)/);
    expect(cmds).toMatch(/reminder: call knit_classify_task/);
  });
});

describe('mergeHostHooks — idempotent co-existence', () => {
  it('returns the generated manifest when nothing exists yet', () => {
    const { manifest } = buildHostHookManifest('cursor', ROOT, TS);
    expect(mergeHostHooks(null, manifest)).toBe(manifest);
  });

  it('preserves a user hook under the same event and strips stale Knit entries', () => {
    const { manifest } = buildHostHookManifest('cursor', ROOT, TS);
    const userHook = { type: 'command', command: 'echo user' };
    const staleKnit = { _knitOwned: true, type: 'command', command: 'node -e old' };
    const existing = {
      version: 1,
      hooks: { sessionStart: [userHook, staleKnit] },
      myCustomKey: 'keep me',
    };
    const merged = mergeHostHooks(existing, manifest);
    const sessionStart = (merged.hooks as Record<string, unknown[]>).sessionStart;
    // user hook kept, stale Knit entry removed, fresh Knit entry appended
    expect(sessionStart).toContainEqual(userHook);
    expect(sessionStart).not.toContainEqual(staleKnit);
    expect(sessionStart.filter((h) => (h as { _knitOwned?: boolean })._knitOwned)).toHaveLength(1);
    // unrelated top-level keys preserved
    expect(merged.myCustomKey).toBe('keep me');
    expect(merged._knitUnverified).toBe(true);
  });

  it('ignores a malformed array-shaped .hooks (no bogus numeric event keys)', () => {
    const { manifest } = buildHostHookManifest('cursor', ROOT, TS);
    const merged = mergeHostHooks({ hooks: ['junk', 'junk2'] } as unknown as Record<string, unknown>, manifest);
    const outHooks = merged.hooks as Record<string, unknown[]>;
    expect(Object.keys(outHooks)).not.toContain('0');
    expect(Object.keys(outHooks)).not.toContain('1');
    // Knit's three events are still present.
    expect(Object.keys(outHooks).length).toBe(3);
  });

  it('survives a __proto__ event key without throwing or polluting', () => {
    const { manifest } = buildHostHookManifest('codex', ROOT, TS);
    const evil = JSON.parse('{"hooks": {"__proto__": [{"command":"x"}], "sessionStart": []}}');
    const merged = mergeHostHooks(evil, manifest);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(merged.hooks as object)).not.toContain('__proto__');
  });

  it('is idempotent — merging twice yields one Knit entry per event', () => {
    const { manifest } = buildHostHookManifest('codex', ROOT, TS);
    const once = mergeHostHooks(null, manifest);
    const twice = mergeHostHooks(once, manifest);
    for (const entries of Object.values(twice.hooks as Record<string, unknown[]>)) {
      expect(entries.filter((h) => (h as { _knitOwned?: boolean })._knitOwned)).toHaveLength(1);
    }
  });
});
