/**
 * v0.22 — per-host hook generators for the non-Claude MCP hosts that DO have a
 * hook mechanism (Cursor, Codex CLI, Copilot/VS Code agent hooks). Thin writers
 * over the shared substrate in hook-snippets.ts: same portable nodeHook compiler
 * and the same brain-side bodies the Claude path uses — only the manifest shape,
 * file location, and event names change.
 *
 * HONESTY BOUNDARY (verify-before-trust, per the v0.22 plan): this machine can
 * only run Claude Code, so the non-Claude event names and hook INPUT contracts
 * below could NOT be confirmed in-host. Therefore we deliberately emit ONLY the
 * adherence touchpoints whose Knit-side body is host-input-INDEPENDENT (they read
 * Knit's markers via embedded paths, not host-passed args):
 *   T1 session-start marker + load_session reminder
 *   T2 pre-edit classify REMINDER (soft — never a hard block; Cursor has no
 *      pre-edit block and Codex/Copilot block semantics are unverified)
 *   T4 stop LEARN/verify reminder
 * The per-file tsc/diff/import hooks stay Claude-only until their host input
 * contracts are verified. Every manifest carries `_knitUnverified: true` + a
 * `_knitNote` so users know to confirm in-host. No faked auto-trigger claims.
 */
import { join } from 'node:path';
import {
  nodeHook,
  hookPaths,
  sessionStartBody,
  preEditReminderBody,
  stopLearnReminderBody,
} from './hook-snippets.js';

export const HOST_HOOKS_VERSION = 1;

export type HostHookId = 'cursor' | 'codex' | 'copilot';

interface HostHookProfile {
  /** Repo-relative manifest path. */
  file: string;
  /** Touchpoint → this host's event name (per May-2026 research; UNVERIFIED). */
  events: { sessionStart: string; preEdit: string; stop: string };
  /** What specifically could not be confirmed from this machine. */
  note: string;
}

const PROFILES: Record<HostHookId, HostHookProfile> = {
  cursor: {
    file: join('.cursor', 'hooks.json'),
    events: { sessionStart: 'sessionStart', preEdit: 'afterFileEdit', stop: 'stop' },
    note: 'Cursor hook event names per docs (sessionStart/afterFileEdit/stop). Cursor has NO pre-edit block event, so the classify check is a reminder only. Verify event names + that Cursor preserves the _knit* keys in-host.',
  },
  codex: {
    file: join('.codex', 'hooks.json'),
    events: { sessionStart: 'sessionStart', preEdit: 'preToolUse', stop: 'stop' },
    note: 'Codex CLI hook event names + JSON schema are UNVERIFIED from this machine. Confirm the manifest shape and the block mechanism (exit-code vs decision JSON) in-host before relying on enforcement.',
  },
  copilot: {
    file: join('.github', 'hooks', 'knit.json'),
    events: { sessionStart: 'sessionStart', preEdit: 'preToolUse', stop: 'stop' },
    note: 'Copilot/VS Code agent hooks (.github/hooks/*.json) are UNVERIFIED from this machine and may require a preview flag. Confirm the path + schema in-host.',
  },
};

/** One hook command entry, tagged so the merge can strip only Knit's. */
function entry(body: string) {
  return { _knitOwned: true, type: 'command', command: nodeHook(body), timeout: 5 };
}

/** Build the host-input-independent adherence manifest for a host. */
export function buildHostHookManifest(hostId: HostHookId, rootPath: string, generatedAt: string): {
  file: string;
  manifest: Record<string, unknown>;
} {
  const profile = PROFILES[hostId];
  const p = hookPaths(rootPath);
  const hooks: Record<string, unknown[]> = {
    [profile.events.sessionStart]: [entry(sessionStartBody(p))],
    [profile.events.preEdit]: [entry(preEditReminderBody(p))],
    [profile.events.stop]: [entry(stopLearnReminderBody(p))],
  };
  return {
    file: profile.file,
    manifest: {
      version: HOST_HOOKS_VERSION,
      hooks,
      _knitHooks: { version: HOST_HOOKS_VERSION, generatedAt },
      _knitOwned: true,
      _knitUnverified: true,
      _knitNote: profile.note,
    },
  };
}

/**
 * Idempotent co-existence: merge Knit's generated manifest into whatever the
 * user already has on disk. Knit-owned hook entries (tagged `_knitOwned`) are
 * replaced; the user's own hooks under the same events are preserved; unrelated
 * top-level keys are left untouched. Mirrors the Claude settings hybrid-merge so
 * `knit setup` never clobbers a user's existing host config — the compose-with-
 * existing rule (don't duplicate what the user already has).
 */
export function mergeHostHooks(
  existing: Record<string, unknown> | null,
  generated: Record<string, unknown>,
): Record<string, unknown> {
  if (!existing || typeof existing !== 'object') return generated;
  const merged: Record<string, unknown> = { ...existing };

  // Guard: a non-object OR an ARRAY `.hooks` (some tools use a different shape)
  // is not the event-map shape we merge into — fall back to empty so we don't
  // splice numeric array indices into the output as bogus event names.
  const existingHooks = (existing.hooks && typeof existing.hooks === 'object' && !Array.isArray(existing.hooks))
    ? (existing.hooks as Record<string, unknown[]>)
    : {};
  const genHooks = generated.hooks as Record<string, unknown[]>;
  const outHooks: Record<string, unknown[]> = {};

  // Preserve the user's non-Knit entries per event, then append Knit's fresh ones.
  const events = new Set([...Object.keys(existingHooks), ...Object.keys(genHooks)]);
  for (const ev of events) {
    // Never treat a prototype-polluting key as an event name.
    if (ev === '__proto__' || ev === 'constructor' || ev === 'prototype') continue;
    const userEntries = Array.isArray(existingHooks[ev])
      ? existingHooks[ev].filter((h) => !(h && typeof h === 'object' && (h as { _knitOwned?: boolean })._knitOwned))
      : [];
    outHooks[ev] = [...userEntries, ...(genHooks[ev] ?? [])];
  }

  merged.hooks = outHooks;
  merged._knitHooks = generated._knitHooks;
  merged._knitUnverified = generated._knitUnverified;
  merged._knitNote = generated._knitNote;
  return merged;
}
