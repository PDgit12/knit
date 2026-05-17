import { homedir } from 'node:os';
import { join } from 'node:path';
import { projectId } from './project-id.js';

/**
 * All engram data paths flow through here. No code outside this file
 * should construct paths into ~/.engram/ or <project>/.claude/ by string
 * concatenation — that's how the v0.1 codebase ended up with six scattered
 * disk-writers each using a slightly different convention.
 *
 * Canonical layout:
 *   ~/.engram/                                  ← all engram data
 *     projects/<hash>/                          ← one dir per project
 *       knowledge.json                          ← static-analysis brain
 *       knowledgebase.json                      ← learnings DB
 *       teams.json                              ← custom teams
 *       sessions.jsonl                          ← session memory (C4)
 *       learnings/<project-slug>.md             ← human-readable learnings
 *
 * The project's own CLAUDE.md stays at the project root (Claude Code
 * needs to find it). Everything else moves to ~/.engram/.
 */

/**
 * Root of all engram data, normally ~/.engram/.
 * Override with ENGRAM_HOME env var (useful for tests + sandboxed installs).
 */
export function engramRoot(): string {
  return process.env.ENGRAM_HOME || join(homedir(), '.engram');
}

/** ~/.engram/projects/<hash>/ — data dir for a specific project. */
export function projectDataDir(rootPath: string): string {
  return join(engramRoot(), 'projects', projectId(rootPath));
}

/** ~/.engram/projects/<hash>/knowledge.json */
export function knowledgePath(rootPath: string): string {
  return join(projectDataDir(rootPath), 'knowledge.json');
}

/** ~/.engram/projects/<hash>/knowledgebase.json */
export function knowledgebasePath(rootPath: string): string {
  return join(projectDataDir(rootPath), 'knowledgebase.json');
}

/** ~/.engram/projects/<hash>/teams.json */
export function teamsPath(rootPath: string): string {
  return join(projectDataDir(rootPath), 'teams.json');
}

/** ~/.engram/projects/<hash>/worktrees.json — registry of active team worktrees. */
export function worktreesRegistryPath(rootPath: string): string {
  return join(projectDataDir(rootPath), 'worktrees.json');
}

/** ~/.engram/global/ — opt-in cross-project data, never auto-populated. */
export function globalDataDir(): string {
  return join(engramRoot(), 'global');
}

/** ~/.engram/global/learnings.jsonl — opt-in cross-project learnings pool. */
export function globalLearningsPath(): string {
  return join(globalDataDir(), 'learnings.jsonl');
}

/** ~/.engram/agents/cache/<ref>/ — VoltAgent source cache, one dir per pinned ref. */
export function agentsCacheDir(ref: string): string {
  return join(engramRoot(), 'agents', 'cache', sanitizeRef(ref));
}

/** ~/.engram/agents/cache/<ref>/<category>/<name>.md — single cached source file. */
export function agentsCacheFile(ref: string, category: string, name: string): string {
  return join(agentsCacheDir(ref), category, `${name}.md`);
}

/** <project>/.claude/agents/ — Claude Code reads project-local agents from here. */
export function projectAgentsDir(rootPath: string): string {
  return join(rootPath, '.claude', 'agents');
}

/**
 * <project>/.claude/agents/engram-<name>.md — engram-managed agent for a project.
 *
 * Accepts either a bare name (`typescript-pro`) or an already-prefixed name
 * (`engram-typescript-pro`). The leading `engram-` is stripped before
 * composing the filename so callers can pass whichever they have.
 */
export function projectAgentFile(rootPath: string, name: string): string {
  const bare = name.replace(/^engram-/, '');
  return join(projectAgentsDir(rootPath), `engram-${bare}.md`);
}

/** Refs can be SHAs or branch names; strip filesystem-unsafe chars for safety. */
function sanitizeRef(ref: string): string {
  return ref.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/** ~/.engram/projects/<hash>/sessions.jsonl — reserved for C4. */
export function sessionsJsonlPath(rootPath: string): string {
  return join(projectDataDir(rootPath), 'sessions.jsonl');
}

/** ~/.engram/projects/<hash>/learnings/ */
export function learningsDir(rootPath: string): string {
  return join(projectDataDir(rootPath), 'learnings');
}

/** ~/.engram/projects/<hash>/learnings/<slug>.md */
export function learningsFilePath(rootPath: string, projectName: string): string {
  const slug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return join(learningsDir(rootPath), `${slug}.md`);
}

/** ~/.engram/projects/<hash>/learnings/sessions.md (legacy Stop-hook output). */
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
