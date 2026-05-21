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

### Slice 2 — Retrieval audit + wire-up (NEXT WEEK)
- [ ] Audit: which search paths use BM25+RRF? Grep `handleSearchLearnings`, `handleSearchSessions`, `handleSearchGlobalLearnings`, `handleQueryByDomains`
- [ ] Any that fall back to substring → migrate to `retrieval/index.ts` fused query
- [ ] Add session-diversity cap (max 2 per session in final top-K) — `retrieval/index.ts`
- [ ] Add retrieval-quality metric: hits where relevance > 0.5 vs total queries

### Slice 3 — Compounding metrics extension
- [ ] Extend `knit_compounding_metrics` response with:
  - `tokens_spent_estimate` (sum from session entries)
  - `tokens_saved_estimate` (cache hits × 15k + FP suppressions × 5k + graph queries × 5k)
  - `wrong_retrievals_count` (when learning entry surfaced but agent ignored)
  - `plan_mode_trigger_rate_weekly` (week-over-week)
  - `classification_accuracy` (1 − FP_count / total_classifications)
- [ ] Persist weekly snapshots to `~/.knit/projects/<hash>/metrics-history.jsonl`
- [ ] New tool: `knit_get_metrics_history` (Tier 2, opt-in)

### Deferred from v0.10
- Local embeddings (`@xenova/transformers`) — bundle size hit, defer until BM25 ceiling proven
- Predictive prefetch — needs compounding metrics baseline first

---

## v0.11 — Verify Layer (Anti-Slop) (~2 weeks)

> Cross-check every Claude claim. No slop survives.

### Slice 1 — Mandatory `knit_verify_claim` as REVIEW gate
- [ ] Protocol Guard: REVIEW phase checks for `knit_verify_claim` call in turn
- [ ] If absent and `scopeTier >= 'standard'` → warn (strictness=warn) or block (strictness=block)
- [ ] Surface in classifier `instruction` for standard/complex: *"Before LEARN, verify your claims with `knit_verify_claim`."*
- [ ] Tests: verify gate fires on standard+complex, skips on trivial+inquiry

### Slice 2 — Edit/Write diff verification
- [ ] New PostToolUse hook on Edit|Write|MultiEdit
- [ ] Re-read file, diff vs `tool_input.new_string` (or `content` for Write)
- [ ] Log `[knit] verify: edit landed | edit drifted | file unchanged` to stderr
- [ ] If drift detected → suggest re-edit
- [ ] No-op for read-only tools

### Slice 3 — Behavioral re-classification
- [ ] After significant edit batch (≥3 files in same turn), re-run classifier on the diff
- [ ] If new classification ≠ original → log "classification drift" event
- [ ] Surfaces silent scope creep early

### Slice 4 — Self-healing classifier (per-project calibration)
- [ ] Track classification → outcome per project
- [ ] If 3+ FPs in same direction (e.g., "complex but was actually standard") → adjust per-project threshold
- [ ] Per-project calibration stored at `~/.knit/projects/<hash>/calibration.json`
- [ ] Cross-project learnings stay global; per-project tuning stays local

---

## v0.12 — Universal Auto-Configuration (~2 weeks)

> `npx knit-mcp setup` on ANY repo produces accurate config. Zero manual edits.

### Phase 0 — Project fingerprinting (extend `scanner.ts`)
- [ ] Detect language(s), framework, test runner, build command, lint setup, CI
- [ ] Output structured `ProjectFingerprint` type

### Phase 1 — Domain inference
- [ ] Git co-change clustering (last 90 days, files-touched-together)
- [ ] Import graph centrality → identify domain heads
- [ ] Test colocation → confirm boundaries
- [ ] Output: ranked candidate domains with confidence scores

### Phase 2 — Template composition
- [ ] CLAUDE.md generator consumes `ProjectFingerprint` + inferred domains
- [ ] Marker-wrapped sections all auto-generated; outside markers untouched
- [ ] Per-language `Build & Verify` snippets

### Phase 3 — Validation loop
- [ ] After generation: run detected typecheck, run `knit_brain_status`, run a trivial `knit_classify_task`
- [ ] Any failure → roll back generation, surface error to user
- [ ] Add `engram doctor` CLI for ongoing health checks

### Phase 4 — Drift detection
- [ ] Every N sessions: diff CLAUDE.md domain file lists vs actual `src/`
- [ ] Diff Phase Status vs latest git tags
- [ ] Surface drift via `knit_get_board_summary`

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
