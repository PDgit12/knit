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

## One-Time Setup

```bash
npx engram-dev@latest setup
```

That's it. Open any project in Claude Code. The brain activates automatically.

No per-project setup. No config files to write. No framework to learn.

## What Happens

```
You open Claude Code
    |
    v
Engram MCP starts (from your Claude settings)
    |
    v
First tool call -> auto-detects project, builds knowledge brain
    |
    v
Agent has 20 tools: imports, exports, tests, learnings, teams
    |
    v
Brain compounds with every session
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
| Token cost | ~2-5k per skill loaded | ~19k for all rules | ~200 tokens per MCP call |
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
