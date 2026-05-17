import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectId } from '../src/engine/project-id.js';

describe('projectId', () => {
  it('returns a 16-char hex string', () => {
    const id = projectId('/Users/test/some-project');
    expect(id).toMatch(/^[a-f0-9]{16}$/);
  });

  it('is stable — same path always returns the same id', () => {
    const a = projectId('/Users/test/some-project');
    const b = projectId('/Users/test/some-project');
    expect(a).toBe(b);
  });

  it('normalizes paths — trailing slash does not change the id', () => {
    expect(projectId('/Users/test/some-project'))
      .toBe(projectId('/Users/test/some-project/'));
  });

  it('normalizes paths — redundant segments do not change the id', () => {
    expect(projectId('/Users/test/some-project'))
      .toBe(projectId('/Users/test/./some-project'));
    expect(projectId('/Users/test/some-project'))
      .toBe(projectId('/Users/test/other/../some-project'));
  });

  it('different absolute paths produce different ids', () => {
    expect(projectId('/Users/test/project-a'))
      .not.toBe(projectId('/Users/test/project-b'));
  });

  it('handles paths with spaces and unusual chars', () => {
    const id = projectId('/Users/test/some project (v2)');
    expect(id).toMatch(/^[a-f0-9]{16}$/);
  });

  describe('worktree canonicalization', () => {
    let tmp: string;
    let mainRepo: string;
    let worktree: string;

    beforeAll(() => {
      tmp = mkdtempSync(join(tmpdir(), 'projid-wt-'));
      mainRepo = join(tmp, 'main-repo');
      worktree = join(tmp, 'worktree-branch');

      // Main repo: .git is a directory
      mkdirSync(join(mainRepo, '.git', 'worktrees', 'wt1'), { recursive: true });

      // Worktree: .git is a file pointing at main-repo/.git/worktrees/wt1
      mkdirSync(worktree, { recursive: true });
      writeFileSync(
        join(worktree, '.git'),
        `gitdir: ${join(mainRepo, '.git', 'worktrees', 'wt1')}\n`,
        'utf-8',
      );
    });

    afterAll(() => {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
    });

    it('main repo and its worktree resolve to the same id', () => {
      expect(projectId(mainRepo)).toBe(projectId(worktree));
    });

    it('worktree id is the same as if hashed from main repo path directly', () => {
      // Sanity: the worktree pathway should land on the main repo's canonical root.
      expect(projectId(worktree)).toBe(projectId(mainRepo));
    });

    it('falls back to resolved path when .git file is malformed', () => {
      const broken = join(tmp, 'broken');
      mkdirSync(broken, { recursive: true });
      writeFileSync(join(broken, '.git'), 'not a real gitdir line\n', 'utf-8');
      // Should not throw; should produce a stable id
      expect(projectId(broken)).toMatch(/^[a-f0-9]{16}$/);
    });
  });
});
