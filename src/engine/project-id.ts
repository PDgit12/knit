import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';

/**
 * Stable per-project identity hash.
 *
 * Same canonical repository → same id forever. Used as the directory key
 * under ~/.engram/projects/<id>/ so engram data follows the project
 * across worktrees and doesn't bloat each repo's working tree.
 *
 * For a git worktree (`.git` is a file containing `gitdir: ...`),
 * the canonical repo root is the parent of `.git/worktrees/<name>` —
 * we resolve to that, so all worktrees of one project share a brain.
 *
 * sha256 truncated to 16 hex chars. 64 bits of entropy is enough
 * for any plausible number of projects on one machine.
 */
export function projectId(rootPath: string): string {
  const canonical = canonicalRepoRoot(rootPath);
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

/**
 * Resolve the canonical repo root for a path that may be a worktree.
 * If the input isn't a git repo or detection fails, returns the resolved
 * input path — safe fallback for non-git directories.
 */
export function canonicalRepoRoot(rootPath: string): string {
  const dotGit = join(rootPath, '.git');
  if (!existsSync(dotGit)) return resolve(rootPath);

  try {
    if (statSync(dotGit).isDirectory()) {
      // Canonical clone — .git is the repo itself
      return resolve(rootPath);
    }
  } catch {
    return resolve(rootPath);
  }

  // Worktree — .git is a file: `gitdir: <path>/.git/worktrees/<name>`
  try {
    const content = readFileSync(dotGit, 'utf-8');
    const match = content.match(/^gitdir:\s*(.+)$/m);
    if (!match) return resolve(rootPath);

    const gitDir = resolve(dirname(dotGit), match[1].trim());
    const marker = `${join('.git', 'worktrees')}`;
    const idx = gitDir.lastIndexOf(`/${marker}/`);
    if (idx === -1) return resolve(rootPath);
    return gitDir.slice(0, idx);
  } catch {
    return resolve(rootPath);
  }
}
