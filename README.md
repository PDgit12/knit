<p align="center">
  <a href="https://www.npmjs.com/package/knit-mcp"><img src="https://img.shields.io/npm/v/knit-mcp?style=for-the-badge&color=7c3aed&label=npm" alt="npm version" /></a>
  <img src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge" alt="license" />
  <a href="https://github.com/PDgit12/knit/actions/workflows/ci.yml"><img src="https://github.com/PDgit12/knit/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D18-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="node" />
</p>

<h1 align="center">knit</h1>

<p align="center">
  <strong>An intelligent command layer for Claude Code.</strong>
  <br/>
  Project-scoped memory, on-demand workflow protocol, parallel team worktrees,<br/>
  and honest token accounting — all in one MCP server.
</p>

<br/>

## What knit is

Knit makes Claude Code do the right thing automatically because it can't predict how a user will phrase a request. It does three jobs at once:

- **Memory** — every project keeps a brain at `~/.knit/projects/<hash>/`. Sessions compound: learnings, false positives, session summaries, and a static-analysis import graph are all queryable next session.
- **Tokens** — `CLAUDE.md` is ~100 lines (project facts only). Workflow protocol is fetched on demand via `knit_get_workflow(phase)`. Knit is net-negative on context cost.
- **Workflow** — a 4-tier classification (Inquiry / Trivial / Standard / Complex) with phase-triggered plan mode, quality-gated `LEARN`, and team-scoped git worktrees so parallel agents don't step on each other.

It's a **single product**, not three. Every design choice has to win on memory + tokens + workflow together.

## What's new in v0.9.0

v0.9 closes the *enforcement* story — every honest limit from the v0.8 architecture got a structural fix:

- **Citation rule in the MCP `instructions` field.** Every session's system prompt now tells the agent: *"when you state a fact about this codebase, cite the Knit tool result that verified it — e.g. (per knit_query_imports). If you can't cite, say 'unverified' explicitly."* Makes hallucinations visible at the claim level instead of letting them ship as confident-sounding prose.
- **`knit_verify_claim` tool.** Single-call fact-check against the knowledge graph. Parses patterns ("A imports B", "X exports Y", "A is tested by B", "X exists") and returns verdict `verified | contradicted | unparseable` with evidence. The companion to `knit_query_*` — those answer *what?*; this answers *is the agent's claim about it true?*
- **Auto-search inside `knit_classify_task`.** For `standard` and `complex` tier, classify_task now runs BM25 over (description + affected domains) automatically and embeds top-3 hits as `pre_emptive_learnings` in the response. Closes the "agent skipped knit_search_learnings before re-investigating" gap with zero extra calls.
- **`suggested_reads` from `knit_build_context`.** Returns a curated list of files worth reading before editing — via three signals: graph-importers (blast radius), graph-imports (likely needed), and memory-mentions (files referenced by past learnings in these domains). Each entry carries `{ path, reason, via }`.
- **`knit_get_learning` — hierarchical retrieval.** Search returns headlines (summary + tags); the agent expands a specific learning by id only when needed. Token-savings on the upfront list, pay-per-detail.
- **`knit_consolidate_learnings`.** Tag-Jaccard clustering of similar learnings; proposes a single pattern entry per cluster. Dry-run by default; `commit=true` persists with originals tagged `#consolidated` (preserved but deprioritized in retrieval). Keeps the working set lean as the KB grows.
- **Hook-level enforcement (HOOKS_VERSION 6 → 7).**
  - **PreToolUse search-gate.** For `standard`/`complex` tasks, blocks Edit/Write (in `block` mode) or warns (in default `warn`) when `knit_search_learnings` hasn't fired in the current turn.
  - **PreToolUse content inspection.** Reads proposed Edit/Write content, parses local imports, warns on relative paths that don't resolve on disk — catches hallucinated imports before they land.
  - **PostToolUse import validation.** After the file lands, re-parses imports and warns about unresolved relative paths — catches anything that slipped past the pre-check (e.g. MultiEdit combinations).
  - **Stop-hook budget watch.** Cheap CLAUDE.md size check at session end; warns if it crosses the 12.5KB over-budget threshold. Drift becomes visible even when the agent doesn't call `knit_brain_status`.

## What's new in v0.8

- **Vectorless RAG.** All three search tools (`knit_search_learnings`, `knit_search_global_learnings`, `knit_search_sessions`) now run BM25 with proper IDF + term-frequency saturation + length normalization, fused via Reciprocal Rank Fusion (k=60). Session search adds branch-diversification so one verbose feature branch can't flood the response. Zero new dependencies. Fully deterministic — same query → same results, every time.
- **Graph-traversal retriever.** Layered into RRF alongside BM25. Pass `files=src/a.ts,src/b.ts` to `knit_search_learnings` to enable a graph-neighborhood boost: 1-hop import/importer files, weighted into the final ranking. Surfaces learnings that lexical search misses (e.g. *"when session.ts changes, re-run integration tests"* when you're editing `auth.ts`).
- **Per-project instruction tailoring.** The MCP `instructions` field is now computed per-project from the integration scanner's results — if Ruflo / gstack / CodeTour / Conductor / custom CLAUDE.md sections are detected, short framework-specific addenda tell the agent to defer routing decisions to them. Memory + classification stay Knit's domain.
- **`knit_compounding_metrics`.** Quantifies "Knit gets cheaper over time" — sessions, learnings, cache hits, reuse-ratio %, access-density %, estimated tokens saved. Verdict ladder: `cold | warming | compounding | strong`. Pairs with `knit_brain_status` token_budget surface — budget tells you the per-session COST, compounding tells you the cumulative PAYOFF.
- **Integration scanner.** Detects existing workflow frameworks installed alongside Knit and persists the result to `~/.knit/projects/<hash>/integrations.json`. Surfaced by `knit_brain_status`. Drives the per-project instruction tailoring above.

## What's new in v0.7

- **Universal protocol injection.** Knit sets the MCP server-level `instructions` field, so every MCP client sees Knit's flow at session start — *before* tool descriptions.
- **Tier-gated tool surface.** Tools split into three tiers: Tier 1 (always exposed — memory, knowledge graph, workflow, etc.), Tier 2 (auto-exposed when the project shape matches), Tier 3 (admin, opt-in). Solo-domain projects no longer see 9 team-worktree tools cluttering their decision space.
- **`knit_list_features` + `knit_enable_feature` / `knit_disable_feature`.** Discoverability escape hatch — always shows what's hidden and how to enable it. Persisted to `~/.knit/projects/<hash>/features.json` so the choice survives sessions. v0.7.1 added `notifications/tools/list_changed` so enable/disable updates the agent's tool list without a Claude Code restart.
- **Inquiry tier in the classifier.** Read-only "what / where / audit / explain" tasks now route to `tier: "inquiry"` with no plan mode and no phases — fixes the over-routing bug where audit-style questions hijacked Complex.
- **CLAUDE.md cut ~88%** (16.7 KB → ~2 KB on typical projects).
- **Lazy / minimal response modes.** `knit_load_session` returns the lean core by default; opt into more via `include=patterns,teams,metrics,recent_sessions,full_learnings,full_knowledge,all`. `knit_classify_task` returns the minimal shape by default; pass `verbose=true` for diagnostic fields.
- **Token-budget guardrail in `knit_brain_status`.** Per-surface verdicts (`healthy | warn | over-budget`) make the v0.7 trim measurable.
- **In-band update notification.** `knit_brain_status` surfaces an `update_available` field when the cached npm `latest` is newer than the installed VERSION.
- **Legacy CLAUDE.md migration.** Users upgrading from v0.5.x with `<!-- engram:start -->/<!-- engram:end -->` markers are auto-migrated cleanly.

### Per-session token-budget table

| Surface | v0.6.5 | v0.9.0 | Cut |
|---|---|---|---|
| CLAUDE.md per-turn | ~16.7 KB | ~2 KB | 88% |
| Tool registry (typical project) | ~6–8 KB | ~3–4 KB | ~50% |
| `knit_classify_task` response | ~500 tok | ~150 tok | 70% |
| `knit_load_session` response | ~3–5 KB | ~1.5 KB | ~60% |

### Upgrade note

After running `npx knit-mcp@latest setup` (or just updating the version pin), **restart Claude Code**. The MCP server's `instructions` field and tier-gated `tools/list` only flow into the system prompt at handshake — the cached process from before the upgrade keeps the older behavior until restart. The HOOKS_VERSION bump (6 → 7 in v0.9.0) means installed hooks auto-regenerate on the next brain load — no manual `knit refresh` needed.

## Setup (one time)

```bash
npx knit-mcp@latest setup
```

Adds the Knit MCP server to your Claude Code config (`~/.claude.json`). No per-project setup. Open Claude Code in any project and the first MCP tool call auto-initializes everything.

**Supported shells:** macOS, Linux, WSL, Git Bash, and Windows PowerShell. The generated hooks use POSIX-style single-quoted `node -e '…'` payloads. Windows `cmd.exe` does not treat single quotes as delimiters and is not supported as the hook-runner shell — on Windows, use PowerShell (default in modern Windows Terminal) or Git Bash. If you hit a hook error on Windows, file an issue with the shell you're using.

### Quiet mode (no hook enforcement)

Knit ships Protocol Guard in `warn` mode by default — hooks print reminders, they never block. If you want it fully silent (no PreToolUse classification gate, no reminder messages), run this once inside Claude Code:

> `knit_set_protocol_strictness({ level: "off" })`

The other hooks (LEARN compliance, KB metrics, final build verification) stay as observability nudges — they print, they don't gate. To remove them too, see Uninstall below.

### Uninstall

```bash
rm -rf ~/.knit                                 # all per-project + global memory
```

Then:
1. Remove `"knit-brain"` from `mcpServers` in `~/.claude.json`
2. Delete the `<!-- knit:start --> ... <!-- knit:end -->` block from each project's `CLAUDE.md`
3. Remove `_knitOwned` entries from each project's `.claude/settings.local.json` (or delete the file if Knit was the only thing in it)

Total time: ~30 seconds per project. Knit doesn't write anywhere else on your machine.

## How data is stored

Knit data is centralized — not in every repo's working tree:

```
~/.knit/
└── projects/<hash>/                    ← one dir per project (sha256 of repo root)
    ├── knowledge.json                  ← import graph, exports, test mapping
    ├── knowledgebase.json              ← learnings + access metrics + false positives
    ├── sessions.jsonl                  ← session memory, append-only
    ├── teams.json                      ← custom teams (if defined)
    ├── worktrees.json                  ← active team worktree registry
    └── learnings/<project>.md          ← human-readable learnings
```

What stays in the project:

```
your-project/
├── CLAUDE.md                           ← ≤150-line thin shape, marker-wrapped
└── .claude/
    └── settings.local.json             ← per-machine hooks (knit-managed; gitignored by convention)
```

The project's own `CLAUDE.md` is wrapped in `<!-- knit:start --> ... <!-- knit:end -->` markers. Knit regenerates only the block between markers — never clobbers anything else you write. If your project already has a `CLAUDE.md` without markers, knit writes a sidecar at `.claude/KNIT.md` instead.

Override the data location with `KNIT_HOME=/custom/path` (useful for sandboxes and tests).

## Workflow on demand

The protocol is in MCP, not preloaded in every session. CLAUDE.md tells the agent to call `knit_get_workflow(phase)` when it needs the actual procedure. Sections:

```
knit_get_workflow({phase: "research"})    // RESEARCH phase details
knit_get_workflow({phase: "plan"})        // PLAN + plan-mode rules
knit_get_workflow({phase: "execute"})     // EXECUTE + TDD
knit_get_workflow({phase: "optimize"})    // OPTIMIZE + role briefings
knit_get_workflow({phase: "review"})      // REVIEW gates
knit_get_workflow({phase: "learn"})       // LEARN quality gate
knit_get_workflow({phase: "handoff"})     // session handoff
knit_get_workflow({phase: "ship"})        // commit + ship + prod checklist
knit_get_workflow({phase: "tdd"})         // RED → GREEN → REFACTOR
knit_get_workflow({phase: "tools"})       // knit MCP tools reference
```

Plus `overview`, `tier`, `phases`. Call with no `phase` to list all sections.

**Effect:** v0.1's CLAUDE.md was ~700 lines / ~20 KB per session, every session. v0.2's is ~100 lines / ~2.7 KB. Protocol depth pulled only when needed.

## 43 MCP Tools

### Knowledge graph (Tier 1, ~5ms)

| Tool | What it does |
|------|--------------|
| `knit_query_imports` | Reverse dependencies — who imports this file. |
| `knit_query_dependents` | Forward dependencies — what this file imports. |
| `knit_query_exports` | Functions / classes / interfaces / types this file exposes. |
| `knit_query_tests` | Test coverage for a file, or list all untested with `filter=untested`. |
| `knit_find_fanout` | High-fanout files — the contracts to change carefully. |
| `knit_verify_claim` | **v0.9.** Fact-check one claim against the graph — "A imports B", "X exports Y", "A is tested by B", "X exists". Verdict: `verified | contradicted | unparseable`. |

### Memory + retrieval (Tier 1)

| Tool | What it does |
|------|--------------|
| `knit_load_session` | Call at session start — returns handoff, top learnings, false positives, project knowledge. Lazy by default; opt into `include=patterns,teams,metrics,recent_sessions,full_learnings,full_knowledge,all`. |
| `knit_search_learnings` | **v0.8+.** BM25 + import-graph hybrid. Pass `query=text` for BM25, `domains=#tag` for tag filter, `files=src/a.ts` for graph-neighborhood boost. Fused via RRF (k=60). |
| `knit_search_sessions` | BM25 over session summaries + branch + commits + tags. Branch-diversified (max 2 per branch) so one feature branch can't flood. |
| `knit_search_global_learnings` | BM25 across the cross-project pool at `~/.knit/global/learnings.jsonl`. |
| `knit_get_learning` | **v0.9.** Fetch one full learning by id. Pair with `knit_search_learnings` (headlines) for hierarchical retrieval — pay per detail. |
| `knit_record_learning` | Save a non-obvious insight. Quality check first; secret patterns redacted before persistence. |
| `knit_record_global_learning` | Opt-in: cross-project pool when the insight generalizes beyond this project. |
| `knit_record_false_positive` | Mark a finding as confirmed non-issue so future reviewers don't re-flag it. |
| `knit_get_false_positives` | List confirmed non-issues to suppress in review prompts. |
| `knit_save_session_summary` | Opt-in narrative — record only when this session accomplished something a future session would search for. |
| `knit_save_handoff` | Save state when context degrades. `failed_attempts` is the load-bearing field. |
| `knit_consolidate_learnings` | **v0.9.** Cluster similar learnings via tag-Jaccard, propose a single pattern entry per cluster. Dry-run by default. |

### Workflow + classification (Tier 1)

| Tool | What it does |
|------|--------------|
| `knit_classify_task` | First call on every task. Returns tier (inquiry / trivial / standard / complex), phases, `auto_plan_mode`. **v0.9.** For standard/complex, auto-runs BM25 over the description + affected domains and embeds top-3 hits as `pre_emptive_learnings`. |
| `knit_build_context` | Domain context for the current task. **v0.9.** Includes `suggested_reads` — files worth opening (graph-importers, graph-imports, memory-mentions). |
| `knit_get_workflow` | Fetch protocol depth for one phase on demand. Sections: overview, tier, phases, research, ideate, plan, execute, optimize, review, tdd, learn, handoff, ship, tools. |
| `knit_get_suggestions` | Adaptive warnings from past patterns in given domains. "Based on history, watch out for X." |
| `knit_reflect` | Detect patterns across recorded learnings (per-project + global pool). Useful with ≥3 entries. |
| `knit_setup_project` | Describe a non-code project (legal, marketing, research) to bootstrap domain teams. |
| `knit_prune_sessions` | Prune `sessions.jsonl` by age (default 90 days). Atomic rewrite. |

### Protocol Guard (Tier 1)

Runtime enforcement of the Knit protocol via PreToolUse and SessionStart hooks. Default strictness: `warn`.

| Tool | What it does |
|------|--------------|
| `knit_set_protocol_strictness` | Set strictness: `off` (no checks), `warn` (reminder, default), `block` (hard-fail Edit/Write without prior `knit_classify_task` AND `knit_search_learnings`). |
| `knit_get_protocol_strictness` | Read current strictness level. |

### Discoverability + diagnostics (Tier 1)

| Tool | What it does |
|------|--------------|
| `knit_brain_status` | Brain health + **token-budget** verdicts per surface (CLAUDE.md, tool registry, instructions, total) + `update_available` notification when the npm `latest` is newer + integrations summary. |
| `knit_list_features` | Returns `{ active, available, totals, by_category, project_shape }` — surfaces hidden tools and tells you how to enable them. The escape hatch. |
| `knit_enable_feature` | Flip on a Tier-2/3 feature (`teams`, `subagents`, `admin`). Persisted to `~/.knit/projects/<hash>/features.json`. Emits `notifications/tools/list_changed` so new tools appear without a Claude Code restart. |
| `knit_disable_feature` | Symmetric to enable_feature. |
| `knit_scan_integrations` | Re-detect existing workflow frameworks (Ruflo, gstack, CodeTour, Conductor, other MCP servers, custom CLAUDE.md sections). Runs implicitly at autoInit. |
| `knit_compounding_metrics` | Quantifies "Knit gets cheaper over time" — sessions, learnings, cache hits, reuse-ratio %, access-density %, estimated tokens saved. Verdict: `cold | warming | compounding | strong`. |

### Parallel team worktrees (Tier 2 — auto-active when ≥3 domains detected, or opt-in via `knit_enable_feature("teams")`)

| Tool | What it does |
|------|--------------|
| `knit_spawn_team_worktree` | Create a git worktree for a team so they can write in parallel without colliding. |
| `knit_list_team_worktrees` | List active team worktrees. |
| `knit_finalize_team_worktree` | Merge or discard a team's worktree; surfaces conflicts without destroying it. |
| `knit_get_teams` | List auto-detected or custom teams. |
| `knit_define_team` | Create a custom team. |
| `knit_start_team_review` | Start a parallel review with a shared findings board. |
| `knit_get_team_prompt` | Per-team prompt including other teams' findings. |
| `knit_post_team_findings` | Post findings to the shared board. |
| `knit_get_board_summary` | Cross-team summary, severity-gated. |

### Subagents (Tier 2 — auto-active when `.claude/agents/` exists, or opt-in)

| Tool | What it does |
|------|--------------|
| `knit_install_agent` | Install a single VoltAgent subagent (e.g. `typescript-pro`) into `.claude/agents/knit-<name>.md`, personalized with project context. |

### Admin (Tier 3 — opt-in only via `knit_enable_feature("admin")`)

| Tool | What it does |
|------|--------------|
| `knit_setup_project` | Bootstrap domain teams for a non-code project. One-time. |
| (`knit_prune_sessions` is also exposed in Tier 1 by default since auto-prune handles it; not Tier 3.) |

The cross-project pool (`knit_search_global_learnings` + `knit_record_global_learning`) holds the lessons that travel between projects — "Stripe signature rules", "GitHub API pagination quirks", "Redis cluster failover behavior" — the kind of thing future-you will be glad you wrote down once, somewhere.

## Subagents — VoltAgent + project personalization

v0.4 closes the gap where knit's team configs referenced agent names
(`typescript-pro`, `security-engineer`, etc.) without actually installing them.
A fresh user opening Claude Code had none of those agents on disk, so teams
fell back to generic prompts.

Now: on first MCP call, knit **installs personalized subagents** into
`<project>/.claude/agents/knit-<name>.md`. Each agent has:

1. **The VoltAgent base** — the curated system prompt from
   [github.com/VoltAgent/awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents)
   (MIT-licensed, 131+ agents). Knit bundles the 6 most common
   (`code-reviewer`, `security-engineer`, `qa-expert`, `typescript-pro`,
   `python-pro`, `golang-pro`) so they install with zero network. Specialized
   agents fetch from VoltAgent at a pinned SHA the first time knit needs them.
2. **An knit context block** appended at the end with project name, stack,
   high-fanout files, recent relevant learnings, false positives to suppress,
   and the knit MCP tools the agent can call.

Each agent now has both VoltAgent's role expertise AND knit's project-specific
context. When a team dispatches via Claude Code's Agent tool, the agent inherits
both layers.

**Never clobbers user-curated agents.** If you have your own
`<project>/.claude/agents/typescript-pro.md`, knit writes
`knit-typescript-pro.md` alongside it. Different filename, no conflict.

```bash
knit install-agents              # install agents this project's teams need
knit install-agents --all        # install every known agent
knit install-agents --refresh    # re-fetch from network even if cached
```

`KNIT_OFFLINE=1` disables network fetches (bundled-core still works).
`KNIT_AGENT_REGISTRY_REF=main` overrides the pinned VoltAgent SHA.
(Legacy `ENGRAM_OFFLINE` / `ENGRAM_AGENT_REGISTRY_REF` are still honored.)

## Parallel team worktrees

A Complex task gets broken across multiple teams. Each team works in its own git worktree (sibling to the main repo, native `git worktree` convention). Multiple agents within one team share the team's worktree. The orchestrator collects each team's work, runs gates, and merges back.

```
/Users/p/my-repo                          <- main
/Users/p/my-repo-knit-ui-<ts>           <- UI team
/Users/p/my-repo-knit-api-security-<ts> <- API & Security team
```

```js
// Orchestrator workflow
const ui = await knit_spawn_team_worktree({ team_name: "UI", task_description: "..." })
// Spawn agents with ui.path; they cd there and work
// ...
await knit_finalize_team_worktree({ team_name: "UI", action: "merge" })
```

**Merge conflicts surface cleanly** — `knit_finalize_team_worktree` with `action: "merge"` returns `{status: "conflict", conflict_files: [...]}` without destroying the worktree. Resolve manually, then call again.

Compatible with Claude Code's `EnterWorktree({path})` — knit's worktrees register via native `git worktree add`, so any session can switch into one.

## Token accounting

`knit_brain_status` answers the only question that matters: is knit saving more than it costs?

**v0.9 structured token-budget surface:**

```json
{
  "token_budget": {
    "budgets": {
      "claude_md":            { "bytes": 2048,  "target_bytes": 6500,  "verdict": "healthy" },
      "tool_registry":        { "bytes": 8400,  "target_bytes": 8500,  "verdict": "healthy", "active_tool_count": 31, "total_tool_count": 43 },
      "instructions":         { "bytes": 2200,  "target_bytes": 2500,  "verdict": "healthy" },
      "per_session_overhead": { "bytes": 12648, "target_bytes": 17500, "verdict": "healthy" }
    },
    "overall_verdict": "healthy",
    "compounding": {
      "session_count": 12,
      "total_learnings": 18,
      "learnings_hit_rate_pct": 67,
      "note": "Strong compounding — learnings are getting reused across sessions."
    }
  },
  "update_available": {
    "current": "0.8.0",
    "latest":  "0.9.0",
    "upgrade": "Restart Claude Code to spawn a fresh MCP — npx will auto-fetch the new version."
  }
}
```

Each surface (CLAUDE.md, tool registry, instructions, total) gets `healthy / warn / over-budget` against the v0.9 ship promise — drift becomes a regression test, not a vibes claim. Pair with `knit_compounding_metrics` for the value side of the ledger (sessions, hit rate, estimated tokens saved by skipped re-investigations).

## CLI

```bash
knit setup       # One time: add MCP to Claude settings
knit status      # Dashboard: sessions, learnings, hit rate, knowledge health
knit refresh     # Force rebuild knowledge brain
```

Example `knit status` output:

```
Knowledge Index
  Files:        54 indexed (11,495 lines)
  Imports:      46 edges mapped
  Untested:     5 files

Knowledge Base
  Learnings:      18 total
  Accessed:       12 (67% hit rate)
  False positives: 3

Token budget (v0.9)
  CLAUDE.md:           2.0 KB  → healthy
  Tool registry:       8.4 KB  → healthy (31 active / 43 total)
  Instructions:        2.2 KB  → healthy
  Per-session total:   12.6 KB → healthy

Compounding
  Sessions logged:     14
  Reuse ratio:         67%  → strong
  Tokens saved (est.): 65,000
```

## How it's different

|  | gstack (skills) | ECC (agents) | Ruflo (orchestration) | Knit |
|--|---|---|---|---|
| Bet | Slash-command flows | Agent rules | 100+ agents in swarms | One disciplined agent, compounding memory |
| Setup | Install skills per-project | Manual `.claude/` setup | `npx ruflo init` (heavy) | `npx knit-mcp setup` (light) |
| Memory | jsonl files in-tree | Memory directory | Vector DB (ruvector) + 4-tier consolidation | `~/.knit/projects/<hash>/` — local, searchable, **vectorless BM25 + graph fusion** |
| Token cost | Skills loaded into context | Rules loaded into context | 314 tools advertised | ~2 KB CLAUDE.md, tier-gated registry, lazy responses, **token-budget guardrail** |
| Parallel work | None | None | Multi-agent swarms + federation | Team-scoped git worktrees |
| Cloud dependency | None | None | Cognitum.One (cloud backbone) | None — fully local |
| Self-measurement | None | None | Cost-tracker plugin | `knit_brain_status.token_budget` + `knit_compounding_metrics` |
| Anti-hallucination | None | None | None advertised | `knit_verify_claim` + citation rule + pre/post import validation hooks |
| Non-code projects | No | No | Limited | Description-driven domains via `knit_setup_project` |

**The bet:** Ruflo for agent quantity (swarms, federation, plugins). Knit for agent quality (memory, classification, token discipline, hallucination defense). Different markets. The integration scanner detects Ruflo when installed and tailors instructions to defer routing to it — Knit operates as the memory + classification substrate underneath.

## Migration from v0.1

If you have an existing project with knit v0.1 data at `<project>/.claude/`, knit v0.2 auto-migrates on the first MCP call:

1. Detects `<project>/.claude/knowledge.json` (or `knowledgebase.json`)
2. Copies all knit data forward to `~/.knit/projects/<hash>/`
3. Writes `<project>/.claude/MIGRATED.txt` breadcrumb explaining where the data went
4. Leaves the old `.claude/` directory intact (delete at your discretion)

No data loss, no dual-writes. Single migration per project.

## Development

```bash
git clone https://github.com/PDgit12/knit.git
cd knit
npm install
npm run dev       # Run CLI locally
npm run test      # 492 tests
npm run typecheck # TypeScript strict mode
npm run build     # Compile CLI + MCP server
```

## Architecture

```
knit (npm package)
├── dist/cli.js                 # CLI: setup, status, refresh
└── dist/mcp/server.js          # MCP server: 43 tools (tier-gated), auto-init

per-project, in ~/.knit/projects/<hash>/
├── knowledge.json              # import graph + exports + test map
├── knowledgebase.json          # learnings + access metrics
├── sessions.jsonl              # session memory, append-only
├── teams.json                  # custom teams
├── worktrees.json              # active team worktree registry
└── learnings/<project>.md      # human-readable learnings

per-project, in <project>/
├── CLAUDE.md                   # ≤150-line thin shape, marker-wrapped
└── .claude/settings.local.json # per-machine hooks, knit-managed (gitignored by convention)
```

Zero external dependencies for the knowledge brain. **492 tests.** Strict-mode TypeScript.

## License

MIT
