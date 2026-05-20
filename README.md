<p align="center">
  <a href="https://www.npmjs.com/package/knit-mcp"><img src="https://img.shields.io/npm/v/knit-mcp?style=for-the-badge&color=7c3aed&label=npm" alt="npm version" /></a>
  <a href="https://github.com/PDgit12/knit/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/PDgit12/knit/ci.yml?style=for-the-badge&label=CI&color=10b981" alt="CI" /></a>
  <img src="https://img.shields.io/badge/license-MIT-3b82f6?style=for-the-badge" alt="license" />
  <img src="https://img.shields.io/badge/node-%E2%89%A518-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="node" />
  <img src="https://img.shields.io/badge/tests-492%20passing-22c55e?style=for-the-badge" alt="tests" />
  <img src="https://img.shields.io/badge/MCP%20tools-43-7c3aed?style=for-the-badge" alt="tools" />
</p>

<h1 align="center">🧶 knit</h1>

<p align="center">
  <strong>An intelligent command layer for Claude Code.</strong><br/>
  Project-scoped memory · on-demand workflow · parallel team worktrees · honest token accounting.<br/>
  <em>All in one MCP server.</em>
</p>

<p align="center">
  <a href="#-quick-start">Quick start</a> ·
  <a href="#-what-knit-is">What it is</a> ·
  <a href="#-whats-new-in-v090">v0.9</a> ·
  <a href="#-43-mcp-tools">Tools</a> ·
  <a href="#-how-its-different">Comparison</a>
</p>

---

## 🧠 What knit is

Knit makes Claude Code do the right thing automatically — because you can't predict how a user will phrase a request. It does three jobs at once:

| | |
|---|---|
| 🧠 **Memory** | Every project keeps a brain at `~/.knit/projects/<hash>/`. Sessions compound: learnings, false positives, session summaries, and a static-analysis import graph are all queryable next session. |
| 🪶 **Tokens** | `CLAUDE.md` is ~2 KB (project facts only). Protocol depth is fetched on demand via `knit_get_workflow(phase)`. Knit is **net-negative** on context cost. |
| 🛠️ **Workflow** | A 4-tier classification (Inquiry / Trivial / Standard / Complex) with phase-triggered plan mode, quality-gated `LEARN`, and team-scoped git worktrees so parallel agents don't step on each other. |

It's a **single product**, not three. Every design choice has to win on memory + tokens + workflow together.

---

## 🚀 Quick start

```bash
npx knit-mcp@latest setup
```

Adds the Knit MCP server to your Claude Code config (`~/.claude.json`). **No per-project setup.** Open Claude Code in any project — the first MCP tool call auto-initializes the brain, hooks, and per-project CLAUDE.md block.

> **Supported shells:** macOS, Linux, WSL, Git Bash, PowerShell. Windows `cmd.exe` is not supported as the hook-runner shell — use PowerShell (default in modern Windows Terminal) or Git Bash.

### Quiet mode

Knit ships **Protocol Guard in `warn` mode by default** — hooks print reminders, they never block. Fully silent:

```js
knit_set_protocol_strictness({ level: "off" })
```

### Uninstall in 30 seconds

```bash
rm -rf ~/.knit                                 # all per-project + global memory
```

Then:
1. Remove `"knit-brain"` from `mcpServers` in `~/.claude.json`
2. Delete the `<!-- knit:start --> ... <!-- knit:end -->` block from each project's `CLAUDE.md`
3. Remove `_knitOwned` entries from each project's `.claude/settings.local.json`

Knit writes nowhere else on your machine.

---

## ✨ What's new in v0.9.0

v0.9 closes the **enforcement story** — every honest limit from the v0.8 architecture got a structural fix.

### Anti-hallucination

- 📎 **Citation rule in the MCP `instructions` field.** Every session's system prompt now tells the agent: *"when you state a fact about this codebase, cite the Knit tool result that verified it — e.g. (per `knit_query_imports`). If you can't cite, say 'unverified' explicitly."* Makes hallucinations visible at the **claim level**.
- 🔍 **`knit_verify_claim` tool.** Single-call fact-check against the knowledge graph. Parses *"A imports B"*, *"X exports Y"*, *"A is tested by B"*, *"X exists"* and returns `verified | contradicted | unparseable` with evidence.

### Smarter retrieval

- ⚡ **Auto-search inside `knit_classify_task`.** For `standard` / `complex` tier, classify now runs BM25 over (description + affected domains) automatically and embeds top-3 hits as `pre_emptive_learnings`. Closes the *"agent skipped `knit_search_learnings` before re-investigating"* gap with **zero extra calls**.
- 📚 **`suggested_reads` from `knit_build_context`.** Curated list of files worth opening *before* editing — three signals: graph-importers (blast radius), graph-imports (likely needed), memory-mentions (files referenced by past learnings). Each entry carries `{ path, reason, via }`.
- 🪜 **`knit_get_learning` — hierarchical retrieval.** Search returns headlines (summary + tags); the agent expands a specific learning by id only when needed. **Pay-per-detail.**
- 🧮 **`knit_consolidate_learnings`.** Tag-Jaccard clustering of similar learnings → one pattern entry per cluster. Dry-run by default; `commit=true` persists with originals tagged `#consolidated` (preserved but deprioritized).

### Hook-level enforcement (`HOOKS_VERSION` 6 → 7)

| Hook | What it does |
|---|---|
| **PreToolUse search-gate** | For `standard`/`complex` tasks, blocks Edit/Write (in `block` mode) or warns (default `warn`) when `knit_search_learnings` hasn't fired in the current turn. |
| **PreToolUse content inspection** | Reads proposed Edit/Write content, parses local imports, warns on relative paths that don't resolve on disk — **catches hallucinated imports before they land**. |
| **PostToolUse import validation** | After the file lands, re-parses imports and warns about unresolved relative paths — catches anything that slipped past the pre-check. |
| **Stop-hook budget watch** | Cheap CLAUDE.md size check at session end; warns if it crosses the 12.5 KB over-budget threshold. Drift becomes visible even when the agent doesn't call `knit_brain_status`. |

> **Upgrade note.** After `npx knit-mcp@latest setup`, **restart Claude Code**. The `instructions` field and tier-gated `tools/list` only flow into the system prompt at handshake. The `HOOKS_VERSION` bump auto-regenerates installed hooks on the next brain load — no manual `knit refresh` needed.

---

## 📉 Token budget — measured, not vibes

| Surface | v0.6.5 | v0.9.0 | Cut |
|---|---|---|---|
| CLAUDE.md per-turn | ~16.7 KB | **~2 KB** | **88%** |
| Tool registry (typical project) | ~6–8 KB | **~3–4 KB** | ~50% |
| `knit_classify_task` response | ~500 tok | **~150 tok** | 70% |
| `knit_load_session` response | ~3–5 KB | **~1.5 KB** | ~60% |

Each surface gets a `healthy | warn | over-budget` verdict from `knit_brain_status.token_budget`. **Drift is a regression test, not a vibes claim.**

---

## 🛠️ 43 MCP Tools

<details open>
<summary><strong>🕸️ Knowledge graph</strong> <em>(Tier 1, ~5ms)</em></summary>

| Tool | What it does |
|---|---|
| `knit_query_imports` | Reverse dependencies — who imports this file. |
| `knit_query_dependents` | Forward dependencies — what this file imports. |
| `knit_query_exports` | Functions / classes / interfaces / types this file exposes. |
| `knit_query_tests` | Test coverage for a file, or list all untested with `filter=untested`. |
| `knit_find_fanout` | High-fanout files — the contracts to change carefully. |
| `knit_verify_claim` | **v0.9.** Fact-check one claim against the graph — `verified \| contradicted \| unparseable` with evidence. |

</details>

<details open>
<summary><strong>📚 Memory + retrieval</strong> <em>(Tier 1)</em></summary>

| Tool | What it does |
|---|---|
| `knit_load_session` | Call at session start — returns handoff, top learnings, false positives, project knowledge. Lazy by default; opt in via `include=patterns,teams,metrics,recent_sessions,full_learnings,full_knowledge,all`. |
| `knit_search_learnings` | **v0.8+.** BM25 + import-graph hybrid. `query=text` for BM25, `domains=#tag` for tag filter, `files=src/a.ts` for graph-neighborhood boost. Fused via RRF (k=60). |
| `knit_search_sessions` | BM25 over session summaries + branch + commits + tags. Branch-diversified (max 2 per branch) — one feature branch can't flood. |
| `knit_search_global_learnings` | BM25 across the cross-project pool at `~/.knit/global/learnings.jsonl`. |
| `knit_get_learning` | **v0.9.** Fetch one full learning by id. Pair with search (headlines) for hierarchical retrieval. |
| `knit_record_learning` | Save a non-obvious insight. Quality check first; secret patterns redacted before persistence. |
| `knit_record_global_learning` | Opt-in: cross-project pool when the insight generalizes beyond this project. |
| `knit_record_false_positive` | Mark a finding as confirmed non-issue so future reviewers don't re-flag it. |
| `knit_get_false_positives` | List confirmed non-issues to suppress in review prompts. |
| `knit_save_session_summary` | Opt-in narrative — record only when this session accomplished something a future session would search for. |
| `knit_save_handoff` | Save state when context degrades. `failed_attempts` is the load-bearing field. |
| `knit_consolidate_learnings` | **v0.9.** Cluster similar learnings via tag-Jaccard → one pattern entry per cluster. Dry-run by default. |

</details>

<details>
<summary><strong>🧭 Workflow + classification</strong> <em>(Tier 1)</em></summary>

| Tool | What it does |
|---|---|
| `knit_classify_task` | First call on every task. Returns tier (`inquiry \| trivial \| standard \| complex`), phases, `auto_plan_mode`. **v0.9.** For standard/complex, auto-runs BM25 and embeds top-3 hits as `pre_emptive_learnings`. |
| `knit_build_context` | Domain context for the current task. **v0.9.** Includes `suggested_reads` — files worth opening (graph-importers, graph-imports, memory-mentions). |
| `knit_get_workflow` | Fetch protocol depth for one phase on demand. Sections: `overview, tier, phases, research, ideate, plan, execute, optimize, review, tdd, learn, handoff, ship, tools`. |
| `knit_get_suggestions` | Adaptive warnings from past patterns in given domains. |
| `knit_reflect` | Detect patterns across recorded learnings (per-project + global pool). Useful with ≥3 entries. |
| `knit_setup_project` | Describe a non-code project (legal, marketing, research) to bootstrap domain teams. |
| `knit_prune_sessions` | Prune `sessions.jsonl` by age (default 90 days). Atomic rewrite. |

</details>

<details>
<summary><strong>🛡️ Protocol Guard</strong> <em>(Tier 1)</em></summary>

Runtime enforcement of the Knit protocol via PreToolUse and SessionStart hooks. Default strictness: `warn`.

| Tool | What it does |
|---|---|
| `knit_set_protocol_strictness` | Set strictness: `off` (no checks), `warn` (reminder, default), `block` (hard-fail Edit/Write without prior `knit_classify_task` AND `knit_search_learnings`). |
| `knit_get_protocol_strictness` | Read current strictness level. |

</details>

<details>
<summary><strong>📊 Discoverability + diagnostics</strong> <em>(Tier 1)</em></summary>

| Tool | What it does |
|---|---|
| `knit_brain_status` | Brain health + **token-budget** verdicts per surface + `update_available` notification + integrations summary. |
| `knit_list_features` | Surfaces hidden tools and tells you how to enable them. The escape hatch. |
| `knit_enable_feature` | Flip on a Tier-2/3 feature (`teams`, `subagents`, `admin`). Emits `notifications/tools/list_changed` — new tools appear without a Claude Code restart. |
| `knit_disable_feature` | Symmetric to enable. |
| `knit_scan_integrations` | Re-detect existing workflow frameworks (Ruflo, gstack, CodeTour, Conductor, other MCP servers, custom CLAUDE.md sections). |
| `knit_compounding_metrics` | Quantifies *"Knit gets cheaper over time"* — sessions, cache hits, reuse-ratio %, estimated tokens saved. Verdict: `cold \| warming \| compounding \| strong`. |

</details>

<details>
<summary><strong>👥 Parallel team worktrees</strong> <em>(Tier 2 — auto-active with ≥3 domains)</em></summary>

| Tool | What it does |
|---|---|
| `knit_spawn_team_worktree` | Create a git worktree for a team so they can write in parallel without colliding. |
| `knit_list_team_worktrees` | List active team worktrees. |
| `knit_finalize_team_worktree` | Merge or discard a team's worktree; surfaces conflicts without destroying it. |
| `knit_get_teams` | List auto-detected or custom teams. |
| `knit_define_team` | Create a custom team. |
| `knit_start_team_review` | Start a parallel review with a shared findings board. |
| `knit_get_team_prompt` | Per-team prompt including other teams' findings. |
| `knit_post_team_findings` | Post findings to the shared board. |
| `knit_get_board_summary` | Cross-team summary, severity-gated. |

</details>

<details>
<summary><strong>🤖 Subagents</strong> <em>(Tier 2 — auto-active when `.claude/agents/` exists)</em></summary>

| Tool | What it does |
|---|---|
| `knit_install_agent` | Install a VoltAgent subagent (e.g. `typescript-pro`) into `.claude/agents/knit-<name>.md`, personalized with project context. |

</details>

<details>
<summary><strong>⚙️ Admin</strong> <em>(Tier 3 — opt-in only)</em></summary>

| Tool | What it does |
|---|---|
| `knit_setup_project` | Bootstrap domain teams for a non-code project. One-time. |

</details>

> The **cross-project pool** (`knit_search_global_learnings` + `knit_record_global_learning`) holds the lessons that travel between projects — *"Stripe signature rules", "GitHub API pagination quirks", "Redis cluster failover behavior"* — the kind of thing future-you will be glad you wrote down once, somewhere.

---

## 💾 How data is stored

Knit data is **centralized** — not in every repo's working tree:

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

The project's own `CLAUDE.md` is wrapped in `<!-- knit:start --> ... <!-- knit:end -->` markers. Knit regenerates **only** the block between markers — never clobbers anything else. If your project already has a `CLAUDE.md` without markers, knit writes a sidecar at `.claude/KNIT.md` instead.

Override the data location with `KNIT_HOME=/custom/path` (useful for sandboxes and tests).

---

## 🧩 Workflow on demand

The protocol is in MCP, **not preloaded** in every session. CLAUDE.md tells the agent to call `knit_get_workflow(phase)` when it needs the actual procedure:

```js
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

> **Effect:** v0.1's CLAUDE.md was ~700 lines / ~20 KB per session. v0.9's is ~100 lines / ~2 KB. **Protocol depth pulled only when needed.**

---

## 🌳 Parallel team worktrees

A Complex task gets broken across multiple teams. Each team works in its own git worktree (sibling to the main repo, native `git worktree` convention). Multiple agents within one team share the team's worktree. The orchestrator collects each team's work, runs gates, and merges back.

```
/Users/p/my-repo                          ← main
/Users/p/my-repo-knit-ui-<ts>             ← UI team
/Users/p/my-repo-knit-api-security-<ts>   ← API & Security team
```

```js
const ui = await knit_spawn_team_worktree({ team_name: "UI", task_description: "..." })
// Spawn agents with ui.path; they cd there and work
await knit_finalize_team_worktree({ team_name: "UI", action: "merge" })
```

**Merge conflicts surface cleanly** — `knit_finalize_team_worktree` with `action: "merge"` returns `{status: "conflict", conflict_files: [...]}` without destroying the worktree. Resolve manually, then call again.

Compatible with Claude Code's `EnterWorktree({path})` — knit's worktrees register via native `git worktree add`, so any session can switch into one.

---

## 🧬 Subagents — VoltAgent + project personalization

On first MCP call, knit installs **personalized subagents** into `<project>/.claude/agents/knit-<name>.md`. Each agent has:

1. **The VoltAgent base** — the curated system prompt from [github.com/VoltAgent/awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents) (MIT, 131+ agents). Knit bundles the 6 most common (`code-reviewer`, `security-engineer`, `qa-expert`, `typescript-pro`, `python-pro`, `golang-pro`) so they install with zero network. Specialized agents fetch at a pinned SHA the first time knit needs them.
2. **A knit context block** appended at the end with project name, stack, high-fanout files, recent relevant learnings, false positives to suppress, and the knit MCP tools the agent can call.

**Never clobbers user-curated agents.** If you have your own `typescript-pro.md`, knit writes `knit-typescript-pro.md` alongside it. Different filename, no conflict.

```bash
knit install-agents              # install agents this project's teams need
knit install-agents --all        # install every known agent
knit install-agents --refresh    # re-fetch from network even if cached
```

`KNIT_OFFLINE=1` disables network fetches (bundled-core still works). `KNIT_AGENT_REGISTRY_REF=main` overrides the pinned SHA.

---

## 💰 Token accounting

`knit_brain_status` answers the only question that matters: **is knit saving more than it costs?**

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

Pair with `knit_compounding_metrics` for the value side of the ledger (sessions, hit rate, estimated tokens saved by skipped re-investigations).

---

## 💻 CLI

```bash
knit setup       # one time: add MCP to Claude settings
knit status      # dashboard: sessions, learnings, hit rate, knowledge health
knit refresh     # force rebuild knowledge brain
```

Example `knit status`:

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

---

## 🆚 How it's different

|  | gstack (skills) | ECC (agents) | Ruflo (orchestration) | **Knit** |
|--|---|---|---|---|
| **Bet** | Slash-command flows | Agent rules | 100+ agents in swarms | **One disciplined agent, compounding memory** |
| **Setup** | Install skills per-project | Manual `.claude/` setup | `npx ruflo init` (heavy) | **`npx knit-mcp setup` (light)** |
| **Memory** | jsonl files in-tree | Memory directory | Vector DB + 4-tier consolidation | **Local, searchable, vectorless BM25 + graph fusion** |
| **Token cost** | Skills loaded into context | Rules loaded into context | 314 tools advertised | **~2 KB CLAUDE.md, tier-gated registry, budget guardrail** |
| **Parallel work** | None | None | Multi-agent swarms + federation | **Team-scoped git worktrees** |
| **Cloud dependency** | None | None | Cognitum.One (cloud backbone) | **None — fully local** |
| **Self-measurement** | None | None | Cost-tracker plugin | **`knit_brain_status.token_budget` + `knit_compounding_metrics`** |
| **Anti-hallucination** | None | None | None advertised | **`knit_verify_claim` + citation rule + pre/post import validation** |
| **Non-code projects** | No | No | Limited | **Description-driven via `knit_setup_project`** |

**The bet:** Ruflo for agent quantity (swarms, federation, plugins). Knit for **agent quality** (memory, classification, token discipline, hallucination defense). Different markets. The integration scanner detects Ruflo when installed and tailors instructions to defer routing to it — Knit operates as the memory + classification substrate underneath.

---

## 📜 Release history

| Version | Headline |
|---|---|
| **v0.9.0** | Hook-level enforcement · citation rule · `knit_verify_claim` · auto-search in classify · `suggested_reads` · `knit_get_learning` · `knit_consolidate_learnings`. |
| **v0.8.x** | Vectorless RAG (BM25 + RRF) · graph-traversal retriever · per-project instruction tailoring · `knit_compounding_metrics` · integration scanner. |
| **v0.7.x** | Universal protocol injection via MCP `instructions` · tier-gated tool surface · `knit_list_features` · Inquiry classification tier · CLAUDE.md cut 88% · lazy response modes · token-budget guardrail · legacy migration. |
| **v0.5.x** | Protocol Guard — runtime enforcement via hooks (off / warn / block). |
| **v0.4.x** | VoltAgent subagent integration · personalization layer · `engram install-agents` CLI · hybrid hook merging · `export obsidian`. |
| **v0.3.x** | Centralized data at `~/.knit/projects/<hash>/` · marker-wrapped CLAUDE.md · on-demand workflow · cross-project learnings pool. |

---

## 🔄 Migration from v0.1

If you have an existing project with knit v0.1 data at `<project>/.claude/`, knit auto-migrates on the first MCP call:

1. Detects `<project>/.claude/knowledge.json` (or `knowledgebase.json`)
2. Copies all knit data forward to `~/.knit/projects/<hash>/`
3. Writes `<project>/.claude/MIGRATED.txt` breadcrumb explaining where the data went
4. Leaves the old `.claude/` directory intact (delete at your discretion)

**No data loss, no dual-writes.** Single migration per project.

---

## 🛠️ Development

```bash
git clone https://github.com/PDgit12/knit.git
cd knit
npm install
npm run dev        # run CLI locally
npm run test       # 492 tests
npm run typecheck  # TypeScript strict mode
npm run build      # compile CLI + MCP server
```

### Architecture

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
└── .claude/settings.local.json # per-machine hooks, knit-managed
```

**Zero external dependencies for the knowledge brain.** 492 tests. Strict-mode TypeScript.

---

## 📄 License

[MIT](./LICENSE) © 2026 

<p align="center">
  <sub>If knit saved you tokens, <a href="https://github.com/PDgit12/knit">give it a ⭐</a>.</sub>
</p>
