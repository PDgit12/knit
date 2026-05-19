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

## What's new in v0.7.0

- **Universal protocol injection.** Knit sets the MCP server-level `instructions` field, so every MCP client (Claude Code, Cursor, Codex) sees Knit's flow at session start — *before* tool descriptions. Session 1 follows the protocol instead of stumbling onto it.
- **Tier-gated tool surface.** 38 tools split into three tiers: Tier 1 (26 universal — memory, knowledge graph, workflow, classification, false-positive suppression, reflection, Protocol Guard config, diagnostics) is always exposed. Tier 2 (team worktrees, subagent installer) auto-activates when the project shape matches (≥3 detected domains, `.claude/agents/` exists) or via explicit opt-in. Tier 3 (admin/setup) is opt-in only. Solo-domain projects no longer see 9 team-worktree tools cluttering their decision space.
- **`knit_list_features`** is the discoverability escape hatch — always available, always tells you what's hidden and exactly how to enable it (`knit_enable_feature({feature: "teams" | "subagents" | "admin"})`). Persisted to `~/.knit/projects/<hash>/features.json` so the choice survives sessions.
- **Inquiry tier in the classifier.** Read-only "what / where / audit / explain" tasks now route to `tier: "inquiry"` with no plan mode and no phases — fixes a long-standing over-routing bug where audit-style questions hijacked Complex.
- **CLAUDE.md cut ~88%** (16.7 KB → ~2 KB on typical projects). The per-turn context tax dropped sharply; all project-specific content (header, project map, domain architecture, build gates, false positives) stays intact.
- **Lazy / minimal response modes.** `knit_load_session` returns the lean core by default; opt into more via `include=patterns,teams,metrics,recent_sessions,full_learnings,full_knowledge,all`. `knit_classify_task` returns the minimal shape by default; pass `verbose=true` for the diagnostic fields.
- **Legacy CLAUDE.md migration.** Users upgrading from v0.5.x with `<!-- engram:start -->/<!-- engram:end -->` markers are auto-migrated — the legacy block is replaced cleanly with the new lean block instead of leaving an orphan.

### Per-session token-budget table

| Surface | v0.6.5 | v0.7.0 | Cut |
|---|---|---|---|
| CLAUDE.md per-turn | ~16.7 KB | ~2 KB | 88% |
| Tool registry (typical project) | ~6–8 KB | ~3–4 KB | ~50% |
| `knit_classify_task` response | ~500 tok | ~150 tok | 70% |
| `knit_load_session` response | ~3–5 KB | ~1.5 KB | ~60% |

### Upgrade note

After running `npx knit-mcp@latest setup` (or just updating the version pin), **restart Claude Code**. The MCP server's `instructions` field and tier-gated `tools/list` only flow into the system prompt at handshake — the cached process from before the upgrade keeps the v0.6.5 behavior until restart.

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

## 35 MCP Tools

### Query the brain (read-only, cached, ~5ms)

| Tool | What it does |
|------|--------------|
| `knit_query_imports` | Reverse dependencies for a file. Use before edits. |
| `knit_query_dependents` | What a file imports. |
| `knit_query_exports` | What a file exposes. |
| `knit_query_tests` | Test coverage for a file, or list all untested. |
| `knit_find_fanout` | High-fanout files — the contracts. |
| `knit_search_learnings` | Past lessons by domain tag. |
| `knit_get_false_positives` | Confirmed non-issues to suppress in review. |
| `knit_brain_status` | Brain health + **token accounting**. |
| `knit_search_sessions` | Search past sessions by free text over summary+tags+branch. |
| `knit_load_session` | Call at session start — returns last sessions, handoff, learnings, false positives, teams, project knowledge in one round trip. |

### Update the brain (write — quality-gated)

| Tool | What it does |
|------|--------------|
| `knit_classify_task` | First call on every task. Returns tier, phases, affected domains. |
| `knit_build_context` | Domain context for the current task. |
| `knit_record_learning` | Save a non-obvious insight. Quality check first. |
| `knit_record_false_positive` | Mark a finding as a confirmed non-issue. |
| `knit_save_session_summary` | Opt-in narrative summary of what this session did. |
| `knit_save_handoff` | Save state when context degrades. |
| `knit_setup_project` | Describe a non-code project (legal, marketing, research). |
| `knit_prune_sessions` | Prune sessions.jsonl by age — keep recent N or drop entries older than N days. |
| `knit_install_agent` | Install a single VoltAgent subagent (e.g. `typescript-pro`) into `.claude/agents/`. |

### Protocol Guard (v0.5.0+)

Runtime enforcement of the knit protocol via PreToolUse and SessionStart hooks. Default strictness: `warn`.

| Tool | What it does |
|------|--------------|
| `knit_set_protocol_strictness` | Set strictness: `off` (no checks), `warn` (reminder), `block` (hard-fail Edit/Write without prior `knit_classify_task`). |
| `knit_get_protocol_strictness` | Read current strictness level for this project. |

### Workflow on demand

| Tool | What it does |
|------|--------------|
| `knit_get_workflow` | Fetch protocol depth for one phase. |

### Parallel team worktrees

| Tool | What it does |
|------|--------------|
| `knit_spawn_team_worktree` | Create a git worktree for a team. |
| `knit_list_team_worktrees` | List active team worktrees. |
| `knit_finalize_team_worktree` | Merge or discard a team's worktree. |

### Team review board

| Tool | What it does |
|------|--------------|
| `knit_get_teams` | List auto-detected or custom teams. |
| `knit_define_team` | Create a custom team. |
| `knit_start_team_review` | Start a parallel review with shared findings. |
| `knit_get_team_prompt` | Per-team prompt including other teams' findings. |
| `knit_post_team_findings` | Post findings to the shared board. |
| `knit_get_board_summary` | Cross-team summary, severity-gated. |

### Cross-project learnings (Model C, opt-in)

| Tool | What it does |
|------|--------------|
| `knit_record_global_learning` | Opt-in: save an insight to `~/.knit/global/learnings.jsonl` when it generalizes beyond this project. |
| `knit_search_global_learnings` | Free-text search across **all** of your projects' shared learnings. |
| `knit_reflect` | Detect patterns across recorded learnings. Useful with ≥3 entries (which Model C makes easy to reach). |
| `knit_get_suggestions` | Adaptive suggestions for the current task based on past patterns in given domains. |

Per-project `knit_record_learning` stays primary. The global pool is for the lessons that travel between projects — "Stripe signature rules", "GitHub API pagination quirks", "Redis cluster failover behavior" — the kind of thing future-you will be glad you wrote down once, somewhere.

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

```json
{
  "token_accounting": {
    "claude_md_kb": 2.7,
    "session_count": 12,
    "learnings_hit_rate_pct": 67,
    "note": "Healthy."
  }
}
```

Warnings surface when CLAUDE.md > 30 KB (knit is too heavy) or hit rate < 20 % on >10 learnings (most learnings unused — prune).

## CLI

```bash
knit setup       # One time: add MCP to Claude settings
knit status      # Dashboard: sessions, learnings, hit rate, knowledge health
knit refresh     # Force rebuild knowledge brain
```

Example `knit status` output:

```
Knowledge Index
  Files:        47 indexed (12,340 lines)
  Imports:      23 edges mapped
  Untested:     8 files

Knowledge Base
  Learnings:      12 total
  Accessed:        8 (67% hit rate)
  False positives: 3

Token accounting
  CLAUDE.md:       2.7 KB
  Sessions logged: 14
  Hit rate:        67% → Healthy
```

## How it's different

|  | gstack (skills) | ECC (agents) | Knit |
|--|---|---|---|
| Setup | Install skills per-project | Manual `.claude/` setup | One command. Done forever. |
| Memory | jsonl files in-tree | Memory directory | `~/.knit/projects/<hash>/` — centralized, project-keyed, searchable sessions |
| Token cost | Skills loaded into context | Rules loaded into context | Workflow fetched on-demand. CLAUDE.md is ~2.7 KB. |
| Parallel work | None | None | Team-scoped git worktrees |
| Self-measurement | None | None | `knit_brain_status.token_accounting` |
| Non-code projects | No | No | Description-driven domains via `knit_setup_project` |

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
npm run test      # 295 tests
npm run typecheck # TypeScript strict mode
npm run build     # Compile CLI + MCP server
```

## Architecture

```
knit (npm package)
├── dist/cli.js                 # CLI: setup, status, refresh
└── dist/mcp/server.js          # MCP server: 27 tools, auto-init

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

Zero external dependencies for the knowledge brain. 295 tests. Strict-mode TypeScript.

## License

MIT
