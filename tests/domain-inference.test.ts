import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { inferDomains } from '../src/engine/domain-inference.js';

/**
 * v0.12 phase 1 — domain inference.
 *
 * Three signals: git co-change (requires real history), import-graph
 * centrality (synthetic input), test colocation (filesystem-detected).
 * RRF fuses; tests focus on centrality + colocation since git history
 * needs a real repo (covered loosely via the no-signals path).
 */

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'knit-domain-test-'));
});

afterEach(() => {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('inferDomains', () => {
  it('empty project — no signals — returns empty candidates', () => {
    const result = inferDomains(root, {}, { tested: {}, testFiles: [] });
    expect(result.candidates).toEqual([]);
    expect(result.signalCoverage.coChange).toBe(false);
    expect(result.signalCoverage.centrality).toBe(false);
    expect(result.signalCoverage.testColocation).toBe(false);
    expect(result.note).toMatch(/No signals/);
  });

  it('centrality alone ranks domains by inbound import count', () => {
    const importGraph: Record<string, string[]> = {
      'src/api/handlers.ts': ['src/engine/foo.ts', 'src/engine/bar.ts', 'src/engine/baz.ts'],
      'src/cli/main.ts': ['src/engine/foo.ts', 'src/engine/bar.ts'],
      'src/web/page.ts': ['src/api/handlers.ts'],
    };
    const result = inferDomains(root, importGraph, { tested: {}, testFiles: [] });
    expect(result.signalCoverage.centrality).toBe(true);
    // 'engine' has 5 inbound (from api + cli); 'api' has 1 (from web); 'web' has 0.
    expect(result.candidates[0].name).toBe('engine');
    expect(result.candidates[0].signals).toContain('centrality');
  });

  it('test colocation detected from sibling tests/<dir> directory', () => {
    // Create src/auth/ + tests/auth/ to confirm colocation.
    mkdirSync(join(root, 'src', 'auth'), { recursive: true });
    writeFileSync(join(root, 'src', 'auth', 'session.ts'), '');
    mkdirSync(join(root, 'tests', 'auth'), { recursive: true });
    writeFileSync(join(root, 'tests', 'auth', 'session.test.ts'), '');
    // Provide centrality so we have at least one signal beyond colocation.
    const importGraph = { 'src/cli/main.ts': ['src/auth/session.ts'] };
    const result = inferDomains(root, importGraph, { tested: {}, testFiles: ['tests/auth/session.test.ts'] });
    expect(result.signalCoverage.testColocation).toBe(true);
    const auth = result.candidates.find((c) => c.name === 'auth');
    expect(auth).toBeDefined();
    expect(auth!.signals).toContain('test-colocation');
  });

  it('RRF fuses centrality + colocation — domain in both signals ranks higher', () => {
    mkdirSync(join(root, 'src', 'auth'), { recursive: true });
    mkdirSync(join(root, 'tests', 'auth'), { recursive: true });
    writeFileSync(join(root, 'src', 'auth', 'a.ts'), '');
    writeFileSync(join(root, 'tests', 'auth', 'a.test.ts'), '');
    const importGraph: Record<string, string[]> = {
      'src/cli/main.ts': ['src/auth/a.ts', 'src/billing/b.ts'],
      'src/web/p.ts': ['src/auth/a.ts'],
    };
    const result = inferDomains(root, importGraph, { tested: {}, testFiles: [] });
    // auth has both signals; billing has only centrality. auth should rank higher.
    const authRank = result.candidates.findIndex((c) => c.name === 'auth');
    const billingRank = result.candidates.findIndex((c) => c.name === 'billing');
    expect(authRank).toBeGreaterThanOrEqual(0);
    expect(authRank).toBeLessThan(billingRank >= 0 ? billingRank : Infinity);
  });

  it('confidence is normalized 0-1 with top candidate at 1.0', () => {
    const importGraph: Record<string, string[]> = {
      'src/cli/main.ts': ['src/engine/foo.ts'],
    };
    const result = inferDomains(root, importGraph, { tested: {}, testFiles: [] });
    if (result.candidates.length > 0) {
      expect(result.candidates[0].confidence).toBe(1);
      for (const c of result.candidates) {
        expect(c.confidence).toBeGreaterThanOrEqual(0);
        expect(c.confidence).toBeLessThanOrEqual(1);
      }
    }
  });

  it('caps candidates to top 8', () => {
    const importGraph: Record<string, string[]> = {};
    for (let i = 0; i < 15; i++) {
      importGraph[`src/caller${i}/main.ts`] = [`src/domain${i}/foo.ts`];
    }
    const result = inferDomains(root, importGraph, { tested: {}, testFiles: [] });
    expect(result.candidates.length).toBeLessThanOrEqual(8);
  });
});

describe('knit_infer_domains via handleToolCall', () => {
  it('returns the inference result with instruction', async () => {
    const { handleToolCall } = await import('../src/mcp/tools.js');
    const importGraph: Record<string, string[]> = {
      'src/api/handlers.ts': ['src/engine/foo.ts', 'src/engine/bar.ts'],
    };
    const brain = buildBrain(importGraph);
    const res = JSON.parse(handleToolCall('knit_infer_domains', {}, brain));
    expect(res.candidates).toBeDefined();
    expect(res.signalCoverage).toBeDefined();
    expect(res.instruction).toMatch(/domain|signals/);
  });

  function buildBrain(importGraph: Record<string, string[]>) {
    return {
      rootPath: root,
      knowledge: {
        generatedAt: new Date().toISOString(),
        summary: { totalFiles: 0, totalLines: 0, languageBreakdown: {}, entryPoints: [], highFanoutFiles: [], untestedFiles: [], largestFiles: [] },
        files: [], importGraph, exports: {}, testMap: { tested: {}, untested: [], testFiles: [] },
      },
      reverseDeps: {},
      knowledgeBase: { version: 1, projectName: 'test', entries: [], metrics: { totalSessions: 0, totalLearnings: 0, cacheHits: 0, domainDistribution: {}, sessions: [] } },
      config: { name: 'test', packageManager: 'npm', stack: { language: 'typescript', dependencies: [], buildCommand: '', lintCommand: '', typecheckCommand: '' }, domains: [], targetAgent: 'claude-code', tokenOptimization: 'standard' },
      loadedAt: Date.now(),
      autoInitialized: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }
});
