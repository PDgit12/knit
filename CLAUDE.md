# Engram — Agent Memory & Workflow Intelligence CLI

CLI tool that gives any AI coding agent (Claude Code, Cursor, Codex) compounding project intelligence. One command (`npx engram init`) wires up institutional memory, tiered task routing, and token-optimized workflows — what takes weeks to hand-build, installed in 5 minutes.

## Build & Verify

```bash
npm run typecheck   # zero errors required
npm run lint        # zero errors required
npm run test        # all tests must pass
npm run build       # clean compilation
npm run dev         # local dev — test CLI locally with `node dist/cli.js`
```

All four checks MUST pass before any commit or PR. The Stop hook runs typecheck + lint + build automatically.

## Project Architecture

### Domain Architecture

Every file belongs to exactly one domain. Domains are the unit of orchestration.

```
┌─────────────────────────────────────────────┐
│            MAIN ORCHESTRATOR                │
│  (Claude — classifies, routes, synthesizes) │
└──────┬────────┬────────┬────────┬─────┬─────┘
       │        │        │        │     │
       ▼        ▼        ▼        ▼     ▼
   ┌──────┐ ┌──────┐ ┌──────┐ ┌─────┐ ┌───┐
   │ CLI  │ │Engine│ │ Gen  │ │Adapt│ │ QA│
   │ Head │ │ Head │ │ Head │ │Head │ │Head│
   └──┬───┘ └──┬───┘ └──┬───┘ └──┬──┘ └─┬─┘
      │        │        │        │      │
    agents   agents   agents   agents  agents
```

### Domain 1: CLI (User Interface)
**Files:** `src/cli.ts`, `src/commands/*.ts`
**Head concern:** UX, argument parsing, error messages, interactive prompts, progress output
**Agents:** `code-reviewer`, `typescript-reviewer`

### Domain 2: Engine (Core Intelligence)
**Files:** `src/engine/*.ts` — learnings manager, tier router, context builder, false-positive tracker, handoff manager
**Head concern:** Memory persistence, tier classification accuracy, token optimization, context object construction
**Agents:** `type-design-analyzer`, `code-reviewer`, `code-architect`, `silent-failure-hunter`

### Domain 3: Generators (Output Templates)
**Files:** `src/generators/*.ts` — CLAUDE.md generator, settings generator, hooks generator, learnings scaffold
**Head concern:** Template correctness across frameworks, idiomatic output, no hardcoded paths
**Agents:** `code-reviewer`, `typescript-reviewer`

### Domain 4: Adapters (Agent Compatibility)
**Files:** `src/adapters/*.ts` — Claude Code adapter, Cursor adapter, Codex adapter
**Head concern:** Hook format compatibility, settings format per agent, memory format translation
**Agents:** `code-architect`, `code-reviewer`, `silent-failure-hunter`

### Domain 5: Quality Assurance
**Files:** `tests/*`, build configs, lint configs
**Head concern:** Test coverage (80%+), CLI integration tests, template output validation
**Agents:** `tdd-guide`, `pr-test-analyzer`, `build-error-resolver`

### Cross-Domain Communication Rules

| Change in | Notify | Why |
|-----------|--------|-----|
| `src/engine/types.ts` | ALL domains | Types are the universal contract |
| `src/engine/tier-router.ts` | CLI + Gen + QA | Tier classification affects what gets generated |
| `src/generators/*` | Adapters + QA | Output format changes must be adapter-compatible |
| `src/adapters/*` | Gen + QA | Adapter constraints may require generator changes |
| New CLI command | CLI + Engine + QA | Needs wiring, engine support, tests |

---

## Orchestration Protocol — v1.0 (2026-05-15)

### Pre-flight (runs BEFORE every task — no exceptions)

**Step 1 — Load institutional knowledge:**
```
grep learnings: .claude/learnings/*.md for domain tags matching the task
grep false positives: filter for #false-positive entries → feed into all agent prompts
```

**Step 2 — Detect tool availability:**

| Layer | Check | If unavailable |
|-------|-------|----------------|
| Semantic search | Is a code search MCP available? | Fall back to Grep + Read |
| Browser QA | Is a browse skill available? | Skip browser verification |
| Dev build | `npm run build` exits 0? | Fix build before proceeding |

**Step 3 — State availability:** Before classification, say:
> **Tools:** semantic search ✓/✗ | browser QA ✓/✗ | build ✓/✗

---

### Task Classification

Classify BEFORE doing anything. State the classification out loud.

**Trivial** (1 domain, obvious fix):
- Typo, config change, lint fix, missing import
- Phases: EXECUTE → VERIFY → LEARN
- Agents: 0

**Standard** (1-2 domains):
- Bug fix, single-file feature, test addition
- Phases: RESEARCH → EXECUTE → OPTIMIZE → REVIEW → LEARN

**Complex** (3+ domains or architectural):
- New feature, schema change, new adapter, new CLI command
- Phases: ALL 6 — RESEARCH → IDEATE → PLAN → EXECUTE → OPTIMIZE → REVIEW
- **IMMEDIATE ACTION:** Call `EnterPlanMode` as FIRST tool call after stating classification

**Auto-detection rules:**
- Touches `src/engine/types.ts` → Complex (universal contract)
- Touches tier-router or context-builder → Complex (core intelligence)
- New file created → at minimum Standard
- Touches 3+ files → Complex
- User says "plan" or shift+tab → Force Complex

### The 6-Phase Protocol

```
RESEARCH → IDEATE → PLAN → EXECUTE → OPTIMIZE → REVIEW
    ↑                                              |
    └──────────────── LEARN ←──────────────────────┘
```

**Phase routing by tier:**
```
TRIVIAL:    EXECUTE ──→ VERIFY ──→ LEARN
STANDARD:   RESEARCH ──→ EXECUTE ──→ OPTIMIZE ──→ REVIEW ──→ LEARN
COMPLEX:    RESEARCH ──→ IDEATE ──→ PLAN ──→ EXECUTE ──→ OPTIMIZE ──→ REVIEW ──→ LEARN
```

### Domain Context Object

Built during RESEARCH, passed to EVERY agent prompt:

```
DOMAIN CONTEXT:
  Affected domains: [list]
  Files to touch: [list]
  Cross-domain ripple: [which domains get notified]
  Known pitfalls: [from learnings grep]
  False positives to suppress: [from #false-positive entries]
  Tool availability: semantic search ✓/✗ | browser QA ✓/✗ | build ✓/✗
  Scout findings: [from RESEARCH]
  Selected approach: [from IDEATE, if run]
  Approved plan: [from PLAN, if run]
```

---

#### Phase 1: RESEARCH `[Standard + Complex]`

**Standard:** Read affected files directly, check cross-domain rules.
**Complex:** Spawn `code-explorer` agents per affected domain in parallel.

**Gate:** Can I name all affected files and domains? YES → proceed | NO → read more

---

#### Phase 2: IDEATE `[Complex only]`

1. Launch domain heads for affected domains in parallel
2. Each head proposes approach + risks
3. Orchestrator synthesizes and presents options

**Gate:** User selects approach

---

#### Phase 3: PLAN `[Complex only — auto plan mode]`

Auto-enter plan mode. RESEARCH and IDEATE happen INSIDE plan mode.

1. Domain plans with exact files to create/modify/delete
2. Cross-domain sync + ordering
3. Execution order (sequential vs parallel)

**Gate:** User says "go" / "approved" / "do it"

---

#### Phase 4: EXECUTE

- Follow approved plan strictly
- TDD for new features (test first → implement → refactor)
- Milestone check: typecheck every 5 file edits

---

#### Phase 5: OPTIMIZE `[Standard + Complex]`

Launch affected domain heads in parallel with review agents:

| Domain Head | Review Agents |
|-------------|--------------|
| CLI Head | `code-reviewer`, `typescript-reviewer` |
| Engine Head | `type-design-analyzer`, `code-reviewer`, `code-architect`, `silent-failure-hunter` |
| Gen Head | `code-reviewer`, `typescript-reviewer` |
| Adapter Head | `code-architect`, `code-reviewer`, `silent-failure-hunter` |
| QA Head | `tdd-guide`, `pr-test-analyzer`, `build-error-resolver` |

**Gate:** Zero CRITICAL findings. All HIGH acknowledged.

---

#### Phase 6: REVIEW `[Standard + Complex]`

**Layer 1 — Code gates:** typecheck + lint + test + build (all must pass)
**Layer 2 — CLI verification:** Run the CLI against a test project, verify output

---

#### LEARN (after every task) — MANDATORY, NEVER SKIP

**Enforcement rule:** If about to say "done"/"complete"/"finished" — STOP. Did LEARN run? If not, run it NOW.

**Checklist:**
1. [ ] Append entry to `.claude/learnings/` with domain tags
2. [ ] If false positive → add `#false-positive` tag
3. [ ] If semantic search available AND code changed → sync index
4. [ ] If phase completed → update CLAUDE.md Phase Status
5. [ ] If file created/deleted → update Domain Architecture file lists

**Output format:**
```
LEARN complete:
  ✅ Learnings updated: [entry title]
  ✅ CLAUDE.md: [what changed, or "no changes needed"]
  ✅ Memory: [what changed, or "no changes needed"]
  ✅ Search index: [synced / skipped — offline]
```

---

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

---

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

---

## Session Handoff Protocol

When context degrades:
1. Write `handoff.md`: Goal, Current State, Files in Flight, What Changed, **Failed Attempts** (mandatory), Decisions Made, ONE Next Step
2. User runs `/clear`
3. Fresh session reads `handoff.md` first
4. Archive to `.claude/handoffs/`

---

## Toolchain

Built with TypeScript, compiled via tsup, tested with Vitest. The Engram Orchestration Protocol is the core IP — all generated workflow files are original compositions.

## Git & Commits

- **Branches:** `feature/<descriptive-name>`, squash merge to main
- **Pre-merge:** `npm run typecheck && npm run lint && npm run test && npm run build`
- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`

## Phase Status

All four releases below are live on npm as `@piyushdua/engram-dev`. `latest` → v0.4.1.

- **Phase 0** (project setup + workflow): ✅ Complete
- **v0.1.x** — shipped. 23 MCP tools, 111 tests. Original baseline.
- **v0.3.0** — shipped. Centralized data at `~/.engram/projects/<hash>/`, marker-wrapped CLAUDE.md, on-demand workflow via `engram_get_workflow`, session memory in `sessions.jsonl`, team-scoped git worktrees, token-accounting metrics, hooks wired into auto-init. Model C: cross-project learnings pool at `~/.engram/global/learnings.jsonl`. Pattern reflection re-enabled. v0.2.0 was tagged in git but skipped on npm (jumped straight to 0.3.0). 31 MCP tools, 197 tests.
- **v0.3.1** — git-tagged, NOT published to npm. Windows-compatible hooks (rewrote all 7 hooks as inline `node -e '…'` cross-platform). Folded into v0.4.0's npm release.
- **v0.4.0** — shipped. VoltAgent subagent integration (`github.com/VoltAgent/awesome-claude-code-subagents`, MIT, pinned SHA `6f804f0c…`) with engram personalization layer. Bundled-core 6 agents in `dist/agents/core/`; specialized agents fetched on demand to `~/.engram/agents/cache/<sha>/`. `engram install-agents` CLI + `engram_install_agent` MCP tool. 32 MCP tools, 247 tests.
- **v0.4.1** — shipped. Built across 4 parallel team worktrees via Claude Code's Agent `isolation:"worktree"` — engram eating its own dogfood. Fixed agent-prefix wiring bug (`agentsForRole` now returns `engram-<name>`). VoltAgent attribution added to fetched agents + `THIRD-PARTY-NOTICES.md` shipped. JSONL session pruning + `engram_prune_sessions` tool. Reflect falls back to global pool when local entries < 3. Hybrid hook merging (`_engramOwned: true` tag per entry; merge into existing user `settings.local.json` without clobbering). `engram export obsidian <vault>` CLI. 33 MCP tools, 272 tests.

## v0.5 candidates (deferred, ranked by value × cost)

1. **Hybrid search fusion** — engram's `searchSessions` / `searchGlobalLearnings` / `queryByDomains` use plain substring match. agentmemory (`rohitg00/agentmemory`, Apache-2.0) uses BM25 + vector embeddings + knowledge graph fused via Reciprocal Rank Fusion (k=60). ~95% R@5 vs ~86% BM25-only in their benchmarks. Local embeddings via `@xenova/transformers` or similar avoid the network. Biggest retrieval-quality win.
2. **4-tier memory consolidation** — engram has flat learnings + sessions. agentmemory promotes through working → episodic → semantic → procedural tiers with Ebbinghaus decay. Lets old noise self-evict; surfaces stable patterns; matches how human memory actually consolidates. Real architecture change.
3. **Privacy filter on the ingest path** — engram strips control chars + caps length on MCP tool inputs (`tools.ts:209`), but doesn't scan for secrets (`sk-…`, `AKIA…`, `ghp_…`) before persisting to learnings or sessions. Bake it into the ingest pipeline. Real defense for users who paste tokens by accident.
4. **More auto-capture hooks** — engram has PreToolUse + PostToolUse + Stop. agentmemory has 12 lifecycle hooks (SessionStart, PreCompact, etc.) and captures from them automatically. Reduces the LEARN-discipline burden — closer to zero-effort capture.
5. **Session-diversified retrieval** — cap retrieved results to N per session in final ranking so one verbose session doesn't dominate. Trivial add to `searchSessions` / `searchGlobalLearnings`.
6. **/plugin install path** — Claude Code now supports `claude /plugin install`. Ship engram as a plugin alongside the MCP-server-via-npx path so users don't need to edit `~/.claude.json` manually.
7. **Knowledge graph + entity extraction** — agentmemory extracts entities/relationships during consolidation and uses graph traversal as a reranking signal. Useful only AFTER (1) and (2) land.

(Items 8+: REST/HTTP API for non-MCP clients, live observability viewer, native Windows shell outside hooks — all deferred until a real user need surfaces.)
