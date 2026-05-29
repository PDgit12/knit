<p align="center">
  <a href="https://www.npmjs.com/package/knit-mcp"><img src="https://img.shields.io/npm/v/knit-mcp?style=for-the-badge&color=7c3aed&label=npm" alt="npm version" /></a>
  <a href="https://github.com/PDgit12/knit/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/PDgit12/knit/ci.yml?style=for-the-badge&label=CI&color=10b981" alt="CI" /></a>
  <img src="https://img.shields.io/badge/license-MIT-3b82f6?style=for-the-badge" alt="license" />
  <img src="https://img.shields.io/badge/node-%E2%89%A518-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="node" />
  <img src="https://img.shields.io/badge/MCP%20tools-56-7c3aed?style=for-the-badge" alt="tools" />
  <img src="https://img.shields.io/badge/local--first-100%25-3b82f6?style=for-the-badge" alt="local-first" />
</p>

<h1 align="center">🧶 knit</h1>

<p align="center">
  <strong>Universal MCP brain for agentic coding platforms.</strong><br/>
  Project-scoped memory · on-demand workflow · parallel team worktrees · live analytics dashboard.<br/>
  <em>Works with Claude Code, Cursor, Codex CLI, Cline, Continue, and GitHub Copilot (via VS Code Agent mode) — anything that speaks MCP.</em>
</p>

<p align="center">
  <a href="#-quick-start">Quick start</a> ·
  <a href="#-what-knit-is">What it is</a> ·
  <a href="#-how-search-works">How search works</a> ·
  <a href="#-56-mcp-tools">Tools</a> ·
  <a href="#-the-dashboard">Dashboard</a> ·
  <a href="#-why-knit">Why Knit</a>
</p>

---

## 🧠 What Knit is

Knit gives **any MCP-speaking coding agent** the right defaults automatically — because you can't predict how a user will phrase a request, and every agent (Claude Code, Cursor, Codex CLI, Cline, Continue, GitHub Copilot) ends up burning tokens re-discovering the same project facts. Knit does four jobs at once:

| | |
|---|---|
| 🧠 **Memory** | Every project keeps a brain at `~/.knit/projects/<hash>/`. Sessions compound: learnings, false positives, session summaries, and a static-analysis import graph are all queryable next session. Cross-project pool at `~/.knit/global/`. |
| 🪶 **Tokens** | `CLAUDE.md` is ~2 KB (project facts only). Protocol depth is fetched on demand via `knit_get_workflow(phase)`. Per-cache-hit savings ≈ 15K tokens (calibrated from instrumented RESEARCH phases — override via env). Reuse-ratio + ROI surfaced in the dashboard. |
| 🛠️ **Workflow** | A 4-tier classification (Inquiry / Trivial / Standard / Complex) with phase-triggered plan mode, quality-gated `LEARN`, and team-scoped git worktrees so parallel agents don't step on each other. |
| 📊 **Dashboard** | `knit` opens the brain — a local-first dashboard at `http://127.0.0.1:7421`: bento layout, brain savings, per-project ROI, **force-directed brain graph**, real-time sync via SSE. See [Dashboard](#-the-dashboard). |

**Local-first** invariant: zero cloud calls in memory/retrieval/classification. Dashboard binds to `127.0.0.1` only, with Host/Origin validation + CSP headers. Your brain stays on your machine.

One product: every design choice wins on memory, tokens, workflow, and analytics together.

---

## 🚀 Quick start

```bash
npm install -g knit-mcp
knit setup       # one-time: register Knit with your agents (Claude Code / Cursor / Codex / …)
knit             # open the brain — the dashboard at http://127.0.0.1:7421
```

Two commands: `knit setup` for one-time agent registration, then `knit` to open the brain. Agents communicate with the MCP server over stdio; that process is launched by the host, not invoked manually.

**No per-project setup.** Open your MCP-speaking agent in any project — the first MCP tool call auto-initializes the brain, hooks, and per-project CLAUDE.md block.

### First prompt — onboard your project

Once Knit is connected, open your project in your agent and paste this once. Fill in the brackets, or just describe the project in your own words — the agent does the rest:

> You have the Knit MCP connected. Call `knit_load_session`, then call `knit_onboard` with:
> - **project_description** — what this project is
> - **intent** — what I'm building right now
> - **strictness** — `off` | `warn` | `block` (how strictly to enforce the workflow)
> - **focus_domains** — comma-separated areas (e.g. `api, billing`)
>
> Then summarize what you configured and call `knit_classify_task` for my first task.

Knit persists these preferences and surfaces your project intent at the start of every session. It's a plain MCP tool, so the same prompt works on **any** host — Claude Code, Cursor, Codex, Cline, Continue, Copilot — new session or resumed.

### Adoption per agent

v0.14: a single `knit setup` detects **every** installed MCP-speaking agent on
your machine and writes Knit's config into each one's native format. No
per-agent manual setup, no copy-pasted JSON.

| Agent | Auto-detected by `knit setup` | Config format written | Hook support |
|---|---|---|---|
| Claude Code | ✅ `~/.claude.json` | JSON · `mcpServers` | ✅ PreToolUse / PostToolUse / Stop |
| Cursor | ✅ `.cursor/mcp.json` | JSON · `mcpServers` | ⚠️ approval flow only |
| Codex CLI | ✅ `~/.codex/config.toml` | **TOML** · `[mcp_servers.knit-brain]` | ⚠️ approval flow only |
| Cline | ✅ `~/.cline/mcp.json` + `AGENTS.md` | JSON · `mcpServers` | ⚠️ approval flow only |
| Continue | ✅ `.continue/mcpServers/knit-brain.yaml` | **YAML** per-server | ⚠️ approval flow only |
| GitHub Copilot (VS Code Agent mode) | ✅ `.vscode/mcp.json` | JSON · `servers` (unique key) | ⚠️ approval flow only |
| Any other MCP client | ✅ stdio works universally | per the client's docs | varies |

> **"Hook support" caveat:** only Claude Code has lifecycle hooks (PreToolUse /
> PostToolUse / Stop). For the other 5 agents Knit enforces the protocol via
> the MCP `instructions` field (handshake primer) + **server-side soft-gates**
> in tool responses — same effect as hooks, transport-layer instead of host-layer.
> Opt into block-strictness enforcement with `knit_set_protocol_strictness({level: 'block'})`.

> **Supported shells:** macOS, Linux, WSL, Git Bash, PowerShell. Windows `cmd.exe` is not supported as the hook-runner shell — use PowerShell (default in modern Windows Terminal) or Git Bash.

### Quiet mode

Knit ships **Protocol Guard in `warn` mode by default** — hooks print reminders, they never block. Fully silent:

```js
knit_set_protocol_strictness({ level: "off" })
```

### Uninstall

One command kills all data:

```bash
rm -rf ~/.knit                                 # all per-project + global memory
```

Then remove Knit's registration from each agent you've used `knit setup` with:

| Agent | File to edit | What to remove |
|---|---|---|
| Claude Code (global) | `~/.claude.json` | the `"knit-brain"` entry under `mcpServers` |
| Claude Code (global) | `~/.claude/CLAUDE.md` | the `## Knit Brain (MCP)` block (appended by `knit setup`) |
| Cursor | `~/.cursor/mcp.json` or `.cursor/mcp.json` | the `"knit-brain"` entry under `mcpServers` |
| Codex CLI | `~/.codex/config.toml` | the `[mcp_servers.knit-brain]` section |
| Cline | `~/.cline/mcp.json` | the `"knit-brain"` entry under `mcpServers` |
| Continue | `.continue/mcpServers/knit-brain.yaml` | delete the file |
| VS Code Copilot | `.vscode/mcp.json` (or user `mcp.json`) | the `"knit-brain"` entry under `servers` |

Per-project residue to clean:

- `<project>/CLAUDE.md` — delete the `<!-- knit:start --> ... <!-- knit:end -->` block
- `<project>/.claude/settings.local.json` — remove hook entries tagged `_knitOwned: true`
- `<project>/.claude/KNIT.md` — sidecar written when CLAUDE.md had no markers; delete if present
- `<project>/.claude/agents/knit-*.md` — installed VoltAgent subagents; delete the `knit-` prefixed ones
- `<project>/AGENTS.md` — if you use Codex CLI or Cline, the marker-wrapped Knit block was written here; delete the block or the file

Knit writes nowhere else on your machine.

---

## 🎬 A real session

A new TypeScript project, from install to a compounding brain:

1. **Install + register.** `npm i -g knit-mcp && knit setup` — Knit registers with every MCP-speaking agent on the machine.
2. **Onboard.** Open the project in your agent and paste the onboarding prompt. The agent calls `knit_onboard` — *"Project: a billing API. Intent: add Stripe webhooks. strictness: warn. focus: api, webhooks."* Knit persists those preferences and records the intent.
3. **Ask for the feature.** The agent calls `knit_classify_task` → e.g. *complex, high-risk* → plan mode. It pulls context with `knit_build_context` (ripple effects), `knit_search_learnings` (anything learned before), and `knit_query_dependents` on the files it will touch.
4. **Build + verify.** It implements, runs `knit_verify_claim` to check its claims against the knowledge graph, and `knit_record_learning` to save what was non-obvious.
5. **Compound.** Next session, `knit_load_session` surfaces your intent plus that learning — the brain is already sharper. Run **`knit`** to see it: the dashboard shows the project, its knowledge index, learnings, and token ROI building over time. Hit **Refresh** to re-index or **Export brain** to write an Obsidian vault.

Every step is local, deterministic, and works on any MCP host.

## 🔍 How search works

Knit's retrieval is **BM25 + Reciprocal Rank Fusion** over your learnings,
session summaries, and the cross-project pool, with two lexical-bridging
layers on top: a **2-gram fallback** for typos and rare compounds, and
**curated coding-domain synonym expansion** for common semantic-gap pairs.
No vector embeddings, no remote inference, no API calls.

The design is deliberate:

- **Deterministic** — same query, same ranking, every time. No model drift.
- **Fast** — sub-millisecond on typical project corpora (≤ 1K entries). No cold start.
- **Local-first** — zero network calls; your memory never leaves the machine.
- **Auditable** — every hit is explainable from term overlap plus the 50-pair synonym dictionary.

**Capabilities.** Exact term + identifier match (`knit_classify_task`),
rare-term emphasis (`PIPE_BUF`), multi-word ranking, tag filtering,
cross-project diversification (max 2 per project), branch diversification on
sessions (max 2 per branch), typo recovery via 2-gram fallback
(`knit_clasify` → `knit_classify_task`), and synonym recovery (`hook` ↔
`webhook`, `schema` ↔ `migration`, `auth` ↔ `authentication`, `cache` ↔
`memo`, `deploy` ↔ `ship` ↔ `release`, … — see
[`src/engine/retrieval/synonyms.ts`](src/engine/retrieval/synonyms.ts) for the
full ~50-pair dictionary). Synonym matches score at 0.4× a direct hit, so exact
matches always rank higher.

**Benchmarks.** Synthetic 88.0% top-1 / **100% recall@5**; real-prose learnings
86.7% top-1 / 96.7% recall@5. Both layers default on; set
`enableNgramFallback: false` + `enableSynonyms: false` for a strict
lexical-only baseline.

**Roadmap.** A hybrid retriever (BM25 + local embeddings, fused via RRF) for
paraphrase and abstraction-bridging is a v0.21+ candidate — opt-in,
bench-gated, and local-first.

---

## ✨ What's new in v0.21.0

- **Onboarding (`knit_onboard`).** Paste the README prompt after connecting Knit, describe your project + how you want Knit to behave, and the agent persists your preferences (strictness, features, focus domains) and records the project intent — surfaced every session, on any MCP host.
- **Dashboard actions.** The dashboard can now **Refresh** (re-index a project) and **Export all projects** (Obsidian vault), in addition to viewing. Actions run as child processes (non-blocking) and stay loopback-bound + Host/Origin-gated.
- **56 tools** (Tier-1 37). Shipped after a second six-dimension audit (0 critical) and a real-life end-to-end run.

## ✨ What's new in v0.20.0

v0.20 makes Knit a **fully-ready, dashboard-first brain** — a consolidated
release (internal phases v0.17–v0.20) shipped after a six-dimension deep-clean
audit (0 critical findings).

- **Brain freshness layer.** One shared primitive governs staleness across every
  store, so the brain never serves data it can't vouch for: handoffs auto-clear
  once resolved or stale, idle classifier signals decay, old cross-project
  learnings drop from search, and a learning that names a now-deleted file is
  flagged. Freshness drives prune/clear/flag only — never the bench-gated
  retrieval ranking.
- **Tool count you can explain.** `knit doctor` and `knit_list_features` print
  the live active count *with the reason* (e.g. `46 of 56 = 37 always-on + 9
  teams [≥3 domains] · …`), so a number that legitimately varies by project
  shape stops looking like a bug. A drift test pins the docs to the registry.
- **Stays on-protocol mid-session.** A throttled, escalating reminder rides the
  MCP tool response when an agent drifts (e.g. records work before classifying)
  — reaching every MCP host, not just Claude Code. Silence with
  `knit_set_protocol_strictness({ level: "off" })`.
- **Dashboard-first.** Run **`knit`** to open the brain; the agent/stdio path is
  unchanged. The dashboard gains a Knowledge-index view and a `knit doctor`
  webapp health check. (v0.21 adds Refresh + Export actions to the dashboard;
  `knit setup` remains CLI-only.)
- **Composes with your setup.** Scans Claude Code Skills
  (`.claude/skills/<name>/SKILL.md`) alongside slash commands; positioning leads
  with the integrated brain rather than competitor comparisons.

Security/hygiene from the audit: the command/Skill scanner now guards size and
rejects symlinks before reading (no OOM, no arbitrary-file reads into the brain).

## ✨ What's new in v0.16.0

v0.16 is the **semantic-lite release**. Two retrieval improvements that
close the most common BM25 lexical gaps without an embedding model or
external API call. Both default ON, both bench-pinned non-regressive.

- **Curated synonym expansion.** Hand-curated dictionary of ~50
  coding-domain synonym pairs (`webhook` ↔ `hook`, `schema` ↔
  `migration`, `auth` ↔ `authentication`, `cache` ↔ `memo`, `deploy` ↔
  `ship` ↔ `release`, etc.) in `src/engine/retrieval/synonyms.ts`. When
  a query token has known synonyms, BM25 scores documents containing
  those synonyms with a 0.4× discount weight (higher than the 2-gram
  fallback's 0.25 because synonyms are conceptually closer than
  near-spelling matches). Fires both as a fallback (term unmatched,
  synonym matched) and a boost (term matched directly, synonym widens
  reach).
- **2-gram fallback default ON.** `enableNgramFallback` flipped from
  default `false` → default `true`. v0.15 introduced this as opt-in to
  avoid bench regression risk; v0.16 flips the default after both
  benches verified strictly stable.
- **FIFO-safe `handleIndexRequirements`.** Latent v0.12.1 hardening
  bug: `openSync(O_RDONLY)` on a named pipe blocked indefinitely
  before `fstat` could reject it. Now passes `O_NONBLOCK`; regular
  files unaffected.

Bench impact (v0.15 → v0.16): synthetic 86%/96% → **88%/100%**;
learnings 83.3%/96.7% → **86.7%/96.7%**. The synthetic recall@5 hit
100% because synonym expansion closed the "hook events authenticated"
miss that BM25 alone couldn't bridge.

## ✨ What's new in v0.15.0

v0.15 is the **deep-clean release**. A second six-dimension internal audit
graded the post-v0.14.1 codebase and surfaced the deferred items — defense-
in-depth, retrieval honesty, UX parity, the trailing TODO debt. A single
audit-cleanup branch closed them all, then six parallel agents re-graded
the post-fix code to confirm nothing new slipped in.

- **Security defense-in-depth.** Every `git` invocation in `worktrees.ts`
  migrated to `execFileSync` with array args (no shell). Agent fetcher
  cache writes are SHA256-verified via sidecars; tampered caches force
  a fresh fetch with stderr alert; pre-v0.15 caches backfilled on first
  read. `qs` CVE (GHSA-q8mj-m7cp-5q26) pinned via npm `overrides` —
  `npm audit` now reports 0 vulnerabilities.
- **Brain mechanics.** New `pruneLearningsByAge` parallels the sessions
  pattern (atomic rewrite, conservatively preserves unparseable dates +
  `#false-positive` entries). `readLearnings` schema-validates on read.
  Opt-in BM25 2-gram fallback (`enableNgramFallback`, default off)
  rescues typo-only queries without disturbing benchmarks.
- **Retrieval honesty.** New `bench:learnings` regression bench against
  30 real-learning-shape narrative entries — gates at top-1 ≥ 75% /
  recall@5 ≥ 90% (currently 83.3% / 96.7%). Compounding-metrics response
  now surfaces token-saved methodology with env-var overrides.
- **UX & instructions.** Webapp DoctorView shows per-agent rows (parity
  with CLI `knit doctor`). Workflow `EXECUTE` + `REVIEW` phases now embed
  `knit_suggest_command` hooks so the agent defers to user slash-commands
  for test/lint/ship/qa/review. `buildUpdateNotice` surfaces npm-update
  banner in the MCP instructions field — Cursor/Codex/Cline/Continue/
  Copilot users now see updates at handshake.

## ✨ What's new in v0.14.0

v0.14 is the **universality release**. Three coordinated shifts: every
MCP-speaking agent works out of the box, Knit composes with the slash
commands you already wrote, and enforcement works across all agents
(not just Claude Code).

### 🌍 Six agents, one install

`knit setup` now detects every installed MCP-speaking agent and writes Knit's
config into each one's native format — JSON for Claude Code / Cursor / Cline /
VS Code (note: `servers` not `mcpServers` for VS Code), TOML for Codex CLI,
YAML for Continue. If Codex CLI or Cline is detected, a marker-wrapped
`AGENTS.md` is also written at project root (the cross-agent rules convention).
`knit doctor` now reports per-agent registration status, so you can see
which of your agents are wired up at a glance.

### 🔧 Cross-platform protocol enforcement

Only Claude Code has hook lifecycles (PreToolUse / PostToolUse / Stop). For
the other 5 agents, v0.14 adds **server-side soft-gates** in MCP tool
responses. When strictness is set to `block`, protocol-critical handlers
return `{ status: 'protocol_required', next_action: '...' }` instead of
proceeding — the agent reads the response, follows the breadcrumb, retries.
This is the universality answer: same enforcement, transport layer instead
of host layer. Default strictness stays `warn` so existing flows are unchanged.
(v0.20 extends this with mid-session re-surfacing — see *What's new in v0.20.0* above.)

### ⚡ Agent-native slash-command auto-detection

Two new Tier-1 MCP tools:

- `knit_scan_agent_commands` — scans `.claude/commands/`, `.cursor/rules/`,
  `.clinerules/`, `~/.codex/prompts/`, `~/.continue/prompts/`, `.github/prompts/`
  and surfaces every user-defined slash command + its description.
- `knit_suggest_command({phase})` — given a protocol phase (test/lint/review/
  ship), returns matching commands so the agent can invoke `/test` (or
  whatever you wrote) via the host's native slash mechanism, instead of
  describing the work in prose.

Cached at `~/.knit/projects/<hash>/agent-commands.json` with a 1-hour TTL
(~10ms re-scan when stale). Read-only filesystem ops; Knit never executes
commands — the host agent invokes via its own mechanism.

Dashboard exposes the scan results at **`#/commands`** with searchable
per-agent listing.

### 🛡️ Audit + hardening before publish

v0.14 included a deep-dive internal audit of every dashboard
endpoint, MCP handler, fs.watch race condition, and supply-chain dep. Five
inline fixes landed in commit `e4e1793`:
- `fs.watch` error handler now resets `watcher = null` so SSE recovers
  cleanly after a watcher death (pre-fix, real-time sync silently stopped
  until `knit ui` restart).
- JSON + SSE responses gained `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` (pre-fix only on
  HTML).
- `handleDefineTeam` + `handlePostTeamFindings` now call `redactSecrets` on
  user-supplied team metadata + finding descriptions (pre-fix: raw write to
  disk). 9 of 9 write handlers now redact uniformly.

CBSE-style attack class verified PASS on every dashboard endpoint:
Host-validation + Origin-validation + read-only contract + same-origin CSP
+ hex-only project-id regex. No malicious-page-can-read-your-brain vector.

## ✨ What's new in v0.13.0

v0.13 ships the **dashboard** — the visual surface on top of the brain. Plus security hardening and the universal positioning (works with every MCP-speaking agent).

### 📊 Brain dashboard (`knit ui`)

A single command opens a local-first analytics surface at `http://127.0.0.1:7421` — bento layout inspired by modern fintech dashboards, color-blocked cards, generous spacing, real-time sync.

| View | What it shows |
|---|---|
| **Brain** (`#/`) | Hero card with net tokens saved across all projects, recent activity feed (live), memory hit-rate arc, top projects by ROI |
| **Graph** (`#/graph`) | Project picker → **force-directed brain graph**: every learning is a node, edges by Jaccard similarity over shared tags + domains. Click any node for the full lesson. Threshold slider. |
| **Cross-project** (`#/global`) | Cross-project learnings pool, filterable by source project |
| **Per-project** (`#/p/:id`) | Searchable learnings list, retrieval signals, ROI deep dive (`#/p/:id/metrics`), graph (`#/p/:id/graph`) |
| **Health** (`#/doctor`) | Install diagnostics: ~/.knit writable, MCP registered, version current |

**Real-time sync via SSE.** The server watches `~/.knit/` via `fs.watch`; any agent recording a learning anywhere updates the open dashboard within ~250ms. No polling.

### 🔐 Security hardening

The dashboard is a localhost HTTP server, which has real attack surface. v0.13 closes it:

- **Host-header validation** — rejects requests whose `Host` isn't `127.0.0.1`/`localhost`. Blocks **DNS rebinding** (a malicious site you visit could resolve `evil.com` to 127.0.0.1 and trick your browser into reading the dashboard).
- **Origin-header validation** — cross-origin requests get `403`. Same defense pattern as PostgreSQL, Redis, Docker daemon, the React dev server.
- **Content-Security-Policy** on every HTML response — same-origin scripts only, no `'unsafe-eval'`, no external sources.
- **X-Frame-Options: DENY**, X-Content-Type-Options: nosniff, Referrer-Policy: no-referrer.
- **No mutation endpoints** in v0.13 (read-only dashboard). Setup wizard / refresh button stay deferred until proper CSRF protection lands.

### 🌍 Universal positioning

Knit is an MCP server. Anything that speaks MCP works:

- **Claude Code** — handshake via stdio, `instructions` field carries protocol primer
- **Cursor** — register knit MCP server in settings
- **Codex CLI** — `~/.codex/config.toml` mcpServers section
- **Cline / Continue** — both speak MCP, same setup

The dashboard works regardless of which agent you use — it reads the brain from disk.

### 🪙 Token-economy lever

`knit ui` notifies you when a new `knit-mcp` is available on npm — polls the registry every 5 minutes server-side, banner pops in the dashboard with the one-line `npm install -g knit-mcp@latest` command. No stale installs.

> **Upgrade note.** After `npm install -g knit-mcp@latest`, **restart your agent**. The `instructions` field flows into the system prompt at handshake. The `HOOKS_VERSION` bump auto-regenerates installed hooks on the next brain load — no manual `knit refresh` needed.

---

## 📉 Token budget — measured, not vibes

| Surface | v0.6.5 | v0.9.0 | Cut |
|---|---|---|---|
| CLAUDE.md per-turn | ~16.7 KB | **~2 KB** | **88%** |
| Tool registry (typical project) | ~6–8 KB | **~3–4 KB** | ~50% |
| `knit_classify_task` response | ~500 tok | **~150 tok** | 70% |
| `knit_load_session` response | ~3–5 KB | **~1.5 KB** | ~60% |

Each surface gets a `healthy | warn | over-budget` verdict from `knit_brain_status.token_budget`, enforced by a regression test.

---

## 📊 The dashboard

Run **`knit`** to open the brain (the local analytics surface); `knit ui` is an explicit alias:

```bash
knit
# Knit Dashboard — http://127.0.0.1:7421
# Reading from: /Users/<you>/.knit
# Press Ctrl-C to stop.
# (opens your default browser; visit the URL above if it does not)
```

| Feature | What you see |
|---|---|
| **Bento home** | Big "Net tokens saved" hero card (dark), live recent activity (green "live" dot when SSE connected), memory hit-rate gauge, top projects by ROI as color-blocked cards |
| **Brain graph** | Force-directed visualization of one project's learnings. Nodes sized by access count, colored by domain. Edges by Jaccard similarity over tags + domains. Click any node → side panel with the full lesson. Threshold slider live-recomputes the graph. |
| **Per-project deep dive** | Hero card with verdict tone (cold/warming/compounding/strong), retrieval signals, classifications-by-tier breakdown, top domains heatmap, searchable learnings list, Knowledge index, and **Refresh** (re-index this project) + **Export all projects** (Obsidian vault) actions |
| **Health** | Install diagnostics — Node version, Knit version, ~/.knit permissions, per-agent MCP registration |

**API endpoints** (127.0.0.1 only, Host/Origin-gated):

- `GET /api/version` — runtime version + update check + security metadata
- `GET /api/brain/summary` — global counts
- `GET /api/brain/aggregate` — cross-project ROI totals
- `GET /api/projects` — project list
- `GET /api/projects/:id/learnings` — full learning entries
- `GET /api/projects/:id/metrics` — compounding ROI for one project
- `GET /api/projects/:id/knowledge` — knowledge-index summary
- `GET /api/projects/:id/graph` — force-directed node + edge data (Jaccard threshold tunable)
- `GET /api/global/learnings` — cross-project pool
- `GET /api/doctor` — install diagnostics
- `GET /api/events` — Server-Sent Events stream for real-time sync
- `POST /api/projects/:id/refresh` — re-index a project (source path from its meta; spawned as a child process)
- `POST /api/export` — export all projects to a fixed `~/.knit/exports/` vault

---

## 🛠️ 56 MCP Tools

> **37 always-on, up to 19 conditional, 56 total.** The active count varies by
> project shape, so it isn't one fixed number — it's `37` plus whichever
> conditional groups your project triggers: teams (9 tools, auto-on when ≥3
> domains detected), diagnostics (6 tools, on during your first session),
> subagents (1 tool, auto-on when `.claude/agents/` exists), and admin (3 tools,
> opt-in via `knit_enable_feature("admin")`). That's why one machine shows 46
> and another 44 — it reflects each project's shape. Run `knit doctor` (or call
> `knit_list_features`) for your project's **live count and the reason for it**.
> The groups below cover the main tools; `knit_list_features` is the
> authoritative live list.

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
| `knit_onboard` | **v0.21.** One-time onboarding: captures the project + how the user wants Knit, persists preferences (strictness, features, focus domains), records the project intent. |
| `knit_scan_agent_commands` | Scan each MCP host's slash-command + skill directories; surface user-defined commands so Knit composes with them. |
| `knit_suggest_command` | Per-phase lookup against scanned commands; returns the agent-native command to invoke. |

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
| `knit_enable_feature` | Flip on a Tier-2/3 feature (`teams`, `subagents`, `admin`). Emits `notifications/tools/list_changed` — new tools appear without an agent restart. |
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
| `knit_setup_project` | Bootstrap domain teams for a non-code project (legal, marketing, research). One-time. |
| `knit_prune_sessions` | Prune `sessions.jsonl` by age (default 90 days). Atomic rewrite. Auto-prune handles this normally. |
| `knit_reset_calibration` | Wipe per-project classifier calibration. Discards accumulated tuning. |

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
      "tool_registry":        { "bytes": 8400,  "target_bytes": 8500,  "verdict": "healthy", "active_tool_count": 46, "total_tool_count": 56 },
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
    "upgrade": "Restart your agent to spawn a fresh MCP — npx will auto-fetch the new version."
  }
}
```

Pair with `knit_compounding_metrics` for the value side of the ledger (sessions, hit rate, estimated tokens saved by skipped re-investigations).

---

## 💻 CLI

The surface is dashboard-first: `knit` opens the brain, `knit setup` performs
one-time agent registration. The remaining commands are operational tooling for
scripting and CI; their views are progressively moving into the dashboard.

```bash
knit                  # open the brain (the dashboard at http://127.0.0.1:7421)
knit setup            # one-time: detect installed MCP-speaking agents and register Knit in each
knit doctor           # install health check: version, per-agent MCP registration, webapp bundle, knowledgebase
knit ui               # explicit alias for the dashboard (same as bare `knit`)
knit status           # terminal snapshot: sessions, learnings, hit rate, knowledge-index health
knit refresh          # rebuild the knowledge index from source
knit install-agents   # install subagent definitions into <project>/.claude/agents/
knit export <fmt>     # export learnings (supported targets: obsidian)
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

Token budget (v0.16)
  CLAUDE.md:           2.0 KB  → healthy
  Tool registry:       ~13 KB  → warn (46 active / 56 total)
  Instructions:        ~4 KB   → healthy
  Per-session total:   ~20 KB  → healthy

Compounding
  Sessions logged:     14
  Reuse ratio:         67%  → strong
  Tokens saved (est.): 65,000
```

---

## 🧠 Why Knit

Knit is a **project brain your agent plugs into** — a live code knowledge graph wired into ranked memory and a task classifier that routes work by impact. The pieces aren't sold separately; the value is the integration:

- **Graph-grounded recall** — memory ranked by what your change *structurally* touches (dependents, fanout), not just keyword overlap.
- **Impact classifier** — every task is sized (Inquiry → Trivial → Standard → Complex) and complex work auto-enters plan mode. The brain decides *how carefully* to handle a change, not just what to recall.
- **Self-calibrating** — `knit_record_false_positive` shifts the classifier's thresholds per project; it gets less wrong over time.
- **Token accounting** — `knit_compounding_metrics` makes "cheaper over time" chartable per project.
- **Parallel team worktrees** — multi-domain work fans out into isolated git worktrees so agents don't collide.
- **Brain integrity** — a freshness layer keeps every datum trustworthy: stale handoffs auto-clear, idle classifier signals decay, deleted-file references get flagged.
- **Fully local, zero-glue** — `npx knit-mcp setup` and it's a brain every MCP host (Claude Code, Cursor, Codex, Cline, Continue, Copilot) shares. No cloud, no SDK wiring.

**"Why use Knit if my agent already has memory?"** Your agent's memory *stores notes*; Knit *decides* — it ranks recall by what your change structurally touches, classifies each task to set the right workflow depth, and tracks the cost over time. Graph-grounded routing, not a markdown notepad.

Knit also **composes with** whatever else you run: `knit_scan_integrations` detects existing workflow frameworks and slash commands and defers to them where they fit — Knit stays the memory + classification brain underneath.

### Retrieval benchmarks

Knit's retrieval is BM25 + reciprocal-rank fusion + graph traversal — **vectorless, deterministic, auditable**, no embedding model or cloud call. In-repo regression gates:

| Harness | Top-1 | Recall@5 | Run it |
|---|---|---|---|
| 50-question synthetic | **88%** | **100%** | `npm run bench` |
| 30-question narrative prose | **86.7%** | **96.7%** | `npm run bench:learnings` |

These are focused in-repo regression gates that block a merge if retrieval degrades. A run on a standard long-memory benchmark and a hybrid BM25 + local-embeddings retriever are v0.21+ candidates.

---

## 📜 Release history

| Version | Headline |
|---|---|
| **v0.21.0** | **Onboarding + dashboard actions.** `knit_onboard` captures the project + how the user wants Knit (preferences persisted, intent surfaced every session, host-agnostic). The dashboard gains **Refresh** + **Export all projects** actions (non-blocking child processes, Host/Origin-gated). New `GET /api/projects/:id/knowledge` + a `knit doctor` webapp check. Shipped after a second six-dimension audit (0 critical) + a real-life E2E. 56 tools. |
| **v0.20.0** | **Brain integrity + clarity + dashboard-first.** A freshness layer keeps every datum trustworthy (handoffs auto-clear, idle classifier signals decay, deleted-file references get flagged). `knit doctor`/`knit_list_features` explain the live tool count. Mid-session protocol re-surfacing keeps agents on-protocol across every MCP host. **`knit`** opens the brain dashboard; a read-only Knowledge-index view + Skills composition land. Removed competitor comparisons for intrinsic positioning. Shipped after a six-dimension deep-clean audit (0 critical). 55 tools, 855 tests. |
| **v0.16.0** | **Semantic-lite retrieval.** Curated coding-domain synonym dictionary (~50 pairs) closes the most common BM25 lexical gaps (`hook` ↔ `webhook`, `schema` ↔ `migration`, etc.) without an embedding model. 2-gram fallback for typos default ON after bench verification. Synthetic bench 88% top-1 / **100% recall@5** (was 96%); learnings 86.7% top-1 / 96.7% recall@5. Plus a FIFO-safe `O_NONBLOCK` fix to `handleIndexRequirements`. 55 tools, 818 tests. |
| **v0.15.0** | **Deep-clean audit release.** Six-dimension second audit + atomic-write helper applied to 9+ sites including `~/.claude.json` (a torn write there used to brick Claude Code). SHA256 sidecars on agent-fetcher cache writes detect tampering and re-fetch. `qs` CVE pinned via `npm overrides` → 0 vulns. Opt-in BM25 2-gram fallback for typos. `pruneLearningsByAge` + schema-validated `readLearnings`. Webapp DoctorView shows per-agent rows. Update notice surfaces in MCP `instructions` field for all 6 agents. 55 tools, 805+ tests. |
| **v0.14.1** | **Ship-readiness audit + atomicity hardening.** First six-dimension audit + 14 P1 fixes: `writeFileAtomic` helper across 9+ persistence paths; `handleSetupProject` redaction gap closed; `record_learning` substring dedup matches the description claim; soft-gate documented in instructions field; pre-publish leak gate. 55 tools. |
| **v0.14.0** | **Universality release.** Single `knit setup` detects + writes to every installed MCP-speaking agent (Claude Code, Cursor, Codex CLI, Cline, Continue, GitHub Copilot via VS Code Agent mode). Server-side soft-gates as the cross-platform protocol enforcement layer for agents without hook lifecycles. Slash-command auto-detection via `knit_scan_agent_commands` + `knit_suggest_command`. 55 tools. |
| **v0.13.0** | **Brain dashboard release.** `knit ui` opens a local-first analytics dashboard (Monetir-inspired bento, force-directed brain graph, real-time SSE sync, Host/Origin validation + CSP). Security hardening across every endpoint. Universal positioning copy across CLI + README. |
| **v0.12.0** | **Picture Perfect: Structural Enforcement.** Diagnostic → enforcing. Budget verdict surfaces in the MCP `instructions` field at handshake (before any tool description is read). `knit_load_session` carries `budget_health` + `learnings_health` nudges. `knit doctor` exits non-zero on over-budget; `knit setup` runs doctor as final step. New PostToolUse hook warns immediately on over-budget CLAUDE.md edits (HOOKS_VERSION 11→12; auto-rolls to existing users). This repo dogfoods: hand-curated 16KB CLAUDE.md migrated to lean 3.8KB plus an internal long-form sidecar. New `npm run bench:tokens` measures real MCP-on vs MCP-off cost: 93% smaller per-recall call, 50% smaller per-classify, payback at 3 recall calls. 53 tools, 705 tests. |
| **v0.11.4** | Dogfood audit · ran a full audit of Knit's own codebase using its own `knit_spawn_team_worktree` primitive (4 parallel teams: Core Logic, Infrastructure, UI, Quality Assurance). Fixes: HIGH `engram refresh` no longer clobbers user-curated CLAUDE.md (now uses `spliceKnitBlock` like `cache.ts`); `saveSource`/`loadSource` validate `sourceId`; `appendGlobalLearning` propagates write failures; `redactSecrets` applied to `label`/`tags`/`domains` across all persistence boundaries; 100KB response ceiling on `knit_generate_test_cases`; full v0.11 tool surface now documented in `workflow-protocol.ts` generator (was frozen at the v0.4 surface). Plus: 16 key tools reclassified with `[PROTOCOL]`/`[REVIEW]`/`[MEMORY]`/`[GRAPH]` prefixes so the LLM picks the right tool reliably. 53 tools, 687 tests. |
| **v0.11.3** | Propagation patch · `update_available` flag now surfaces in `knit_load_session` response (≈100% session reach vs. brain_status' low reach) + startup stderr nag on stale versions. Helps FUTURE upgrades land faster; doesn't retroactively reach v0.10.x users. 53 tools, 665 tests. |
| **v0.11.2** | Pre-publish polish · chunk cap (2000) + `errorResponse` envelope across handlers + CLAUDE.md generator surfaces v0.11 tools · new `engram doctor` install health-check CLI · upgrade-path smoke test caught + fixed a data-loss bug in cache.ts (Case B was wiping user permissions on upgrade) · 11 real exploit-payload integration tests prove C1/C2/H1 fixes hold · `npm run bench` ships a synthetic retrieval harness (50 Q&A) measuring 86% top-1 / 96% R@5. 53 tools, 664 tests. |
| **v0.11.1** | Audit-driven hardening · 3 CRITICAL (source_id path traversal, post-edit tsc shell injection, live calibration bug) + 10 HIGH fixes from a 5-agent audit, implemented in 3 parallel `knit_spawn_team_worktree` teams. HOOKS_VERSION 11 (auto-upgrades existing users). New `knit_delete_requirements` tool. 53 tools, 636 tests. |
| **v0.11.0** | Verify Layer + auto-config foundation · mandatory `knit_verify_claim` REVIEW gate · post-edit diff verify + universal `tsc` check · drift detector · self-healing classifier (per-project calibration) · `knit_index_requirements` + `knit_generate_test_cases` (BM25 over long specs) · `knit_get_fingerprint` + `knit_infer_domains` + `knit_compose_template` (zero-config CLAUDE.md). 52 tools, 625 tests. |
| **v0.10.0** | Token-economics release · risk × scope × change_kind classifier split · `context_budget_remaining` graceful degradation · per-project diversity cap on cross-project search · 11 new compounding-metrics fields + weekly snapshot persistence + `knit_get_metrics_history`. Makes "Knit makes Claude cheaper" a chartable number from day 1. |
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
npm run test       # 818 tests, ~8 s
npm run typecheck  # TypeScript strict mode
npm run bench      # retrieval bench: synthetic + learnings-shape
npm run build      # compile CLI + MCP server + webapp
```

### Architecture

```
knit (npm package)
├── dist/cli.js                 # CLI: setup, doctor, ui, status, refresh, install-agents, export
└── dist/mcp/server.js          # MCP server: 56 tools (tier-gated), auto-init

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

**Zero external dependencies for the knowledge brain.** 818 tests, 0 `npm audit` vulnerabilities. Strict-mode TypeScript.

---

## 📄 License

[MIT](./LICENSE) © 2026 

<p align="center">
  <sub>If knit saved you tokens, <a href="https://github.com/PDgit12/knit">give it a ⭐</a>.</sub>
</p>
