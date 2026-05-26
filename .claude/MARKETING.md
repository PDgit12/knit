# Knit — release narrative + extended protocol reference

This file is the sidecar to CLAUDE.md. It carries content that doesn't need to load into every agent context: the release timeline, deferred work, full orchestration protocol detail, and slash-command routing.

Project facts (build commands, domain architecture, cross-domain rules, git conventions) live in `CLAUDE.md`. The tier classifier, workflow phases, and tool reach-for guide are injected via the MCP `instructions` field at handshake. Phase depth is fetched on demand via `knit_get_workflow({phase})`. This file is the historical + narrative layer.

## Orchestration Protocol — v1.0 (2026-05-15)

### Pre-flight (runs BEFORE every task)

1. **Load institutional knowledge** — `knit_load_session` returns prior handoff, top learnings, false positives, update flag, budget_health + learnings_health nudges.
2. **Classify** — `knit_classify_task` BEFORE any Edit/Write. Returns tier (inquiry / trivial / standard / complex), phases, auto_plan_mode flag.
3. **Plan mode** — if tier=complex with auto_plan_mode=true, call EnterPlanMode immediately. Do NOT start editing.

### Task Classification (4-tier)

- **Inquiry** — read-only "what / where / audit / explain". Just answer. No phases.
- **Trivial** — single-file obvious change. EXECUTE → VERIFY → LEARN.
- **Standard** — bug fix or single-domain feature. RESEARCH → EXECUTE → OPTIMIZE → REVIEW → LEARN.
- **Complex** — cross-domain, types/auth-touching, high-fanout, or any task spanning more than one commit. Full 6 phases with auto plan mode.

**Auto-detection rules:**
- Touches `src/engine/types.ts` → Complex (universal contract).
- Touches `src/mcp/handlers.ts` or `src/mcp/cache.ts` → Complex (high-fanout, 9 dependents each).
- New file created → at minimum Standard.
- Touches 3+ files → Complex.
- User says "plan" or shift+tab → Force Complex.

### The 6-Phase Protocol

```
RESEARCH → IDEATE → PLAN → EXECUTE → OPTIMIZE → REVIEW → LEARN
```

Routed by tier:
```
TRIVIAL:    EXECUTE → VERIFY → LEARN
STANDARD:   RESEARCH → EXECUTE → OPTIMIZE → REVIEW → LEARN
COMPLEX:    RESEARCH → IDEATE → PLAN → EXECUTE → OPTIMIZE → REVIEW → LEARN
```

Fetch depth on demand: `knit_get_workflow({phase: "OPTIMIZE"})`.

### Domain Context Object

Built during RESEARCH, passed to EVERY agent prompt:

```
DOMAIN CONTEXT:
  Affected domains: [list]
  Files to touch: [list]
  Cross-domain ripple: [which domains get notified]
  Known pitfalls: [from learnings grep]
  False positives to suppress: [from #false-positive entries]
  Scout findings: [from RESEARCH]
  Selected approach: [from IDEATE, if run]
  Approved plan: [from PLAN, if run]
```

### Phase 5 — OPTIMIZE (review agents per domain)

| Domain Head | Review Agents |
|-------------|--------------|
| CLI | `code-reviewer`, `typescript-reviewer` |
| Engine | `type-design-analyzer`, `code-reviewer`, `code-architect`, `silent-failure-hunter` |
| Generators | `code-reviewer`, `typescript-reviewer` |
| MCP | `code-architect`, `code-reviewer`, `silent-failure-hunter` |
| QA | `tdd-guide`, `pr-test-analyzer`, `build-error-resolver` |

Gate: zero CRITICAL findings; all HIGH acknowledged.

### LEARN (after every task — never skip)

If about to say "done" / "complete" / "finished" — STOP. Did LEARN run? If not, run `knit_record_learning` now.

Checklist:
1. Append entry with domain tags.
2. If false positive → add `#false-positive` tag via `knit_record_false_positive`.
3. If file created/deleted → update CLAUDE.md Domain Architecture file lists.

## Token Discipline

| Tier | Agent calls | Cost |
|------|------------|------|
| Trivial | 0 | ~5-8k tokens |
| Standard | 1-3 | ~20-30k tokens |
| Complex | 5-15 parallel | ~50-80k tokens |

**Savings mechanisms:**
- Learnings file prevents re-investigation (~10-20k saved per known issue)
- False positive suppression (~5k saved per FP)
- Domain Context Object gives targeted scope (~10-30k saved per agent)
- Parallel execution (5 agents = 1 round trip)
- Tier-appropriate scaling (no agents for trivial tasks)
- v0.12 handshake-time budget verdict (instructions field) — enforces, not just measures

## Slash Command Routing

| User says | Skill |
|-----------|-------|
| "plan", "how should we" | `/plan` |
| "ship", "create PR" | `/ship` |
| "review" | `/review` |
| "QA", "test" | `/qa` |
| "debug", "investigate" | `/investigate` |
| "build failed" | `/build-fix` |
| "security audit" | `/cso` |
| "save progress" | `/context-save` |
| "resume" | `/context-restore` |

## Session Handoff Protocol

When context degrades:
1. Write `handoff.md` via `knit_save_handoff` — goal, current state, files in flight, what changed, **failed_attempts** (mandatory), decisions made, ONE next step.
2. User runs `/clear`.
3. Fresh session reads `handoff.md` first (Knit's MCP enforces this via SessionStart hook).
4. Archive prior handoff to `.claude/handoffs/`.

## Toolchain

Built with TypeScript, compiled via tsup, tested with Vitest, benched via tsx. The Knit Orchestration Protocol is the core IP — all generated workflow files are original compositions.

## Phase Status

All releases below are live on npm as `knit-mcp`. `latest` → v0.11.4 (as of 2026-05-25).

- **Phase 0** (project setup + workflow): ✅ Complete
- **v0.1.x** — shipped. 23 MCP tools, 111 tests. Original baseline.
- **v0.3.0** — shipped. Centralized data at `~/.knit/projects/<hash>/`, marker-wrapped CLAUDE.md, on-demand workflow via `knit_get_workflow`, session memory in `sessions.jsonl`, team-scoped git worktrees, token-accounting metrics. Cross-project learnings pool at `~/.knit/global/learnings.jsonl`. 31 MCP tools, 197 tests.
- **v0.3.1** — git-tagged, NOT published to npm. Windows-compatible hooks (all 7 hooks rewritten as inline `node -e '…'` cross-platform). Folded into v0.4.0's npm release.
- **v0.4.0** — shipped. VoltAgent subagent integration (`github.com/VoltAgent/awesome-claude-code-subagents`, MIT, pinned SHA `6f804f0c…`) with Knit personalization layer. Bundled-core 6 agents; specialized agents fetched on demand to `~/.knit/agents/cache/<sha>/`. `engram install-agents` CLI + `knit_install_agent` MCP tool. 32 MCP tools, 247 tests.
- **v0.4.1** — shipped. Built across 4 parallel team worktrees via Claude Code's Agent `isolation:"worktree"` — Knit eating its own dogfood. JSONL session pruning + `knit_prune_sessions`. Reflect falls back to global pool when local entries < 3. Hybrid hook merging. `engram export obsidian` CLI. 33 MCP tools, 272 tests.
- **v0.4.2** — shipped. Metadata-only patch. Dropped stale "20 tools" copy from package.json; fixed broken npm version badge in README. 33 MCP tools, 272 tests.
- **v0.5.0** — shipped. Headline: **Protocol Guard** — runtime enforcement via hooks. New SessionStart hook, UserPromptSubmit hook, PreToolUse `Edit|Write|MultiEdit` gate (strictness: off/warn/block). New tools `knit_set_protocol_strictness` + `knit_get_protocol_strictness`. 35 MCP tools, 293 tests.
- **v0.5.1** — shipped. Upgrade-path fix for v0.5.0. `HOOKS_VERSION` constant; `cache.ts` reads stored `_engramHooks.version`; if stale, runs `writeKnitHooks` once per process. Hybrid merge preserves user permissions. Existing v0.4.x users auto-receive Protocol Guard on next MCP call. 35 MCP tools, 295 tests.
- **v0.6.x** — engram → Knit rename. Brand sweep + npm move. Back-compat regex preserved on disk.
- **v0.7.x** — Universal protocol injection via MCP `instructions` field. Tier-gated tool surface. `knit_list_features`. Inquiry classification tier. CLAUDE.md cut 88% (16KB → 2KB). Lazy response modes. Token-budget guardrail. Legacy migration.
- **v0.8.x** — Vectorless RAG (BM25 + RRF). Graph-traversal retriever. Per-project instruction tailoring. `knit_compounding_metrics`. Integration scanner.
- **v0.9.0** — Hook-level enforcement. Citation rule. `knit_verify_claim`. Auto-search in classify. `suggested_reads`. `knit_get_learning`. `knit_consolidate_learnings`.
- **v0.10.0** — Token-economics release. Risk × scope × change_kind classifier split. `context_budget_remaining` graceful degradation. Per-project diversity cap on cross-project search. 11 new compounding-metrics fields + weekly snapshot persistence + `knit_get_metrics_history`.
- **v0.11.0** — Verify Layer + auto-config foundation. Mandatory `knit_verify_claim` REVIEW gate. Post-edit diff verify + universal `tsc` check. Drift detector. Self-healing classifier (per-project calibration). `knit_index_requirements` + `knit_generate_test_cases` (BM25 over long specs). `knit_get_fingerprint` + `knit_infer_domains` + `knit_compose_template` (zero-config CLAUDE.md). 52 tools, 625 tests.
- **v0.11.1** — Audit-driven hardening. 3 CRITICAL (source_id path traversal, post-edit tsc shell injection, live calibration bug) + 10 HIGH fixes from a 5-agent audit, implemented in 3 parallel `knit_spawn_team_worktree` teams. HOOKS_VERSION 11 (auto-upgrades existing users). New `knit_delete_requirements`. 53 tools, 636 tests.
- **v0.11.2** — Pre-publish polish. Chunk cap (2000) + `errorResponse` envelope across handlers + CLAUDE.md generator surfaces v0.11 tools · new `engram doctor` install health-check CLI · upgrade-path smoke test caught + fixed a data-loss bug in cache.ts (Case B was wiping user permissions on upgrade) · 11 real exploit-payload integration tests prove C1/C2/H1 fixes hold · `npm run bench` ships a synthetic retrieval harness (50 Q&A) measuring 86% top-1 / 96% R@5. 53 tools, 664 tests.
- **v0.11.3** — Propagation patch. `update_available` flag now surfaces in `knit_load_session` response (≈100% session reach vs. brain_status' low reach) + startup stderr nag on stale versions. 53 tools, 665 tests.
- **v0.11.4** — Dogfood audit. Full audit of Knit's own codebase using its own `knit_spawn_team_worktree` primitive (4 parallel teams). HIGH `engram refresh` no longer clobbers user-curated CLAUDE.md; `saveSource`/`loadSource` validate `sourceId`; `appendGlobalLearning` propagates write failures; `redactSecrets` applied to `label`/`tags`/`domains` across all persistence boundaries; 100KB response ceiling on `knit_generate_test_cases`; full v0.11 tool surface documented in `workflow-protocol.ts` generator. 16 key tools reclassified with `[PROTOCOL]`/`[REVIEW]`/`[MEMORY]`/`[GRAPH]` prefixes. 53 tools, 687 tests.
- **v0.12** — **Picture Perfect**: Structural Enforcement (in flight). Handshake-time budget verdict in MCP `instructions` field (active layer, not diagnostic). `knit_load_session` surfaces `budget_health` + `learnings_health` nudges. `engram doctor` exits non-zero on over-budget. `engram setup` runs doctor as final step. CLAUDE.md PostToolUse hook warns on over-budget edits. This repo dogfoods: 16 KB CLAUDE.md migrated to lean ~4 KB + this MARKETING.md sidecar. New `npm run bench:tokens` measures real MCP-on vs MCP-off per-session cost. 53 tools, 699+ tests.

## v0.13+ candidates (deferred, ranked by value × cost)

1. **Hybrid search fusion** — add embeddings as third signal alongside BM25 + graph (already wired in v0.8); fuse via RRF. ~95% R@5 target (vs current 86%/96%). Local embeddings via `@xenova/transformers` avoid the network.
2. **4-tier memory consolidation** — promote learnings through working → episodic → semantic → procedural tiers with Ebbinghaus decay. Lets old noise self-evict; surfaces stable patterns.
3. **Privacy filter on ingest path** — bake secret scanning (`sk-…`, `AKIA…`, `ghp_…`) into ingest, not just persistence. Defense in depth.
4. **More auto-capture hooks** — agentmemory has 12 lifecycle hooks; Knit has 5. Reduces LEARN-discipline burden.
5. **Knowledge graph + entity extraction** — extract entities/relationships during consolidation; use graph traversal as a reranking signal. Useful AFTER (1) and (2) land.
6. **/plugin install path** — Claude Code now supports `claude /plugin install`. Ship Knit as a plugin alongside the npx path.
7. **REST/HTTP API** — for non-MCP clients.
8. **Live observability viewer** — real-time session + token cost dashboard.
