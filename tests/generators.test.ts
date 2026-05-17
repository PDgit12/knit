import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateClaudeMd } from '../src/generators/claude-md.js';
import { generateSettings, generateSettingsLocal } from '../src/generators/settings.js';
import { generateLearningsContent } from '../src/generators/learnings.js';
import type { EngramConfig, ProjectKnowledge, LearningEntry } from '../src/engine/types.js';

// Sandbox engram data writes; generateSettings embeds paths under ENGRAM_HOME.
let engramHome: string;
const TEST_ROOT = '/tmp/test-project';
beforeAll(() => {
  engramHome = mkdtempSync(join(tmpdir(), 'engram-gen-test-'));
  process.env.ENGRAM_HOME = engramHome;
});
afterAll(() => {
  delete process.env.ENGRAM_HOME;
  try { rmSync(engramHome, { recursive: true, force: true }); } catch { /* best effort */ }
});

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

describe('generateClaudeMd (v0.2 — thin shape)', () => {
  it('includes project name', () => {
    const md = generateClaudeMd(testConfig);
    expect(md).toContain('# test-project');
  });

  it('is wrapped in engram markers for safe regeneration', () => {
    const md = generateClaudeMd(testConfig);
    expect(md).toContain('<!-- engram:start -->');
    expect(md).toContain('<!-- engram:end -->');
    // start must appear before end
    expect(md.indexOf('<!-- engram:start -->')).toBeLessThan(md.indexOf('<!-- engram:end -->'));
  });

  it('emits 150 lines or fewer (v0.2 thin shape target)', () => {
    const md = generateClaudeMd(testConfig);
    const lineCount = md.split('\n').length;
    expect(lineCount).toBeLessThanOrEqual(150);
  });

  it('includes build gates from the project config', () => {
    const md = generateClaudeMd(testConfig);
    expect(md).toContain('npm run typecheck');
    expect(md).toContain('npm run lint');
    expect(md).toContain('npm run build');
  });

  it('includes all detected domains', () => {
    const md = generateClaudeMd(testConfig);
    expect(md).toContain('### UI');
    expect(md).toContain('### API & Security');
    expect(md).toContain('### Quality Assurance');
  });

  it('contains the tier vocabulary (decision aid form)', () => {
    const md = generateClaudeMd(testConfig);
    expect(md).toContain('Tier vocabulary');
    expect(md).toContain('Inquiry');
    expect(md).toContain('Trivial');
    expect(md).toContain('Standard');
    expect(md).toContain('Complex');
  });

  it('points to engram_get_workflow for protocol depth (not inlined)', () => {
    const md = generateClaudeMd(testConfig);
    expect(md).toContain('engram_get_workflow');
    // Must NOT inline the long-form protocol that v0.1 dumped here
    expect(md).not.toContain('Phase 1: RESEARCH');
    expect(md).not.toContain('Phase 6: REVIEW');
    expect(md).not.toContain('Domain Context Object');
    expect(md).not.toContain('MANDATORY, NEVER SKIP');
  });

  it('points to engram_load_session for session startup', () => {
    const md = generateClaudeMd(testConfig);
    expect(md).toContain('engram_load_session');
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
    // Still has the workflow pointer + tier vocabulary
    expect(md).toContain('engram_get_workflow');
  });
});

describe('spliceEngramBlock', () => {
  it('replaces only the in-marker block, preserving surrounding content', async () => {
    const { spliceEngramBlock, ENGRAM_MARKER_START, ENGRAM_MARKER_END } = await import('../src/generators/claude-md.js');
    const existing = `# My Project

Some user content above.

${ENGRAM_MARKER_START}
old engram block
${ENGRAM_MARKER_END}

Some user content below.
`;
    const newBlock = `${ENGRAM_MARKER_START}\nnew engram block\n${ENGRAM_MARKER_END}`;
    const { content, mode } = spliceEngramBlock(existing, newBlock);
    expect(mode).toBe('replaced');
    expect(content).toContain('Some user content above');
    expect(content).toContain('Some user content below');
    expect(content).toContain('new engram block');
    expect(content).not.toContain('old engram block');
  });

  it('returns sidecar-needed when no markers exist', async () => {
    const { spliceEngramBlock } = await import('../src/generators/claude-md.js');
    const existing = `# My Project\n\nThis CLAUDE.md is user-curated.\n`;
    const { mode } = spliceEngramBlock(existing, '## new content');
    expect(mode).toBe('sidecar-needed');
  });
});

describe('generateSettings', () => {
  it('includes destructive git hook', () => {
    const settings = generateSettings(testConfig, TEST_ROOT) as Record<string, unknown>;
    const hooks = settings.hooks as Record<string, unknown[]>;
    expect(hooks.PreToolUse).toBeDefined();
    expect(hooks.PreToolUse.length).toBeGreaterThan(0);
  });

  it('includes typecheck hook for TypeScript', () => {
    const settings = generateSettings(testConfig, TEST_ROOT) as Record<string, unknown>;
    const hooks = settings.hooks as Record<string, unknown[]>;
    expect(hooks.PostToolUse.length).toBeGreaterThan(0);
  });

  it('includes stop hooks with enforcement', () => {
    const settings = generateSettings(testConfig, TEST_ROOT) as Record<string, unknown>;
    const hooks = settings.hooks as Record<string, unknown[]>;
    // build verification + session capture + LEARN enforcement + KB metrics = 4
    expect(hooks.Stop.length).toBeGreaterThanOrEqual(4);
  });

  it('has hooks structure', () => {
    const settings = generateSettings(testConfig, TEST_ROOT) as Record<string, unknown>;
    expect(settings.hooks).toBeDefined();
  });

  it('includes LEARN compliance hook (soft reminder, not enforcement)', () => {
    const settings = generateSettings(testConfig, TEST_ROOT) as Record<string, unknown>;
    const hooks = settings.hooks as Record<string, unknown[]>;
    const stopCommands = hooks.Stop.map((h: any) => h.hooks?.[0]?.command || '').join(' ');
    expect(stopCommands).toContain('LEARN was not recorded this session');
    expect(stopCommands).toContain('test-project.md');
  });

  it('includes KB metrics hook', () => {
    const settings = generateSettings(testConfig, TEST_ROOT) as Record<string, unknown>;
    const hooks = settings.hooks as Record<string, unknown[]>;
    const stopCommands = hooks.Stop.map((h: any) => h.hooks?.[0]?.command || '').join(' ');
    expect(stopCommands).toContain('knowledgebase.json');
    expect(stopCommands).toContain('totalSessions');
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
