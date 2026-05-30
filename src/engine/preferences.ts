/**
 * v0.21 — per-project onboarding preferences.
 *
 * Captured once via knit_onboard (the agent runs it after a user pastes the
 * README onboarding prompt and describes their project + how they want Knit to
 * behave) and persisted to ~/.knit/projects/<hash>/preferences.json. The brain
 * surfaces the stated intent every session (handshake instructions +
 * knit_load_session) so it reflects what the user is actually building.
 *
 * Host-agnostic by construction: this is plain project state set through an MCP
 * tool, so it works for any MCP host and any session — no Claude Code specifics.
 */

import { existsSync, readFileSync } from 'node:fs';
import { writeFileAtomic } from './atomic-write.js';
import { preferencesPath } from './paths.js';

export type OrchestrationPref = 'auto' | 'suggest' | 'off';
export type TokenModePref = 'lean' | 'standard';

export interface ProjectPreferences {
  version: 1;
  /** Short description of the project (what it is). */
  projectDescription: string;
  /** What the user is building / their goal — the intent the brain echoes back. */
  intent: string;
  /** Preferred protocol strictness, or null if the user didn't set one. */
  strictness: 'off' | 'warn' | 'block' | null;
  /** Domains the user wants Knit to focus on. */
  focusDomains: string[];
  /**
   * v0.22 — how Knit should surface host-composition directives on complex tasks:
   *   'auto'    — emit the host_orchestration directive (default).
   *   'suggest' — same directive, but framed as a suggestion (reserved; currently
   *               identical to auto since MCP can only ever suggest).
   *   'off'     — never emit host_orchestration (user drives orchestration manually).
   */
  orchestration: OrchestrationPref;
  /**
   * v0.22 — token budget mode:
   *   'standard' — default surfaces.
   *   'lean'     — trim optional surfaces (fewer/headline-only learnings, drop
   *               non-essential nudges) for users on a tight context budget.
   */
  tokenMode: TokenModePref;
  /** ISO timestamp of onboarding. */
  onboardedAt: string;
}

/** Coerce an unknown value to a valid OrchestrationPref, defaulting to 'auto'. */
function coerceOrchestration(v: unknown): OrchestrationPref {
  return v === 'off' || v === 'suggest' || v === 'auto' ? v : 'auto';
}

/** Coerce an unknown value to a valid TokenModePref, defaulting to 'standard'. */
function coerceTokenMode(v: unknown): TokenModePref {
  return v === 'lean' || v === 'standard' ? v : 'standard';
}

/** Read preferences for a project; null if not onboarded or unreadable. */
export function loadPreferences(rootPath: string): ProjectPreferences | null {
  const path = preferencesPath(rootPath);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<ProjectPreferences>;
    const hasContent =
      (typeof parsed.intent === 'string' && parsed.intent.trim() !== '') ||
      (typeof parsed.projectDescription === 'string' && parsed.projectDescription.trim() !== '');
    if (!hasContent) return null; // no usable intent/description → treat as not onboarded
    return {
      version: 1,
      projectDescription: typeof parsed.projectDescription === 'string' ? parsed.projectDescription : '',
      intent: typeof parsed.intent === 'string' ? parsed.intent : '',
      strictness: parsed.strictness === 'off' || parsed.strictness === 'warn' || parsed.strictness === 'block'
        ? parsed.strictness
        : null,
      focusDomains: Array.isArray(parsed.focusDomains) ? parsed.focusDomains.filter((d): d is string => typeof d === 'string') : [],
      // v0.22 fields — absent in pre-v0.22 preferences.json → safe defaults (no migration).
      orchestration: coerceOrchestration(parsed.orchestration),
      tokenMode: coerceTokenMode(parsed.tokenMode),
      onboardedAt: typeof parsed.onboardedAt === 'string' ? parsed.onboardedAt : '',
    };
  } catch {
    return null;
  }
}

/** Persist preferences atomically (temp + rename via writeFileAtomic). */
export function savePreferences(rootPath: string, prefs: ProjectPreferences): void {
  writeFileAtomic(preferencesPath(rootPath), JSON.stringify(prefs, null, 2));
}
