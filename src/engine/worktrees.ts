import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, basename, resolve, join } from 'node:path';
import { worktreesRegistryPath, projectDataDir } from './paths.js';
import { canonicalRepoRoot } from './project-id.js';

/**
 * Team-scoped git worktrees.
 *
 * The dev-team mental model: each TEAM gets one worktree. Multiple agents
 * within that team can work in parallel inside the same worktree (sharing
 * state) without interfering with other teams. The orchestrator collects
 * each team's result, runs gates, and merges back to the main branch.
 *
 * Worktrees are sibling directories to the main repo (git's native pattern):
 *   /Users/p/my-repo            <- main checkout
 *   /Users/p/my-repo-knit-ui  <- UI team worktree
 *   /Users/p/my-repo-knit-api <- API team worktree
 *
 * We never auto-resolve merge conflicts. If `git merge` fails, we surface
 * the conflict file list back to the orchestrator and leave the worktree
 * + branch intact so the user (or a follow-up agent) can resolve manually.
 */

export interface WorktreeRecord {
  /** Display name of the team (e.g., "API & Security"). */
  teamName: string;
  /** Slugified team name used in filesystem paths + branch names. */
  teamSlug: string;
  /** Absolute path to the worktree's working directory. */
  path: string;
  /** Branch name (e.g., "knit/team-api-security-<timestamp>"). */
  branch: string;
  /** What the team is being asked to do. */
  taskDescription: string;
  /** ISO 8601. */
  createdAt: string;
  status: 'active' | 'merged' | 'discarded';
}

interface Registry {
  version: 1;
  worktrees: WorktreeRecord[];
}

const EMPTY_REGISTRY: Registry = { version: 1, worktrees: [] };

// ── Public API ───────────────────────────────────────────────────

export function spawnWorktree(
  rootPath: string,
  teamName: string,
  taskDescription: string,
): WorktreeRecord {
  const repoRoot = canonicalRepoRoot(rootPath);
  const slug = slugify(teamName);
  const ts = Date.now();
  const branch = `knit/team-${slug}-${ts}`;
  const worktreePath = resolve(dirname(repoRoot), `${basename(repoRoot)}-knit-${slug}-${ts}`);

  // Fail loudly if a worktree for this exact slug+ts already exists (race condition / re-spawn)
  if (existsSync(worktreePath)) {
    throw new Error(`Worktree path already exists: ${worktreePath}`);
  }

  // Refuse to spawn if the team already has an active worktree
  const registry = loadRegistry(rootPath);
  const existing = registry.worktrees.find(
    (w) => w.teamSlug === slug && w.status === 'active',
  );
  if (existing) {
    throw new Error(
      `Team "${teamName}" already has an active worktree at ${existing.path}. ` +
      `Finalize it before spawning a new one.`,
    );
  }

  // git worktree add -b <branch> <path>
  // v0.15 (audit B10): execFile + array args — no shell, no quoting surface.
  try {
    execFileSync('git', ['worktree', 'add', '-b', branch, worktreePath], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`git worktree add failed: ${msg}`);
  }

  const record: WorktreeRecord = {
    teamName,
    teamSlug: slug,
    path: worktreePath,
    branch,
    taskDescription,
    createdAt: new Date().toISOString(),
    status: 'active',
  };

  registry.worktrees.push(record);
  saveRegistry(rootPath, registry);
  return record;
}

export function listWorktrees(rootPath: string, includeFinalized = false): WorktreeRecord[] {
  const registry = loadRegistry(rootPath);
  // Reconcile against the filesystem: anything in the registry but missing on disk is stale
  for (const wt of registry.worktrees) {
    if (wt.status === 'active' && !existsSync(wt.path)) {
      wt.status = 'discarded';
    }
  }
  saveRegistry(rootPath, registry);

  return includeFinalized
    ? registry.worktrees
    : registry.worktrees.filter((w) => w.status === 'active');
}

export interface FinalizeResult {
  status: 'merged' | 'discarded' | 'conflict';
  worktree: WorktreeRecord;
  /** Files in conflict (only set when status === 'conflict'). */
  conflictFiles?: string[];
  /** Stderr from git when something failed. */
  message?: string;
}

export function finalizeWorktree(
  rootPath: string,
  teamSlugOrName: string,
  action: 'merge' | 'discard',
): FinalizeResult {
  const registry = loadRegistry(rootPath);
  const slug = slugify(teamSlugOrName);
  const record = registry.worktrees.find(
    (w) => w.status === 'active' && (w.teamSlug === slug || w.teamName === teamSlugOrName),
  );
  if (!record) {
    throw new Error(`No active worktree found for team "${teamSlugOrName}".`);
  }

  const repoRoot = canonicalRepoRoot(rootPath);

  if (action === 'discard') {
    try {
      execFileSync('git', ['worktree', 'remove', '--force', record.path], { cwd: repoRoot, stdio: 'pipe' });
    } catch { /* worktree may already be gone; continue */ }
    try {
      execFileSync('git', ['branch', '-D', record.branch], { cwd: repoRoot, stdio: 'pipe' });
    } catch { /* branch may already be gone; continue */ }
    record.status = 'discarded';
    saveRegistry(rootPath, registry);
    return { status: 'discarded', worktree: record };
  }

  // Merge: try `git merge --no-ff <branch>` from the main repo's current branch.
  try {
    execFileSync('git', ['merge', '--no-ff', record.branch], { cwd: repoRoot, stdio: 'pipe' });
  } catch (err) {
    // Detect merge conflicts and report them
    let conflictFiles: string[] = [];
    try {
      const out = execFileSync('git', ['diff', '--name-only', '--diff-filter=U'], { cwd: repoRoot, encoding: 'utf-8' });
      conflictFiles = out.split('\n').map((s) => s.trim()).filter(Boolean);
    } catch { /* ignore */ }

    const msg = err instanceof Error ? err.message : String(err);
    // Don't unregister — leave the worktree alive so the user can resolve
    return {
      status: 'conflict',
      worktree: record,
      conflictFiles,
      message: `Merge conflict. Resolve in ${repoRoot}, then call knit_finalize_worktree again with action='merge' to retry, or 'discard' to throw away. ${msg}`,
    };
  }

  // Merge succeeded — clean up the worktree and branch
  try {
    execFileSync('git', ['worktree', 'remove', record.path], { cwd: repoRoot, stdio: 'pipe' });
  } catch { /* worktree may have been removed manually */ }
  try {
    execFileSync('git', ['branch', '-d', record.branch], { cwd: repoRoot, stdio: 'pipe' });
  } catch { /* branch keep — it's already merged but not deletable */ }

  record.status = 'merged';
  saveRegistry(rootPath, registry);
  return { status: 'merged', worktree: record };
}

// ── internals ────────────────────────────────────────────────────

function loadRegistry(rootPath: string): Registry {
  const path = worktreesRegistryPath(rootPath);
  if (!existsSync(path)) return { ...EMPTY_REGISTRY, worktrees: [] };
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    if (data && data.version === 1 && Array.isArray(data.worktrees)) {
      return data as Registry;
    }
  } catch { /* fall through to empty */ }
  return { ...EMPTY_REGISTRY, worktrees: [] };
}

function saveRegistry(rootPath: string, registry: Registry): void {
  const path = worktreesRegistryPath(rootPath);
  mkdirSync(projectDataDir(rootPath), { recursive: true });
  // Atomic write: temp + rename. Prevents the partial-file race that would
  // happen if two engram MCP processes spawned worktrees concurrently and
  // one overwrote mid-write of the other.
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(registry, null, 2), 'utf-8');
  renameSync(tmp, path);
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// v0.15 (audit B10): removed shellQuote() — all git invocations now use
// execFileSync with array args, which never invokes a shell. No quoting
// surface, no injection vector.

// Re-exported for tests that need to inspect paths.
export { join as _testJoin };
