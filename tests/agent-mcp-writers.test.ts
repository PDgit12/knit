import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  writeCursorMcp,
  writeClineMcp,
  writeVscodeMcp,
  KNIT_REGISTRATION_NAME,
} from '../src/generators/agent-mcp-writers.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'knit-agent-writers-'));
});

afterEach(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('writeCursorMcp', () => {
  it('creates .cursor/mcp.json with mcpServers.knit-brain when none exists', () => {
    const path = join(tmp, '.cursor', 'mcp.json');
    const r = writeCursorMcp(path);
    expect(r.written).toBe(true);
    expect(r.alreadyRegistered).toBe(false);
    const config = JSON.parse(readFileSync(path, 'utf-8'));
    expect(config.mcpServers[KNIT_REGISTRATION_NAME].command).toBe('npx');
    expect(config.mcpServers[KNIT_REGISTRATION_NAME].type).toBe('stdio');
  });

  it('idempotent — second call is a no-op', () => {
    const path = join(tmp, '.cursor', 'mcp.json');
    writeCursorMcp(path);
    const r = writeCursorMcp(path);
    expect(r.written).toBe(false);
    expect(r.alreadyRegistered).toBe(true);
  });

  it('preserves other mcpServers entries — no clobber', () => {
    const path = join(tmp, '.cursor', 'mcp.json');
    mkdirSync(join(tmp, '.cursor'), { recursive: true });
    writeFileSync(path, JSON.stringify({ mcpServers: { other: { command: 'other' } } }), 'utf-8');
    writeCursorMcp(path);
    const config = JSON.parse(readFileSync(path, 'utf-8'));
    expect(config.mcpServers.other.command).toBe('other');
    expect(config.mcpServers[KNIT_REGISTRATION_NAME]).toBeDefined();
  });

  it('does not overwrite a corrupted JSON file', () => {
    const path = join(tmp, '.cursor', 'mcp.json');
    mkdirSync(join(tmp, '.cursor'), { recursive: true });
    writeFileSync(path, '{not valid json', 'utf-8');
    const r = writeCursorMcp(path);
    expect(r.written).toBe(false);
    // File contents preserved — corruption surfaced, not destroyed.
    expect(readFileSync(path, 'utf-8')).toBe('{not valid json');
  });
});

describe('writeClineMcp', () => {
  it('writes mcpServers.knit-brain to the given path', () => {
    const path = join(tmp, '.cline', 'mcp.json');
    const r = writeClineMcp(path);
    expect(r.written).toBe(true);
    const config = JSON.parse(readFileSync(path, 'utf-8'));
    expect(config.mcpServers[KNIT_REGISTRATION_NAME].command).toBe('npx');
    expect(config.mcpServers[KNIT_REGISTRATION_NAME].args).toEqual(['-y', 'knit-mcp@latest']);
  });

  it('does NOT add a type field — Cline uses bare command/args', () => {
    const path = join(tmp, '.cline', 'mcp.json');
    writeClineMcp(path);
    const config = JSON.parse(readFileSync(path, 'utf-8'));
    expect(config.mcpServers[KNIT_REGISTRATION_NAME].type).toBeUndefined();
  });

  it('idempotent', () => {
    const path = join(tmp, '.cline', 'mcp.json');
    writeClineMcp(path);
    const r = writeClineMcp(path);
    expect(r.alreadyRegistered).toBe(true);
  });
});

describe('writeVscodeMcp', () => {
  it('uses `servers` (not `mcpServers`) as the top-level key — VS Code\'s unique schema', () => {
    const path = join(tmp, '.vscode', 'mcp.json');
    const r = writeVscodeMcp(path);
    expect(r.written).toBe(true);
    const config = JSON.parse(readFileSync(path, 'utf-8'));
    expect(config.servers).toBeDefined();
    expect(config.mcpServers).toBeUndefined();
    expect(config.servers[KNIT_REGISTRATION_NAME].command).toBe('npx');
    expect(config.servers[KNIT_REGISTRATION_NAME].type).toBe('stdio');
  });

  it('preserves existing `servers` entries from other MCP servers', () => {
    const path = join(tmp, '.vscode', 'mcp.json');
    mkdirSync(join(tmp, '.vscode'), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({ servers: { playwright: { command: 'npx', args: ['-y', '@microsoft/mcp-server-playwright'] } } }),
      'utf-8',
    );
    writeVscodeMcp(path);
    const config = JSON.parse(readFileSync(path, 'utf-8'));
    expect(config.servers.playwright).toBeDefined();
    expect(config.servers[KNIT_REGISTRATION_NAME]).toBeDefined();
  });

  it('idempotent', () => {
    const path = join(tmp, '.vscode', 'mcp.json');
    writeVscodeMcp(path);
    const r = writeVscodeMcp(path);
    expect(r.alreadyRegistered).toBe(true);
  });

  it('writes to nested dir when .vscode/ does not yet exist', () => {
    const path = join(tmp, 'nonexistent', 'deep', 'mcp.json');
    const r = writeVscodeMcp(path);
    expect(r.written).toBe(true);
    expect(existsSync(path)).toBe(true);
  });
});
