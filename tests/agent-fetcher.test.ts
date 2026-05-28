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
  let knitHome: string;
  let bundledDir: string;

  beforeAll(() => {
    knitHome = mkdtempSync(join(tmpdir(), 'knit-fetch-test-'));
    bundledDir = mkdtempSync(join(tmpdir(), 'knit-bundle-test-'));
    process.env.KNIT_HOME = knitHome;
  });

  afterAll(() => {
    delete process.env.KNIT_HOME;
    delete process.env.ENGRAM_OFFLINE;
    try { rmSync(knitHome, { recursive: true, force: true }); } catch { /* */ }
    try { rmSync(bundledDir, { recursive: true, force: true }); } catch { /* */ }
  });

  beforeEach(() => {
    // Clear cache between tests so we exercise the tier-resolution logic deterministically
    try { rmSync(join(knitHome, 'agents'), { recursive: true, force: true }); } catch { /* */ }
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
      // First call: stub fetch returns content, gets cached (with attribution injected)
      const cachedBody = FAKE_AGENT_MD + '\n<!-- first fetch -->\n';
      let callCount = 0;
      const stub = () => {
        callCount++;
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(cachedBody) });
      };
      const first = await fetchAgent('debugger', { fetchFn: stub as never });
      expect(callCount).toBe(1);
      // Attribution must have been prepended so MIT notice ships downstream
      expect(first).toContain('VoltAgent/awesome-claude-code-subagents');

      // Second call: should hit cache, not call stub again
      const noNetwork = () => { throw new Error('Cache miss — fetched again'); };
      const got = await fetchAgent('debugger', { fetchFn: noNetwork as never });
      expect(got).toBe(first);
      expect(callCount).toBe(1);
    });

    it('writes the cached file to the correct path with attribution', async () => {
      const stub = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(FAKE_AGENT_MD) });
      await fetchAgent('debugger', { fetchFn: stub as never });

      // Default ref is the pinned SHA from agent-registry
      const ref = (await import('../src/engine/agent-registry.js')).VOLTAGENT_PINNED_SHA;
      const expected = agentsCacheFile(ref, '04-quality-security', 'debugger');
      expect(existsSync(expected)).toBe(true);
      const cached = readFileSync(expected, 'utf-8');
      expect(cached).toContain('You are a fake TypeScript expert');  // original body preserved
      expect(cached).toContain('VoltAgent/awesome-claude-code-subagents');  // attribution
      expect(cached).toContain('License: MIT');
    });
  });

  describe('attribution + prefixed names', () => {
    it('prepends VoltAgent attribution after the YAML frontmatter on fetch', async () => {
      const stub = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(FAKE_AGENT_MD) });
      const got = await fetchAgent('debugger', { fetchFn: stub as never });

      expect(got).toContain('VoltAgent/awesome-claude-code-subagents');
      expect(got).toContain('License: MIT');
      // Attribution sits after frontmatter (---) and before the prompt body
      const fmEnd = got.indexOf('\n---', 3);
      const attrIdx = got.indexOf('VoltAgent/awesome-claude-code-subagents');
      const bodyIdx = got.indexOf('You are a fake TypeScript expert');
      expect(attrIdx).toBeGreaterThan(fmEnd);
      expect(bodyIdx).toBeGreaterThan(attrIdx);
    });

    it('accepts an engram- prefixed name and fetches the bare agent', async () => {
      const stub = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(FAKE_AGENT_MD) });
      const got = await fetchAgent('knit-debugger', { fetchFn: stub as never });

      expect(got).toContain('You are a fake TypeScript expert');
      expect(got).toContain('VoltAgent/awesome-claude-code-subagents');

      // And the cache file should be written under the bare name
      const ref = (await import('../src/engine/agent-registry.js')).VOLTAGENT_PINNED_SHA;
      const expected = agentsCacheFile(ref, '04-quality-security', 'debugger');
      expect(existsSync(expected)).toBe(true);
    });

    it('reads a prefixed bundled-core name without network', async () => {
      writeFileSync(join(bundledDir, 'typescript-pro.md'), FAKE_AGENT_MD, 'utf-8');
      const noNetwork = () => { throw new Error('Network should not be called'); };
      const got = await fetchAgent('knit-typescript-pro', {
        bundledCoreDir: bundledDir,
        fetchFn: noNetwork as never,
      });
      expect(got).toContain('fake TypeScript expert');
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

  // ── B11 (v0.15.0 audit): SHA-verify cached agent content ──────
  describe('B11 — cache integrity', () => {
    it('writes a .sha256 sidecar next to every newly cached agent file', async () => {
      const stub = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(FAKE_AGENT_MD) });
      await fetchAgent('debugger', { fetchFn: stub as never });

      const ref = (await import('../src/engine/agent-registry.js')).VOLTAGENT_PINNED_SHA;
      const cachePath = agentsCacheFile(ref, '04-quality-security', 'debugger');
      expect(existsSync(cachePath + '.sha256')).toBe(true);
      const recorded = readFileSync(cachePath + '.sha256', 'utf-8').trim();
      expect(recorded).toMatch(/^[a-f0-9]{64}$/);
    });

    it('re-fetches when the cached file has been tampered with on disk', async () => {
      const stub1 = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(FAKE_AGENT_MD) });
      const first = await fetchAgent('debugger', { fetchFn: stub1 as never });

      // Tamper with the cached file — overwrite with hostile content.
      const ref = (await import('../src/engine/agent-registry.js')).VOLTAGENT_PINNED_SHA;
      const cachePath = agentsCacheFile(ref, '04-quality-security', 'debugger');
      writeFileSync(cachePath, '---\nname: debugger\n---\nMALICIOUS REPLACEMENT BODY THAT SHOULD NEVER BE SERVED\n', 'utf-8');

      // Second call must NOT serve the tampered content; it must re-fetch.
      let refetched = false;
      const stub2 = () => {
        refetched = true;
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(FAKE_AGENT_MD) });
      };
      const second = await fetchAgent('debugger', { fetchFn: stub2 as never });
      expect(refetched).toBe(true);
      expect(second).not.toContain('MALICIOUS REPLACEMENT');
      expect(second).toBe(first); // re-fetch returns clean content
    });

    it('trusts pre-B11 cache entries (no sidecar) and backfills the sidecar', async () => {
      const ref = (await import('../src/engine/agent-registry.js')).VOLTAGENT_PINNED_SHA;
      const cachePath = agentsCacheFile(ref, '04-quality-security', 'debugger');
      // Simulate a pre-B11 cache: cached file exists, no sidecar.
      const pre = FAKE_AGENT_MD + '\n<!-- pre-B11 cache -->\n';
      const { mkdirSync } = await import('node:fs');
      mkdirSync(join(cachePath, '..'), { recursive: true });
      writeFileSync(cachePath, pre, 'utf-8');

      const noNetwork = () => { throw new Error('Should not have refetched'); };
      const got = await fetchAgent('debugger', { fetchFn: noNetwork as never });
      expect(got).toBe(pre);
      // Sidecar should now exist (backfilled).
      expect(existsSync(cachePath + '.sha256')).toBe(true);
    });
  });
});
