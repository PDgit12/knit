import { describe, it, expect } from 'vitest';

import { composeAutoConfiguredSections } from '../src/generators/auto-config.js';
import type { ProjectFingerprint } from '../src/engine/types.js';
import type { DomainCandidate } from '../src/engine/domain-inference.js';

/**
 * v0.12 phase 2 — template composition.
 *
 * Pure transformation: ProjectFingerprint + DomainCandidate[] → markdown
 * sections. No IO; just string assembly with sensible fallbacks when
 * signals are sparse.
 */

const FULL_FP: ProjectFingerprint = {
  languages: ['typescript'],
  framework: 'nextjs',
  testRunner: 'vitest',
  linter: 'eslint',
  buildCommand: 'npm run build',
  lintCommand: 'npm run lint',
  typecheckCommand: 'npm run typecheck',
  packageManager: 'npm',
  ciFiles: ['.github/workflows/ci.yml'],
  scannedAt: '2026-05-24T00:00:00Z',
};

const EMPTY_FP: ProjectFingerprint = {
  languages: [],
  framework: null,
  testRunner: null,
  linter: null,
  buildCommand: null,
  lintCommand: null,
  typecheckCommand: null,
  packageManager: null,
  ciFiles: [],
  scannedAt: '2026-05-24T00:00:00Z',
};

const DOMAINS: DomainCandidate[] = [
  { name: 'engine', confidence: 1.0, files: ['src/engine/foo.ts', 'src/engine/bar.ts'], signals: ['centrality', 'co-change'] },
  { name: 'api', confidence: 0.7, files: ['src/api/handlers.ts'], signals: ['centrality'] },
];

describe('composeAutoConfiguredSections — full signals', () => {
  it('Project Identity surfaces stack, framework, package manager, CI', () => {
    const { projectIdentity } = composeAutoConfiguredSections('Knit', FULL_FP, DOMAINS);
    expect(projectIdentity).toMatch(/## Knit/);
    expect(projectIdentity).toMatch(/typescript/);
    expect(projectIdentity).toMatch(/nextjs/);
    expect(projectIdentity).toMatch(/npm/);
    expect(projectIdentity).toMatch(/1 workflow/);
  });

  it('Build & Verify emits a code block with all four commands', () => {
    const { buildAndVerify } = composeAutoConfiguredSections('Knit', FULL_FP, DOMAINS);
    expect(buildAndVerify).toMatch(/## Build & Verify/);
    expect(buildAndVerify).toMatch(/```bash/);
    expect(buildAndVerify).toMatch(/npm run typecheck/);
    expect(buildAndVerify).toMatch(/npm run lint/);
    expect(buildAndVerify).toMatch(/vitest/);
    expect(buildAndVerify).toMatch(/npm run build/);
    expect(buildAndVerify).toMatch(/MUST pass/);
  });

  it('Domain Architecture renders a confidence-ranked table', () => {
    const { domainArchitecture } = composeAutoConfiguredSections('Knit', FULL_FP, DOMAINS);
    expect(domainArchitecture).toMatch(/## Domain Architecture/);
    expect(domainArchitecture).toMatch(/\| Domain \| Confidence \| Signals \| Anchor files \|/);
    expect(domainArchitecture).toMatch(/\*\*engine\*\*/);
    expect(domainArchitecture).toMatch(/1\.00/);
    expect(domainArchitecture).toMatch(/centrality, co-change/);
    expect(domainArchitecture).toMatch(/`src\/engine\/foo\.ts`/);
  });

  it('combined preview is the three sections joined by double-newline', () => {
    const { combined, projectIdentity, buildAndVerify, domainArchitecture } = composeAutoConfiguredSections('Knit', FULL_FP, DOMAINS);
    expect(combined).toBe([projectIdentity, buildAndVerify, domainArchitecture].join('\n\n'));
  });
});

describe('composeAutoConfiguredSections — fallbacks', () => {
  it('Project Identity falls back to manual-fill prompt when no signals', () => {
    const { projectIdentity } = composeAutoConfiguredSections('Empty', EMPTY_FP, []);
    expect(projectIdentity).toMatch(/No stack signals/);
  });

  it('Build & Verify falls back to manual-fill prompt when no commands', () => {
    const { buildAndVerify } = composeAutoConfiguredSections('Empty', EMPTY_FP, []);
    expect(buildAndVerify).toMatch(/No build commands detected/);
    expect(buildAndVerify).not.toMatch(/```bash/);
  });

  it('Domain Architecture falls back when no domains inferred', () => {
    const { domainArchitecture } = composeAutoConfiguredSections('Empty', FULL_FP, []);
    expect(domainArchitecture).toMatch(/No domains inferred/);
    expect(domainArchitecture).toMatch(/knit_infer_domains/);
  });

  it('truncates anchor files to first 3 + count of remainder', () => {
    const many: DomainCandidate[] = [{
      name: 'big', confidence: 1.0, signals: ['centrality'],
      files: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'],
    }];
    const { domainArchitecture } = composeAutoConfiguredSections('p', FULL_FP, many);
    expect(domainArchitecture).toMatch(/`a\.ts`, `b\.ts`, `c\.ts`, \+2 more/);
  });
});

describe('knit_compose_template via handleToolCall', () => {
  it('returns preview with fingerprint + inferred_domains + composed sections', async () => {
    const { handleToolCall } = await import('../src/mcp/tools.js');
    const { mkdtempSync, rmSync, mkdirSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const root = mkdtempSync(`${tmpdir()}/knit-compose-`);
    try {
      writeFileSync(`${root}/tsconfig.json`, '{}');
      writeFileSync(`${root}/package.json`, JSON.stringify({
        name: 'demo', version: '1.0.0',
        devDependencies: { typescript: '^5', vitest: '^1' },
        scripts: { build: 'tsc', test: 'vitest' },
      }));
      mkdirSync(`${root}/src/engine`, { recursive: true });
      const brain = {
        rootPath: root,
        knowledge: {
          generatedAt: new Date().toISOString(),
          summary: { totalFiles: 0, totalLines: 0, languageBreakdown: {}, entryPoints: [], highFanoutFiles: [], untestedFiles: [], largestFiles: [] },
          files: [],
          importGraph: { 'src/cli/main.ts': ['src/engine/foo.ts'] },
          exports: {}, testMap: { tested: {}, untested: [], testFiles: [] },
        },
        reverseDeps: {},
        knowledgeBase: { version: 1, projectName: 'demo', entries: [], metrics: { totalSessions: 0, totalLearnings: 0, cacheHits: 0, domainDistribution: {}, sessions: [] } },
        config: { name: 'demo', packageManager: 'npm', stack: { language: 'typescript', dependencies: [], buildCommand: '', lintCommand: '', typecheckCommand: '' }, domains: [], targetAgent: 'claude-code', tokenOptimization: 'standard' },
        loadedAt: Date.now(),
        autoInitialized: false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
      const res = JSON.parse(handleToolCall('knit_compose_template', {}, brain));
      expect(res.project_name).toBe('demo');
      expect(res.fingerprint).toBeDefined();
      expect(res.composed_sections.project_identity).toMatch(/demo/);
      expect(res.composed_sections.build_and_verify).toMatch(/Build & Verify/);
      expect(res.combined_preview).toBeDefined();
    } finally {
      try { rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  });
});
