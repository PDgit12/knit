# Changelog

All notable changes to engram. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); engram uses [Semantic Versioning](https://semver.org/).

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
