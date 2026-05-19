# Changelog

All notable changes to Knit. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); Knit uses [Semantic Versioning](https://semver.org/).

## [0.7.1] — 2026-05-19

**Hot-reload for tier-gated tools.** `knit_enable_feature` and
`knit_disable_feature` now emit the MCP `notifications/tools/list_changed`
notification when they successfully change persisted state. The client
(Claude Code, Cursor, Codex) re-fetches `tools/list` immediately and
newly-active tools appear in the same session — no Claude Code restart
needed for these operations.

This was the realistic partial win from the v0.7.0 "auto-update on
MCP code change" question. Handler code changes still require restart
(MCP transport limitation, not Knit), but the visible tool surface
update is restart-free starting in v0.7.1.

### Added

- **`src/mcp/notifier.ts`** — late-bound dispatcher that bridges the
  handler layer (no Server reference) to the transport layer.
  `registerToolsListChangedNotifier(fn)` is called once by `server.ts`
  and `cli.ts` after constructing the Server. `notifyToolsListChanged()`
  is called by handlers after a state change; fire-and-forget, never
  throws, swallows both sync exceptions and async rejections so a
  notification failure can't tear down the handler.

- **Server capability advertisement.** `tools: { listChanged: true }`
  now appears in `capabilities` on both `src/mcp/server.ts` and
  `src/cli.ts` runMCP-mode constructors, telling clients we may emit
  the notification.

### Changed

- **`handleEnableFeature`** fires `notifyToolsListChanged()` after a
  successful enable (NOT on already-enabled — re-enable is a no-op
  notification too). Response `instruction` updated to reflect the new
  live behavior: "Tools list updated for this session. The newly-
  enabled tools should be available immediately — call
  knit_list_features to confirm."

- **`handleDisableFeature`** symmetric: fires on successful disable
  (real state transition), no-ops on already-disabled.

### Tests

366 → 374. New `tests/notifier.test.ts` covers:
- Notifier registration + invocation.
- No-op when no notifier registered (handlers running outside MCP).
- Sync exceptions and async rejections from the notifier are swallowed.
- `handleEnableFeature` fires exactly on real flag-flip-on; idempotent
  re-enable does NOT fire.
- `handleDisableFeature` fires exactly on real flag-flip-off.
- Invalid feature names hit the error path and do NOT fire.

### What still requires a Claude Code restart (honest scope)

- Handler code bug fixes (the v0.6.4 Stop-hook fix would still need
  restart even after v0.7.1).
- Server `instructions` field changes — sent at handshake only.
- Upgrading the npm package version itself (process is already running
  the prior version's code).

For these, the answer is and will remain "restart Claude Code." It's
a property of the MCP stdio transport, not a Knit limitation.

## [0.7.0] — 2026-05-19

**The "connective tissue" release.** Knit becomes the universal MCP layer
for any project shape: tier-gated tool surface, dynamic per-project
protocol injection at session start, ~60% per-turn token reduction
across the board. No breaking changes for v0.6.5 users — every new
behavior is additive or opt-in, with back-compat for legacy markers
and persistence files.

**Important upgrade note:** after upgrading, **restart Claude Code**
(or your MCP client) so the running MCP server picks up the new
`instructions` field and tier-gated `tools/list`. The new server
instructions only flow into the system prompt at handshake time —
the cached MCP process from before the upgrade keeps the v0.6.5
behavior until restart.

### Added

- **MCP server-level `instructions` field.** The Server constructor now
  emits a ~2KB universal-baseline protocol string that every MCP client
  (Claude Code, Cursor, Codex) injects into the session system prompt
  BEFORE tool descriptions are read. Closes the "agent doesn't know
  Knit's flow at session start" gap that CLAUDE.md alone could never
  close — CLAUDE.md is harness-wrapped with "may or may not be
  relevant" caveats; instructions surface unconditionally. New file
  `src/mcp/instructions.ts` exports `KNIT_INSTRUCTIONS`; both
  `src/mcp/server.ts` and `src/cli.ts` runMCP-mode wire it in.

- **Inquiry tier in the classifier.** `knit_classify_task` now detects
  read-only "what / where / audit / explain / status / how" intent in
  the task description and returns `tier: 'inquiry'` with empty phases
  and `auto_plan_mode: false` — Inquiry-class tasks (e.g., "audit the
  codebase") no longer hijack plan mode the way they did pre-v0.7.
  Action directives ("fix this", "implement X") override even if an
  inquiry word appears, so write-bearing commands stay correctly
  routed. The workflow protocol always documented an Inquiry tier;
  the classifier implementation just shipped late.

- **Tier-gated tool registry — 38 tools, three tiers.**
  - **Tier 1 (26 tools, always active):** memory + retrieval (8),
    knowledge graph (5), workflow + classification (4), false positives
    + reflection (3), Protocol Guard config (2), diagnostics + meta (4).
  - **Tier 2 (10 tools, auto-exposed when project shape matches):**
    team worktrees (9) auto-active when ≥3 domains detected OR
    `knit_enable_feature("teams")`; subagents (1) auto-active when
    `.claude/agents/` exists OR `knit_enable_feature("subagents")`.
  - **Tier 3 (2 tools, strictly opt-in):** `knit_prune_sessions` and
    `knit_setup_project`, both reachable via `knit_enable_feature("admin")`.
  `tools/list` MCP responses are now filtered per project shape — the
  agent never sees tools it can't usefully call. Solo-domain projects
  drop 9 team-worktree tools from their decision space.

- **`knit_list_features`** — the discoverability escape hatch. Always
  Tier 1. Returns `{ active, available, totals, by_category,
  project_shape }`. The `available` entries carry the rationale and
  `enable_via` hint so the agent can tell the user how to switch a
  hidden tool on.

- **`knit_enable_feature` / `knit_disable_feature`** — flip Tier-2/3
  flags on/off. Both Tier 1 (must always be reachable — otherwise a
  user who disables "admin" by accident could lock themselves out of
  the recovery path). Persisted to `~/.knit/projects/<hash>/features.json`
  via atomic temp-then-rename write so a mid-write crash can't corrupt
  the flag state. Unknown feature names in a persisted file are
  silently dropped, not crashed on.

- **Response payload caps.**
  - `knit_load_session` is now lazy by default. The core response
    (session_context, top 3 learnings, top 5 false positives, knowledge
    counts) is always returned. Optional sections — patterns, teams,
    metrics, recent_sessions, full_learnings, full_knowledge — gate
    behind `include=<comma-list>`. `include=all` opts into everything.
  - `knit_classify_task` minimal-mode by default. Returns `{ tier,
    affected_domains, phases, auto_plan_mode, instruction }`. The
    diagnostic fields (`reasoning`, `cross_domain_ripple`, `files_count`)
    move behind `verbose=true` for ad-hoc debugging.

### Changed

- **CLAUDE.md generator trimmed ~88%** on a typical project (16.7KB →
  ~2KB). The previously-injected system-reminder override paragraph,
  verbose Protocol Guard prose, and Phase Status placeholder are gone
  — covered by server instructions or pure ceremony. Project Map caps
  high-fanout 15→5, untested 10→3. Tier vocabulary collapsed from a
  prose-heavy section to a 4-row table. Workflow pointer collapsed
  from a 10-phase code block to a one-liner. Project-specific value
  (header, session-start pointer, project map, domain architecture,
  build gates, false positives if curated) is fully preserved.

- **Tool descriptions** in `src/mcp/tools.ts` compressed across the
  board. Pre: average ~150 chars per tool. Post: average ~52 chars.
  Action-verb-first one-liners. Behavior markers ("Call first on
  every task.", "Opt-in.") retained because they affect agent
  routing; elaborations and examples cut.

### Fixed

- **`spliceKnitBlock` now recognizes the legacy v0.5.x markers**
  (`<!-- engram:start --> ... <!-- engram:end -->`) in addition to the
  current `<!-- knit:start --> ... <!-- knit:end -->`. Pre-fix, users
  upgrading from v0.5.x would have ended up with a 16KB orphan block
  stranded in CLAUDE.md while Knit wrote a separate `.claude/KNIT.md`
  sidecar — confusing and wasteful. The legacy block now gets cleanly
  replaced; the file converges to the current markers over time.

### Token-budget table (per-session fixed cost)

| Surface | v0.6.5 | v0.7.0 | Cut |
|---|---|---|---|
| CLAUDE.md per-turn | ~16.7 KB | ~2 KB | 88% |
| Tool registry (typical project) | ~6-8 KB | ~3-4 KB | ~50% |
| `knit_classify_task` response | ~500 tok | ~150 tok | 70% |
| `knit_load_session` response (default) | ~3-5 KB | ~1.5 KB | ~60% |
| Server `instructions` | 0 | ~500 tok | (new context) |

Net per-session fixed cost roughly halves on a typical project.

### Deferred to v0.7.1 (close-successor)

- BM25 + import-graph retrieval (vectorless RAG) — replaces substring
  search across `knit_search_*`. Designed in `V0.7-PLAN.md` step 9.
- Session-diversified retrieval — trivial follow-on once BM25 lands.
- Integration scanner (`integrations.json`) — detects gstack /
  CodeTour / custom CLAUDE.md frameworks and tailors instructions
  per-project.
- Token budget guardrail in `knit_brain_status`.
- Knowledge-graph entity extraction.
- 4-tier memory consolidation.
- `/plugin install` packaging.
- Secret-redaction pattern expansion based on real-user reports.

### Tests

312 → 366. New coverage for: Inquiry-tier detection, `KNIT_INSTRUCTIONS`
budget + content invariants, tool registry shape + gating rules,
`computeFeatureListing`, `isToolActive`, `getActiveToolDefinitions`
filtering (including the Tier-1 recoverability invariant), feature-flag
persistence round-trip, malformed `features.json` graceful fallback,
unknown feature-name skip, atomic-write artifact check, multi-include
parsing on `knit_load_session`, minimal/verbose modes on
`knit_classify_task`, legacy `<!-- engram:start -->` marker migration
in `spliceKnitBlock`.

## [0.6.5] — 2026-05-18

**Polish pass before public link.** Final sweep through user-visible
strings that escaped the v0.6.0 rename, plus an honest README note on
Windows shell support.

### Fixed

- **`engram` / `Engram` cleaned out of every user-visible string** the
  product writes to disk or returns to the agent:
  - `src/generators/workflow-protocol.ts` — overview + tier-classification
    headings ("Knit workflow — overview", "you decide, Knit informs").
    This is what the agent sees when it calls `knit_get_workflow`.
  - `src/generators/claude-md.ts` — the generated CLAUDE.md block now
    reads "Knit-powered workflow", "Knit protocol", "Knit MCP tools
    reference", "Knit-generated", and "Knit will configure domains".
  - `src/mcp/cache.ts` — the `.claude/KNIT.md` sidecar template (written
    when a user-curated CLAUDE.md exists without Knit markers) now says
    "Knit's per-project workflow".
  - `src/commands/export.ts` — Obsidian export writes `Knit Index.md`
    with heading `# Knit Knowledge Index` (was `Engram Index.md` / `#
    Engram Knowledge Index`). Existing exports keep their filenames; a
    re-export creates the new file.
  - `src/generators/learnings.ts` — the bootstrap entry now reads
    "Project initialized with Knit workflow".
  - `src/engine/worktrees.ts` — new team worktrees use branch names
    `knit/team-<slug>-<ts>` instead of `engram/team-…`. Existing
    worktrees keep their branch names; only new spawns are affected.
- **Agent-md markers renamed with back-compat.**
  `src/generators/agent-md.ts` writes `<!-- knit:context:start -->` /
  `<!-- knit:context:end -->` going forward. The legacy
  `<!-- engram:context:* -->` markers are still recognized so v0.5.x
  personalized agent files (in `.claude/agents/knit-<name>.md`) regenerate
  cleanly without leaving an orphan block. `src/engine/install-agents.ts`
  also checks both marker forms before treating a file as user-curated.

### Added

- **README: explicit Windows shell support boundary.** Knit's hooks use
  POSIX-style `node -e '…'` quoting which works under bash, zsh, Git
  Bash, WSL, and Windows PowerShell — but **not** Windows `cmd.exe`
  (single quotes are literal characters there, not delimiters). Documented
  alongside setup instructions. Issue template for hook errors invites
  users to report shell context.

### Internal (not user-visible — left for a later sweep)

- `engram` references inside source comments and internal variable names
  (`ENGRAM_GRADIENT` in `src/cli.ts`, `ENGRAM_DIR` in
  `src/generators/settings.ts`, doc comments in `src/mcp/cache.ts` /
  `src/mcp/handlers.ts` / `src/generators/agent-md.ts` etc.). These don't
  appear in any output the user sees — chore commit any time.

## [0.6.4] — 2026-05-18

**Hotfix for Node 22+/25+ hook execution.** Closes a second, distinct
hook-runtime bug that v0.6.3 didn't catch.

### Fixed

- **`node -e` top-level `return` rejected on Node 22+ / 25+.** Several
  generated hook scripts (LEARN-compliance, KB-metrics, session-tuple
  recorder, etc.) used `return;` as an early-exit from a top-level
  `try { ... }`. Older Node versions tolerated this in `-e`-evaluated
  scripts; Node 22 and especially Node 25 reject it with
  `SyntaxError: Illegal return statement`. Every Stop hook fired this
  on session end.
  Fix: `nodeHook` in `src/generators/settings.ts` now wraps the script
  body in an IIFE — `(() => { … })()` — so `return` is legal.
- **Regression test extended to actually execute generated hooks.**
  `tests/generators.test.ts` previously used `bash -n` to syntax-check
  commands without running them; that caught the v0.6.3 quoting bug but
  not this one (valid shell, valid JS — just illegal under Node's
  evaluator). The new test runs every generated `node -e` command under
  the current Node, with empty stdin to prevent stdin-reading hooks from
  hanging. Would have caught both v0.6.3 and v0.6.4 regressions.
- **`HOOKS_VERSION` bumped 5 → 6** so users who installed any v0.6.0–0.6.3
  build get a clean hook regeneration on next brain load.

## [0.6.3] — 2026-05-18

**Public-link ship-readiness patch.** Closes the first-impression and
data-integrity gaps surfaced by the pre-launch audit. No new features —
purely correctness, branding consistency, and safety.

### Fixed

- **CLI/MCP version now sourced from `package.json` (was hardcoded `0.4.1`).**
  Three sites (`src/cli.ts` × 2, `src/mcp/server.ts` × 1) reported stale
  `0.4.1` instead of the real package version. New `src/version.ts` module
  resolves `package.json` via `createRequire` at module init so every site
  reads from one source of truth. A new `tests/version.test.ts` asserts
  this against the package manifest so the drift can't recur.
- **`HOOKS_VERSION` bumped 3 → 4 to activate the v0.6 rename migration.**
  The constant in `src/generators/settings.ts` was never bumped during the
  v0.6.0 rename, so existing v0.5.x users upgrading to v0.6.x silently kept
  their old `_engramHooks`-tagged settings.local.json — meaning their
  installed hooks still referenced the legacy marker name and never picked
  up the SessionStart/UserPromptSubmit gates introduced in v0.5.0. v0.6.3
  forces regeneration on next MCP call.
- **Hook merge now strips legacy `_engramOwned` entries on upgrade.** The
  hybrid-merge logic in `src/mcp/cache.ts` only filtered `_knitOwned`
  entries, so v0.5.x → v0.6.x upgrade would have left stale engram-flavored
  hooks alongside fresh knit-flavored ones (duplicates). The filter now
  removes both. Additionally, files carrying the legacy `_engramHooks`
  marker are now treated as fully knit-owned and overwritten cleanly, and
  the stale marker key is deleted after migration.
- **Setup output: lingering "Engram Brain" branding cleaned up.**
  - `src/commands/setup.ts` now writes a `## Knit Brain (MCP)` section to
    `~/.claude/CLAUDE.md`, prints "Knit instructions added", and dedups
    against BOTH the new heading and the legacy "Engram Brain (MCP)" so
    users upgrading from v0.5.x don't get a duplicate block appended.
  - "Agent gets 20 tools" → "Agent gets 35 tools" (correct count).
- **User-facing "Engram" → "Knit" in error/info messages:**
  `src/commands/status.ts`, `refresh.ts`, `install-agents.ts`, and the
  background-install instruction string returned by `knit_install_agent`.
- **`appendLearning` is now atomic.** Switched from read-modify-write to
  `appendFileSync`, so concurrent Claude Code instances on the same project
  (or a crash mid-write) no longer truncate or interleave the learnings file.
  New concurrency test in `tests/learnings.test.ts` runs 100 parallel
  appends and asserts all 100 entries persist intact.
- **Secret-pattern redaction on persistence.** `knit_record_learning`,
  `knit_record_global_learning`, `knit_save_handoff`, and
  `knit_record_false_positive` now scrub Anthropic / OpenAI / GitHub PAT /
  AWS access key ID / Slack / npm tokens and PEM private-key blocks before
  writing to disk. New `src/mcp/sanitize.ts` module with conservative
  patterns (no generic base64 catch-all). Covered by `tests/sanitize.test.ts`.
- **THIRD-PARTY-NOTICES.md** now correctly attributes the redistribution to
  "Knit" (was "engram") and references `~/.knit/agents/cache/`. VoltAgent
  attribution unchanged.
- **Stop-hook shell-quoting bug.** The `nodeHook` helper in
  `src/generators/settings.ts` wrapped scripts in single quotes (`node -e
  '…'`), but one Stop-hook script contained a literal apostrophe in
  `console.log("That's fine…")` — the apostrophe closed the outer shell
  quote and produced `unexpected EOF while looking for matching ` on every
  session end. The wrapper now escapes embedded single quotes via the
  POSIX `'\''` close-escape-reopen pattern. A new regression test in
  `tests/generators.test.ts` runs every generated `node -e` command
  through `bash -n` to syntax-check it without execution. Also renamed the
  remaining `[Engram]` / `Engram:` strings the Stop hooks emit (status
  messages + the destructive-git block reason) to use Knit branding.
- **`HOOKS_VERSION` bumped 4 → 5** so users who received the buggy v0.6.3
  hooks (or any earlier broken regeneration) get a clean rewrite on next
  brain load. The hooks-version mechanism exists exactly for this case.

### Changed

- **`KNIT_*` env vars are now first-class; legacy `ENGRAM_*` still honored.**
  - `KNIT_OFFLINE=1` disables network fetches (was `ENGRAM_OFFLINE=1`).
  - `KNIT_AGENT_REGISTRY_REF=main` overrides the pinned VoltAgent SHA
    (was `ENGRAM_AGENT_REGISTRY_REF`).
  - `KNIT_EXPORT_QUIET=1` silences the export-command summary (was
    `ENGRAM_EXPORT_QUIET`).
  - `KNIT_HOME` already shipped in v0.3.0; `ENGRAM_HOME` still honored.
  - README updated. Anyone with the legacy env vars set continues to work
    unchanged.

### Added

- `src/version.ts` — single source of truth for the package version.
- `src/mcp/sanitize.ts` — secret-pattern redaction helper.
- `tests/version.test.ts` — asserts the version centralization.
- `tests/sanitize.test.ts` — asserts secret patterns redact correctly.
- New concurrency test under `tests/learnings.test.ts`.

### Deferred to v0.7 (still)

- **CLAUDE.md token-cost trim (~16KB → ~6KB target).** Real rework
  touching the core protocol output. Held back from v0.6.3 deliberately —
  this is the public-link patch, and regressing the protocol surface
  before launch is the opposite of "make sure everything is proper."
- **Trivial-task fast path in `knit_classify_task`.** The classifier
  already returns a trivial tier with a minimal phase list (`EXECUTE →
  VERIFY → LEARN`). The remaining win is skipping the marker write for
  literally-typo-class tasks; routing-correctness regressions here would
  silently hurt Protocol Guard, so this needs its own focused PR.
- **Lazy-load `knit_load_session` response shape.** Inspection shows it
  already truncates aggressively (300-char session, 2KB handoff, top-5
  learnings only). Further trimming requires changing the loaded-context
  contract — a v0.7 concern, not a v0.6.3 patch.
- **CI workflow gating `npm publish`.** `prepublishOnly` runs typecheck +
  lint + test + build locally and has held the line through six releases.
  Adding a GitHub workflow is a v0.7 ergonomics improvement.

## [0.6.2] — 2026-05-18

### Fixed

- **Critical: `knit setup` was registering the MCP server with args
  pointing at the DEPRECATED `@piyushdua/engram-dev@latest` package.**
  Three source files (`src/commands/setup.ts`, `src/generators/settings.ts`,
  `src/mcp/server.ts`) still hardcoded the legacy scoped name — sed missed
  them during the v0.6.0 rename because the path-style `@piyushdua/engram-dev`
  string wasn't covered by the `engram-` pattern. Now all three correctly
  reference `knit-mcp@latest`. Anyone who ran `knit setup` between v0.6.0
  and v0.6.1 has a broken MCP registration that runs deprecated code; they
  should re-run `npx knit-mcp@latest setup` after upgrading.

## [0.6.1] — 2026-05-18

Metadata-only republish. No code changes.

### Fixed

- **npm README indexing.** v0.6.0's published metadata had `readme: ""` and
  `readmeFilename: null` in the registry — the README.md was correctly
  included in the tarball but the registry's indexed `readme` field was
  empty, causing the npmjs.com package page to render without the long-form
  content (badges, tool tables, install instructions). v0.6.1 republishes
  to force the registry to re-index README.md alongside the rest of the
  metadata.

## [0.6.0] — 2026-05-18

**Headline: project renamed from `engram` to `Knit`.** This is a breaking change.

### Why

The npm registry already had two prior-art packages in the same product
space — `engram-mcp` (engram-ai / danielwhyte.com, "MCP server for Engram:
persistent memory for AI") and `engram-ai` (mareo.ai, "small explicit memory
layer for AI agents"). Launching publicly under the `engram` name invited
trademark questions and positioned this project as a clone. With zero
external users today, the cost of renaming is at its lowest.

`Knit` is the new brand — it suggests the actual product mechanic:
sessions knitting together into compounding intelligence.

### Migration for existing v0.5.x users

- **New install command:** `npx knit-mcp@latest setup` (was `npx @piyushdua/engram-dev@latest setup`).
- **Data directory:** moved from `~/.engram/` to `~/.knit/`. Existing data is preserved at the old path — the new code reads from `~/.knit/` and falls back to `ENGRAM_HOME` env var so the migration path works.
- **MCP tool names:** all `engram_*` tools renamed to `knit_*` (e.g. `engram_classify_task` → `knit_classify_task`). 35 tools, all renamed.
- **Settings file:** `_engramHooks` and `_engramOwned` markers renamed to `_knitHooks` / `_knitOwned`. HOOKS_VERSION bumped 3 → 4; the auto-refresh path from v0.5.1 detects any settings.local.json with the old marker and regenerates cleanly via hybrid merge, preserving user-owned hooks and permissions.
- **Subagent files:** `<project>/.claude/agents/engram-<name>.md` → `<project>/.claude/agents/knit-<name>.md`. Path-resolution accepts both prefixes for back-compat reads.
- **Old package on npm:** `@piyushdua/engram-dev` will receive a `npm deprecate` notice pointing to `knit-mcp`.

### Changed

- Package name: `@piyushdua/engram-dev` → `knit-mcp`.
- CLI binary: `engram-dev` → `knit`.
- Repository: `github.com/PDgit12/engram` → `github.com/PDgit12/knit`.
- All 35 MCP tools renamed `engram_*` → `knit_*`.
- Env vars: `ENGRAM_HOME` → `KNIT_HOME` (legacy `ENGRAM_HOME` still honored).
- Settings markers: `_engramHooks` / `_engramOwned` → `_knitHooks` / `_knitOwned`.
- Generated CLAUDE.md markers: `<!-- engram:start -->` → `<!-- knit:start -->`.
- Sidecar filename: `.claude/ENGRAM.md` → `.claude/KNIT.md`.
- Internal types: `EngramConfig` → `KnitConfig`; `ENGRAM_MARKER_*` → `KNIT_MARKER_*`.
- Internal functions: `writeEngramHooks` → `writeKnitHooks`; `spliceEngramBlock` → `spliceKnitBlock`; `engramRoot` → `knitRoot`.
- Worktree slug prefix: `<repo>-engram-<team>-<ts>` → `<repo>-knit-<team>-<ts>`.

### Internal

- 299 tests still pass after the rename — no behavior change, only identifier rename.
- Sed-driven mechanical refactor across 50 source/test files; targeted Edits for back-compat regexes that accept both `knit-` and `engram-` prefixes.

## [0.5.2] — 2026-05-18

Audit-fix patch. Five doc drifts, two real code fixes, one new test file.

### Changed

- **README.md** — header `32 MCP Tools` → `35 MCP Tools`; added the four
  tools that were missing from the tool tables (`engram_prune_sessions`,
  `engram_install_agent`, `engram_set_protocol_strictness`,
  `engram_get_protocol_strictness`); test count `181 tests` → `295 tests`.
- **CLAUDE.md** — Phase Status: `latest → v0.4.1` updated to `v0.5.1` and
  added v0.4.2 / v0.5.0 / v0.5.1 release entries; Domain 2 (Engine) file
  list now includes `protocol-guard`; Domain 4 (MCP) tool count `33` → `35`;
  Domain 5 (QA) test count `272` → `295`.
- **src/engine/protocol-guard.ts** — `from 'fs'` → `from 'node:fs'` and
  `from 'path'` → `from 'node:path'`. The only file in src/ using bare
  module names instead of `node:*` prefix.
- **src/generators/settings.ts** — replaced two silent `catch (e) {}` blocks
  in the Protocol Guard PreToolUse hook with `console.error` logging.
  Previously a malformed `protocol-config.json` would silently fall through
  to warn-level with no diagnostic; now operators see why.

### Added

- **tests/cache.test.ts** — direct unit coverage for `maybeRefreshHooks`
  idempotency (per-process Set prevents double-refresh), malformed
  settings.local.json robustness (no crash on corrupt JSON), and
  `detectProjectRoot` cwd-fallback path. 299 tests total (+4).

## [0.5.1] — 2026-05-18

Upgrade-path fix for the Protocol Guard hooks shipped in v0.5.0. Without
this, existing v0.4.x users would never receive the new hooks — the
`writeEngramHooks` call only ran on first-time `autoInitialize`.

### Added

- **`HOOKS_VERSION` constant** in `src/generators/settings.ts` — single
  source of truth for the emitted `_engramHooks.version` field. Bumped to 3
  for v0.5.0+ (SessionStart, UserPromptSubmit, classification gate). Anyone
  whose settings file stamps an older version is treated as stale.
- **Auto-refresh on brain load** — `getBrain()` reads the project's
  `.claude/settings.local.json` once per process; if the stored hook version
  is below `HOOKS_VERSION`, `writeEngramHooks` runs to regenerate. Hybrid
  merge preserves user-owned hooks and permissions, only `_engramOwned`
  entries get refreshed.
- Two new tests in `tests/auto-init-hooks.test.ts` cover the upgrade path
  (stale v2 install → v3 with Protocol Guard hooks, user permissions
  survive) and the no-op case (current version untouched).

### Fixed

- Existing v0.4.x installs now auto-upgrade silently on next MCP call. No
  user action required, no `engram refresh` command needed.

## [0.5.0] — 2026-05-18

Headline feature: **Protocol Guard**. The engram workflow protocol is now
runtime-enforced via hooks, not just documented in CLAUDE.md. The protocol
went from skippable advice to a structural gate, modelled after the
"make wrong things hard, not just discouraged" principle.

### Added

- **`engram_set_protocol_strictness({ level: "off" | "warn" | "block" })`** —
  configures Protocol Guard behaviour per project. Default on install: `warn`.
- **`engram_get_protocol_strictness`** — reads the current level.
- **SessionStart hook** — drops a session-loaded marker and prints a reminder
  that `engram_load_session` should be the first MCP call.
- **UserPromptSubmit hook** — clears the per-turn classification marker so
  `engram_classify_task` must run fresh on every user turn before Edit/Write.
- **PreToolUse Edit/Write/MultiEdit gate** — reads
  `~/.engram/projects/<hash>/protocol-config.json` and the per-turn marker:
  - `level=off`: hook exits 0 (no checks).
  - `level=warn` + missing marker: prints a stderr reminder, exits 0.
  - `level=block` + missing marker: prints a block message, exits 2 (Claude
    Code refuses the Edit/Write).
- **`src/engine/protocol-guard.ts`** — pure-IO module for the strictness
  config and marker files, unit-tested in isolation.
- **`engram_classify_task` side effect** — every classification call writes
  `~/.engram/projects/<hash>/.classified-current` with the tier + files so the
  gate has something to read. Best-effort: marker write errors never break
  classification.
- **CLAUDE.md "system-reminder override" paragraph** — defends the protocol
  block against the harness's default `"this context may or may not be
  relevant"` wrapper that demotes user instructions to background.

### Changed

- Generator emits two new top-level hook arrays (`SessionStart`,
  `UserPromptSubmit`). The existing hybrid-merge logic in `src/mcp/cache.ts`
  already handles new event types per `_engramOwned: true` tagging — no
  changes needed there.
- Tool count: 33 → 35. Test assertions and metric badges updated accordingly.

### Internal

- New `tests/protocol-guard.test.ts` with 11 tests covering config
  round-trip, marker lifecycle, handler validation, and `handleClassifyTask`
  side-effect behaviour.
- `tests/generators.test.ts` extended with a Protocol Guard hook suite
  asserting the new SessionStart/UserPromptSubmit/PreToolUse entries are
  present, tagged `_engramOwned`, and cross-platform.

## [0.4.2] — 2026-05-18

Metadata-only patch. No code changes.

### Changed

- **package.json description** — dropped stale "20 tools" claim (real count
  is 33 since v0.4.1). New copy describes engram by capability (memory,
  workflow, worktrees) rather than tool count, so it doesn't drift on every
  release.
- **README** — fixed broken npm version badge (was pointing at unscoped
  `engram-dev`, now URL-encoded `@piyushdua/engram-dev` so shields.io
  resolves the real published package). Removed hardcoded `MCP_tools-32`
  badge for the same drift reason.
- **CLAUDE.md** — domain architecture section synced to actual `src/`:
  the `src/adapters/*` domain was fictional (never existed); replaced with
  the real `src/mcp/*` domain (server, handlers, tools, cache). Engine
  file list now lists the real 15 modules.

## [0.4.1] — 2026-05-17

Built across 4 parallel team worktrees using engram's own team-worktree
feature on itself. Each team owned one domain; the orchestrator merged
their branches back to main, ran integrated gates, shipped.

### Fixed (Team A — Correctness)

- **Agent-prefix wiring bug.** v0.4.0 had `agentsForRole()` returning
  unprefixed names (e.g., `typescript-pro`) while installing files as
  `engram-typescript-pro.md`. When the orchestrator said "spawn
  typescript-pro", Claude Code's Agent registry looked for
  `typescript-pro.md` and found either the user's own file or nothing —
  engram's personalized file was never invoked. Fixed: `agentsForRole`
  now returns `engram-`-prefixed names; `projectAgentFile` defensively
  strips a leading `engram-` to prevent double-prefixing; the fetcher
  accepts either form internally and looks up the bare name for category /
  URL / bundled-core resolution.
- **VoltAgent attribution gap.** v0.4.0 bundled-core agents had VoltAgent
  attribution (added by `vendor-agents.mjs`), but network-fetched agents
  were cached verbatim with no attribution. Fixed: `fetchAgent` now
  injects the same attribution HTML comment after the YAML frontmatter
  before caching. Both bundled and fetched agents now ship with proper
  upstream notice — MIT compliant.
- **`THIRD-PARTY-NOTICES.md`** added at the repo root and shipped in the
  npm package (`package.json` `files:` extended). Lists VoltAgent's
  project URL, license (MIT), pinned SHA, and the full MIT license text.

### Added (Team B — Memory hygiene)

- **`pruneSessionsByAge(rootPath, maxAgeDays)`** in `src/engine/sessions.ts`.
  Atomic temp+rename rewrite. Keeps entries with corrupted dates (we don't
  prove staleness from missing data).
- **`engram_prune_sessions` MCP tool** (tool count 32 → 33). Default 90
  days. Returns `{ kept, pruned, instruction }`.
- **Auto-prune on autoInit.** Fires deferred via `Promise.resolve().then`
  so it doesn't block MCP startup; errors swallowed to stderr.
- **Reflect uses global pool when local is sparse.** `reflect()` in
  `src/engine/reflect.ts` now merges entries from
  `~/.engram/global/learnings.jsonl` when the local KnowledgeBase has
  fewer than 3 entries. Each emitted `Pattern` carries a new
  `source: 'local' | 'global' | 'mixed'` annotation so callers can
  distinguish per-project from cross-project signals.

### Added (Team C — Hybrid hook merging)

- **Three-case `writeEngramHooks`:**
  1. **No file** → write fresh (current behavior).
  2. **File has `_engramHooks` marker** → overwrite (idempotent regen).
  3. **File exists without `_engramHooks`** → MERGE engram's hooks into
     existing user arrays, preserving user entries. Top-level keys
     (mcpServers, permissions) are preserved verbatim. Stale engram
     entries from prior merges (identified by `_engramOwned: true`) are
     stripped and replaced with current ones; user entries untouched.
- **Per-hook `_engramOwned: true` tag** on every entry engram pushes into
  PreToolUse / PostToolUse / Stop arrays. Claude Code ignores unknown
  fields, so this is purely metadata for engram's own regen logic.
- **`_engramHooks.merged: true`** in the top-level marker on merged files
  to distinguish from engram-owned files.

### Added (Team D — Obsidian export)

- **`engram export obsidian <vault-path>`** CLI command. Walks
  `~/.engram/projects/*/knowledgebase.json` (per-project learnings) and
  `~/.engram/global/learnings.jsonl` (global pool), writes one Markdown
  file per entry into the target Obsidian vault with YAML frontmatter
  (date, outcome, domains, source_project, tags) and inline `#tags`.
- **`<vault>/Engram Index.md`** auto-generated index page grouping
  learnings by tag, linked via `[[wikilinks]]`. Obsidian's graph view
  picks it up automatically.
- **`--filter <tag>`** option to scope export to a specific tag.
- Format argument is `obsidian` only in 0.4.1; structured for future
  extensibility (markdown plain, JSON dump, CSV, etc.).

### Tests

247 → 272 (+25 across the 4 teams):
- Team A added agent-prefix expectation tests, attribution presence test,
  prefix-handling for the fetcher, double-prefix protection for paths.
- Team B added prune coverage (kept/pruned counts, corruption handling)
  and a new `tests/reflect-global.test.ts` for the global-pool path.
- Team C added merge-mode tests (preserves user entries, strips stale
  engram entries, preserves top-level keys).
- Team D added a new `tests/export.test.ts` covering Obsidian export with
  seeded learnings + filter scoping.

### Process note (engram eating its own dogfood)

This release was built by spawning 4 parallel Agent calls with
`isolation: "worktree"`, each handling one domain in an isolated git
worktree. They committed their work to their branches; the orchestrator
merged each branch back to main, ran integrated gates, shipped. Same
team-worktree feature engram v0.4.0 exposed for users — used on engram
itself, proving the workflow round-trips.

## [0.4.0] — 2026-05-17

VoltAgent subagent integration with engram personalization. Closes the gap
where engram referenced agent names by string but didn't install them — fresh
users now get specialized subagents on first MCP call, no manual setup needed.

### Added

- **VoltAgent subagent integration.** Engram knows which curated agents from
  [github.com/VoltAgent/awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents)
  (MIT-licensed) match each domain role and project stack. On first MCP call,
  engram installs them into `<project>/.claude/agents/engram-<name>.md` so
  Claude Code's Agent tool finds them automatically.
- **Project personalization layer.** Each installed agent has the VoltAgent
  base prompt plus a marker-wrapped `<!-- engram:context:start --> ... <!-- engram:context:end -->`
  block with project name, stack, high-fanout files, recent relevant
  learnings (filtered by agent role), false positives to suppress, and the
  engram MCP tools the agent can call.
- **Three-tier fetch strategy.** Bundled-core agents (6 files in the npm
  package: `code-reviewer`, `security-engineer`, `qa-expert`, `typescript-pro`,
  `python-pro`, `golang-pro`) install with zero network. Specialized agents
  fetch from VoltAgent at a pinned SHA on first need and cache at
  `~/.engram/agents/cache/<sha>/`. Subsequent installs are local-only.
- **`engram install-agents` CLI command.** `--all` installs every known
  agent (not just project-needed); `--refresh` re-fetches from network even
  if cached. Useful for sandboxes, offline-then-online transitions, and CI
  prep.
- **`engram_install_agent` MCP tool.** Mid-session self-heal: if a team
  references an agent that isn't on disk, the orchestrator can install it
  on demand. Fire-and-forget — returns "queued" immediately, file lands in
  a few seconds for cached/bundled, longer for network fetches.
- **`ENGRAM_OFFLINE=1` env var.** Disables all network fetches. Bundled-core
  still installs; specialized agents surface a clean error pointing the user
  at `engram install-agents` when online.
- **`ENGRAM_AGENT_REGISTRY_REF` env var.** Override the pinned VoltAgent SHA
  (e.g., `main` to track latest, or a different SHA for reproducible builds).

### Changed

- **`scanner.ts::getAgentsForLanguage`** now delegates to the new
  `agent-registry.ts`. The names returned are real VoltAgent names that
  resolve to real .md files (vs v0.3's names that assumed Claude Code had
  agents installed by some other tool).
- **Tool count: 31 → 32** (+`engram_install_agent`).
- **Auto-init flow** now also writes per-project subagents alongside
  CLAUDE.md and `.claude/settings.local.json`. Fire-and-forget so MCP
  startup latency is unchanged.
- **Build script:** `npm run build` now also runs `npm run vendor-agents`
  to refresh `dist/agents/core/*.md` from the pinned VoltAgent SHA. Runs
  automatically on `prepublishOnly`.

### Attribution

The bundled-core agents are vendored verbatim from VoltAgent with an
attribution header (HTML comment after the YAML frontmatter). License:
MIT. Source: github.com/VoltAgent/awesome-claude-code-subagents at
commit `6f804f0cfab22fb62668855aa3d62ee3a1453077`.

### Privacy

Engram remains local-first. The only network condition is fetching a
specialized (non-bundled) agent on first need. That fetch goes to GitHub
raw, no auth, no cookies, no telemetry. After the first fetch, the agent
is cached and never re-fetched until `--refresh` is passed.

### Tests

201 → 247 (+46). New suites: `agent-registry.test.ts` (registry lookups,
URL composition, bundled-core consistency), `agent-fetcher.test.ts`
(three-tier resolution: bundled / cache / network; offline mode;
error paths with stubbed fetch), `agent-md.test.ts` (personalization,
marker safety, learning relevance filtering).

### Notes

- v0.3.1 (Windows hooks) shipped to git/GitHub but was NOT published to
  npm — its changes ship instead as part of v0.4.0.
- Hybrid hook merging, native Windows shell support beyond the Node-based
  hooks, Obsidian export, and JSONL pruning remain v0.5 candidates.

## [0.3.1] — 2026-05-17

Cross-platform fix. v0.3.0 hooks worked on macOS/Linux/WSL but silently
failed on native Windows shells (cmd.exe, PowerShell) because they used
unix-only utilities: `jq`, `find -mmin`, `printf '%s'`, `awk`, `sed`, `tr`,
`wc -l`, `tail`, `head`, `grep -qE`. None of those ship by default on
Windows. v0.3.1 rewrites all seven hooks as inline `node -e '...'` scripts
that run identically on every platform.

### Changed

- **All hooks rewritten as inline Node.** Each hook command is now a
  single-quoted `node -e '<script>'` invocation. Node is already an engram
  prerequisite (npm-installable), so no new runtime dependency. Scripts use
  Node's `fs`, `child_process`, regex, and `process.stdin` — all of which
  behave identically across Windows, macOS, Linux, and WSL.
- **Quoting strategy: single-quoted outer, double-quoted inner.** Single
  quotes preserve content literally on bash, zsh, PowerShell, and cmd.exe.
  JS strings inside use double quotes. No escape-character minefields.
- **Embedded paths use forward slashes.** `JSON.stringify(path.replace(/\\/g, '/'))`
  produces a path literal valid in any JS source, on any OS. Node accepts
  forward slashes on Windows too.
- **`_engramHooks.version` bumped 1 → 2.** Lets engram tell a v0.3.0 hook
  set (unix-only) from a v0.3.1 hook set (cross-platform) and regenerate
  cleanly. Existing v0.3.0 users will see their hooks regenerated on the
  next MCP call.
- **Permissions allowlist now includes `Bash(node:*)`** so the hook scripts
  themselves don't bump into Claude Code's command-permission system.

### Affected hooks

- **PreToolUse** Bash git-block — was `jq | grep -qE`; now Node regex over stdin
- **PostToolUse** typecheck on edit (TS/Python/Go/Rust) — was `jq | case`; now Node
- **Stop** build verification — was shell `&&`-chained; now Node sequential `execSync`
- **Stop** session log to `sessions.md` — was bash with `git log | sed`; now Node
- **Stop** sessions.jsonl tuple — was bash with `printf %s`; now Node
- **Stop** LEARN compliance soft reminder — was `find -mmin`; now Node `fs.statSync().mtimeMs`
- **Stop** KB metrics — already Node in v0.3.0, kept

### Tests

197 → 200 (+3): new cross-platform assertions in `generators.test.ts`:
- every hook command starts with `node -e ` (no shell-only)
- no hook contains `jq`, `find -mmin`, `printf '%s'`, `wc -l`, `tail`, `head`, `awk`, `sed`, `tr`
- no Windows backslash-escape patterns leak into embedded paths

Plus a live-fire smoke test confirmed the regenerated session.jsonl hook
runs cleanly via raw `node -e` invocation against a tmp git repo —
identical to how Claude Code would spawn it.

### Notes for v0.3.0 users

Open Claude Code in any engram-managed project. The first MCP call detects
the `_engramHooks.version: 1` marker, regenerates `.claude/settings.local.json`
to version 2, and from that point hooks work on every platform.

## [0.3.0] — 2026-05-17

Released alongside v0.2's architectural rebuild. Brought forward the items
originally scoped for v0.3 because they're complementary (Model C makes
pattern reflection useful again) and small enough to land cleanly without
delaying the v0.2 surface.

### Added

- **Cross-project learnings pool (Model C)** at `~/.engram/global/learnings.jsonl`. Opt-in: per-project `engram_record_learning` stays primary, but when an insight generalizes beyond the project it was discovered in (e.g., "Stripe webhook signature verification rules"), the agent can call `engram_record_global_learning`. Entries are tagged with the source project's hash + display name.
- **`engram_record_global_learning`** MCP tool — quality-gated like the per-project version; requires summary + lesson + tags.
- **`engram_search_global_learnings`** MCP tool — free-text search over the cross-project pool. Returns matches with their source project so the agent can attribute the lesson. Useful from a fresh project to see what you already know across all your machines' projects.
- **`engram_reflect`** and **`engram_get_suggestions`** MCP tools — back, with sensible guards. In v0.2 these were removed because patterns need ≥3 learnings to be useful and most projects start with one. Model C fixes that: a fresh project benefits from patterns across the global pool from day one.
- **Atomic write for the worktree registry.** Previously `worktrees.json` was written with a plain `writeFileSync`. If two engram MCP processes spawned worktrees concurrently, one could overwrite the other mid-write. Now uses temp-file + atomic rename. Eliminates the race without adding a lockfile dependency.
- **Fix: `.claude/settings.local.json` instead of `.claude/settings.json`** for engram hooks. (Strictly speaking a v0.2 fix discovered during release review, included here.) Teams that commit `.claude/settings.json` are now safe — engram only writes per-machine config to the conventionally-gitignored `*.local.json` file.

### Changed

- Tool count: 27 → 31 (+4: record_global_learning, search_global_learnings, reflect, get_suggestions).
- MCP server header description updated to reflect 31-tool surface and Model C.
- README + CHANGELOG note added about the global-learnings pool being opt-in.

### Tests

182 → 197 (+15). New suite: `global-learnings.test.ts` (15 tests across append, search, recent, count, build, parse-resilience).

### Migration

None needed. The global learnings pool is opt-in — it doesn't exist until the agent first calls `engram_record_global_learning`. Existing v0.2 (or v0.1 → v0.2 migrated) projects keep working unchanged. The version bump is feature-additive, not breaking.

### Still deferred (real v0.4 candidates)

- **Hybrid hook merging.** Currently engram's hook write is all-or-nothing per file. v0.4 should support appending engram's hooks to existing user-defined arrays in settings.local.json.
- **Native Windows hooks.** Stop hooks use bash shell syntax. Most Windows users on Claude Code run WSL, where it works. Native PowerShell support would require rewriting hooks as cross-platform Node scripts.
- **Obsidian export.** `engram export --format=obsidian` writes a vault with one note per learning + sessions as journal entries. Niche, deferred.
- **JSONL pruning.** sessions.jsonl is unbounded; 100 MB read-time guard exists but no automatic pruning. Revisit when a real project hits the limit.

## [0.2.0] — 2026-05-17

The v0.2 rebuild — engram becomes net-negative on tokens. Memory + workflow + parallel teams unified as one MCP-resident intelligence layer. Nine atomic commits across one arc.

### Added

- **Centralized data path** at `~/.engram/projects/<hash>/`. No more `.claude/` bloat in every repo. Worktree-aware project hash (`canonicalRepoRoot`) so all worktrees of one project share the same brain.
- **Searchable session memory** in `sessions.jsonl`. Two write paths: Stop hook auto-captures structured tuples (date, branch, files, commits), and the agent can opt into a narrative summary via `engram_save_session_summary`. Search across past sessions with `engram_search_sessions`.
- **Workflow on demand** via `engram_get_workflow({phase})`. 14 sections: overview, tier, phases, research, ideate, plan, execute, optimize, review, tdd, learn, handoff, ship, tools. Each is project-config-aware (embeds the project's actual build commands when relevant).
- **Token accounting** in `engram_brain_status.token_accounting`: per-session `claude_md_kb`, `session_count`, `learnings_hit_rate_pct`, plus actionable warnings when CLAUDE.md exceeds 30 KB or hit rate falls below 20 % with > 10 learnings.
- **Hooks wired for real.** Auto-init writes `.claude/settings.json` per project with engram's hook set. Tagged with `_engramHooks` marker for idempotent regeneration; never clobbers a user-curated settings.json (no marker → skip).
- **Marker-wrapped CLAUDE.md.** `<!-- engram:start --> ... <!-- engram:end -->` lets engram regenerate only the engram block, preserving everything else the user wrote. If your existing CLAUDE.md has no markers, engram writes a sidecar `.claude/ENGRAM.md` instead.
- **Parallel team worktrees.** New tools `engram_spawn_team_worktree`, `engram_list_team_worktrees`, `engram_finalize_team_worktree`. Each team works in its own sibling git worktree on a dedicated branch. Multiple agents within a team share the team's worktree. Merge conflicts surface conflict files without destroying work. Compatible with Claude Code's `EnterWorktree({path})`.
- **ENGRAM_HOME env var override** for sandboxed installs and tests.
- **One-shot migration** from legacy v0.1 `<project>/.claude/` data, with `<project>/.claude/MIGRATED.txt` breadcrumb explaining where the data went. No silent loss, no dual-writes.

### Changed

- **CLAUDE.md generator** rewritten from ~700 → ~100 lines per project (−85 % size). Project-facts-only: name, stack, project map, domain architecture, build gates, tier vocabulary, workflow pointer. The 6-phase protocol depth no longer lives in every project's CLAUDE.md.
- **`$HOME/CLAUDE.md`**: 46.6 KB → 0.5 KB stub. Workflow protocol is per-project + on-demand, not global.
- **Tool description rewrite.** All 27 descriptions trimmed to terse-by-design (avg 90 chars, was 146). Schema JSON: 12,574 → 9,712 bytes (−23 %).
- **Tier vocabulary** added (Inquiry / Trivial / Standard / Complex). Inquiry is new — read-only Q&A skips classification, phases, and LEARN entirely.
- **LEARN inverted from mandatory to quality-gated.** "If session N+1 searched for this tag, would this entry save them time? If no — don't write." Soft reminder hook (`ℹ LEARN was not recorded this session`) instead of the v0.1 enforcement scolding.
- **Plan mode triggers by phase, not by user keyword.** Auto-fires when the agent enters RESEARCH or PLAN. Discussion sessions never enter plan mode by accident.

### Removed

- `engram_reflect` and `engram_get_suggestions` MCP tools — premature with ~1 learning per project. Will re-enable in v0.3 once projects accumulate ≥ 10 learnings. The `reflect()` function itself is kept (still used internally to surface patterns in `engram_load_session`).
- `dash` CLI command — 284 undocumented lines, only imported by `cli.ts`. Removed cleanly.
- `src/adapters/` directory — empty stub claiming Cursor/Codex adapters that never existed.
- `cursor`, `codex` keywords from `package.json` (unsupported clients).
- All v0.1 marketing claims that didn't match the code: "22 project types", "650+ line workflow protocol", "20 MCP Tools" badge inconsistency.

### Fixed

- **Scanner walked $HOME on accidental invocation.** Added macOS home dirs (`Library`, `Caches`, `Downloads`, `Desktop`, `Documents`, `Movies`, `Music`, `Pictures`, `Public`, `Applications`) to `SKIP_DIRS`. Capped `highFanoutFiles` output at top 15 with `+N more` suffix.
- **Worktree-aware projectId.** v0.1 hashed by absolute path; opening two git worktrees of the same repo produced different hashes (and orphaned brains). Now hashes by canonical repo root via `gitdir` resolution.
- **Stale version strings** in `cli.ts` (was 0.1.9) and `mcp/server.ts` (was 0.1.0) now match `package.json`.

### Tests

111 → 181 (+70). New suites: `paths.test.ts`, `project-id.test.ts`, `auto-init-hooks.test.ts`, `sessions.test.ts`, `workflow-protocol.test.ts`, `worktrees.test.ts`. Test sandboxing via `ENGRAM_HOME` env var — tests never touch the real `~/.engram/`.

### Migration

Open Claude Code in a project that has v0.1 engram data. On the first MCP call, engram detects `<project>/.claude/knowledge.json`, copies all engram files forward to `~/.engram/projects/<hash>/`, and writes `<project>/.claude/MIGRATED.txt` explaining the move. The legacy `.claude/` directory is left intact — delete at your discretion.

## [0.1.11] — earlier

Pre-rebuild baseline. See git history for the v0.1.x line.
