import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  writeCodexMcp,
  buildCodexMcpBlock,
  codexAlreadyRegistered,
} from '../src/generators/codex-mcp.js';
import {
  writeContinueMcp,
  buildContinueYaml,
} from '../src/generators/continue-mcp.js';
import {
  buildAgentsMdBody,
  buildAgentsMdBlock,
  mergeAgentsMd,
} from '../src/generators/agents-md.js';
import { KNIT_REGISTRATION_NAME } from '../src/generators/agent-mcp-writers.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'knit-p3-toml-yaml-'));
});

afterEach(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
});

// ─── Codex (TOML) ───────────────────────────────────────────────────────

describe('Codex TOML writer', () => {
  it('buildCodexMcpBlock produces the canonical Knit table', () => {
    const block = buildCodexMcpBlock();
    expect(block).toMatch(/\[mcp_servers\.knit-brain\]/);
    expect(block).toMatch(/command = "npx"/);
    expect(block).toMatch(/args = \["-y", "knit-mcp@latest"\]/);
  });

  it('codexAlreadyRegistered detects knit-brain heading', () => {
    expect(codexAlreadyRegistered('[mcp_servers.knit-brain]')).toBe(true);
    expect(codexAlreadyRegistered('  [mcp_servers.knit-brain]  ')).toBe(true);
    expect(codexAlreadyRegistered('[mcp_servers.knit]')).toBe(true);
    expect(codexAlreadyRegistered('[mcp_servers.other]')).toBe(false);
    expect(codexAlreadyRegistered('')).toBe(false);
  });

  it('codexAlreadyRegistered does NOT match the substring inside a comment', () => {
    // The regex anchors to start of line + whitespace, so a comment
    // mentioning [mcp_servers.knit-brain] mid-line won't match.
    const text = '# This file declares [mcp_servers.knit-brain] eventually\n';
    expect(codexAlreadyRegistered(text)).toBe(false);
  });

  it('writes a fresh config.toml with the Knit block', () => {
    const path = join(tmp, '.codex', 'config.toml');
    const r = writeCodexMcp(path);
    expect(r.written).toBe(true);
    expect(r.alreadyRegistered).toBe(false);
    const text = readFileSync(path, 'utf-8');
    expect(codexAlreadyRegistered(text)).toBe(true);
  });

  it('appends to an existing TOML file without clobbering existing tables', () => {
    const path = join(tmp, 'config.toml');
    writeFileSync(path, '[other]\nfoo = "bar"\n', 'utf-8');
    const r = writeCodexMcp(path);
    expect(r.written).toBe(true);
    const text = readFileSync(path, 'utf-8');
    expect(text).toMatch(/\[other\]/);
    expect(text).toMatch(/foo = "bar"/);
    expect(text).toMatch(/\[mcp_servers\.knit-brain\]/);
  });

  it('idempotent — second call is a no-op', () => {
    const path = join(tmp, 'config.toml');
    writeCodexMcp(path);
    const r = writeCodexMcp(path);
    expect(r.written).toBe(false);
    expect(r.alreadyRegistered).toBe(true);
  });

  it('handles a file ending without a trailing newline cleanly', () => {
    const path = join(tmp, 'config.toml');
    writeFileSync(path, '[existing]\nkey = "value"', 'utf-8'); // no trailing \n
    writeCodexMcp(path);
    const text = readFileSync(path, 'utf-8');
    // Knit block should be appended, separated by a newline
    expect(text).toMatch(/\[existing\][\s\S]*\[mcp_servers\.knit-brain\]/);
    // No accidental concatenation
    expect(text).not.toMatch(/"value"\[mcp_servers/);
  });
});

// ─── Continue (YAML per-server file) ───────────────────────────────────

describe('Continue YAML writer', () => {
  it('buildContinueYaml produces the canonical 4-field schema', () => {
    const yaml = buildContinueYaml();
    expect(yaml).toMatch(/^name: knit-brain$/m);
    expect(yaml).toMatch(/^command: npx$/m);
    expect(yaml).toMatch(/^type: stdio$/m);
    expect(yaml).toMatch(/^args:\n {2}- -y\n {2}- knit-mcp@latest$/m);
  });

  it('writes a fresh knit-brain.yaml in the mcpServers directory', () => {
    const path = join(tmp, '.continue', 'mcpServers', `${KNIT_REGISTRATION_NAME}.yaml`);
    const r = writeContinueMcp(path);
    expect(r.written).toBe(true);
    expect(existsSync(path)).toBe(true);
    const yaml = readFileSync(path, 'utf-8');
    expect(yaml).toMatch(/name: knit-brain/);
  });

  it('idempotent — file-exists alone signals "registered" (preserves user overrides)', () => {
    const path = join(tmp, '.continue', 'mcpServers', `${KNIT_REGISTRATION_NAME}.yaml`);
    writeContinueMcp(path);
    // Simulate user editing the file to pin a version
    writeFileSync(path, 'name: knit-brain\ncommand: npx\nargs: ["-y", "knit-mcp@0.13.0"]\ntype: stdio\n', 'utf-8');
    const r = writeContinueMcp(path);
    expect(r.written).toBe(false);
    expect(r.alreadyRegistered).toBe(true);
    // User edit preserved
    expect(readFileSync(path, 'utf-8')).toMatch(/knit-mcp@0\.13\.0/);
  });
});

// ─── AGENTS.md ─────────────────────────────────────────────────────────

describe('AGENTS.md generator', () => {
  it('buildAgentsMdBody includes the project name as h1', () => {
    const body = buildAgentsMdBody({ projectName: 'my-app' });
    expect(body).toMatch(/^# my-app$/m);
  });

  it('buildAgentsMdBody includes optional description when provided', () => {
    const body = buildAgentsMdBody({ projectName: 'my-app', projectDescription: 'A test project.' });
    expect(body).toMatch(/A test project\./);
  });

  it('buildAgentsMdBody documents the canonical Knit session-start sequence', () => {
    const body = buildAgentsMdBody({ projectName: 'demo' });
    expect(body).toMatch(/knit_load_session/);
    expect(body).toMatch(/knit_classify_task/);
    expect(body).toMatch(/knit_record_learning/);
    expect(body).toMatch(/knit_save_handoff/);
  });

  it('buildAgentsMdBlock wraps the body in the canonical markers', () => {
    const block = buildAgentsMdBlock({ projectName: 'demo' });
    expect(block).toMatch(/<!-- knit:start -->/);
    expect(block).toMatch(/<!-- knit:end -->/);
  });

  it('mergeAgentsMd appends a Knit block to an empty AGENTS.md', () => {
    const { content, mode } = mergeAgentsMd('', { projectName: 'demo' });
    expect(mode).toBe('appended');
    expect(content).toMatch(/<!-- knit:start -->/);
    expect(content).toMatch(/<!-- knit:end -->/);
  });

  it('mergeAgentsMd replaces an existing Knit block instead of appending', () => {
    const existing = `<!-- knit:start -->\n\nOLD KNIT BLOCK\n\n<!-- knit:end -->\n`;
    const { content, mode } = mergeAgentsMd(existing, { projectName: 'demo' });
    expect(mode).toBe('replaced');
    expect(content).not.toMatch(/OLD KNIT BLOCK/);
    expect(content).toMatch(/# demo/);
  });

  it('mergeAgentsMd appends Knit block when existing file has content but no markers', () => {
    const existing = '# User-curated AGENTS.md\n\nSome user notes.\n';
    const { content, mode } = mergeAgentsMd(existing, { projectName: 'demo' });
    expect(mode).toBe('appended');
    expect(content).toMatch(/# User-curated AGENTS\.md/);
    expect(content).toMatch(/Some user notes/);
    expect(content).toMatch(/<!-- knit:start -->/);
    expect(content).toMatch(/# demo/);
  });

  it('mergeAgentsMd preserves user content above and below the marker block', () => {
    const existing = [
      '# User Preamble',
      '',
      'User-curated content above.',
      '',
      '<!-- knit:start -->',
      '',
      'OLD',
      '',
      '<!-- knit:end -->',
      '',
      '## User Footer',
      '',
      'User-curated content below.',
      '',
    ].join('\n');
    const { content } = mergeAgentsMd(existing, { projectName: 'demo' });
    expect(content).toMatch(/User Preamble/);
    expect(content).toMatch(/User-curated content above/);
    expect(content).toMatch(/User Footer/);
    expect(content).toMatch(/User-curated content below/);
    expect(content).not.toMatch(/OLD/);
    expect(content).toMatch(/# demo/);
  });
});
