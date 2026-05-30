/**
 * v0.22 — host composition: who is on the other end of the MCP?
 *
 * Knit's positioning is "the brain every MCP agent plugs into." To *compose*
 * with each host's native orchestration (Claude Code dynamic workflows, Cursor
 * parallel agents, Codex subagents, Copilot/VS Code MCP prompts) Knit must first
 * know which host it's talking to. The only runtime signal for that is the
 * `clientInfo` the host sends at the MCP `initialize` handshake — captured in
 * src/cli.ts (the live MCP path) via `server.oninitialized` + `getClientVersion()`.
 *
 * THREE HARD TRUTHS this module is built around:
 *   1. MCP can't push host UI. A `tier:'hook'` profile means deterministic hooks
 *      EXIST on that host (auto-trigger is real); it does NOT mean Knit toggles a
 *      mode. `tier:'suggest'` = runtime suggest-only, never faked.
 *   2. clientInfo.name can't disambiguate VS Code: Copilot, Cline and Continue
 *      all report `Visual Studio Code`. So VS Code defaults to `suggest` for
 *      runtime nudge framing. (What hooks get WRITTEN is a SEPARATE, filesystem
 *      decision in agent-detector.ts — the two never cross.)
 *   3. Only CONFIRMED clientInfo strings are matched. Everything else →
 *      `unknown` → suggest-only. We never hardcode an unverified string on faith.
 *
 * State is module-level by design: one MCP process per session, so the active
 * host is naturally session-scoped and resets next session (mirrors adherence.ts).
 */

export type HostId = 'claude-code' | 'cursor' | 'codex' | 'vscode' | 'unknown';

/**
 * 'hook'    — deterministic hooks exist on this host → auto-trigger is real.
 * 'suggest' — no reliable runtime hook signal → suggest-only (reminders ride the
 *             MCP response). Never claim auto-trigger here.
 */
export type HostTier = 'hook' | 'suggest';

export interface HostProfile {
  /** Stable host identifier derived from clientInfo.name. */
  id: HostId;
  /** Runtime adherence framing: deterministic-hook host vs suggest-only. */
  tier: HostTier;
  /** The host's native fan-out primitive Knit composes with, or null. */
  autoMechanism: string | null;
  /** MCP `prompts` → `/mcp.knit.*` slash commands available (confirmed: VS Code). */
  slashSurface: boolean;
}

/** clientInfo as sent at the MCP initialize handshake (SDK `Implementation`). */
export interface ClientInfo {
  name?: string;
  version?: string;
}

/** The fallback profile — unknown host, suggest-only, no native primitive. */
export const UNKNOWN_HOST: HostProfile = {
  id: 'unknown',
  tier: 'suggest',
  autoMechanism: null,
  slashSurface: false,
};

/**
 * Map a handshake clientInfo to a HostProfile. CONFIRMED strings only
 * (claude-code, cursor, codex-mcp-client/codex_vscode, Visual Studio Code);
 * anything else falls back to suggest-only. Case-insensitive substring match so
 * minor host-version suffixes (e.g. `cursor-vscode (via …)`) still resolve.
 */
export function classifyHost(clientInfo: ClientInfo | undefined | null): HostProfile {
  const raw = (clientInfo?.name ?? '').trim();
  if (!raw) return UNKNOWN_HOST;
  const name = raw.toLowerCase();

  // Claude Code — dynamic workflows (parallel subagents) + hooks.
  if (name.includes('claude-code') || name.includes('claude code')) {
    return { id: 'claude-code', tier: 'hook', autoMechanism: 'dynamic-workflows', slashSurface: false };
  }

  // Codex CLI — subagents + 10-event hooks. Check BEFORE the bare vscode match
  // because `codex_vscode` contains "vscode".
  if (name.includes('codex')) {
    return { id: 'codex', tier: 'hook', autoMechanism: 'codex-subagents', slashSurface: false };
  }

  // Cursor — parallel worktree agents + Cursor Hooks.
  if (name.includes('cursor')) {
    return { id: 'cursor', tier: 'hook', autoMechanism: 'cursor-parallel-agents', slashSurface: false };
  }

  // VS Code — ambiguous: Copilot / Cline / Continue all report this exact name.
  // Can't tell them apart → suggest-only for runtime framing. MCP prompts ARE
  // confirmed here, so the slash surface is available regardless of which one.
  if (name === 'visual studio code' || name.includes('vscode')) {
    return { id: 'vscode', tier: 'suggest', autoMechanism: null, slashSurface: true };
  }

  return UNKNOWN_HOST;
}

// ── Host-tailored composition ──────────────────────────────────────────────

/**
 * The directive classify attaches (on complex + cross-cutting tasks only) telling
 * the agent to compose with THIS host's native orchestration, carrying Knit's
 * context (the affected domains). Hook hosts get their real fan-out primitive;
 * suggest-only hosts (VS Code / unknown) get Knit's own knit_spawn_team_worktree
 * — never a faked auto-trigger claim.
 */
export function hostOrchestrationDirective(profile: HostProfile, domains: string[]): string {
  const list = domains.length > 0 ? ` (one per affected domain: ${domains.join(', ')})` : '';
  const ground = ' Ground each agent in Knit via knit_build_context; record the outcome with knit_record_learning.';
  switch (profile.id) {
    case 'claude-code':
      return `Complex + cross-cutting — run this as a DYNAMIC WORKFLOW: fan out parallel subagents${list}.${ground}`;
    case 'cursor':
      return `Complex + cross-cutting — fan out to parallel worktree agents${list}, or use knit_spawn_team_worktree.${ground}`;
    case 'codex':
      return `Complex + cross-cutting — delegate to subagents${list}.${ground}`;
    case 'vscode':
      return `Complex + cross-cutting — use agent mode; Knit's context + onboarding are available as /mcp.knit.* slash commands. Parallelize domains with knit_spawn_team_worktree${list}.${ground}`;
    default:
      return `Complex + cross-cutting — parallelize with knit_spawn_team_worktree${list} (this host has no deterministic hooks; Knit suggests, never forces).${ground}`;
  }
}

/** The host contract surfaced in the first knit_load_session response — what
 *  this host can/can't do, so the agent composes correctly all session. */
export function hostContract(profile: HostProfile): {
  id: HostId;
  mode: string;
  native_orchestration: string | null;
  slash_commands: boolean;
  compose: string;
} {
  return {
    id: profile.id,
    mode: profile.tier === 'hook' ? 'auto: deterministic hooks available' : 'suggest-only: no host hooks — Knit directs, never forces',
    native_orchestration: profile.autoMechanism,
    slash_commands: profile.slashSurface,
    compose: profile.autoMechanism
      ? `For complex/cross-domain tasks, classify will direct you to compose with this host's ${profile.autoMechanism}.`
      : 'For complex/cross-domain tasks, parallelize via knit_spawn_team_worktree.',
  };
}

// ── Active-host singleton (per-process / per-session) ──────────────────────

let activeHost: HostProfile = UNKNOWN_HOST;

/** Stash the host detected at the initialize handshake. */
export function setActiveHost(profile: HostProfile): void {
  activeHost = profile;
}

/** The host detected this session, or UNKNOWN_HOST before the handshake lands. */
export function getActiveHost(): HostProfile {
  return activeHost;
}

/** Reset to the fallback — exposed for tests + a clean new-session signal. */
export function resetActiveHost(): void {
  activeHost = UNKNOWN_HOST;
}
