/**
 * v0.22 Batch F — REAL-LIFE end-to-end test (not synthetic).
 *
 * Spawns the live Knit MCP server over stdio (tsx src/cli.ts — the same path an
 * MCP host launches), performs a genuine JSON-RPC `initialize` handshake with a
 * different `clientInfo.name` per host, then calls knit_classify_task on a
 * complex cross-cutting task and asserts the response carries the correctly
 * host-tailored `host_orchestration` directive — with the suggest fallback for an
 * unknown host. This exercises the whole chain: handshake → oninitialized →
 * getClientVersion → classifyHost → classify → host directive.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TSX = join(process.cwd(), 'node_modules', '.bin', 'tsx');
const CLI = join(process.cwd(), 'src', 'cli.ts');
const MULTI = 'src/api/auth.ts, src/components/Button.tsx, src/lib/util.ts';
const COMPLEX_DESC = 'architect a new cross-domain system spanning auth, UI and lib over many commits';

let knitHome: string;
let projectRoot: string;

beforeAll(() => {
  knitHome = mkdtempSync(join(tmpdir(), 'knit-e2e-home-'));
  projectRoot = mkdtempSync(join(tmpdir(), 'knit-e2e-proj-'));
  writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({ name: 'e2e-proj' }), 'utf-8');
  mkdirSync(join(projectRoot, 'src'), { recursive: true });
  writeFileSync(join(projectRoot, 'src', 'index.ts'), 'export const x = 1;\n', 'utf-8');
});

afterAll(() => {
  try { rmSync(knitHome, { recursive: true, force: true }); } catch { /* */ }
  try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* */ }
});

/**
 * Drive a full handshake + one classify call against a freshly-spawned server,
 * identifying as `clientName`. Resolves with the parsed classify response object.
 */
function driveClassify(clientName: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn(TSX, [CLI], {
      cwd: projectRoot,
      env: { ...process.env, KNIT_HOME: knitHome, KNIT_INDEX_STALENESS_MS: '0' },
      stdio: ['pipe', 'pipe', 'ignore'],
    });

    let buf = '';
    let settled = false;
    const done = (err: Error | null, val?: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch { /* */ }
      if (err) reject(err); else resolve(val as Record<string, unknown>);
    };

    const timer = setTimeout(() => done(new Error(`timeout for ${clientName}`)), 25000);

    const send = (msg: unknown) => child.stdin.write(JSON.stringify(msg) + '\n');

    child.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString();
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg: { id?: number; result?: { content?: Array<{ text?: string }> } };
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === 1) {
          // initialize acknowledged → notify initialized, then call classify.
          send({ jsonrpc: '2.0', method: 'notifications/initialized' });
          send({
            jsonrpc: '2.0', id: 2, method: 'tools/call',
            params: { name: 'knit_classify_task', arguments: { files_to_touch: MULTI, description: COMPLEX_DESC } },
          });
        } else if (msg.id === 2) {
          clearTimeout(timer);
          const text = msg.result?.content?.[0]?.text;
          if (!text) return done(new Error(`no classify text for ${clientName}`));
          try { done(null, JSON.parse(text)); } catch (e) { done(e as Error); }
        }
      }
    });

    child.on('error', (e) => { clearTimeout(timer); done(e); });

    // Kick off the handshake, advertising this host.
    send({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: clientName, version: '1.0.0' } },
    });
  });
}

describe('real-life stdio E2E — host-tailored classify per clientInfo.name', () => {
  it('claude-code → dynamic workflow directive', async () => {
    const res = await driveClassify('claude-code');
    expect(res.tier).toBe('complex');
    expect(String(res.host_orchestration)).toMatch(/dynamic workflow/i);
  }, 30000);

  it('cursor → parallel worktree agents', async () => {
    const res = await driveClassify('cursor');
    expect(String(res.host_orchestration)).toMatch(/parallel worktree agents/i);
  }, 30000);

  it('codex → subagents', async () => {
    const res = await driveClassify('codex-mcp-client');
    expect(String(res.host_orchestration)).toMatch(/subagents/i);
  }, 30000);

  it('Visual Studio Code → agent mode + /mcp.knit.* (suggest)', async () => {
    const res = await driveClassify('Visual Studio Code');
    expect(String(res.host_orchestration)).toMatch(/agent mode/i);
    expect(String(res.host_orchestration)).toMatch(/\/mcp\.knit\.\*/);
  }, 30000);

  it('unknown host → Knit’s own worktree primitive, suggest-not-force', async () => {
    const res = await driveClassify('some-unrecognized-agent');
    expect(String(res.host_orchestration)).toMatch(/knit_spawn_team_worktree/);
    expect(String(res.host_orchestration)).toMatch(/suggests, never forces/i);
  }, 30000);
});

describe('real-life stdio E2E — MCP prompts surface', () => {
  it('prompts/list returns knit_onboard (→ /mcp.knit.onboard on supporting hosts)', () => new Promise<void>((resolve, reject) => {
    const child = spawn(TSX, [CLI], {
      cwd: projectRoot,
      env: { ...process.env, KNIT_HOME: knitHome },
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    let buf = '';
    let settled = false;
    const fin = (err?: Error) => { if (settled) return; settled = true; try { child.kill(); } catch { /* */ } if (err) reject(err); else resolve(); };
    const timer = setTimeout(() => fin(new Error('prompts timeout')), 25000);
    const send = (m: unknown) => child.stdin.write(JSON.stringify(m) + '\n');
    child.stdout.on('data', (c: Buffer) => {
      buf += c.toString();
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg: { id?: number; result?: { prompts?: Array<{ name: string }> } };
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === 1) {
          send({ jsonrpc: '2.0', method: 'notifications/initialized' });
          send({ jsonrpc: '2.0', id: 2, method: 'prompts/list', params: {} });
        } else if (msg.id === 2) {
          clearTimeout(timer);
          try {
            const names = (msg.result?.prompts ?? []).map((p) => p.name);
            expect(names).toContain('knit_onboard');
            fin();
          } catch (e) { fin(e as Error); }
        }
      }
    });
    child.on('error', (e) => { clearTimeout(timer); fin(e); });
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'Visual Studio Code', version: '1.0' } } });
  }), 30000);
});
