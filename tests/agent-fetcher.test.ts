import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  fetchAgent,
  AgentFetchError,
  isAgentCachedOrBundled,
} from '../src/engine/agent-fetcher.js';
import { agentsCacheFile } from '../src/engine/paths.js';

const FAKE_AGENT_MD = `---
name: typescript-pro
description: "fake"
tools: Read, Write
model: sonnet
---

You are a fake TypeScript expert for the test suite.
`;

describe('agent-fetcher', () => {
  let engramHome: string;
  let bundledDir: string;

  beforeAll(() => {
    engramHome = mkdtempSync(join(tmpdir(), 'engram-fetch-test-'));
    bundledDir = mkdtempSync(join(tmpdir(), 'engram-bundle-test-'));
    process.env.ENGRAM_HOME = engramHome;
  });

  afterAll(() => {
    delete process.env.ENGRAM_HOME;
    delete process.env.ENGRAM_OFFLINE;
    try { rmSync(engramHome, { recursive: true, force: true }); } catch { /* */ }
    try { rmSync(bundledDir, { recursive: true, force: true }); } catch { /* */ }
  });

  beforeEach(() => {
    // Clear cache between tests so we exercise the tier-resolution logic deterministically
    try { rmSync(join(engramHome, 'agents'), { recursive: true, force: true }); } catch { /* */ }
    try {
      const files = ['typescript-pro.md', 'code-reviewer.md', 'not-a-real-bundled-agent.md'];
      for (const f of files) {
        const p = join(bundledDir, f);
        try { rmSync(p, { force: true }); } catch { /* */ }
      }
    } catch { /* */ }
    delete process.env.ENGRAM_OFFLINE;
  });

  describe('tier 1 — bundled core', () => {
    it('reads a bundled-core agent without touching network', async () => {
      writeFileSync(join(bundledDir, 'typescript-pro.md'), FAKE_AGENT_MD, 'utf-8');

      const noNetwork = () => { throw new Error('Network should not be called'); };
      const got = await fetchAgent('typescript-pro', {
        bundledCoreDir: bundledDir,
        fetchFn: noNetwork as never,
      });

      expect(got).toContain('fake TypeScript expert');
    });

    it('falls through to cache/network when bundled file is missing', async () => {
      // No file written to bundledDir — should fall through
      const stub = (url: string) => Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(FAKE_AGENT_MD + `\n<!-- url: ${url} -->\n`),
      });
      const got = await fetchAgent('typescript-pro', {
        bundledCoreDir: bundledDir,
        fetchFn: stub as never,
      });
      expect(got).toContain('fake TypeScript expert');
    });
  });

  describe('tier 2 — local cache', () => {
    it('reads from cache without touching network on second call', async () => {
      // First call: stub fetch returns content, gets cached
      const cachedBody = FAKE_AGENT_MD + '\n<!-- first fetch -->\n';
      let callCount = 0;
      const stub = () => {
        callCount++;
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(cachedBody) });
      };
      await fetchAgent('debugger', { fetchFn: stub as never });
      expect(callCount).toBe(1);

      // Second call: should hit cache, not call stub again
      const noNetwork = () => { throw new Error('Cache miss — fetched again'); };
      const got = await fetchAgent('debugger', { fetchFn: noNetwork as never });
      expect(got).toBe(cachedBody);
      expect(callCount).toBe(1);
    });

    it('writes the cached file to the correct path', async () => {
      const stub = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(FAKE_AGENT_MD) });
      await fetchAgent('debugger', { fetchFn: stub as never });

      // Default ref is the pinned SHA from agent-registry
      const ref = (await import('../src/engine/agent-registry.js')).VOLTAGENT_PINNED_SHA;
      const expected = agentsCacheFile(ref, '04-quality-security', 'debugger');
      expect(existsSync(expected)).toBe(true);
      expect(readFileSync(expected, 'utf-8')).toBe(FAKE_AGENT_MD);
    });
  });

  describe('tier 3 — network', () => {
    it('respects ENGRAM_OFFLINE=1', async () => {
      process.env.ENGRAM_OFFLINE = '1';
      await expect(fetchAgent('debugger')).rejects.toThrow(AgentFetchError);
      await expect(fetchAgent('debugger')).rejects.toThrow(/ENGRAM_OFFLINE/);
    });

    it('surfaces a clean error on non-2xx response', async () => {
      const stub = () => Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('Not Found') });
      await expect(fetchAgent('debugger', { fetchFn: stub as never })).rejects.toThrow(/HTTP 404/);
    });

    it('surfaces a clean error on network failure', async () => {
      const stub = () => Promise.reject(new Error('ENOTFOUND'));
      await expect(fetchAgent('debugger', { fetchFn: stub as never })).rejects.toThrow(/Network error/);
    });

    it('rejects suspiciously short responses (likely a gateway error)', async () => {
      const stub = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('x') });
      await expect(fetchAgent('debugger', { fetchFn: stub as never })).rejects.toThrow(/empty or suspiciously short/);
    });
  });

  describe('unknown agents', () => {
    it('throws AgentFetchError for unknown names', async () => {
      await expect(fetchAgent('not-a-real-agent')).rejects.toThrow(/Unknown agent/);
    });
  });

  describe('isAgentCachedOrBundled', () => {
    it('returns true for bundled-core when file exists', () => {
      writeFileSync(join(bundledDir, 'typescript-pro.md'), FAKE_AGENT_MD, 'utf-8');
      expect(isAgentCachedOrBundled('typescript-pro', { bundledCoreDir: bundledDir })).toBe(true);
    });

    it('returns false when neither cached nor bundled', () => {
      expect(isAgentCachedOrBundled('debugger')).toBe(false);
    });

    it('returns false for unknown agents', () => {
      expect(isAgentCachedOrBundled('not-a-real-agent')).toBe(false);
    });

    it('returns true after a successful fetch (cache hit)', async () => {
      const stub = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(FAKE_AGENT_MD) });
      await fetchAgent('debugger', { fetchFn: stub as never });
      expect(isAgentCachedOrBundled('debugger')).toBe(true);
    });
  });
});
