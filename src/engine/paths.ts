import { homedir } from 'node:os';
import { join } from 'node:path';
import { projectId } from './project-id.js';

/**
 * All engram data paths flow through here. No code outside this file
 * should construct paths into ~/.knit/ or <project>/.claude/ by string
 * concatenation — that's how the v0.1 codebase ended up with six scattered
 * disk-writers each using a slightly different convention.
 *
 * Canonical layout:
 *   ~/.knit/                                  ← all engram data
 *     projects/<hash>/                          ← one dir per project
 *       knowledge.json                          ← static-analysis brain
 *       knowledgebase.json                      ← learnings DB
 *       teams.json                              ← custom teams
 *       sessions.jsonl                          ← session memory (C4)
 *       learnings/<project-slug>.md             ← human-readable learnings
 *
 * The project's own CLAUDE.md stays at the project root (Claude Code
 * needs to find it). Everything else moves to ~/.knit/.
 */

/**
 * Root of all knit data, normally ~/.knit/.
 * Override with KNIT_HOME env var (useful for tests + sandboxed installs).
 * Back-compat: legacy ENGRAM_HOME env var is honored if KNIT_HOME unset.
 */
export function knitRoot(): string {
  return process.env.KNIT_HOME || process.env.ENGRAM_HOME || join(homedir(), '.knit');
}

/** Legacy v0.5.x path: ~/.engram/. Used only by the one-shot migration. */
export function legacyEngramRoot(): string {
  return process.env.ENGRAM_HOME || join(homedir(), '.engram');
}

/** ~/.knit/projects/<hash>/ — data dir for a specific project. */
export function projectDataDir(rootPath: string): string {
  return join(knitRoot(), 'projects', projectId(rootPath));
}

/** ~/.knit/projects/<hash>/knowledge.json */
export function knowledgePath(rootPath: string): string {
  return join(projectDataDir(rootPath), 'knowledge.json');
}

/** ~/.knit/projects/<hash>/knowledgebase.json */
export function knowledgebasePath(rootPath: string): string {
  return join(projectDataDir(rootPath), 'knowledgebase.json');
}

/** ~/.knit/projects/<hash>/teams.json */
export function teamsPath(rootPath: string): string {
  return join(projectDataDir(rootPath), 'teams.json');
}

/** ~/.knit/projects/<hash>/worktrees.json — registry of active team worktrees. */
export function worktreesRegistryPath(rootPath: string): string {
  return join(projectDataDir(rootPath), 'worktrees.json');
}

/** ~/.knit/global/ — opt-in cross-project data, never auto-populated. */
export function globalDataDir(): string {
  return join(knitRoot(), 'global');
}

/** ~/.knit/global/learnings.jsonl — opt-in cross-project learnings pool. */
export function globalLearningsPath(): string {
  return join(globalDataDir(), 'learnings.jsonl');
}

/** ~/.knit/agents/cache/<ref>/ — VoltAgent source cache, one dir per pinned ref. */
export function agentsCacheDir(ref: string): string {
  return join(knitRoot(), 'agents', 'cache', sanitizeRef(ref));
}

/** ~/.knit/agents/cache/<ref>/<category>/<name>.md — single cached source file. */
export function agentsCacheFile(ref: string, category: string, name: string): string {
  return join(agentsCacheDir(ref), category, `${name}.md`);
}

/** <project>/.claude/agents/ — Claude Code reads project-local agents from here. */
export function projectAgentsDir(rootPath: string): string {
  return join(rootPath, '.claude', 'agents');
}

/**
 * <project>/.claude/agents/knit-<name>.md — knit-managed agent for a project.
 *
 * Accepts a bare name (`typescript-pro`), a v0.6+ prefixed name
 * (`knit-typescript-pro`), or a legacy v0.5.x prefixed name
 * (`knit-typescript-pro`). The leading prefix is stripped before
 * composing the filename so callers can pass whichever they have.
 */
export function projectAgentFile(rootPath: string, name: string): string {
  const bare = name.replace(/^(knit|engram)-/, '');
  return join(projectAgentsDir(rootPath), `knit-${bare}.md`);
}

/** Refs can be SHAs or branch names; strip filesystem-unsafe chars for safety. */
function sanitizeRef(ref: string): string {
  return ref.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/** ~/.knit/projects/<hash>/sessions.jsonl — reserved for C4. */
export function sessionsJsonlPath(rootPath: string): string {
  return join(projectDataDir(rootPath), 'sessions.jsonl');
}

/** ~/.knit/projects/<hash>/protocol-config.json — Protocol Guard strictness. */
export function protocolConfigPath(rootPath: string): string {
  return join(projectDataDir(rootPath), 'protocol-config.json');
}

/** ~/.knit/projects/<hash>/.classified-current — per-turn classification marker. */
export function classificationMarkerPath(rootPath: string): string {
  return join(projectDataDir(rootPath), '.classified-current');
}

/** ~/.knit/projects/<hash>/.session-loaded — SessionStart auto-load marker. */
export function sessionMarkerPath(rootPath: string): string {
  return join(projectDataDir(rootPath), '.session-loaded');
}

/** ~/.knit/projects/<hash>/.searched-current — per-turn search marker.
 *  Written by knit_search_learnings / knit_search_global_learnings; cleared
 *  on UserPromptSubmit. The PreToolUse Edit gate reads it to enforce the
 *  "search before re-investigate" discipline on standard/complex tasks. */
export function searchMarkerPath(rootPath: string): string {
  return join(projectDataDir(rootPath), '.searched-current');
}

/** v0.11 slice 1 — ~/.knit/projects/<hash>/.claim-verified-current
 *  Per-turn marker written by knit_verify_claim. Cleared on UserPromptSubmit.
 *  The Stop hook reads it to enforce "verify ≥1 claim before LEARN" on
 *  standard/complex scope tasks — the anti-slop REVIEW gate. */
export function claimMarkerPath(rootPath: string): string {
  return join(projectDataDir(rootPath), '.claim-verified-current');
}

/** v0.11 slice 3 — ~/.knit/projects/<hash>/.turn-edits.jsonl
 *  Per-turn append-only log of file paths the agent has Edit/Write'd.
 *  Cleared on UserPromptSubmit. The Stop hook reads it and compares
 *  the touched set against the classification marker to surface scope
 *  drift (turn touched 8 files but original classification was trivial). */
export function turnEditLogPath(rootPath: string): string {
  return join(projectDataDir(rootPath), '.turn-edits.jsonl');
}

/** ~/.knit/projects/<hash>/features.json — opt-in feature flags (Tier 2/3 enable). */
export function featuresConfigPath(rootPath: string): string {
  return join(projectDataDir(rootPath), 'features.json');
}

/** ~/.knit/projects/<hash>/integrations.json — detected user workflow frameworks
 *  (Ruflo, gstack, CodeTour, custom CLAUDE.md sections, other MCP servers).
 *  Populated by the integration scanner; surfaced by knit_brain_status. */
export function integrationsConfigPath(rootPath: string): string {
  return join(projectDataDir(rootPath), 'integrations.json');
}

/** v0.10 slice 3 — ~/.knit/projects/<hash>/metrics-history.jsonl
 *  Weekly snapshots of the compounding-metrics surface. Append-only; each
 *  line is one frozen snapshot. Read by knit_get_metrics_history to compute
 *  week-over-week trends ("47% cheaper by week 8" style charts). */
export function metricsHistoryPath(rootPath: string): string {
  return join(projectDataDir(rootPath), 'metrics-history.jsonl');
}

/** ~/.knit/projects/<hash>/learnings/ */
export function learningsDir(rootPath: string): string {
  return join(projectDataDir(rootPath), 'learnings');
}

/** ~/.knit/projects/<hash>/learnings/<slug>.md */
export function learningsFilePath(rootPath: string, projectName: string): string {
  const slug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return join(learningsDir(rootPath), `${slug}.md`);
}

/** ~/.knit/projects/<hash>/learnings/sessions.md (legacy Stop-hook output). */
export function sessionsLogPath(rootPath: string): string {
  return join(learningsDir(rootPath), 'sessions.md');
}

/** Legacy v0.1 path: <project>/.claude/ — checked during migration. */
export function legacyClaudeDir(rootPath: string): string {
  return join(rootPath, '.claude');
}

/** Legacy v0.1 path: <project>/.claude/knowledge.json */
export function legacyKnowledgePath(rootPath: string): string {
  return join(legacyClaudeDir(rootPath), 'knowledge.json');
}

/** Legacy v0.1 path: <project>/.claude/knowledgebase.json */
export function legacyKnowledgebasePath(rootPath: string): string {
  return join(legacyClaudeDir(rootPath), 'knowledgebase.json');
}

/** Legacy v0.1 path: <project>/.claude/teams.json */
export function legacyTeamsPath(rootPath: string): string {
  return join(legacyClaudeDir(rootPath), 'teams.json');
}

/** Legacy v0.1 path: <project>/.claude/learnings/ */
export function legacyLearningsDir(rootPath: string): string {
  return join(legacyClaudeDir(rootPath), 'learnings');
}

/** Breadcrumb dropped at <project>/.claude/MIGRATED.txt after a one-shot migration. */
export function migrationBreadcrumbPath(rootPath: string): string {
  return join(legacyClaudeDir(rootPath), 'MIGRATED.txt');
}
