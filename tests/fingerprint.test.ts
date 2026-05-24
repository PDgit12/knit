import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { scanProjectFingerprint } from '../src/engine/scanner.js';

/**
 * v0.12 phase 0 — project fingerprinting.
 *
 * Detection precedence: TS+package.json > python > go > rust. CI files
 * detected by directory + filename convention. Linter from config file
 * presence + language fallback.
 */

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'knit-fp-test-'));
});

afterEach(() => {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('scanProjectFingerprint', () => {
  it('detects empty project shape (no signals)', () => {
    const fp = scanProjectFingerprint(root);
    expect(fp.languages).toEqual([]);
    expect(fp.framework).toBeNull();
    expect(fp.testRunner).toBeNull();
    expect(fp.ciFiles).toEqual([]);
  });

  it('detects TypeScript project from tsconfig.json + package.json', () => {
    writeFileSync(join(root, 'tsconfig.json'), '{}');
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      name: 't', version: '1.0.0',
      devDependencies: { typescript: '^5', vitest: '^1' },
      scripts: { build: 'tsc', lint: 'eslint .', typecheck: 'tsc --noEmit' },
    }));
    const fp = scanProjectFingerprint(root);
    expect(fp.languages).toContain('typescript');
    expect(fp.testRunner).toBe('vitest');
    expect(fp.buildCommand).toMatch(/run build/);
    expect(fp.typecheckCommand).toMatch(/run typecheck/);
  });

  it('detects Next.js framework', () => {
    writeFileSync(join(root, 'tsconfig.json'), '{}');
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      name: 'n', version: '1.0.0',
      dependencies: { next: '14', react: '18' },
    }));
    const fp = scanProjectFingerprint(root);
    expect(fp.framework).toBe('nextjs');
  });

  it('detects Python project from pyproject.toml', () => {
    writeFileSync(join(root, 'pyproject.toml'), '[tool.poetry]\nname = "x"\n[tool.poetry.dependencies]\nfastapi = "*"\npytest = "*"\nruff = "*"');
    const fp = scanProjectFingerprint(root);
    expect(fp.languages).toContain('python');
    expect(fp.framework).toBe('fastapi');
    expect(fp.testRunner).toBe('pytest');
    expect(fp.linter).toBe('ruff');
  });

  it('detects Go project from go.mod', () => {
    writeFileSync(join(root, 'go.mod'), 'module example.com/x\ngo 1.21\n');
    const fp = scanProjectFingerprint(root);
    expect(fp.languages).toContain('go');
    expect(fp.testRunner).toBe('go test');
    expect(fp.linter).toBe('golangci-lint');
  });

  it('detects Rust project from Cargo.toml', () => {
    writeFileSync(join(root, 'Cargo.toml'), '[package]\nname = "x"\n');
    const fp = scanProjectFingerprint(root);
    expect(fp.languages).toContain('rust');
    expect(fp.testRunner).toBe('cargo test');
    expect(fp.linter).toBe('clippy');
  });

  it('detects polyglot — TS primary, secondary python', () => {
    writeFileSync(join(root, 'tsconfig.json'), '{}');
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0' }));
    writeFileSync(join(root, 'pyproject.toml'), '[tool.poetry]\nname = "x"');
    const fp = scanProjectFingerprint(root);
    expect(fp.languages).toContain('typescript');
    expect(fp.languages).toContain('python');
  });

  it('detects GitHub Actions workflows', () => {
    mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'name: CI\n');
    writeFileSync(join(root, '.github', 'workflows', 'release.yaml'), 'name: Release\n');
    writeFileSync(join(root, '.github', 'workflows', 'README.md'), 'not a workflow');
    const fp = scanProjectFingerprint(root);
    expect(fp.ciFiles).toContain('.github/workflows/ci.yml');
    expect(fp.ciFiles).toContain('.github/workflows/release.yaml');
    expect(fp.ciFiles.length).toBe(2);
  });

  it('detects GitLab + CircleCI + Travis + Jenkins', () => {
    writeFileSync(join(root, '.gitlab-ci.yml'), '');
    mkdirSync(join(root, '.circleci'), { recursive: true });
    writeFileSync(join(root, '.circleci', 'config.yml'), '');
    writeFileSync(join(root, '.travis.yml'), '');
    writeFileSync(join(root, 'Jenkinsfile'), '');
    const fp = scanProjectFingerprint(root);
    expect(fp.ciFiles).toEqual(expect.arrayContaining([
      '.gitlab-ci.yml', '.circleci/config.yml', '.travis.yml', 'Jenkinsfile',
    ]));
  });

  it('detects ESLint from eslint.config.js', () => {
    writeFileSync(join(root, 'tsconfig.json'), '{}');
    writeFileSync(join(root, 'package.json'), '{}');
    writeFileSync(join(root, 'eslint.config.js'), 'export default [];');
    const fp = scanProjectFingerprint(root);
    expect(fp.linter).toBe('eslint');
  });

  it('detects package manager from lockfile', () => {
    writeFileSync(join(root, 'pnpm-lock.yaml'), '');
    writeFileSync(join(root, 'package.json'), '{}');
    const fp = scanProjectFingerprint(root);
    expect(fp.packageManager).toBe('pnpm');
  });

  it('fingerprint includes scannedAt ISO timestamp', () => {
    const fp = scanProjectFingerprint(root);
    expect(() => new Date(fp.scannedAt).toISOString()).not.toThrow();
    expect(fp.scannedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('knit_get_fingerprint via handleToolCall', () => {
  it('returns the fingerprint + summary line', async () => {
    const { handleToolCall } = await import('../src/mcp/tools.js');
    writeFileSync(join(root, 'tsconfig.json'), '{}');
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      name: 'x', version: '1.0.0',
      devDependencies: { typescript: '^5', vitest: '^1' },
    }));
    const brain = buildBrain();
    const res = JSON.parse(handleToolCall('knit_get_fingerprint', {}, brain));
    expect(res.fingerprint).toBeDefined();
    expect(res.fingerprint.languages).toContain('typescript');
    expect(res.summary).toMatch(/typescript/);
    expect(res.summary).toMatch(/vitest/);
  });

  function buildBrain() {
    return {
      rootPath: root,
      knowledge: {
        generatedAt: new Date().toISOString(),
        summary: { totalFiles: 0, totalLines: 0, languageBreakdown: {}, entryPoints: [], highFanoutFiles: [], untestedFiles: [], largestFiles: [] },
        files: [], importGraph: {}, exports: {}, testMap: { tested: {}, untested: [], testFiles: [] },
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
