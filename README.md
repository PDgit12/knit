<p align="center">
  <img src="https://img.shields.io/npm/v/engram-dev?style=for-the-badge&color=7c3aed" alt="npm version" />
  <img src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge" alt="license" />
  <a href="https://github.com/PDgit12/engram/actions/workflows/ci.yml"><img src="https://github.com/PDgit12/engram/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <img src="https://img.shields.io/badge/MCP_tools-20-06b6d4?style=for-the-badge" alt="tools" />
  <img src="https://img.shields.io/badge/node-%3E%3D18-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="node" />
</p>

<h1 align="center">engram</h1>

<p align="center">
  <strong>The second brain for Claude Code.</strong>
  <br/>
  An MCP server that gives your agent project intelligence — import graphs, learnings,<br/>
  team orchestration, and a workflow that compounds with every session.
</p>

<br/>

## Setup (one time, 30 seconds)

```bash
npx @piyushdua/engram-dev@latest setup
```

This does ONE thing: adds the Engram MCP server to your Claude Code config (`~/.claude.json`).

No per-project setup. No config files to write. No framework to learn.

## How Data Gets Initialized

You don't initialize anything. The MCP handles everything automatically:

```
Step 1: You open Claude Code in any project
        └─ Claude reads ~/.claude.json → starts engram-dev as MCP subprocess

Step 2: Agent makes first tool call (any of the 20 tools)
        └─ MCP detects: is .claude/knowledge.json here?
           │
           ├─ NO (first time) → Auto-initializes:
           │   • Scans project (detects language, framework, package manager)
           │   • Builds import graph, export map, test coverage mapping
           │   • Generates CLAUDE.md (650+ line workflow protocol)
           │   • Creates .claude/knowledgebase.json (learnings database)
           │   • Creates .claude/learnings/{project}.md (human-readable)
           │   • All in ~1 second. Zero user action.
           │
           └─ YES (returning) → Loads from disk into memory cache
               • All subsequent tool calls: <5ms from cache
               • Learnings from past sessions are available immediately

Step 3: Session ends
        └─ Stop hooks fire automatically:
           • Build verification (typecheck + lint + build)
           • Session state captured to learnings/sessions.md
           • KB metrics updated (totalSessions++)
           • MCP process dies. Cache gone.

Step 4: Next session → repeat from Step 1
        └─ Brain reloads. Learnings persist. Intelligence compounds.
```

**Data stored per project** (in your project directory):
```
your-project/
├── CLAUDE.md                         ← workflow protocol (auto-generated)
└── .claude/
    ├── knowledge.json                ← import graph, exports, test map
    ├── knowledgebase.json            ← learnings + access metrics
    ├── teams.json                    ← custom teams (if defined)
    └── learnings/
        ├── {project-name}.md         ← human-readable learnings
        └── sessions.md              ← session history log
```

All data stays in the project. Nothing shared between projects. Nothing leaves your machine.

## CLI Dashboard

The CLI is for visibility into what the brain knows. Not required for daily use.

```bash
# See brain health, session history, learnings, hit rate
npx @piyushdua/engram-dev status

# Force rebuild after major refactoring
npx @piyushdua/engram-dev refresh

# Re-run setup (fixes config, migrates from old versions)
npx @piyushdua/engram-dev setup
```

Example `status` output:
```
Knowledge Index
  Files:        47 indexed (12,340 lines)
  Imports:      23 edges mapped
  Exports:      31 files with exports
  Untested:     8 files

Knowledge Base
  Learnings:      12 total
  Accessed:       8 (67% hit rate)
  Cache hits:     5 (re-investigations prevented)

Recent Sessions
  Date         Branch               Files   Learnings
  2026-05-16   feature/payments     12      +2
  2026-05-15   main                 5       +1
```

## 20 MCP Tools

### Query the brain (read-only, instant)

| Tool | What the agent asks | Instead of |
|------|-------------------|-----------|
| `engram_query_imports` | "What depends on this file?" | Grepping the whole codebase |
| `engram_query_dependents` | "What does this file need?" | Reading import lines manually |
| `engram_query_exports` | "What does this file expose?" | Reading the entire file |
| `engram_query_tests` | "Is this file tested?" | `find tests/ -name '*.test.*'` |
| `engram_find_fanout` | "Which files are risky to change?" | No equivalent |
| `engram_search_learnings` | "What do we know about auth?" | Reading entire learnings file |
| `engram_get_false_positives` | "What are known non-issues?" | Grepping for #false-positive |
| `engram_brain_status` | "How healthy is the brain?" | No equivalent |

### Update the brain (workflow automation)

| Tool | What it does |
|------|-------------|
| `engram_classify_task` | Classifies trivial/standard/complex, returns phases + auto_plan_mode |
| `engram_build_context` | Assembles Domain Context Object with ripple effects + pitfalls |
| `engram_record_learning` | Persists what was learned (the LEARN phase) |
| `engram_record_false_positive` | Marks non-issues so agents stop re-reporting them |
| `engram_save_handoff` | Saves session state for the next session to pick up |
| `engram_setup_project` | Describes non-code projects (legal, marketing, research) |

### Orchestrate parallel teams

| Tool | What it does |
|------|-------------|
| `engram_get_teams` | Get auto-detected or custom teams for this project |
| `engram_define_team` | Create custom teams (Performance, DevOps, Design...) |
| `engram_start_team_review` | Start parallel review with shared findings board |
| `engram_get_team_prompt` | Get specialized prompt for each team agent |
| `engram_post_team_findings` | Post team findings, visible to other teams |
| `engram_get_board_summary` | Cross-team findings with severity gate |

## The Knowledge Brain

Zero dependencies. Pure Node.js. Auto-built on first use.

```
engram_query_imports("src/lib/types.ts")

-> {
     "imported_by": ["src/api/route.ts", "src/lib/users.ts", "tests/types.test.ts"],
     "count": 3,
     "risk": "MEDIUM - several dependents"
   }
```

What it indexes:
- **Import graph** -- which files depend on which (TS/JS/Python/Go/Rust)
- **Export map** -- functions, classes, interfaces, types with line numbers
- **Test mapping** -- which source files have tests, which don't
- **High-fanout files** -- the contracts that break everything if changed

## Compounding Intelligence

Every task ends with `engram_record_learning`. Next session, `engram_search_learnings` finds it.

```
Session 1: "Always verify Stripe webhook signatures" (recorded)
Session 2: Agent searches #payments -> finds the lesson -> skips the rabbit hole
```

`engram status` shows the metrics:

```
Knowledge Base Health

  Learnings:      47 total
  Accessed:       31 (66% hit rate)
  Never used:     16
  Cache hits:      14 (learnings prevented re-investigation)
  Stale (30d+):    8 candidates for cleanup

  Recent Sessions

  Date         Branch               Files   Learnings
  2026-05-16   feature/payments     12      +2
  2026-05-15   main                 5       +1
```

## Works For Any Project

Not just code. 22 project types with domain-specific teams:

| Type | Domains generated |
|------|------------------|
| TypeScript web | UI, API & Security, Core Logic, Infrastructure, QA |
| Python ML | Core Logic, Quality Assurance (with `python-reviewer`) |
| Go microservice | API & Security, QA (with `go-reviewer`, `go-build-resolver`) |
| Legal review | Document Review, Risk Identification, Compliance, Contract Analysis |
| Stock research | Market Analysis, Risk Assessment, Portfolio Strategy |
| Game dev | Game Design, Level Design, Art Assets, Programming, Playtesting |
| Marketing | Market Research, Content Strategy, Campaign Creation, Analytics |

```bash
# Agent calls this when user describes their project:
engram_setup_project({
  project_type: "legal",
  description: "M&A due diligence for $50M acquisition"
})
# -> Creates 5 domain-specific teams automatically
```

## How It's Different

| | gstack (142 skills) | ECC (53 agents) | Engram |
|--|---|---|---|
| Setup | Install skills, configure per-project | Manual .claude/ setup | One command. Done forever. |
| Architecture | Skill files agent reads | Agent definitions + rules | MCP server agent queries |
| Memory | jsonl files | Memory directory | Structured KB with access tracking + metrics |
| Code analysis | None | None | Import graphs, exports, test mapping |
| Token cost | Skills loaded into context | Rules loaded into context | MCP tools queried on demand (not in context) |
| Non-code projects | No | No | 22 project types |

## CLI Dashboard

```bash
engram setup            # One time: add MCP to Claude settings
engram status           # Analytics: sessions, learnings, hit rate
engram refresh          # Force rebuild knowledge brain
```

## Auto-Generated Workflow

On first use, Engram generates a 650+ line `CLAUDE.md` with:

- **Session Startup** -- step-by-step for new sessions
- **6-Phase Protocol** -- RESEARCH, IDEATE, PLAN, EXECUTE, OPTIMIZE, REVIEW
- **Task Classification** -- trivial/standard/complex with auto plan mode
- **TDD Workflow** -- RED, GREEN, REFACTOR
- **Commit & Ship** -- pre-commit gates, PR flow, branch strategy
- **Production Checklist** -- security, code quality, deployment
- **Effort Scaling** -- honest proxy metrics, not fake token numbers
- **Session Handoff** -- structured context recovery

Plus 6 enforcement hooks that fire automatically:

| Hook | What it does |
|------|-------------|
| PreToolUse | Blocks `git push --force` and `--no-verify` |
| PostToolUse | Runs typecheck after editing TS/Python/Go/Rust files |
| Stop | Build verification (typecheck + lint + build) |
| Stop | Session state capture to learnings |
| Stop | LEARN compliance warning |
| Stop | Knowledge base metrics update |

## Development

```bash
git clone https://github.com/PDgit12/engram.git
cd engram
npm install
npm run dev             # Run CLI locally
npm run test            # 111 tests
npm run typecheck       # TypeScript strict mode
npm run build           # Compile CLI + MCP server
```

## Architecture

```
engram-dev (npm package)
├── dist/cli.js          # CLI: setup, status, refresh
├── dist/mcp/server.js   # MCP server: 20 tools, auto-init
└── (generated per project)
    ├── CLAUDE.md             # 650+ line workflow protocol
    ├── .claude/knowledge.json    # Import graph, exports, test mapping
    ├── .claude/knowledgebase.json # Learnings with access tracking
    └── .claude/learnings/*.md    # Human-readable learnings
```

4,041 lines of TypeScript. Zero external dependencies for the knowledge brain.

## License

MIT
