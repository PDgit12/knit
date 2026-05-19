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
 * Budget: target ≤ 500 tokens. Keep this lean. Phase depth, tool details,
 * and project specifics belong in knit_get_workflow / CLAUDE.md, not here.
 */

export const KNIT_INSTRUCTIONS = `Knit is a memory + workflow layer for this project. It provides per-project memory across sessions, a knowledge graph (imports/exports/tests), and a tier-routed workflow protocol.

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

The protocol enforces a 4-tier classifier:
- Inquiry: read-only "what / where / audit / explain" — just answer.
- Trivial: single-file obvious change — EXECUTE → VERIFY → LEARN.
- Standard: bug fix or single-domain feature — RESEARCH → EXECUTE → OPTIMIZE → REVIEW → LEARN.
- Complex: cross-domain, types/auth-touching, high-fanout, or any task spanning more than one commit — full 6 phases with auto plan mode on RESEARCH.

Knit provides inputs; you make the calls. When in doubt, under-classify — easier to escalate mid-task than to downgrade.`;
