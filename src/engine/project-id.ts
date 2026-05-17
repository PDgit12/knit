import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

/**
 * Stable per-project identity hash.
 *
 * Same absolute path → same id forever. Used as the directory key
 * under ~/.engram/projects/<id>/ so engram data follows the project
 * across worktrees and doesn't bloat each repo's working tree.
 *
 * sha256 truncated to 16 hex chars. 64 bits of entropy is enough
 * for any plausible number of projects on one machine; full sha256
 * would be wasted bytes in path names.
 */
export function projectId(rootPath: string): string {
  const normalized = resolve(rootPath);
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}
