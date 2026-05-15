import { describe, it, expect } from 'vitest';
import { generateClaudeMd } from '../src/generators/claude-md.js';
import { generateSettings, generateSettingsLocal } from '../src/generators/settings.js';
import { generateLearningsContent } from '../src/generators/learnings.js';
import type { EngramConfig, ProjectKnowledge, LearningEntry } from '../src/engine/types.js';

const testConfig: EngramConfig = {
  name: 'test-project',
  packageManager: 'npm',
  stack: {
    language: 'typescript',
    framework: 'nextjs',
    dependencies: ['next', 'react', 'typescript'],
    testFramework: 'vitest',
    buildCommand: 'npm run build',
    lintCommand: 'npm run lint',
    typecheckCommand: 'npm run typecheck',
  },
  domains: [
    {
      name: 'UI',
      description: 'Frontend components',
      filePatterns: ['components/**'],
      agents: ['code-reviewer', 'typescript-reviewer'],
    },
    {
      name: 'API & Security',
      description: 'Route handlers',
      filePatterns: ['app/api/**'],
      agents: ['security-reviewer'],
    },
    {
      name: 'Quality Assurance',
      description: 'Tests and configs',
      filePatterns: ['tests/**'],
      agents: ['tdd-guide'],
    },
  ],
  targetAgent: 'claude-code',
  tokenOptimization: 'standard',
};

describe('generateClaudeMd', () => {
  it('includes project name', () => {
    const md = generateClaudeMd(testConfig);
    expect(md).toContain('# test-project');
  });

  it('includes build commands', () => {
    const md = generateClaudeMd(testConfig);
    expect(md).toContain('npm run typecheck');
    expect(md).toContain('npm run lint');
    expect(md).toContain('npm run build');
  });

  it('includes all domains', () => {
    const md = generateClaudeMd(testConfig);
    expect(md).toContain('### UI');
    expect(md).toContain('### API & Security');
    expect(md).toContain('### Quality Assurance');
  });

  it('includes orchestration protocol', () => {
    const md = generateClaudeMd(testConfig);
    expect(md).toContain('Engram Orchestration Protocol');
    expect(md).toContain('LEARN');
    expect(md).toContain('Domain Context Object');
    expect(md).toContain('Task Classification');
  });

  it('includes full phase details', () => {
    const md = generateClaudeMd(testConfig);
    expect(md).toContain('Phase 1: RESEARCH');
    expect(md).toContain('Phase 2: IDEATE');
    expect(md).toContain('Phase 3: PLAN');
    expect(md).toContain('Phase 4: EXECUTE');
    expect(md).toContain('Phase 5: OPTIMIZE');
    expect(md).toContain('Phase 6: REVIEW');
  });

  it('includes agent learning loop', () => {
    const md = generateClaudeMd(testConfig);
    expect(md).toContain('Agent Learning Loop');
    expect(md).toContain('#false-positive');
    expect(md).toContain('VERIFY');
  });

  it('includes auto-detection rules', () => {
    const md = generateClaudeMd(testConfig);
    expect(md).toContain('Auto-detection rules');
    expect(md).toContain('Touches shared types');
  });

  it('does not reference ECC, gstack, or gbrain', () => {
    const md = generateClaudeMd(testConfig);
    expect(md).not.toContain('ECC');
    expect(md).not.toContain('gstack');
    expect(md).not.toContain('gbrain');
  });

  it('includes Project Map when knowledge is provided', () => {
    const knowledge: ProjectKnowledge = {
      generatedAt: '2026-05-15',
      summary: {
        totalFiles: 10,
        totalLines: 500,
        languageBreakdown: { '.ts': 8, '.tsx': 2 },
        entryPoints: ['src/index.ts'],
        highFanoutFiles: ['src/types.ts'],
        untestedFiles: ['src/utils.ts'],
        largestFiles: [{ path: 'src/big.ts', lines: 200 }],
      },
      files: [],
      importGraph: { 'src/index.ts': ['src/types.ts'] },
      exports: {},
      testMap: { tested: {}, untested: ['src/utils.ts'], testFiles: [] },
    };

    const md = generateClaudeMd(testConfig, knowledge);
    expect(md).toContain('Project Map');
    expect(md).toContain('src/index.ts');
    expect(md).toContain('src/types.ts');
    expect(md).toContain('src/utils.ts');
    expect(md).toContain('knowledge.json');
  });

  it('includes False Positives section when provided', () => {
    const fps: LearningEntry[] = [
      {
        date: '2026-05-15',
        summary: 'Missing types for X is not a real issue',
        domains: ['Engine'],
        approach: 'Verified manually',
        outcome: 'success',
        lesson: 'Types are inferred at runtime',
        tags: ['#engine', '#false-positive'],
      },
    ];

    const md = generateClaudeMd(testConfig, null, fps);
    expect(md).toContain('Known False Positives');
    expect(md).toContain('Missing types for X');
    expect(md).toContain('Types are inferred at runtime');
  });

  it('works without knowledge or false positives', () => {
    const md = generateClaudeMd(testConfig);
    expect(md).not.toContain('## Project Map');
    expect(md).not.toContain('## Known False Positives');
    expect(md).toContain('Engram Orchestration Protocol');
  });

  it('includes effort scaling (not fake token numbers)', () => {
    const md = generateClaudeMd(testConfig);
    expect(md).toContain('Effort Scaling');
    expect(md).toContain('Trivial');
    expect(md).toContain('Standard');
    expect(md).toContain('Complex');
    expect(md).not.toContain('~5-8k tokens');
    expect(md).not.toContain('~20-30k tokens');
    expect(md).toContain('proven, not estimated');
  });

  it('includes handoff protocol', () => {
    const md = generateClaudeMd(testConfig);
    expect(md).toContain('Handoff Protocol');
    expect(md).toContain('Failed Attempts');
  });

  it('includes LEARN enforcement', () => {
    const md = generateClaudeMd(testConfig);
    expect(md).toContain('MANDATORY, NEVER SKIP');
    expect(md).toContain('LEARN complete');
  });
});

describe('generateSettings', () => {
  it('includes destructive git hook', () => {
    const settings = generateSettings(testConfig) as Record<string, unknown>;
    const hooks = settings.hooks as Record<string, unknown[]>;
    expect(hooks.PreToolUse).toBeDefined();
    expect(hooks.PreToolUse.length).toBeGreaterThan(0);
  });

  it('includes typecheck hook for TypeScript', () => {
    const settings = generateSettings(testConfig) as Record<string, unknown>;
    const hooks = settings.hooks as Record<string, unknown[]>;
    expect(hooks.PostToolUse.length).toBeGreaterThan(0);
  });

  it('includes stop hooks', () => {
    const settings = generateSettings(testConfig) as Record<string, unknown>;
    const hooks = settings.hooks as Record<string, unknown[]>;
    expect(hooks.Stop.length).toBeGreaterThanOrEqual(2); // build verification + session capture
  });

  it('has hooks structure', () => {
    const settings = generateSettings(testConfig) as Record<string, unknown>;
    expect(settings.hooks).toBeDefined();
  });
});

describe('generateSettingsLocal', () => {
  it('includes common permissions', () => {
    const local = generateSettingsLocal(testConfig) as Record<string, unknown>;
    const perms = local.permissions as Record<string, string[]>;
    expect(perms.allow).toContain('Bash(npm:*)');
    expect(perms.allow).toContain('Bash(git:*)');
  });

  it('includes language-specific permissions for TypeScript', () => {
    const local = generateSettingsLocal(testConfig) as Record<string, unknown>;
    const perms = local.permissions as Record<string, string[]>;
    expect(perms.allow).toContain('Bash(npx:*)');
    expect(perms.allow).toContain('Bash(node:*)');
  });

  it('includes pnpm permissions when pnpm detected', () => {
    const pnpmConfig = { ...testConfig, packageManager: 'pnpm' as const };
    const local = generateSettingsLocal(pnpmConfig) as Record<string, unknown>;
    const perms = local.permissions as Record<string, string[]>;
    expect(perms.allow).toContain('Bash(pnpm:*)');
  });

  it('includes python permissions for Python projects', () => {
    const pyConfig = { ...testConfig, packageManager: 'unknown' as const, stack: { ...testConfig.stack, language: 'python' as const } };
    const local = generateSettingsLocal(pyConfig) as Record<string, unknown>;
    const perms = local.permissions as Record<string, string[]>;
    expect(perms.allow).toContain('Bash(python3:*)');
    expect(perms.allow).toContain('Bash(pytest:*)');
  });

  it('includes go permissions for Go projects', () => {
    const goConfig = { ...testConfig, packageManager: 'unknown' as const, stack: { ...testConfig.stack, language: 'go' as const } };
    const local = generateSettingsLocal(goConfig) as Record<string, unknown>;
    const perms = local.permissions as Record<string, string[]>;
    expect(perms.allow).toContain('Bash(go:*)');
  });

  it('includes rust permissions for Rust projects', () => {
    const rustConfig = { ...testConfig, packageManager: 'unknown' as const, stack: { ...testConfig.stack, language: 'rust' as const } };
    const local = generateSettingsLocal(rustConfig) as Record<string, unknown>;
    const perms = local.permissions as Record<string, string[]>;
    expect(perms.allow).toContain('Bash(cargo:*)');
  });
});

describe('generateLearningsContent', () => {
  it('includes project name', () => {
    const content = generateLearningsContent(testConfig);
    expect(content).toContain('test-project');
  });

  it('includes bootstrap entry', () => {
    const content = generateLearningsContent(testConfig);
    expect(content).toContain('#workflow');
    expect(content).toContain('#bootstrap');
    expect(content).toContain('typescript + nextjs');
  });

  it('includes instructions for usage', () => {
    const content = generateLearningsContent(testConfig);
    expect(content).toContain('Grep by `#tag`');
    expect(content).toContain('LEARN phase');
  });
});
