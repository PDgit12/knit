/**
 * MCP server-level instructions injected into the client's system prompt at
 * handshake time. Every MCP-compatible client (Claude Code, Cursor, Codex,
 * etc.) surfaces this BEFORE any tool definitions are read — so the agent
 * knows Knit's flow before it has to choose a tool.
 *
 * Closes the gap that CLAUDE.md alone cannot: CLAUDE.md is loaded later in
 * a different context layer (harness-wrapped with "may or may not be
 * relevant" caveats) and per-tool descriptions only get read when the agent
 * is already choosing a tool — too late to know "do load_session first".
 *
 * v0.8.1 — per-project tailoring. The base instructions are universal;
 * `buildInstructions(scan)` appends a short addendum when integration-scanner
 * detected co-installed frameworks (Ruflo, gstack, CodeTour, Conductor,
 * custom CLAUDE.md sections). Knit composes with those frameworks — use
 * their routing primitives where they fit, while Knit stays the brain
 * underneath them all (memory + classification + protocol). server.ts /
 * cli.ts call buildInstructions at startup
 * and pass the result to the Server constructor's `instructions` field.
 *
 * Budget: target ≤ 750 tokens including addenda. Keep base lean; addenda
 * are typically <100 tokens each.
 */

import type { ScanResult } from '../engine/integration-scanner.js';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { VERSION } from '../version.js';
import { getCachedLatestVersion, isNewerVersion } from './update-check.js';
import { loadPreferences } from '../engine/preferences.js';
import { redactSecrets } from './sanitize.js';

export const KNIT_INSTRUCTIONS_BASE = `Knit is a memory + workflow layer for this project: per-project memory across sessions, a knowledge graph (imports/exports/tests), and a tier-routed protocol. Knit supplies inputs; you make the calls. "Required" scales with tier — on hosts with hooks a gate enforces it; everywhere else it's a strong directive you follow.

ALWAYS (every session):
1. knit_load_session FIRST — prior handoff, top learnings, false positives, and (when your host supports it) a host-composition directive all arrive here. If has_unfinished_work, resume that handoff, don't start fresh.
2. knit_classify_task BEFORE any non-trivial edit — returns tier (inquiry / trivial / standard / complex), phases, and a tool_plan.
3. Tier reflex: complex + auto_plan_mode=true → call EnterPlanMode before editing; inquiry → just answer (no plan mode, no phases); re-classify only if scope grows into writes.
4. Follow the tool_plan classify returns — call those tools in order. Don't collapse to 1–2 tools or rebuild the loop from prose.
5. knit_record_learning before "done" if something non-obvious surfaced (not a restatement of an existing learning).

CONDITIONAL (fire on the trigger):
- standard/complex → knit_verify_claim a codebase claim BEFORE LEARN (Stop-gate enforces it; it self-heals a stale index and re-verifies).
- complex → knit_get_workflow({phase}) for phase depth — ask for it, don't memorize it.
- re-touching a domain → knit_search_learnings first, to skip re-investigation. It returns HEADLINES (id + preview); call knit_get_learning({id}) for a full lesson only when you need it.
- stating a codebase fact → knit_query_imports / exports / dependents / tests, and cite the result. The index auto-refreshes when files change.
- before test / lint / review / ship → knit_suggest_command({phase}); if it matches, invoke the host's native slash command instead of describing the work.

ON-DEMAND: knit_save_handoff (context degrading), knit_search_sessions / knit_search_global_learnings, knit_index_requirements + knit_generate_test_cases (specs/RFCs), knit_get_fingerprint, knit_infer_domains + knit_compose_template, knit_get_calibration / knit_record_false_positive (tunes the self-healing classifier), knit_list_features (a tool you want isn't visible).

4-tier classifier (when in doubt, under-classify — easier to escalate than downgrade):
- Inquiry: read-only what / where / audit / explain — just answer.
- Trivial: one obvious file — EXECUTE → VERIFY → LEARN.
- Standard: bug fix or single-domain feature — RESEARCH → EXECUTE → OPTIMIZE → REVIEW → LEARN.
- Complex: cross-domain, types/auth, high-fanout, or multi-commit — full 6 phases, auto plan mode on RESEARCH.

Soft-gate: a handler returning {status:'protocol_required', next_action:'<tool>'} means call that tool then retry — not a failure (only strictness=block returns it).

Citation rule: when you assert a codebase fact ("X imports Y", "Z is defined in W"), cite the Knit tool that verified it — "(per knit_query_imports)". If you can't, mark it 'unverified'. This makes hallucinations visible at the claim level. The verifier exists; use it.`;

/** Back-compat: the static const that v0.7.0–v0.8.0 callers imported. Tests
 *  for budget cap and content invariants continue to assert against this. */
export const KNIT_INSTRUCTIONS = KNIT_INSTRUCTIONS_BASE;

/**
 * v0.12 — handshake-time budget verdict.
 *
 * Reads CLAUDE.md size from disk; returns a one-line addendum when the file
 * is over the 6.5KB budget (warn at 6.5K, over-budget at >25% over = >8.125K).
 * Returns empty string when healthy or when CLAUDE.md is missing.
 *
 * This is the structural enforcement layer: the verdict surfaces in the MCP
 * server `instructions` field — injected into the agent's system prompt at
 * handshake, BEFORE any tool description is read. The agent learns of the
 * budget problem on its first turn, not after calling a diagnostic tool.
 */
export const CLAUDE_MD_BUDGET_BYTES = 6500;

export function buildBudgetVerdict(rootPath: string): string {
  let bytes = 0;
  try { bytes = statSync(join(rootPath, 'CLAUDE.md')).size; } catch { return ''; }
  if (bytes <= CLAUDE_MD_BUDGET_BYTES) return ''; // healthy — no noise.
  const verdict = bytes > CLAUDE_MD_BUDGET_BYTES * 1.25 ? 'over-budget' : 'warn';
  const kb = Math.round(bytes / 1024 * 10) / 10;
  const targetKb = Math.round(CLAUDE_MD_BUDGET_BYTES / 1024 * 10) / 10;
  return `BUDGET ${verdict}: CLAUDE.md is ${kb}KB / ${targetKb}KB target. Run \`knit doctor\` to see the full per-surface report and \`knit refresh\` to regenerate the marker block.`;
}

/**
 * v0.15 — handshake-time update notice for agents that lack the webapp
 * dashboard surface. Until v0.15 the npm-update banner surfaced only in the
 * dashboard (and Claude Code's stderr nag); Cursor / Codex / Cline /
 * Continue / VS Code users had no in-chat signal that a new version was
 * available. Returns empty when up-to-date or when the registry check hasn't
 * landed yet (cold first session).
 */
export function buildUpdateNotice(): string {
  const latest = getCachedLatestVersion();
  if (!latest) return '';
  if (!isNewerVersion(latest, VERSION)) return '';
  return `UPDATE available: knit-mcp ${VERSION} → ${latest}. Run \`npm install -g knit-mcp@latest\` (or restart the MCP host so npx picks up the new version).`;
}

/** Build the instructions string tailored to this project's detected
 *  integrations. Returns the universal baseline if no scan ran or nothing
 *  was detected; appends short addenda for each known framework otherwise.
 *  v0.12: also appends a one-line budget verdict when CLAUDE.md is over
 *  budget — surfaces at handshake before any tool description is read.
 *  Keeps total under the ~750-token budget when healthy. */
export function buildInstructions(scan: ScanResult | null, rootPath?: string): string {
  const budgetLine = rootPath ? buildBudgetVerdict(rootPath) : '';
  const budgetSuffix = budgetLine ? `\n\n— Budget check —\n\n${budgetLine}` : '';
  const updateLine = buildUpdateNotice();
  const updateSuffix = updateLine ? `\n\n— Update available —\n\n${updateLine}` : '';
  // v0.21 — surface the user's onboarded project intent at the handshake, so
  // the brain reflects what they're building before any tool call.
  const prefs = rootPath ? loadPreferences(rootPath) : null;
  // redact at read (defense-in-depth) — same as the handoff read path — since
  // this lands in the agent's handshake context.
  const intentText = prefs ? redactSecrets(prefs.intent || prefs.projectDescription) : '';
  const intentSuffix = intentText ? `\n\n— Project intent —\n\n${intentText.slice(0, 200)}` : '';
  const trailingSuffix = budgetSuffix + updateSuffix + intentSuffix;
  if (!scan) return KNIT_INSTRUCTIONS_BASE + trailingSuffix;
  const addenda: string[] = [];

  if (scan.detected.ruflo.present) {
    addenda.push(
      'DETECTED: Ruflo (multi-agent orchestration) is installed alongside Knit. Compose them — Ruflo can drive multi-agent swarms / federation; Knit is the project brain every agent (Ruflo\'s included) reads from: memory, tier-routed classification, token discipline, hallucination defense. Route swarms via Ruflo; ground each agent in Knit. Just don\'t re-run Knit\'s tier protocol inside an individual Ruflo swarm step.',
    );
  }

  if (scan.detected.gstack.present) {
    addenda.push(
      'DETECTED: gstack slash commands are installed. Invoke the gstack command for its flows (`/plan`, `/ship`, `/qa`, `/cso`, `/investigate`) — and have it draw on Knit, the project brain (memory + classification), via Knit tools. Compose, don\'t compete: gstack runs the flow, Knit grounds it.',
    );
  }

  if (scan.detected.codetour.present) {
    addenda.push(
      'DETECTED: CodeTour is configured (.tours/*.tour). When asked to walk through code or explain architecture, surface relevant tours via the CodeTour extension rather than reconstructing the explanation from scratch.',
    );
  }

  if (scan.detected.conductor.present) {
    addenda.push(
      'DETECTED: Conductor is installed. For cross-workspace handoff and context-restore flows, defer to Conductor\'s primitives; Knit\'s `knit_save_handoff` / `knit_load_session` continue to handle the per-project memory layer.',
    );
  }

  if (scan.detected.custom_workflow_sections.length > 0) {
    addenda.push(
      `DETECTED: this project's CLAUDE.md has user-curated workflow sections (${scan.detected.custom_workflow_sections.join('; ')}). Treat that as the canonical workflow doc for project-specific phases; Knit's brain (memory + tier classification) backs those phases.`,
    );
  }

  if (addenda.length === 0) return KNIT_INSTRUCTIONS_BASE + trailingSuffix;

  return (
    KNIT_INSTRUCTIONS_BASE +
    '\n\n— Per-project integrations —\n\n' +
    addenda.join('\n\n') +
    '\n\nGeneral rule: when an integration above provides a higher-level routing primitive (slash command, swarm orchestrator, methodology framework), use it — and keep grounding every agent in Knit, the brain underneath them all: memory, classification, and the workflow protocol for anything the integration doesn\'t route.' +
    trailingSuffix
  );
}
