import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Write a file atomically: write to a temp file then rename into place.
 * Rename is atomic on POSIX, so a mid-write crash leaves either the prior
 * file or the new one — never a torn/partial write.
 *
 * Same pattern already used by sessions.ts, knowledgebase.ts, worktrees.ts;
 * factored out for the v0.14.1 atomicity sweep across cache.ts, setup.ts,
 * teams.ts.
 */
export function writeFileAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, content, 'utf-8');
  renameSync(tmp, path);
}
