import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  detectClaudeCode,
  detectCursor,
  detectCodex,
  detectCline,
  detectContinue,
  detectVscode,
  detectAllAgents,
} from '../src/engine/agent-detector.js';

// Node's os.homedir() respects $HOME on POSIX and %USERPROFILE% on Windows.
// We override the env vars so the detector reads from a tmp dir, avoiding
// the ESM named-import binding problem that breaks vi.spyOn here.
let fakeHome: string;
let savedHome: string | undefined;
let savedUserprofile: string | undefined;

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), 'knit-agent-detect-'));
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
  try { rmSync(fakeHome, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('detectClaudeCode', () => {
  it('reports not present when ~/.claude.json missing and ~/.claude/ absent', () => {
    const s = detectClaudeCode();
    expect(s.present).toBe(false);
    expect(s.registered).toBe(false);
  });

  it('reports present when ~/.claude.json exists', () => {
    writeFileSync(join(fakeHome, '.claude.json'), '{}');
    const s = detectClaudeCode();
    expect(s.present).toBe(true);
    expect(s.registered).toBe(false);
  });

  it('reports registered when mcpServers contains knit-brain', () => {
    writeFileSync(
      join(fakeHome, '.claude.json'),
      JSON.stringify({ mcpServers: { 'knit-brain': { command: 'npx' } } }),
    );
    const s = detectClaudeCode();
    expect(s.registered).toBe(true);
  });

  it('handles corrupted ~/.claude.json without throwing', () => {
    writeFileSync(join(fakeHome, '.claude.json'), 'not valid');
    const s = detectClaudeCode();
    expect(s.present).toBe(true);   // file exists
    expect(s.registered).toBe(false); // can't parse so can't confirm
  });
});

describe('detectCursor', () => {
  it('not present when no .cursor/ anywhere', () => {
    const ws = mkdtempSync(join(tmpdir(), 'knit-ws-'));
    try {
      expect(detectCursor(ws).present).toBe(false);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it('present when ~/.cursor/ exists', () => {
    mkdirSync(join(fakeHome, '.cursor'));
    expect(detectCursor().present).toBe(true);
  });

  it('registered when workspace .cursor/mcp.json has knit-brain', () => {
    const ws = mkdtempSync(join(tmpdir(), 'knit-ws-'));
    try {
      mkdirSync(join(ws, '.cursor'));
      writeFileSync(
        join(ws, '.cursor', 'mcp.json'),
        JSON.stringify({ mcpServers: { 'knit-brain': {} } }),
      );
      const s = detectCursor(ws);
      expect(s.registered).toBe(true);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });
});

describe('detectCodex', () => {
  it('detects via the existence of ~/.codex/', () => {
    mkdirSync(join(fakeHome, '.codex'));
    expect(detectCodex().present).toBe(true);
  });

  it('registered when config.toml has [mcp_servers.knit] block', () => {
    mkdirSync(join(fakeHome, '.codex'));
    writeFileSync(
      join(fakeHome, '.codex', 'config.toml'),
      `[mcp_servers.knit]\ncommand = "npx"\n`,
    );
    expect(detectCodex().registered).toBe(true);
  });
});

describe('detectCline', () => {
  it('detects via workspace .clinerules/ directory', () => {
    const ws = mkdtempSync(join(tmpdir(), 'knit-ws-'));
    try {
      mkdirSync(join(ws, '.clinerules'));
      const s = detectCline(ws);
      expect(s.present).toBe(true);
      expect(s.notes).toMatch(/clinerules/);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it('detects via ~/.cline/ home dir even without workspace rules', () => {
    mkdirSync(join(fakeHome, '.cline'));
    expect(detectCline().present).toBe(true);
  });
});

describe('detectContinue', () => {
  it('present when ~/.continue/ exists, not registered without knit.yaml', () => {
    mkdirSync(join(fakeHome, '.continue'));
    const s = detectContinue();
    expect(s.present).toBe(true);
    expect(s.registered).toBe(false);
  });

  it('registered when workspace .continue/mcpServers/knit.yaml exists', () => {
    const ws = mkdtempSync(join(tmpdir(), 'knit-ws-'));
    try {
      mkdirSync(join(ws, '.continue', 'mcpServers'), { recursive: true });
      writeFileSync(join(ws, '.continue', 'mcpServers', 'knit.yaml'), 'name: knit\n');
      mkdirSync(join(fakeHome, '.continue')); // present-marker
      expect(detectContinue(ws).registered).toBe(true);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });
});

describe('detectVscode', () => {
  it('present when workspace .vscode/ directory exists', () => {
    const ws = mkdtempSync(join(tmpdir(), 'knit-ws-'));
    try {
      mkdirSync(join(ws, '.vscode'));
      expect(detectVscode(ws).present).toBe(true);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it('registered uses the `servers` key — NOT mcpServers — per VS Code schema', () => {
    const ws = mkdtempSync(join(tmpdir(), 'knit-ws-'));
    try {
      mkdirSync(join(ws, '.vscode'));
      // Wrong key — should NOT count as registered
      writeFileSync(
        join(ws, '.vscode', 'mcp.json'),
        JSON.stringify({ mcpServers: { 'knit-brain': {} } }),
      );
      expect(detectVscode(ws).registered).toBe(false);
      // Right key — should count
      writeFileSync(
        join(ws, '.vscode', 'mcp.json'),
        JSON.stringify({ servers: { 'knit-brain': {} } }),
      );
      expect(detectVscode(ws).registered).toBe(true);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });
});

describe('detectAllAgents', () => {
  it('returns one status per agent, six total', () => {
    const ws = mkdtempSync(join(tmpdir(), 'knit-ws-'));
    try {
      const all = detectAllAgents(ws);
      expect(all).toHaveLength(6);
      const ids = all.map((s) => s.agent).sort();
      expect(ids).toEqual(['claude-code', 'cline', 'codex', 'continue', 'cursor', 'vscode']);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it('every status has displayName + configPath', () => {
    const ws = mkdtempSync(join(tmpdir(), 'knit-ws-'));
    try {
      for (const s of detectAllAgents(ws)) {
        expect(s.displayName.length).toBeGreaterThan(0);
        expect(s.configPath.length).toBeGreaterThan(0);
      }
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });
});
