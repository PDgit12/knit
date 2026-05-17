# Changelog

All notable changes to engram. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); engram uses [Semantic Versioning](https://semver.org/).

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
