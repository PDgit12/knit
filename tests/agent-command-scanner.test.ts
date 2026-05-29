import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseCommandFile,
  scanAllAgentCommands,
  suggestCommandsForPhase,
  loadCachedScan,
  saveScan,
  agentCommandsCachePath,
  getAgentCommands,
  type ScanResult,
} from '../src/engine/agent-command-scanner.js';

let workspaceRoot: string;
let projectData: string;
let fakeHome: string;
let savedHome: string | undefined;
let savedUserprofile: string | undefined;

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'knit-acs-ws-'));
  projectData = mkdtempSync(join(tmpdir(), 'knit-acs-data-'));
  fakeHome = mkdtempSync(join(tmpdir(), 'knit-acs-home-'));
  savedHome = process.env.HOME;
  savedUserprofile = process.env.USERPROFILE;
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  if (savedUserprofile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = savedUserprofile;
  for (const d of [workspaceRoot, projectData, fakeHome]) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

describe('parseCommandFile', () => {
  it('extracts description from YAML frontmatter', () => {
    const text = '---\ndescription: "Run the test suite"\n---\nbody text';
    const parsed = parseCommandFile(text);
    expect(parsed.description).toBe('Run the test suite');
    expect(parsed.knitSkip).toBe(false);
    expect(parsed.body).toBe('body text');
  });

  it('honors knit: skip frontmatter flag', () => {
    const text = '---\nknit: skip\ndescription: "private"\n---\nbody';
    expect(parseCommandFile(text).knitSkip).toBe(true);
  });

  it('falls back to first markdown heading when no frontmatter', () => {
    const text = '# Run Tests\n\nDescription text below.';
    expect(parseCommandFile(text).description).toBe('Run Tests');
  });

  it('falls back to first non-blank line when no heading either', () => {
    const text = '\n\nFirst line of body.\nSecond line.';
    expect(parseCommandFile(text).description).toBe('First line of body.');
  });

  it('caps a long description at 200 chars with ellipsis', () => {
    const long = 'x'.repeat(500);
    const parsed = parseCommandFile(long);
    expect(parsed.description?.length).toBeLessThanOrEqual(200);
    expect(parsed.description?.endsWith('…')).toBe(true);
  });

  it('strips surrounding double-quotes from frontmatter values', () => {
    const text = '---\ndescription: "quoted value"\n---\nbody';
    expect(parseCommandFile(text).description).toBe('quoted value');
  });

  it('strips surrounding single-quotes from frontmatter values', () => {
    const text = `---\ndescription: 'single quoted'\n---\nbody`;
    expect(parseCommandFile(text).description).toBe('single quoted');
  });
});

describe('scanAllAgentCommands', () => {
  it('returns empty when no command directories exist', () => {
    const r = scanAllAgentCommands(workspaceRoot);
    expect(r.commands).toEqual([]);
    expect(r.workspace).toBe(workspaceRoot);
    expect(r.scannedAt).toBeDefined();
  });

  it('scans Claude Code .claude/commands/ for *.md files', () => {
    mkdirSync(join(workspaceRoot, '.claude', 'commands'), { recursive: true });
    writeFileSync(join(workspaceRoot, '.claude', 'commands', 'test.md'), '# Run tests\nRuns npm test.');
    const r = scanAllAgentCommands(workspaceRoot);
    const found = r.commands.find((c) => c.name === 'test' && c.agent === 'claude-code');
    expect(found).toBeDefined();
    expect(found?.description).toBe('Run tests');
  });

  it('scans Cursor .cursor/rules/ for *.mdc files', () => {
    mkdirSync(join(workspaceRoot, '.cursor', 'rules'), { recursive: true });
    writeFileSync(join(workspaceRoot, '.cursor', 'rules', 'review.mdc'), '---\ndescription: "Review the PR"\n---\nbody');
    const r = scanAllAgentCommands(workspaceRoot);
    const found = r.commands.find((c) => c.name === 'review' && c.agent === 'cursor');
    expect(found).toBeDefined();
    expect(found?.description).toBe('Review the PR');
  });

  it('scans Cline .clinerules/ for *.md and *.txt files', () => {
    mkdirSync(join(workspaceRoot, '.clinerules'), { recursive: true });
    writeFileSync(join(workspaceRoot, '.clinerules', 'lint.md'), '# Lint');
    writeFileSync(join(workspaceRoot, '.clinerules', 'notes.txt'), 'Plain text notes.');
    const r = scanAllAgentCommands(workspaceRoot);
    expect(r.commands.some((c) => c.name === 'lint' && c.agent === 'cline')).toBe(true);
    expect(r.commands.some((c) => c.name === 'notes' && c.agent === 'cline')).toBe(true);
  });

  it('excludes commands with knit: skip frontmatter', () => {
    mkdirSync(join(workspaceRoot, '.claude', 'commands'), { recursive: true });
    writeFileSync(join(workspaceRoot, '.claude', 'commands', 'private.md'), '---\nknit: skip\n---\nbody');
    const r = scanAllAgentCommands(workspaceRoot);
    expect(r.commands.find((c) => c.name === 'private')).toBeUndefined();
  });

  it('truncates very long command text', () => {
    mkdirSync(join(workspaceRoot, '.claude', 'commands'), { recursive: true });
    writeFileSync(join(workspaceRoot, '.claude', 'commands', 'huge.md'), 'x'.repeat(10000));
    const r = scanAllAgentCommands(workspaceRoot);
    const huge = r.commands.find((c) => c.name === 'huge');
    expect(huge?.commandText.length).toBeLessThanOrEqual(4000);
  });

  it('handles double-extension filenames (foo.prompt.md) cleanly', () => {
    mkdirSync(join(workspaceRoot, '.github', 'prompts'), { recursive: true });
    writeFileSync(join(workspaceRoot, '.github', 'prompts', 'review.prompt.md'), '# Review');
    const r = scanAllAgentCommands(workspaceRoot);
    const found = r.commands.find((c) => c.agent === 'vscode');
    expect(found?.name).toBe('review');
  });
});

describe('suggestCommandsForPhase', () => {
  const scan: ScanResult = {
    scannedAt: new Date().toISOString(),
    ttlMs: 3600000,
    workspace: '/tmp',
    commands: [
      { name: 'test',        agent: 'claude-code', sourcePath: '/x', commandText: '', knitSkip: false },
      { name: 'run-tests',   agent: 'cursor',      sourcePath: '/y', commandText: '', knitSkip: false },
      { name: 'lint-fix',    agent: 'cline',       sourcePath: '/z', commandText: '', knitSkip: false },
      { name: 'random',      agent: 'claude-code', sourcePath: '/a', commandText: '', knitSkip: false },
    ],
  };

  it('matches exact name (test → test)', () => {
    const matches = suggestCommandsForPhase(scan, 'test');
    expect(matches.map((m) => m.name)).toContain('test');
  });

  it('matches substring via synonyms (test → run-tests)', () => {
    const matches = suggestCommandsForPhase(scan, 'test');
    expect(matches.map((m) => m.name)).toContain('run-tests');
  });

  it('returns empty when no match', () => {
    expect(suggestCommandsForPhase(scan, 'nonexistent-phase')).toEqual([]);
  });

  it('matches via expanded synonyms (lint → lint-fix)', () => {
    const matches = suggestCommandsForPhase(scan, 'lint');
    expect(matches.map((m) => m.name)).toContain('lint-fix');
  });
});

describe('cache (loadCachedScan / saveScan / getAgentCommands)', () => {
  it('returns null when no cache file exists', () => {
    expect(loadCachedScan(projectData)).toBeNull();
  });

  it('round-trips a scan through save+load', () => {
    const scan: ScanResult = {
      scannedAt: new Date().toISOString(),
      ttlMs: 3600000,
      workspace: '/x',
      commands: [],
    };
    saveScan(projectData, scan);
    const loaded = loadCachedScan(projectData);
    expect(loaded?.workspace).toBe('/x');
    expect(existsSync(agentCommandsCachePath(projectData))).toBe(true);
  });

  it('returns null when cached scan is older than TTL', () => {
    const stale: ScanResult = {
      scannedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
      ttlMs: 60 * 60 * 1000, // 1 hour TTL
      workspace: '/x',
      commands: [],
    };
    saveScan(projectData, stale);
    expect(loadCachedScan(projectData)).toBeNull();
  });

  it('getAgentCommands re-scans when workspace doesn\'t match the cache', () => {
    const otherWs: ScanResult = {
      scannedAt: new Date().toISOString(),
      ttlMs: 3600000,
      workspace: '/other/workspace',
      commands: [{ name: 'cached', agent: 'claude-code', sourcePath: '/x', commandText: '', knitSkip: false }],
    };
    saveScan(projectData, otherWs);
    const result = getAgentCommands(workspaceRoot, projectData);
    // Should NOT return the stale cache for /other/workspace
    expect(result.workspace).toBe(workspaceRoot);
  });

  it('getAgentCommands returns cached scan when fresh + workspace matches', () => {
    const fresh: ScanResult = {
      scannedAt: new Date().toISOString(),
      ttlMs: 3600000,
      workspace: workspaceRoot,
      commands: [{ name: 'cached', agent: 'claude-code', sourcePath: '/x', commandText: '', knitSkip: false }],
    };
    saveScan(projectData, fresh);
    const result = getAgentCommands(workspaceRoot, projectData);
    expect(result.commands.some((c) => c.name === 'cached')).toBe(true);
  });
});

describe('Claude Code Skills (v0.19) — folder-per-skill SKILL.md', () => {
  it('surfaces .claude/skills/<name>/SKILL.md as a command named after the folder', () => {
    const skillDir = join(workspaceRoot, '.claude', 'skills', 'ship-it');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'),
      '---\ndescription: Ship the release\n---\n# Ship It\nRun the release flow.\n', 'utf-8');
    const result = scanAllAgentCommands(workspaceRoot);
    const skill = result.commands.find((c) => c.name === 'ship-it');
    expect(skill).toBeDefined();
    expect(skill?.description).toBe('Ship the release');
  });

  it('respects knit: skip frontmatter on a skill', () => {
    const skillDir = join(workspaceRoot, '.claude', 'skills', 'private-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'),
      '---\nknit: skip\ndescription: hidden\n---\nbody\n', 'utf-8');
    const result = scanAllAgentCommands(workspaceRoot);
    expect(result.commands.some((c) => c.name === 'private-skill')).toBe(false);
  });

  it('ignores skill folders without a SKILL.md', () => {
    mkdirSync(join(workspaceRoot, '.claude', 'skills', 'empty-folder'), { recursive: true });
    const result = scanAllAgentCommands(workspaceRoot);
    expect(result.commands.some((c) => c.name === 'empty-folder')).toBe(false);
  });
});

describe('scanner security (audit D2 — v0.19 hardening)', () => {
  it('does not read a symlinked SKILL.md (no arbitrary-file content into brain state)', () => {
    const secret = join(workspaceRoot, 'SECRET.md');
    writeFileSync(secret, '# TOP SECRET\nsk-should-never-surface\n', 'utf-8');
    const skillDir = join(workspaceRoot, '.claude', 'skills', 'evil');
    mkdirSync(skillDir, { recursive: true });
    symlinkSync(secret, join(skillDir, 'SKILL.md'));
    const result = scanAllAgentCommands(workspaceRoot);
    const evil = result.commands.find((c) => c.name === 'evil');
    expect(evil).toBeUndefined();
    expect(JSON.stringify(result.commands)).not.toContain('should-never-surface');
  });

  it('does not read a symlinked flat command file', () => {
    const secret = join(workspaceRoot, 'secret2.md');
    writeFileSync(secret, 'leak-marker-xyz\n', 'utf-8');
    const cmdDir = join(workspaceRoot, '.claude', 'commands');
    mkdirSync(cmdDir, { recursive: true });
    symlinkSync(secret, join(cmdDir, 'evil.md'));
    const result = scanAllAgentCommands(workspaceRoot);
    expect(JSON.stringify(result.commands)).not.toContain('leak-marker-xyz');
  });

  it('skips an oversized command file instead of loading it into memory', () => {
    const cmdDir = join(workspaceRoot, '.claude', 'commands');
    mkdirSync(cmdDir, { recursive: true });
    // 128KB > 64KB cap
    writeFileSync(join(cmdDir, 'huge.md'), 'x'.repeat(128 * 1024), 'utf-8');
    const result = scanAllAgentCommands(workspaceRoot);
    expect(result.commands.some((c) => c.name === 'huge')).toBe(false);
  });
});
