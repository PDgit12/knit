# Knit Roadmap — v0.10 → v0.12

> The strategic ship list. Authored 2026-05-21 after v0.9.1 production-hardening shipped.
> Three releases. Each shippable on its own. Each compounds the last.
>
> **Positioning hook:** *"The only agent memory system that **proves** it makes Claude cheaper."*

---

## Status Discovery (2026-05-21)

What turned out to already exist when planning v0.10:

| Feature | Status | File |
|---|---|---|
| BM25 retrieval | ✅ Built | `src/engine/retrieval/bm25.ts` (201 LOC) |
| RRF fusion | ✅ Built | `src/engine/retrieval/rrf.ts` (87 LOC) |
| Graph-traversal expansion | ✅ Built | `src/engine/retrieval/graph-traversal.ts` (99 LOC) |
| `knit_verify_claim` tool | ✅ Shipped v0.9.0 | `handlers.ts:714` |
| MCP server `instructions` field | ✅ Shipped v0.7 | `mcp/instructions.ts` |
| Protocol Guard (off/warn/block) | ✅ Shipped v0.5.0 | `engine/protocol-guard.ts` |
| Marker-wrapped CLAUDE.md | ✅ Shipped v0.3.0 | `generators/claude-md.ts` |
| `knit_compounding_metrics` | ✅ Shipped (basic) | `handlers.ts` |

**Implication:** v0.10 is mostly *audit, wire, and extend* — not greenfield build.

---

## v0.10 — Token Economics Foundation (~2 weeks)

> Make the "cheapness" claim measurable from day 1.

### Slice 1 — Classifier signal upgrade ✅ shipped 2026-05-21
- [x] Add `riskTier: 'low' | 'medium' | 'high'` to `TaskClassification`
- [x] Add `scopeTier: 'trivial' | 'standard' | 'complex'` (`tier` retained for back-compat)
- [x] Add `changeKind: 'additive' | 'modify' | 'delete' | 'mixed'` — infer via `existsSync` per file, delete-intent overrides
- [x] Add `context_budget_remaining` (0–100) input to `knit_classify_task`
- [x] If `context_budget_remaining < 30` → force scope downgrade + skip OPTIMIZE phase
- [x] `auto_plan_mode` now derives from `riskTier >= 'medium'`, not `scopeTier`
- [x] Update `ClassificationMarker` to persist all three new dimensions (optional fields for back-compat)
- [x] Backward-compat: `tier` field still returned, computed as max(risk, scope)
- [x] 10 new tests (515 total, 515 passing)
- [x] FP nudge surfaced on standard + complex scope

### Slice 2 — Retrieval audit + wire-up ✅ shipped 2026-05-21
Audit finding: the three free-text search paths (`handleSearchLearnings`,
`handleSearchSessions`, `handleSearchGlobalLearnings`) already wire BM25+RRF.
Substring is the intentional fallback for partial-word queries that don't survive
tokenization, or empty BM25 results (tiny corpora). `queryByDomains` is correctly
tag-equality (not free-text), no migration needed.

The one real gap: `handleSearchGlobalLearnings` had no per-project diversity cap,
so one chatty project could flood the cross-project top-K.

- [x] Generic `diversifyBy<T>(results, keyFn, maxPerKey)` helper extracted from `diversifyByBranch`
- [x] New `diversifyByProject` helper (caps results sharing the same `projectName`)
- [x] Wired into `handleSearchGlobalLearnings` (over-fetch ×5, cap 2/project, then RRF)
- [x] 12 new tests for `diversifyBy` / `diversifyByBranch` / `diversifyByProject`
- [x] `handleSearchSessions` already had `diversifyByBranch` — verified
- [x] `handleSearchLearnings` uses BM25+graph+RRF — verified
- [ ] Retrieval-quality metric (>0.5 score hits / total) — **deferred to Slice 3** (metrics extension)

### Slice 3 — Compounding metrics extension ✅ shipped 2026-05-22
The forcing-function slice. Turns "Knit makes Claude cheaper" from a claim
into a chartable number.

- [x] `KBMetrics` extended (all optional for back-compat): `totalClassifications`, `planModeTriggers`, `classificationsByTier`, `fpSuppressions`, `graphQueries`, `highScoreHits`, `totalRetrievalQueries`
- [x] `bumpMetric` + `bumpClassificationTier` helpers in `knowledgebase.ts`
- [x] `handleClassifyTask` instrumented (every call bumps total + tier breakdown + plan-mode trigger)
- [x] `handleSearchLearnings` / `handleSearchSessions` / `handleSearchGlobalLearnings` instrumented (queries, high-score hits @ BM25 score > 5.0, graph contributions, FP surfacings)
- [x] `handleCompoundingMetrics` response extended: `total_classifications`, `classifications_by_tier`, `plan_mode_triggers`, `plan_mode_trigger_rate_pct`, `classification_accuracy_pct`, `fp_suppressions`, `graph_queries`, `total_retrieval_queries`, `retrieval_high_score_rate_pct`, `tokens_spent_estimate`, `tokens_saved_estimate`, `net_token_delta`
- [x] Token heuristics (directional, not accounting): inquiry 200, trivial 1.5k, standard 8k, complex 25k spent; cache_hit 15k, fp_suppression 5k, graph_query 3k saved
- [x] Weekly snapshot persistence to `~/.knit/projects/<hash>/metrics-history.jsonl` (only writes if last is >7 days old)
- [x] New Tier-1 tool `knit_get_metrics_history` — returns snapshots + week-over-week deltas
- [x] Back-compat: `estimated_tokens_saved` field retained, points to new `tokens_saved_estimate`
- [x] 10 new tests (533 total, all passing)
- [ ] `wrong_retrievals_count` — deferred to v0.11 (Verify Layer needs the instrumentation point)

### Deferred from v0.10
- Local embeddings (`@xenova/transformers`) — bundle size hit, defer until BM25 ceiling proven
- Predictive prefetch — needs compounding metrics baseline first

---

## v0.11 — Verify Layer (Anti-Slop) (~2 weeks)

> Cross-check every Claude claim. No slop survives.
>
> Strategic call: v0.10 was *measurement*. v0.11 is *enforcement of correctness*.
> Order: slice 1 (cheapest, biggest leverage) → slice 2 → slice 3 → slice 4.

### Slice 1 — Mandatory `knit_verify_claim` as REVIEW gate ✅ shipped 2026-05-22
- [x] `claimMarkerPath` in `paths.ts` → `~/.knit/projects/<hash>/.claim-verified-current`
- [x] `writeClaimMarker` / `readClaimMarker` / `clearClaimMarker` in `protocol-guard.ts`
- [x] `handleVerifyClaim` writes the marker as a side effect
- [x] Stop hook in `generators/settings.ts` reads classification + claim markers; warns/blocks per protocol-config strictness
- [x] Classifier instruction text appends *"Before LEARN, verify ≥1 claim with `knit_verify_claim`"* on standard/complex scope
- [x] UserPromptSubmit hook also clears the claim marker (mirror of search/classification marker clears)
- [x] `HOOKS_VERSION` bumped 7 → 8 so existing users auto-receive the gate on next MCP call
- [x] 9 new tests (542 total; was 533)

### Slice 2 — Edit/Write diff verification + universal tsc check ✅ shipped 2026-05-22
Expanded scope from "diff verification only" to also include a universal
post-edit tsc — directly addresses the SDK-quirk class of bugs that
plan-mode reviewers can't predict (wrong type import paths, undefined-
until-loaded narrowing, async-contract mismatches).

- [x] PostToolUse diff-verify hook on `Write|Edit|MultiEdit`
  - `Write` → exact match; reports byte delta on drift
  - `Edit` → `new_string` substring check; flags if `old_string` still present (edit failed)
  - `MultiEdit` → per-edit check; reports landed/drifted counts
- [x] Universal post-edit tsc check (replaces v0.9's config-gated typecheck hook)
  - Walks up to find `tsconfig.json` (works regardless of where Knit setup put the user)
  - Prefers `node_modules/.bin/tsc`; falls back to `npx --no-install tsc`
  - Filters output to errors mentioning the touched file
  - Surfaces cross-file ripples explicitly ("project has N type error(s) but none in `f` directly")
  - Catches all three Clerk/Auth-SDK class of bugs at edit time
- [x] `HOOKS_VERSION` 8 → 9 so existing users auto-upgrade on next MCP call
- [x] 3 new generator tests (545 total; was 542)

### Slice 3 — Behavioral re-classification
**Implementation sketch.** Stop hook aggregates the turn's Edit/Write file
paths (parse the PostToolUse log buffer or a per-turn append-only file), then
invokes a lightweight handler that re-runs classifier inference on the diff.
If new classification differs from the marker → log drift event.

- [ ] New `turnEditLogPath` in `paths.ts` → `~/.knit/projects/<hash>/.turn-edits.jsonl`
- [ ] PostToolUse hook (extends slice 2's hook) appends `{path, ts}` per Edit/Write
- [ ] UserPromptSubmit hook clears `.turn-edits.jsonl` per turn (mirror existing marker-clear pattern)
- [ ] New handler `handleReclassifyTurn(brain)` or Stop-hook payload that reads the turn log + classification marker, re-runs `inferRiskTier`/`inferScopeTier`, logs drift if mismatch
- [ ] Threshold: only re-classify if turn touched ≥3 files (cheap path for trivial turns)
- [ ] Tests: simulate turn with type-change diff → assert re-classification surfaces drift
- **Gotcha:** Don't make re-classification expensive — reuse the existing inference helpers, no agent spawning.

### Slice 4 — Self-healing classifier (per-project calibration)
**Implementation sketch.** Persist a per-project calibration sidecar that
adjusts the risk/scope thresholds based on accumulated FP records.

- [ ] New file `~/.knit/projects/<hash>/calibration.json` — `{ riskOffsets: { types: -1, auth: 0, ... }, scopeOffsets: { fileCountAdjust: 0 } }`
- [ ] `inferRiskTier` / `inferScopeTier` accept an optional calibration arg; default no-op
- [ ] When `knit_record_false_positive` is called with a `#classifier` tag → bump the calibration counter for the direction (e.g., `complex-but-was-trivial` → fileCountAdjust + 1)
- [ ] After 3+ same-direction FPs → flip the threshold by 1 unit, log the adjustment to learnings
- [ ] `knit_get_calibration` (Tier 2) shows current per-project tuning
- [ ] Tests: feed 3 FPs in same direction → assert threshold adjusts; cross-project pool unchanged
- **Gotcha:** This is the riskiest slice — a buggy calibration permanently miscalibrates. Add `knit_reset_calibration` admin tool so users can flush.

---

## v0.12 — Universal Auto-Configuration (~2 weeks)

> `npx knit-mcp setup` on ANY repo produces accurate config. Zero manual edits.
> 
> Order: phases are dependent — 0 feeds 1 feeds 2 feeds 3 feeds 4.

### Phase 0 — Project fingerprinting (extend `scanner.ts`)
**Implementation sketch.** Today `scanner.ts` scans imports + computes graph
metrics. Extend it to also emit a `ProjectFingerprint` — the detected
language/framework/test-runner/build-tool/CI signals.

- [ ] New type `ProjectFingerprint` in `types.ts`: `{ languages, framework, testRunner, buildCommand, lintCommand, typecheckCommand, ciFiles, packageManager }`
- [ ] `scanProjectFingerprint(rootPath)` in `scanner.ts` — file-presence + content sniffs (`tsconfig.json` → typescript; `next.config.*` → next.js; `vitest.config.*` → vitest; etc.)
- [ ] Cached on `BrainCache.fingerprint`; rebuilt on `engram refresh`
- [ ] Surface via `knit_brain_status` so users can see what was detected
- [ ] Tests: fixture repos in `tests/fixtures/` for ts+next, py+fastapi, go, rust, etc.
- **Gotcha:** Detection signals overlap (a TS project may have both `vitest.config.ts` and `jest.config.js`). Order detection by file priority; tie-break by package.json scripts.

### Phase 1 — Domain inference
**Implementation sketch.** Three signals fuse via Reciprocal Rank Fusion
(reuse the existing `rrfFuse`) to produce ranked candidate domains.

- [ ] Git co-change clustering — `git log --name-only -90.days` parse → file-pair co-occurrence matrix → DBSCAN or simple greedy clustering
- [ ] Import-graph centrality — for each top-level `src/` subdir, compute PageRank-ish score via existing graph data
- [ ] Test colocation — `tests/foo/` ↔ `src/foo/` confirms domain `foo`
- [ ] Fuse signals via `rrfFuse` (already available) → ranked candidates with confidence
- [ ] New handler `handleInferDomains(brain)` (Tier 2) — returns candidates for user confirmation
- [ ] Tests: hand-built fixture repo with 3 known domains → assert inference recovers them at top-3
- **Gotcha:** Co-change is noisy on tiny repos. Require ≥10 commits for the signal; fall back to import-graph centrality alone otherwise.

### Phase 2 — Template composition
**Implementation sketch.** `generators/claude-md.ts` consumes
`ProjectFingerprint` + inferred domains + user confirmations to produce a
fully marker-wrapped CLAUDE.md. Everything outside markers stays untouched.

- [ ] Extend `generateClaudeMd(config)` to accept fingerprint + domains
- [ ] New section helpers per language: `buildAndVerifySection('typescript' | 'python' | 'go' | ...)` — emits the project's actual commands, not generic placeholders
- [ ] Domain Architecture section: one block per inferred domain with file lists + agent recommendations
- [ ] Marker invariants preserved: `<!-- knit:start -->...<!-- knit:end -->` wraps everything Knit owns
- [ ] Tests: generate against each fixture → snapshot output → CLAUDE.md validates with grep checks (build commands present, domain blocks present, markers intact)
- **Gotcha:** Existing CLAUDE.md may have user content between/outside markers. Diff-merge logic must NEVER touch outside-marker content.

### Phase 3 — Validation loop
**Implementation sketch.** After generation, run a 3-step smoke test; if any
step fails, roll back the generated CLAUDE.md to its pre-generation state.

- [ ] Backup pre-generation CLAUDE.md to `~/.knit/projects/<hash>/.claude-md.backup`
- [ ] Run detected typecheck command (from fingerprint) — must exit 0
- [ ] Run `knit_brain_status` programmatically — must respond
- [ ] Run `knit_classify_task` with `files_to_touch: src/foo.ts` (or detected real file) — must return tier=trivial
- [ ] On any failure → restore from backup, surface error
- [ ] New CLI: `engram doctor` runs the same validation suite on demand
- [ ] Tests: induce each failure mode (broken typecheck, missing brain) → assert rollback fires
- **Gotcha:** The validation loop must NOT trigger Knit's own protocol-guard hooks (infinite loop). Disable hooks during validation by setting `KNIT_VALIDATION_MODE=1` env var, which the hooks check.

### Phase 4 — Drift detection
**Implementation sketch.** Periodic check (every 7 days) that the CLAUDE.md
domain blocks still match reality. Surface drift via `knit_get_board_summary`
so users see it on the next session start.

- [ ] On each `knit_load_session`, check `~/.knit/projects/<hash>/.last-drift-check` — if >7 days, run drift check
- [ ] Drift checks: (a) does each CLAUDE.md-listed file still exist? (b) are there top-level `src/` dirs not represented? (c) does Phase Status reference shipped versions vs latest git tag?
- [ ] Drift report emitted to `~/.knit/projects/<hash>/drift-report.json`
- [ ] `knit_get_board_summary` surfaces unread drift reports
- [ ] New `knit_dismiss_drift` to acknowledge
- [ ] Tests: stale CLAUDE.md vs new src/ structure → assert drift surfaces
- **Gotcha:** Don't auto-fix drift — surface only. User confirms before regenerating.

---

## Deferred (v0.13+)

Conditioned on metrics from v0.10–v0.12 proving the need:

- 4-tier memory tiers (working/episodic/semantic/procedural) + Ebbinghaus decay
- Local embeddings (`@xenova/transformers`)
- Speculative prefetch on classify
- Predictive next-file loading
- Hierarchical memory paging (MemGPT-style)

---

## Out of scope

- Multi-tenant SaaS (Knit stays local-first)
- Non-MCP transport (REST/HTTP API) — defer until real demand
- Editor integrations beyond Claude Code / Cursor / Codex (out of scope for OSS)

---

## Execution discipline

- One slice per PR. Squash merge. Conventional commits.
- All 4 gates pass before merge: typecheck, lint, test, build
- Every slice records a learning via `knit_record_learning`
- Update this roadmap as items ship — check off the box, link the commit
