<p align="center">
  <img src="https://img.shields.io/badge/engram-v0.1.0-7c3aed?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiPjxwYXRoIGQ9Ik0xMiAyYTEwIDEwIDAgMSAwIDAgMjAgMTAgMTAgMCAwIDAgMC0yMHoiLz48cGF0aCBkPSJNMTIgNnY2bDQgMiIvPjwvc3ZnPg==" alt="version" />
  <img src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge" alt="license" />
  <img src="https://img.shields.io/badge/tests-33_passing-brightgreen?style=for-the-badge" alt="tests" />
  <img src="https://img.shields.io/badge/node-%3E%3D18-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="node" />
</p>

<h1 align="center">engram</h1>

<p align="center">
  <strong>Memory and workflow intelligence for AI coding agents.</strong>
  <br/>
  One command gives Claude Code, Cursor, or Codex compounding project intelligence —<br/>
  what takes weeks to hand-build, installed in 5 minutes.
</p>

<br/>

## The Problem

Every AI coding agent starts with amnesia. Each session re-discovers your codebase, re-makes decisions it already made, and wastes tokens on problems it already solved. You become the memory layer — manually pasting context, re-explaining conventions, watching the same mistakes repeat.

**engram fixes this.** It wires up institutional memory, tiered task routing, and token-optimized workflows so your agent gets smarter with every session instead of resetting.

## Quick Start

```bash
npx engram init
```

That's it. Engram scans your project, detects your stack, and generates:

```
  Created:
    ├─ CLAUDE.md                    # Orchestration protocol + domain architecture
    ├─ .claude/settings.json        # Hooks: typecheck, git safety, build verification
    ├─ .claude/settings.local.json  # Permissions for common tools
    └─ .claude/learnings/project.md # Institutional memory (starts empty, compounds)
```

## What You Get

| Feature | What it does | Token savings |
|---------|-------------|---------------|
| **Tiered task routing** | Classifies tasks as trivial/standard/complex — no agents for simple fixes | ~20-50k/task |
| **Institutional memory** | Tagged learnings file that persists across sessions — agents check before re-investigating | ~10-20k per known issue |
| **False positive suppression** | Agents stop re-reporting known non-issues | ~5k per false positive |
| **Domain Context Object** | Agents get scoped context packets, not the whole codebase | ~10-30k per agent call |
| **LEARN exit gate** | No task completes without updating memory — intelligence compounds | Prevents cold starts |
| **6-phase orchestration** | RESEARCH → IDEATE → PLAN → EXECUTE → OPTIMIZE → REVIEW | Right effort for right task |
| **Destructive git blocking** | Hooks prevent `--force` push and `--no-verify` commits | Prevents disasters |
| **Auto typecheck on edit** | TypeScript projects get instant type feedback after every file change | Catches errors early |
| **Session handoff protocol** | Structured context transfer when sessions degrade | Recovers 100% of context |

**Estimated savings: 100-300k tokens per session** via tier routing + accumulated memory.

## How It Works

### 1. Scan

Engram auto-detects your stack, package manager, and project structure:

- **Languages:** TypeScript, JavaScript, Python, Go, Rust
- **Frameworks:** Next.js, React, Vue, Svelte, Express, FastAPI, Django, Flask
- **Package managers:** npm, yarn, pnpm, bun
- **Test frameworks:** Vitest, Jest, Playwright, pytest, go test

### 2. Generate Domains

Your project files are mapped into domains — the unit of orchestration:

```
┌─────────────────────────────────────────────┐
│            MAIN ORCHESTRATOR                │
│  (classifies tasks, routes to domains)      │
└──────┬────────┬────────┬────────┬─────┬─────┘
       │        │        │        │     │
       ▼        ▼        ▼        ▼     ▼
   ┌──────┐ ┌──────┐ ┌──────┐ ┌─────┐ ┌───┐
   │  UI  │ │ API  │ │Logic │ │Infra│ │ QA│
   │ Head │ │ Head │ │ Head │ │Head │ │Head│
   └──────┘ └──────┘ └──────┘ └─────┘ └───┘
```

Each domain has assigned review agents, file patterns, and cross-domain communication rules.

### 3. Wire Hooks

Automated quality gates run without you thinking about them:

- **On file edit:** TypeScript typecheck
- **On git push:** Blocks destructive operations
- **On session end:** Build verification + session capture to learnings

### 4. Compound Intelligence

The learnings file grows with every task:

```markdown
## 2026-05-15 Fixed auth middleware not running on API routes
**Domain(s):** API & Security, Infrastructure
**Outcome:** success
**Lesson:** Next.js 16 requires middleware.ts in project root with exact export signature
**Tags:** #api #infra #nextjs16 #middleware
```

Next session, the agent checks learnings before re-investigating — and skips the rabbit hole.

## Options

```bash
# Initialize in current directory
npx engram init

# Initialize in a specific directory
npx engram init ./my-project

# Specify project name
npx engram init --name "My SaaS"

# Target a different agent (coming soon)
npx engram init --agent cursor

# Overwrite existing setup
npx engram init --force
```

## Supported Agents

| Agent | Status |
|-------|--------|
| Claude Code | **Supported** — full hook + settings + CLAUDE.md integration |
| Cursor | Coming in v0.3 |
| OpenAI Codex | Coming in v0.3 |

## Philosophy

This tool was extracted from a production workflow that saved **100-300k tokens per session** on a real project. The principles:

1. **Agents should get smarter, not reset.** Every session should build on the last.
2. **Right effort for the right task.** A typo fix doesn't need 5 parallel review agents.
3. **Memory is the moat.** The longer you use it, the harder it is to switch — because your accumulated intelligence lives in the project.
4. **Conventions over configuration.** Sensible defaults that work out of the box. Customize after.

## Development

```bash
git clone https://github.com/piyushdua/engram.git
cd engram
npm install
npm run dev          # Run CLI locally
npm run test         # 33 tests
npm run typecheck    # TypeScript strict mode
npm run build        # Compile to dist/
```

## Roadmap

- [x] **v0.1** — `init` command with stack detection, domain mapping, hooks, learnings
- [ ] **v0.2** — `status` command (learnings count, domain coverage, token savings dashboard)
- [ ] **v0.2** — `learn` command (interactive learning entry creation)
- [ ] **v0.3** — Cursor adapter (generate `.cursorrules` + memory format)
- [ ] **v0.3** — Codex adapter (generate `codex.md` + memory format)
- [ ] **v0.4** — Cloud sync (learnings across machines and teams)
- [ ] **v0.5** — Analytics dashboard (token savings, learning velocity, team patterns)

## License

MIT
