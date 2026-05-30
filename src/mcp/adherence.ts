/**
 * v0.18 — protocol adherence re-surfacing.
 *
 * The gap (found in the v0.17 audit): Knit's protocol is injected ONCE at the
 * MCP handshake (the `instructions` field) and never again. Agents follow it at
 * session start, then drift mid-session — they record work without classifying,
 * or run dozens of calls having never loaded the session. There was no
 * mechanism to remind them, and strictness had three fixed levels with no
 * escalation.
 *
 * This module closes that without bleeding tokens. It is:
 *   - cross-platform: the reminder rides the MCP tool RESPONSE (a `_knit_protocol`
 *     field), so it reaches every MCP host — not just Claude Code's hooks.
 *   - drift-triggered: a memory-WRITE tool called before knit_classify_task this
 *     session is the signal that the protocol is being skipped.
 *   - throttled: at most one nudge per NUDGE_THROTTLE calls, so a chatty session
 *     never pays the reminder cost on every call.
 *   - escalating: repeated drift sharpens the message (B2) and resets the moment
 *     the agent classifies — no new permanent strictness level.
 *
 * State is module-level, which is exactly right: the MCP server is one process
 * per session, so this state is naturally session-scoped and resets next
 * session. `off` strictness silences it entirely.
 */

import { readProtocolConfig } from '../engine/protocol-guard.js';

interface AdherenceState {
  calls: number;
  classified: boolean;
  loaded: boolean;
  lastNudgeCall: number;
  consecutiveDrift: number;
  /** v0.22 — distinct Knit tools used this session (full-tool-use signal). */
  distinctTools: Set<string>;
  /** v0.22 — the under-utilization nudge fires at most once per session. */
  underUtilNudged: boolean;
}

const state: AdherenceState = {
  calls: 0,
  classified: false,
  loaded: false,
  lastNudgeCall: -Infinity,
  consecutiveDrift: 0,
  distinctTools: new Set<string>(),
  underUtilNudged: false,
};

/** Min calls before the under-utilization pattern is judged established. */
const UNDERUTIL_MIN_CALLS = 8;

/** Graph/verify tools — using ANY of these means the agent isn't collapsed. */
function isInsightTool(name: string): boolean {
  return name.startsWith('knit_query_') || name === 'knit_verify_claim' || name === 'knit_build_context';
}

/** Protocol tools every session uses — excluded from the diversity count so
 *  "classify + record" still reads as collapsed (the missing middle is the point). */
const PROTOCOL_TOOLS = new Set(['knit_classify_task', 'knit_load_session']);

function underUtilMessage(calls: number): string {
  return `Knit full-tool-use (call ${calls}): you've leaned on ≤2 tools and none of the graph/verify tools this session. The brain is more than record_learning — try knit_query_imports (ripple), knit_query_tests (coverage), or knit_verify_claim (fact-check a codebase claim) for this task.`;
}

/** Memory-write tools — calling one without classifying first is the drift signal. */
const WRITE_TOOLS = new Set<string>([
  'knit_record_learning',
  'knit_record_global_learning',
  'knit_save_handoff',
  'knit_record_false_positive',
  'knit_save_session_summary',
]);

/** Min tool calls between any two nudges — the token-cost ceiling. */
const NUDGE_THROTTLE = 12;
/** Re-surface the core loop once every this many calls in a long session. */
const PERIODIC_EVERY = 30;

/** Reset per-process state. Exposed for tests + for an explicit new-session
 *  signal (knit_load_session) so a resumed process re-arms cleanly. */
export function resetAdherenceState(): void {
  state.calls = 0;
  state.classified = false;
  state.loaded = false;
  state.lastNudgeCall = -Infinity;
  state.consecutiveDrift = 0;
  state.distinctTools = new Set<string>();
  state.underUtilNudged = false;
}

function driftMessage(streak: number): string {
  if (streak >= 2) {
    return `Knit protocol drift (×${streak}): knit_classify_task still hasn't run this session — tiering, plan-mode, and the verify/LEARN gates are being skipped. Classify the current task before continuing.`;
  }
  return `Knit protocol: you're recording work without calling knit_classify_task this session. Classify first so the task is tiered and the right phases (plan-mode / verify / quality-gated LEARN) run.`;
}

function periodicMessage(loaded: boolean, calls: number): string {
  const base = `Knit check-in (call ${calls}): the core loop is classify → search → execute → verify → record. Fetch phase depth with knit_get_workflow({phase}).`;
  return loaded
    ? base
    : `${base} You also haven't called knit_load_session this session — prior handoff + learnings may be going unused.`;
}

/**
 * Observe one tool call and return a one-line protocol reminder when the agent
 * has drifted, or null. MUST be called for EVERY tool call (it maintains the
 * session counters), but returns a nudge only rarely (drift or periodic, both
 * throttled). Never throws.
 */
export function observeAndNudge(toolName: string, rootPath: string): string | null {
  state.calls += 1;
  state.distinctTools.add(toolName);

  if (toolName === 'knit_classify_task') {
    state.classified = true;
    state.consecutiveDrift = 0;
  } else if (toolName === 'knit_load_session') {
    state.loaded = true;
  }

  let level: string;
  try {
    level = readProtocolConfig(rootPath).level;
  } catch {
    level = 'warn';
  }
  if (level === 'off') return null;

  const sinceLast = state.calls - state.lastNudgeCall;

  // Drift: recording work without having classified the task this session.
  if (WRITE_TOOLS.has(toolName) && !state.classified) {
    state.consecutiveDrift += 1;
    if (sinceLast < NUDGE_THROTTLE) return null; // throttle — keep counting, stay quiet
    state.lastNudgeCall = state.calls;
    return driftMessage(state.consecutiveDrift);
  }

  // Under-utilization (v0.22): the agent is active but collapsed onto ≤2 tools
  // and has never used a graph/verify tool — the exact "full tool surface goes
  // unused" failure. One targeted nudge per session, throttled.
  const workToolCount = [...state.distinctTools].filter((t) => !PROTOCOL_TOOLS.has(t)).length;
  if (!state.underUtilNudged
      && state.classified
      && state.calls >= UNDERUTIL_MIN_CALLS
      && workToolCount <= 2
      && ![...state.distinctTools].some(isInsightTool)
      && sinceLast >= NUDGE_THROTTLE) {
    state.underUtilNudged = true;
    state.lastNudgeCall = state.calls;
    return underUtilMessage(state.calls);
  }

  // Periodic re-surface in long sessions (only when not already nudging).
  if (state.calls % PERIODIC_EVERY === 0 && sinceLast >= NUDGE_THROTTLE) {
    state.lastNudgeCall = state.calls;
    return periodicMessage(state.loaded, state.calls);
  }

  return null;
}
