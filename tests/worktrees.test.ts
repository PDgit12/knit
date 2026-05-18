import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnWorktree, listWorktrees, finalizeWorktree } from '../src/engine/worktrees.js';
import { worktreesRegistryPath } from '../src/engine/paths.js';

/**
 * These tests exercise real git operations against a tmpdir repository.
 * That's intentional — worktree behavior is tricky enough that mocking
 * git would defeat the point. Each test cleans up its own tree.
 */

describe('worktrees', () => {
  let knitHome: string;
  let repoRoot: string;
  let parentDir: string; // contains repoRoot and any sibling worktrees

  beforeAll(() => {
    knitHome = mkdtempSync(join(tmpdir(), 'knit-worktrees-test-'));
    process.env.KNIT_HOME = knitHome;
  });

  afterAll(() => {
    delete process.env.KNIT_HOME;
    try { rmSync(knitHome, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  beforeEach(() => {
    parentDir = mkdtempSync(join(tmpdir(), 'knit-wt-repo-'));
    repoRoot = join(parentDir, 'main-repo');
    execSync(`mkdir -p ${repoRoot}`, { stdio: 'pipe' });
    execSync('git init -q -b main', { cwd: repoRoot, stdio: 'pipe' });
    execSync('git config user.email "test@example.com"', { cwd: repoRoot, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: repoRoot, stdio: 'pipe' });
    writeFileSync(join(repoRoot, 'README.md'), '# Test repo\n', 'utf-8');
    execSync('git add . && git commit -q -m "initial"', { cwd: repoRoot, stdio: 'pipe' });
  });

  afterEach(() => {
    try {
      // Best-effort cleanup: remove any worktrees git knows about
      execSync('git worktree list --porcelain', { cwd: repoRoot, encoding: 'utf-8' });
    } catch { /* repo may already be gone */ }
    try { rmSync(parentDir, { recursive: true, force: true }); } catch { /* best effort */ }
    // Clean per-project engram dir between tests so registry is fresh
    try { rmSync(join(knitHome, 'projects'), { recursive: true, force: true }); } catch { /* best */ }
  });

  describe('spawnWorktree', () => {
    it('creates a sibling worktree on a new branch', () => {
      const rec = spawnWorktree(repoRoot, 'UI', 'Build login page');
      expect(rec.teamName).toBe('UI');
      expect(rec.teamSlug).toBe('ui');
      expect(rec.branch).toMatch(/^knit\/team-ui-\d+$/);
      expect(existsSync(rec.path)).toBe(true);
      expect(rec.path).toContain('main-repo-knit-ui-');
      expect(rec.status).toBe('active');

      // Verify git sees it
      const out = execSync('git worktree list --porcelain', { cwd: repoRoot, encoding: 'utf-8' });
      expect(out).toContain(rec.path);
      expect(out).toContain(rec.branch);
    });

    it('registers the worktree in worktrees.json', () => {
      spawnWorktree(repoRoot, 'API', 'Refactor auth');
      const registryPath = worktreesRegistryPath(repoRoot);
      expect(existsSync(registryPath)).toBe(true);
      const reg = JSON.parse(readFileSync(registryPath, 'utf-8'));
      expect(reg.version).toBe(1);
      expect(reg.worktrees).toHaveLength(1);
      expect(reg.worktrees[0].teamSlug).toBe('api');
    });

    it('refuses to spawn a second active worktree for the same team', () => {
      spawnWorktree(repoRoot, 'UI', 'Task one');
      expect(() => spawnWorktree(repoRoot, 'UI', 'Task two')).toThrow(/already has an active worktree/);
    });

    it('allows different teams to have concurrent worktrees', () => {
      const a = spawnWorktree(repoRoot, 'UI', 'UI work');
      const b = spawnWorktree(repoRoot, 'API', 'API work');
      expect(a.path).not.toBe(b.path);
      expect(a.branch).not.toBe(b.branch);

      const list = listWorktrees(repoRoot);
      expect(list).toHaveLength(2);
    });

    it('slugifies non-alphanumeric team names', () => {
      const rec = spawnWorktree(repoRoot, 'API & Security', 'task');
      expect(rec.teamSlug).toBe('api-security');
      expect(rec.path).toContain('-knit-api-security-');
    });
  });

  describe('listWorktrees', () => {
    it('returns active worktrees by default', () => {
      spawnWorktree(repoRoot, 'UI', 'task');
      expect(listWorktrees(repoRoot)).toHaveLength(1);
    });

    it('returns empty when none spawned', () => {
      expect(listWorktrees(repoRoot)).toEqual([]);
    });

    it('marks orphans as discarded when their directory has been deleted', () => {
      const rec = spawnWorktree(repoRoot, 'UI', 'task');
      rmSync(rec.path, { recursive: true, force: true });
      const active = listWorktrees(repoRoot);
      expect(active).toHaveLength(0);

      const all = listWorktrees(repoRoot, true);
      expect(all).toHaveLength(1);
      expect(all[0].status).toBe('discarded');
    });
  });

  describe('finalizeWorktree — discard', () => {
    it('removes the worktree and branch', () => {
      const rec = spawnWorktree(repoRoot, 'UI', 'task');
      const result = finalizeWorktree(repoRoot, 'UI', 'discard');
      expect(result.status).toBe('discarded');
      expect(existsSync(rec.path)).toBe(false);

      // Branch should be gone
      const out = execSync('git branch --list', { cwd: repoRoot, encoding: 'utf-8' });
      expect(out).not.toContain(rec.branch);
    });

    it('updates registry status to discarded', () => {
      spawnWorktree(repoRoot, 'UI', 'task');
      finalizeWorktree(repoRoot, 'UI', 'discard');
      const all = listWorktrees(repoRoot, true);
      expect(all[0].status).toBe('discarded');
    });
  });

  describe('finalizeWorktree — merge', () => {
    it('merges a non-conflicting branch into main', () => {
      const rec = spawnWorktree(repoRoot, 'UI', 'add a file');
      // Commit something in the worktree
      writeFileSync(join(rec.path, 'feature.txt'), 'hello from team UI\n', 'utf-8');
      execSync('git add . && git commit -q -m "ui: add feature.txt"', { cwd: rec.path, stdio: 'pipe' });

      const result = finalizeWorktree(repoRoot, 'UI', 'merge');
      expect(result.status).toBe('merged');

      // feature.txt should now be in the main repo
      expect(existsSync(join(repoRoot, 'feature.txt'))).toBe(true);
      // Worktree gone
      expect(existsSync(rec.path)).toBe(false);
    });

    it('reports conflict files without destroying the worktree', () => {
      const rec = spawnWorktree(repoRoot, 'UI', 'edit README');
      // Both sides edit README.md to conflicting content
      writeFileSync(join(rec.path, 'README.md'), '# Team UI rewrite\n', 'utf-8');
      execSync('git add . && git commit -q -m "ui: rewrite readme"', { cwd: rec.path, stdio: 'pipe' });

      writeFileSync(join(repoRoot, 'README.md'), '# Main branch rewrite\n', 'utf-8');
      execSync('git add . && git commit -q -m "main: rewrite readme"', { cwd: repoRoot, stdio: 'pipe' });

      const result = finalizeWorktree(repoRoot, 'UI', 'merge');
      expect(result.status).toBe('conflict');
      expect(result.conflictFiles).toContain('README.md');
      // Worktree should NOT be destroyed on conflict
      expect(existsSync(rec.path)).toBe(true);
      // Abort the half-merged state so afterEach cleanup doesn't fail
      try { execSync('git merge --abort', { cwd: repoRoot, stdio: 'pipe' }); } catch { /* */ }
    });

    it('throws when finalizing a team with no active worktree', () => {
      expect(() => finalizeWorktree(repoRoot, 'NonExistent', 'discard'))
        .toThrow(/No active worktree found/);
    });
  });
});
