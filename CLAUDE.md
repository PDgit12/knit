# Knit — Agent Memory & Workflow Intelligence CLI

TypeScript MCP server (npm: `knit-mcp`) that gives any AI coding agent (Claude Code, Cursor, Codex) per-project memory, tier-routed workflow protocol, and parallel team worktrees.

The orchestration protocol, tier classifier, and per-phase depth are fetched on demand via `knit_get_workflow({phase})` and injected at MCP handshake — this file holds only project-specific facts. Release timeline and deferred work live in `.claude/MARKETING.md`.

## Build & Verify

```bash
npm run typecheck    # zero errors required
npm run lint         # zero errors required
npm run test         # all tests must pass
npm run build        # clean compilation
npm run bench        # synthetic 50-Q&A retrieval bench (top-1 ≥ 85% gate)
npm run dev          # local dev — test CLI locally with node dist/cli.js
```

All four gates MUST pass before any commit or PR. The Stop hook runs typecheck + lint + build automatically.

## Domain Architecture

Five domains. Every file belongs to exactly one. Domains are the unit of parallel orchestration via `knit_spawn_team_worktree`.

### Domain 1 — CLI (User Interface)
- **Files:** `src/cli.ts`, `src/commands/*.ts` (`setup`, `status`, `refresh`, `install-agents`, `export`, `doctor`)
- **Head concern:** UX, argument parsing, error messages, progress output, exit codes.

### Domain 2 — Engine (Core Intelligence)
- **Files:** `src/engine/*.ts` — `learnings`, `global-learnings`, `sessions`, `reflect`, `knowledge`, `knowledgebase`, `scanner`, `teams`, `worktrees`, `agent-registry`, `agent-fetcher`, `install-agents`, `paths`, `project-id`, `protocol-guard`, `requirements`, `calibration`, `domain-inference`, `types`.
- **Head concern:** Memory persistence (`~/.knit/projects/<hash>/`), learnings + sessions storage, pattern reflection, team/worktree orchestration, agent registry, BM25 retrieval, self-healing classifier.

### Domain 3 — Generators (Output Templates)
- **Files:** `src/generators/*.ts` — `claude-md`, `settings`, `agent-md`, `workflow-protocol`, `learnings`, `auto-config`.
- **Head concern:** Marker-wrapped output, no hardcoded paths, idiomatic per-framework templates. Output drives what users see on disk.

### Domain 4 — MCP Server (Tool Surface)
- **Files:** `src/mcp/*.ts` — `server`, `handlers`, `tools`, `cache`, `features`, `instructions`, `sanitize`, `update-check`, `notifier`.
- **Head concern:** Tool definitions, request handlers, input redaction, response shape, tier-gating, handshake-time budget verdict. The surface every connected agent talks to.

### Domain 5 — Quality Assurance
- **Files:** `tests/*.ts`, `benchmarks/*.ts`, build configs, lint configs.
- **Head concern:** Coverage ≥ 80%, real exploit tests for security fixes, regression-gated benches.

## Cross-Domain Communication Rules

| Change in | Notify | Why |
|-----------|--------|-----|
| `src/engine/types.ts` | ALL domains | Universal contract (31 dependents) |
| `src/engine/reflect.ts` or `learnings.ts` | MCP + QA | Engine changes ripple to MCP responses + tests |
| `src/generators/*` | MCP + QA | Generator output is invoked by MCP setup tools |
| `src/mcp/tools.ts` | CLI + Engine + QA | New tool → new engine method + handler + test |
| `src/mcp/instructions.ts` | MCP + QA | Surface visible to every agent at handshake |
| New CLI command | CLI + Engine + QA | Needs wiring + engine support + tests |

## Git & Commits

- **Branches:** `feature/<descriptive-name>`, squash merge to main.
- **Pre-merge gates:** `npm run typecheck && npm run lint && npm run test && npm run build`.
- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `release:`.
- Never force-push or rewrite tags. Never bypass hooks (`--no-verify`) unless explicitly authorized.
