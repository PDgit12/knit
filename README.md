<p align="center">
  <img src="https://img.shields.io/npm/v/engram-dev?style=for-the-badge&color=7c3aed" alt="npm version" />
  <img src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge" alt="license" />
  <a href="https://github.com/PDgit12/engram/actions/workflows/ci.yml"><img src="https://github.com/PDgit12/engram/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <img src="https://img.shields.io/badge/MCP_tools-27-06b6d4?style=for-the-badge" alt="tools" />
  <img src="https://img.shields.io/badge/node-%3E%3D18-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="node" />
</p>

<h1 align="center">engram</h1>

<p align="center">
  <strong>An intelligent command layer for Claude Code.</strong>
  <br/>
  Project-scoped memory, on-demand workflow protocol, parallel team worktrees,<br/>
  and honest token accounting — all in one MCP server.
</p>

<br/>

## What engram is

Engram makes Claude Code do the right thing automatically because it can't predict how a user will phrase a request. It does three jobs at once:

- **Memory** — every project keeps a brain at `~/.engram/projects/<hash>/`. Sessions compound: learnings, false positives, session summaries, and a static-analysis import graph are all queryable next session.
- **Tokens** — `CLAUDE.md` is ~100 lines (project facts only). Workflow protocol is fetched on demand via `engram_get_workflow(phase)`. Engram is net-negative on context cost.
- **Workflow** — a 4-tier classification (Inquiry / Trivial / Standard / Complex) with phase-triggered plan mode, quality-gated `LEARN`, and team-scoped git worktrees so parallel agents don't step on each other.

It's a **single product**, not three. Every design choice has to win on memory + tokens + workflow together.

## Setup (one time)

```bash
npx @piyushdua/engram-dev@latest setup
```

Adds the Engram MCP server to your Claude Code config (`~/.claude.json`). No per-project setup. Open Claude Code in any project and the first MCP tool call auto-initializes everything.

## How data is stored

Engram data is centralized — not in every repo's working tree:

```
~/.engram/
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
    └── settings.local.json             ← per-machine hooks (engram-managed; gitignored by convention)
```

The project's own `CLAUDE.md` is wrapped in `<!-- engram:start --> ... <!-- engram:end -->` markers. Engram regenerates only the block between markers — never clobbers anything else you write. If your project already has a `CLAUDE.md` without markers, engram writes a sidecar at `.claude/ENGRAM.md` instead.

Override the data location with `ENGRAM_HOME=/custom/path` (useful for sandboxes and tests).

## Workflow on demand

The protocol is in MCP, not preloaded in every session. CLAUDE.md tells the agent to call `engram_get_workflow(phase)` when it needs the actual procedure. Sections:

```
engram_get_workflow({phase: "research"})    // RESEARCH phase details
engram_get_workflow({phase: "plan"})        // PLAN + plan-mode rules
engram_get_workflow({phase: "execute"})     // EXECUTE + TDD
engram_get_workflow({phase: "optimize"})    // OPTIMIZE + role briefings
engram_get_workflow({phase: "review"})      // REVIEW gates
engram_get_workflow({phase: "learn"})       // LEARN quality gate
engram_get_workflow({phase: "handoff"})     // session handoff
engram_get_workflow({phase: "ship"})        // commit + ship + prod checklist
engram_get_workflow({phase: "tdd"})         // RED → GREEN → REFACTOR
engram_get_workflow({phase: "tools"})       // engram MCP tools reference
```

Plus `overview`, `tier`, `phases`. Call with no `phase` to list all sections.

**Effect:** v0.1's CLAUDE.md was ~700 lines / ~20 KB per session, every session. v0.2's is ~100 lines / ~2.7 KB. Protocol depth pulled only when needed.

## 27 MCP Tools

### Query the brain (read-only, cached, ~5ms)

| Tool | What it does |
|------|--------------|
| `engram_query_imports` | Reverse dependencies for a file. Use before edits. |
| `engram_query_dependents` | What a file imports. |
| `engram_query_exports` | What a file exposes. |
| `engram_query_tests` | Test coverage for a file, or list all untested. |
| `engram_find_fanout` | High-fanout files — the contracts. |
| `engram_search_learnings` | Past lessons by domain tag. |
| `engram_get_false_positives` | Confirmed non-issues to suppress in review. |
| `engram_brain_status` | Brain health + **token accounting**. |
| `engram_search_sessions` | Search past sessions by free text over summary+tags+branch. |
| `engram_load_session` | Call at session start — returns last sessions, handoff, learnings, false positives, teams, project knowledge in one round trip. |

### Update the brain (write — quality-gated)

| Tool | What it does |
|------|--------------|
| `engram_classify_task` | First call on every task. Returns tier, phases, affected domains. |
| `engram_build_context` | Domain context for the current task. |
| `engram_record_learning` | Save a non-obvious insight. Quality check first. |
| `engram_record_false_positive` | Mark a finding as a confirmed non-issue. |
| `engram_save_session_summary` | Opt-in narrative summary of what this session did. |
| `engram_save_handoff` | Save state when context degrades. |
| `engram_setup_project` | Describe a non-code project (legal, marketing, research). |

### Workflow on demand

| Tool | What it does |
|------|--------------|
| `engram_get_workflow` | Fetch protocol depth for one phase. |

### Parallel team worktrees

| Tool | What it does |
|------|--------------|
| `engram_spawn_team_worktree` | Create a git worktree for a team. |
| `engram_list_team_worktrees` | List active team worktrees. |
| `engram_finalize_team_worktree` | Merge or discard a team's worktree. |

### Team review board

| Tool | What it does |
|------|--------------|
| `engram_get_teams` | List auto-detected or custom teams. |
| `engram_define_team` | Create a custom team. |
| `engram_start_team_review` | Start a parallel review with shared findings. |
| `engram_get_team_prompt` | Per-team prompt including other teams' findings. |
| `engram_post_team_findings` | Post findings to the shared board. |
| `engram_get_board_summary` | Cross-team summary, severity-gated. |

> Pattern reflection tools (`engram_reflect`, `engram_get_suggestions`) are deferred to v0.3 — they need ≥10 learnings per project before they surface useful patterns. Re-enabled when projects accumulate that mass.

## Parallel team worktrees

A Complex task gets broken across multiple teams. Each team works in its own git worktree (sibling to the main repo, native `git worktree` convention). Multiple agents within one team share the team's worktree. The orchestrator collects each team's work, runs gates, and merges back.

```
/Users/p/my-repo                          <- main
/Users/p/my-repo-engram-ui-<ts>           <- UI team
/Users/p/my-repo-engram-api-security-<ts> <- API & Security team
```

```js
// Orchestrator workflow
const ui = await engram_spawn_team_worktree({ team_name: "UI", task_description: "..." })
// Spawn agents with ui.path; they cd there and work
// ...
await engram_finalize_team_worktree({ team_name: "UI", action: "merge" })
```

**Merge conflicts surface cleanly** — `engram_finalize_team_worktree` with `action: "merge"` returns `{status: "conflict", conflict_files: [...]}` without destroying the worktree. Resolve manually, then call again.

Compatible with Claude Code's `EnterWorktree({path})` — engram's worktrees register via native `git worktree add`, so any session can switch into one.

## Token accounting

`engram_brain_status` answers the only question that matters: is engram saving more than it costs?

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

Warnings surface when CLAUDE.md > 30 KB (engram is too heavy) or hit rate < 20 % on >10 learnings (most learnings unused — prune).

## CLI

```bash
engram setup       # One time: add MCP to Claude settings
engram status      # Dashboard: sessions, learnings, hit rate, knowledge health
engram refresh     # Force rebuild knowledge brain
```

Example `engram status` output:

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

|  | gstack (skills) | ECC (agents) | Engram |
|--|---|---|---|
| Setup | Install skills per-project | Manual `.claude/` setup | One command. Done forever. |
| Memory | jsonl files in-tree | Memory directory | `~/.engram/projects/<hash>/` — centralized, project-keyed, searchable sessions |
| Token cost | Skills loaded into context | Rules loaded into context | Workflow fetched on-demand. CLAUDE.md is ~2.7 KB. |
| Parallel work | None | None | Team-scoped git worktrees |
| Self-measurement | None | None | `engram_brain_status.token_accounting` |
| Non-code projects | No | No | Description-driven domains via `engram_setup_project` |

## Migration from v0.1

If you have an existing project with engram v0.1 data at `<project>/.claude/`, engram v0.2 auto-migrates on the first MCP call:

1. Detects `<project>/.claude/knowledge.json` (or `knowledgebase.json`)
2. Copies all engram data forward to `~/.engram/projects/<hash>/`
3. Writes `<project>/.claude/MIGRATED.txt` breadcrumb explaining where the data went
4. Leaves the old `.claude/` directory intact (delete at your discretion)

No data loss, no dual-writes. Single migration per project.

## Development

```bash
git clone https://github.com/PDgit12/engram.git
cd engram
npm install
npm run dev       # Run CLI locally
npm run test      # 181 tests
npm run typecheck # TypeScript strict mode
npm run build     # Compile CLI + MCP server
```

## Architecture

```
engram-dev (npm package)
├── dist/cli.js                 # CLI: setup, status, refresh
└── dist/mcp/server.js          # MCP server: 27 tools, auto-init

per-project, in ~/.engram/projects/<hash>/
├── knowledge.json              # import graph + exports + test map
├── knowledgebase.json          # learnings + access metrics
├── sessions.jsonl              # session memory, append-only
├── teams.json                  # custom teams
├── worktrees.json              # active team worktree registry
└── learnings/<project>.md      # human-readable learnings

per-project, in <project>/
├── CLAUDE.md                   # ≤150-line thin shape, marker-wrapped
└── .claude/settings.local.json # per-machine hooks, engram-managed (gitignored by convention)
```

Zero external dependencies for the knowledge brain. 181 tests. Strict-mode TypeScript.

## License

MIT
