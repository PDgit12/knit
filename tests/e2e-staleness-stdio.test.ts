/**
 * v0.22 Batch F — REAL-LIFE end-to-end proof that the stale-index class is gone.
 *
 * Drives the LIVE Knit MCP server over stdio (tsx src/cli.ts) as a single
 * long-lived session — exactly how an MCP host runs it for hours — and mutates
 * the source tree mid-session. Asserts the brain self-updates with NO manual
 * knit_refresh_index:
 *   1. query_imports sees the initial import edge.
 *   2. a NEW file + import added mid-session shows up in query_imports.
 *   3. verify_claim on a freshly-added export returns the truth (self-heal),
 *      not a stale "contradicted".
 * This is the scenario that misled real sessions; here it must NOT recur.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TSX = join(process.cwd(), 'node_modules', '.bin', 'tsx');
const CLI = join(process.cwd(), 'src', 'cli.ts');

let knitHome: string;
let projectRoot: string;

/** A persistent stdio client: handshake once, then call tools by id. */
class McpClient {
  private child: ChildProcess;
  private buf = '';
  private nextId = 2;
  private pending = new Map<number, (v: Record<string, unknown>) => void>();
  private ready: Promise<void>;

  constructor(cwd: string, home: string) {
    this.child = spawn(TSX, [CLI], {
      cwd,
      env: { ...process.env, KNIT_HOME: home, KNIT_INDEX_STALENESS_MS: '0' },
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    this.child.stdout!.on('data', (c: Buffer) => this.onData(c));
    this.ready = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('handshake timeout')), 25000);
      this.pending.set(1, () => { clearTimeout(t); resolve(); });
    });
    this.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'claude-code', version: '1.0' } } });
  }

  private send(msg: unknown) { this.child.stdin!.write(JSON.stringify(msg) + '\n'); }

  private onData(chunk: Buffer) {
    this.buf += chunk.toString();
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      let msg: { id?: number };
      try { msg = JSON.parse(line); } catch { continue; }
      if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
        const resolve = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        resolve(msg as Record<string, unknown>);
      }
    }
  }

  async init() {
    await this.ready;
    this.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  }

  /** Call a tool; resolves with the parsed JSON of its text content. */
  call(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`call timeout: ${name}`)), 20000);
      this.pending.set(id, (msg) => {
        clearTimeout(t);
        const text = (msg as { result?: { content?: Array<{ text?: string }> } }).result?.content?.[0]?.text;
        if (!text) return reject(new Error(`no content for ${name}`));
        try { resolve(JSON.parse(text)); } catch (e) { reject(e as Error); }
      });
      this.send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
    });
  }

  close() { try { this.child.kill(); } catch { /* */ } }
}

/** Write a file and stamp its mtime into the future so the probe is unambiguous. */
function writeFresh(path: string, content: string) {
  writeFileSync(path, content, 'utf-8');
  const future = new Date(Date.now() + 60_000);
  utimesSync(path, future, future);
}

beforeAll(() => {
  knitHome = mkdtempSync(join(tmpdir(), 'knit-e2e-stale-home-'));
  projectRoot = mkdtempSync(join(tmpdir(), 'knit-e2e-stale-proj-'));
  writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({ name: 'e2e-stale' }), 'utf-8');
  mkdirSync(join(projectRoot, 'src'), { recursive: true });
  writeFileSync(join(projectRoot, 'src', 'a.ts'), 'export const a = 1;\n', 'utf-8');
  writeFileSync(join(projectRoot, 'src', 'b.ts'), "import { a } from './a.js';\nexport const b = a + 1;\n", 'utf-8');
});

afterAll(() => {
  try { rmSync(knitHome, { recursive: true, force: true }); } catch { /* */ }
  try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* */ }
});

describe('real-life stdio E2E — no staleness while working', () => {
  it('a live session sees mid-session file changes with NO manual refresh', async () => {
    const client = new McpClient(projectRoot, knitHome);
    try {
      await client.init();

      // 1. Baseline: a.ts is imported by b.ts.
      const first = await client.call('knit_query_imports', { file_path: 'src/a.ts' });
      expect(first.imported_by as string[]).toContain('src/b.ts');

      // 2. Mid-session, add c.ts importing a.ts (the exact bug scenario).
      writeFresh(join(projectRoot, 'src', 'c.ts'), "import { a } from './a.js';\nexport const c = a + 2;\n");
      const second = await client.call('knit_query_imports', { file_path: 'src/a.ts' });
      // The brain auto-refreshed — c.ts is now a dependent, no knit_refresh_index called.
      expect(second.imported_by as string[]).toContain('src/b.ts');
      expect(second.imported_by as string[]).toContain('src/c.ts');

      // 3. Add a NEW export to the already-indexed a.ts, then verify a claim about
      //    it — must self-heal to 'verified', not a stale 'contradicted'.
      writeFresh(join(projectRoot, 'src', 'a.ts'), 'export const a = 1;\nexport const freshlyAdded = 42;\n');
      const verdict = await client.call('knit_verify_claim', { claim: 'src/a.ts exports freshlyAdded' });
      expect(verdict.verdict).toBe('verified');

      // 4. A genuinely false claim on the same (now-fresh) file stays contradicted —
      //    the fix doesn't blindly bless everything.
      const falseVerdict = await client.call('knit_verify_claim', { claim: 'src/a.ts exports neverExisted' });
      expect(falseVerdict.verdict).toBe('contradicted');
    } finally {
      client.close();
    }
  }, 40000);
});
