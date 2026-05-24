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
 * custom CLAUDE.md sections). Knit defers routing decisions to those
 * frameworks where they overlap — memory + classification stay Knit's
 * domain regardless. server.ts / cli.ts call buildInstructions at startup
 * and pass the result to the Server constructor's `instructions` field.
 *
 * Budget: target ≤ 750 tokens including addenda. Keep base lean; addenda
 * are typically <100 tokens each.
 */

import type { ScanResult } from '../engine/integration-scanner.js';

export const KNIT_INSTRUCTIONS_BASE = `Knit is a memory + workflow layer for this project. It provides per-project memory across sessions, a knowledge graph (imports/exports/tests), and a tier-routed workflow protocol.

ALWAYS at session start:
1. Call knit_load_session — returns prior handoff, top learnings, false positives. If has_unfinished_work is true, resume that handoff instead of starting fresh.
2. For any non-trivial task, call knit_classify_task BEFORE editing or writing — returns tier (inquiry / trivial / standard / complex) and phases.
3. If tier=complex with auto_plan_mode=true, call EnterPlanMode immediately. Do not start editing.
4. If tier=inquiry, just answer — no plan mode, no phases. Re-classify only if scope grows into writes.
5. Before reporting a task done, call knit_record_learning if anything non-obvious surfaced (not a substring restatement of prior learnings).

When to reach for other Knit tools:
- knit_query_imports / knit_query_exports / knit_query_dependents / knit_query_tests — use instead of grep when the knowledge index is fresh.
- knit_search_learnings — call before re-investigating a domain. The point of memory is to skip what you've already learned.
- knit_search_sessions — answers "have I done this before?"
- knit_search_global_learnings — same, but across all your projects (Knit's cross-project pool).
- knit_get_workflow({phase}) — fetch protocol depth for one phase on demand. Do not try to remember the workflow; ask for it.
- knit_list_features — if you want to do X but the tool isn't visible, this surfaces what's hidden and how to enable it.
- knit_save_handoff — call when context degrades or session ends so the next session resumes cleanly.
- knit_verify_claim — fact-check one claim against the graph BEFORE LEARN on standard/complex scope (Stop-hook gate enforces this).
- knit_index_requirements / knit_generate_test_cases — for long-form spec / RFC / Jira-export ingestion. Indexes once, retrieves only relevant chunks per feature query.
- knit_get_fingerprint — detected stack (lang/framework/test/lint/build/CI) for choosing the right tooling per project.
- knit_infer_domains + knit_compose_template — propose CLAUDE.md auto-config sections from git co-change + import-graph + colocation signals.
- knit_get_calibration / knit_record_false_positive (with a direction tag like #complex-was-trivial) — feed the self-healing classifier so it tunes per-project over time.

The protocol enforces a 4-tier classifier:
- Inquiry: read-only "what / where / audit / explain" — just answer.
- Trivial: single-file obvious change — EXECUTE → VERIFY → LEARN.
- Standard: bug fix or single-domain feature — RESEARCH → EXECUTE → OPTIMIZE → REVIEW → LEARN.
- Complex: cross-domain, types/auth-touching, high-fanout, or any task spanning more than one commit — full 6 phases with auto plan mode on RESEARCH.

Knit provides inputs; you make the calls. When in doubt, under-classify — easier to escalate mid-task than to downgrade.

Citation rule: when you state a fact about this codebase ("file X imports Y", "function Z is defined in W", "tests for A live in B"), cite the Knit tool result that verified it — e.g. "(per knit_query_imports)". If you can't cite a tool result, mark the claim as 'unverified' explicitly. This makes hallucinations visible at the claim level instead of letting them ship as confident-sounding prose. The verifier exists; use it.`;

/** Back-compat: the static const that v0.7.0–v0.8.0 callers imported. Tests
 *  for budget cap and content invariants continue to assert against this. */
export const KNIT_INSTRUCTIONS = KNIT_INSTRUCTIONS_BASE;

/** Build the instructions string tailored to this project's detected
 *  integrations. Returns the universal baseline if no scan ran or nothing
 *  was detected; appends short addenda for each known framework otherwise.
 *  Keeps total under the ~750-token budget. */
export function buildInstructions(scan: ScanResult | null): string {
  if (!scan) return KNIT_INSTRUCTIONS_BASE;
  const addenda: string[] = [];

  if (scan.detected.ruflo.present) {
    addenda.push(
      'DETECTED: Ruflo (multi-agent orchestration) is installed alongside Knit on this project. For multi-agent swarms, federation, or large-scale orchestration, defer to Ruflo\'s tools (`memory_store`, `swarm_init`, `agent_spawn`, etc). Knit\'s domain in this project: per-project memory + tier-routed classification + token discipline. Do NOT duplicate Ruflo\'s routing logic with Knit\'s tier protocol when Ruflo is driving the workflow.',
    );
  }

  if (scan.detected.gstack.present) {
    addenda.push(
      'DETECTED: gstack slash commands are installed. For routing decisions (`/plan`, `/ship`, `/qa`, `/cso`, `/investigate`), prefer the gstack command. Knit operates underneath as the memory + classification layer; the gstack command can invoke Knit tools internally.',
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
      `DETECTED: this project's CLAUDE.md has user-curated workflow sections (${scan.detected.custom_workflow_sections.join('; ')}). Treat that as the canonical workflow doc for project-specific phases; Knit's tier protocol applies underneath as the routing layer.`,
    );
  }

  if (addenda.length === 0) return KNIT_INSTRUCTIONS_BASE;

  return (
    KNIT_INSTRUCTIONS_BASE +
    '\n\n— Per-project integrations —\n\n' +
    addenda.join('\n\n') +
    '\n\nGeneral rule: when an integration above provides a higher-level routing primitive (slash command, swarm orchestrator, methodology framework), use it. Knit handles the substrate it doesn\'t cover: memory, classification, and the workflow protocol for tasks the integration doesn\'t route.'
  );
}
