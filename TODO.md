# Knit — Production-Readiness TODO

Ranked list of fixes from the May 2026 production audit. CRITICAL items have shipped in commit `<see git log>`. Everything below is still open.

Severity rubric:
- 🔴 **CRITICAL** — data loss / silent corruption / external-user-blocking
- 🟠 **HIGH** — fix before v1.0 freeze (MCP contract becomes immutable)
- 🟡 **MEDIUM** — fix before public beta
- 🟢 **LOW** — cleanup pass

---

## ✅ Shipped

- [x] **C1** — atomic `saveKnowledgeBase` via temp + renameSync · `engine/knowledgebase.ts`
- [x] **C2** — `appendSession` try/catch + stderr log + rethrow · `engine/sessions.ts`
- [x] **C3** — `loadKnowledgeBaseSafe` with `loadFailed` flag; cache skips re-save when load failed · `engine/knowledgebase.ts`, `mcp/cache.ts`
- [x] **H4** — `redactSecrets` on session summaries · `mcp/handlers.ts`
- [x] **M4** — added Stripe (live/test), Google API, JWT patterns to `sanitize.ts`

## 🟠 HIGH — open

- [ ] **H1** — Typed MCP input schemas. Replace `Record<string, string>` with per-tool `inputSchema.properties.type` (number/boolean/string/enum) so callers can pass typed payloads. **Breaking change — do this before v1.0 freeze or never.** · `mcp/tools.ts:33-42, 406`
- [ ] **H2** — Add `enum: [...]` to schema for every discriminated union in `types.ts` (tier, outcome, level, etc.). · `mcp/tools.ts`
- [ ] **H3** — Fix `handleInstallAgent` fire-and-forget. Either await the install or expose `knit_get_install_status` polling. · `mcp/handlers.ts:1953`
- [ ] **H5** — Log to stderr before catch in `writeClassificationMarker`. Silent failure in `block` mode is undebuggable. · `mcp/handlers.ts:1053, 1003`
- [ ] **H6** — Write migration test for `migrateLegacyData`. Create temp project with legacy `.claude/`, run `refreshBrain`, assert centralized state + breadcrumb. Zero coverage today; every v0.1→v0.2+ user runs this path. · `tests/cache.test.ts`
- [ ] **H7** — stdio round-trip integration test. Spawn CLI as child process, send `tools/list` JSON-RPC over stdin, assert valid MCP response. Catches a whole class of SDK-boundary bugs. · new `tests/mcp-server-integration.test.ts`

## 🟡 MEDIUM — open

- [ ] **M1** — Split `handlers.ts` (2142 lines) into `handlers/{query,learnings,sessions,teams,worktrees,features,protocol,classify}.ts` + barrel re-export. Section banners already exist; the cut is mechanical.
- [ ] **M2** — Standardize error envelope across all handlers on `{ ok: false, error: string }`. Today: two shapes coexist (`{error}` and `{status:'error', error}`).
- [ ] **M3** — Layer cleanup:
  - `handlers.ts:11` imports `scanProject` directly → route through `brain.config.domains`
  - `handlers.ts:19` imports `getWorkflowSection` from `generators/` → move into engine
- [ ] **M5** — Path-traversal allowlist for agent names. Validate `/^[a-z0-9][a-z0-9_-]*$/` in `paths.ts:97` before `join`. Today `bare = name.replace(/^(knit|engram)-/, '')` accepts `../../etc/passwd`.
- [ ] **M6** — Surface `teams_load_error: true` in `knit_load_session` response when `teams.json` is corrupt. Today: silently returns `teams: []`.
- [ ] **M7** — Log stderr warning in `writeKnitHooks` when `settings.local.json` is malformed. Today: silently skips, user loses hook enforcement with no clue. · `mcp/cache.ts:372`
- [ ] **M8** — Template-literal tag type `type Tag = \`#${string}\``. Agents passing `'auth'` instead of `'#auth'` silently produce unfindable entries. · `types.ts:62, 228, 319`
- [ ] **M9** — Eliminate `LearningEntry`↔`KBEntry` duplication. `type LearningEntry = Omit<KBEntry, 'id'|'accessCount'|'lastAccessed'>`. · `types.ts:55-63 vs 224-237`
- [ ] **M10** — Lockfile or append-aware prune for the concurrent `appendSession` + `pruneSessionsByAge` race. Today: append between read-and-rename → entry vanishes.

## 🟢 LOW — cleanup

- [ ] **L1** — Replace single-slot brain cache with `Map<rootPath, BrainCache>`. · `mcp/cache.ts:42`
- [ ] **L2** — try/catch around `readFileSync(pyproject.toml)` in scanner. · `engine/scanner.ts:101`
- [ ] **L3** — `O_NOFOLLOW` / `realpathSync` check before writing `CLAUDE.md` and `.claude/settings.local.json`. Symlink attack surface.
- [ ] **L4** — Cross-platform hook test: parse the generated hook string with PowerShell `-Command`, not just `bash -n`. · `tests/generators.test.ts`
- [ ] **L5** — `commits?: string` (space-separated) → `commits?: string[]`. Invariant in comment, not type. · `types.ts:314`
- [ ] **L6** — Split `SessionSummary` into `HookWrittenSession | AgentWrittenSession`. Currently `summary` is optional (the main searchable field!) while `outcome` is required — inversion. · `types.ts`

---

## Suggested execution order

**Week 1 (this week)** — close HIGH:
H1 + H2 together (one MCP schema overhaul), then H5, H6, H7, H3.

**Week 2** — public-beta polish:
M1 (split handlers.ts), M2 (error envelope), M3 (layer fixes), M5 (path allowlist), M7 (hook log).

**Week 3** — type design + cleanup:
M8, M9, M10, all L's.

**Dogfood:** use `knit_spawn_team_worktree` for the Week 1 work — three parallel teams (`api-contract`, `safety-fixes`, `tests`) writing simultaneously. This is exactly the v0.4.1 dogfooding story and gives you a real interview narrative.
