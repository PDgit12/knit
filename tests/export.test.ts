import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportCommand } from '../src/commands/export.js';
import { knitRoot, globalLearningsPath } from '../src/engine/paths.js';
import type { KnowledgeBase, KBEntry, GlobalLearning } from '../src/engine/types.js';

function makeKBEntry(overrides: Partial<KBEntry>): KBEntry {
  return {
    id: `id-${Math.random().toString(36).slice(2, 8)}`,
    date: '2026-05-17',
    summary: 'placeholder summary',
    domains: ['core'],
    approach: 'placeholder approach',
    outcome: 'success',
    lesson: 'placeholder lesson',
    tags: ['#test'],
    accessCount: 0,
    lastAccessed: null,
    ...overrides,
  };
}

function makeGlobalLearning(overrides: Partial<GlobalLearning>): GlobalLearning {
  return {
    id: `gid-${Math.random().toString(36).slice(2, 8)}`,
    date: '2026-05-17',
    projectId: 'aaaa1111bbbb2222',
    projectName: 'demo-project',
    summary: 'global placeholder',
    lesson: 'global placeholder lesson',
    tags: ['#test'],
    ...overrides,
  };
}

function seedProject(hash: string, kb: KnowledgeBase): void {
  const projectDir = join(knitRoot(), 'projects', hash);
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, 'knowledgebase.json'), JSON.stringify(kb, null, 2), 'utf-8');
}

function seedGlobal(entries: GlobalLearning[]): void {
  const path = globalLearningsPath();
  mkdirSync(join(knitRoot(), 'global'), { recursive: true });
  writeFileSync(path, entries.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf-8');
}

describe('export command (obsidian)', () => {
  let knitHome: string;
  let vault: string;

  beforeAll(() => {
    knitHome = mkdtempSync(join(tmpdir(), 'knit-export-test-'));
    process.env.KNIT_HOME = knitHome;
    process.env.ENGRAM_EXPORT_QUIET = '1';
  });

  afterAll(() => {
    delete process.env.KNIT_HOME;
    delete process.env.ENGRAM_EXPORT_QUIET;
    try { rmSync(knitHome, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  beforeEach(() => {
    // Wipe knit_home contents between tests
    try { rmSync(join(knitHome, 'projects'), { recursive: true, force: true }); } catch { /* best */ }
    try { rmSync(join(knitHome, 'global'), { recursive: true, force: true }); } catch { /* best */ }

    // Fresh vault dir per test
    vault = mkdtempSync(join(tmpdir(), 'knit-vault-'));
  });

  it('exports 3 per-project + 2 global learnings into the vault', async () => {
    const kb: KnowledgeBase = {
      version: 1,
      projectName: 'sample-project',
      entries: [
        makeKBEntry({ id: '1', summary: 'Use JWT for auth', lesson: 'verify signature with strong secret', tags: ['#auth', '#security'] }),
        makeKBEntry({ id: '2', summary: 'Stripe webhook retries', lesson: 'webhooks may retry — make idempotent', tags: ['#payments', '#stripe'] }),
        makeKBEntry({ id: '3', summary: 'Cache hot paths', lesson: 'cache responses for 10s', tags: ['#performance'] }),
      ],
      metrics: { totalSessions: 0, totalLearnings: 3, cacheHits: 0, domainDistribution: {}, sessions: [] },
    };
    seedProject('proj-hash-1', kb);
    seedGlobal([
      makeGlobalLearning({ id: 'g1', projectName: 'p-other', summary: 'Generalizable signature check', lesson: 'always verify timestamp', tags: ['#stripe', '#security'] }),
      makeGlobalLearning({ id: 'g2', projectName: 'p-other2', summary: 'Token expiry handling', lesson: 'tokens silently expire', tags: ['#auth'] }),
    ]);

    await exportCommand('obsidian', vault, {});

    // Index exists with tag headings
    const indexPath = join(vault, 'Engram Index.md');
    expect(existsSync(indexPath)).toBe(true);
    const index = readFileSync(indexPath, 'utf-8');
    expect(index).toMatch(/# Engram Knowledge Index/);
    expect(index).toMatch(/3 per-project learnings \+ 2 global learnings/);
    expect(index).toMatch(/### #auth/);
    expect(index).toMatch(/### #stripe/);
    expect(index).toMatch(/sample-project/);

    // Per-project learnings: 3 files
    const perProjectFiles = readdirSync(join(vault, 'learnings'));
    expect(perProjectFiles).toHaveLength(3);
    expect(perProjectFiles.some((f) => f.startsWith('use-jwt-for-auth'))).toBe(true);

    // YAML frontmatter + lesson text present
    const jwtFile = perProjectFiles.find((f) => f.startsWith('use-jwt-for-auth'))!;
    const jwtContent = readFileSync(join(vault, 'learnings', jwtFile), 'utf-8');
    expect(jwtContent).toMatch(/^---\n/);
    expect(jwtContent).toMatch(/date: 2026-05-17/);
    expect(jwtContent).toMatch(/outcome: success/);
    expect(jwtContent).toMatch(/source_project: sample-project/);
    expect(jwtContent).toMatch(/tags: \[auth, security\]/);
    expect(jwtContent).toMatch(/verify signature with strong secret/);
    expect(jwtContent).toMatch(/#auth/);

    // Global learnings: 2 files with source_project in frontmatter
    const globalFiles = readdirSync(join(vault, 'global-learnings'));
    expect(globalFiles).toHaveLength(2);
    const sigFile = globalFiles.find((f) => f.startsWith('generalizable-signature-check'))!;
    expect(sigFile).toBeDefined();
    const sigContent = readFileSync(join(vault, 'global-learnings', sigFile), 'utf-8');
    expect(sigContent).toMatch(/source_project: p-other/);
    expect(sigContent).toMatch(/always verify timestamp/);
  });

  it('respects the --filter option, only exporting matching tags', async () => {
    const kb: KnowledgeBase = {
      version: 1,
      projectName: 'mixed-project',
      entries: [
        makeKBEntry({ id: '1', summary: 'auth-only entry', tags: ['#auth'] }),
        makeKBEntry({ id: '2', summary: 'payments entry', tags: ['#payments'] }),
        makeKBEntry({ id: '3', summary: 'auth and security', tags: ['#auth', '#security'] }),
      ],
      metrics: { totalSessions: 0, totalLearnings: 3, cacheHits: 0, domainDistribution: {}, sessions: [] },
    };
    seedProject('proj-hash-2', kb);
    seedGlobal([
      makeGlobalLearning({ id: 'g1', summary: 'global auth lesson', tags: ['#auth'] }),
      makeGlobalLearning({ id: 'g2', summary: 'global other lesson', tags: ['#other'] }),
    ]);

    await exportCommand('obsidian', vault, { filter: '#auth' });

    const perProjectFiles = readdirSync(join(vault, 'learnings'));
    expect(perProjectFiles).toHaveLength(2);
    expect(perProjectFiles.some((f) => f.startsWith('auth-only-entry'))).toBe(true);
    expect(perProjectFiles.some((f) => f.startsWith('auth-and-security'))).toBe(true);
    expect(perProjectFiles.some((f) => f.startsWith('payments-entry'))).toBe(false);

    const globalFiles = readdirSync(join(vault, 'global-learnings'));
    expect(globalFiles).toHaveLength(1);
    expect(globalFiles[0]).toMatch(/^global-auth-lesson/);
  });

  it('throws on unsupported format', async () => {
    await expect(exportCommand('notion', vault, {})).rejects.toThrow(/Unsupported export format/);
  });

  it('handles a fresh KNIT_HOME with no projects or global learnings', async () => {
    await exportCommand('obsidian', vault, {});
    expect(existsSync(join(vault, 'Engram Index.md'))).toBe(true);
    expect(readdirSync(join(vault, 'learnings'))).toHaveLength(0);
    expect(readdirSync(join(vault, 'global-learnings'))).toHaveLength(0);
  });
});
