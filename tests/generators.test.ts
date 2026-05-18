import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateClaudeMd } from '../src/generators/claude-md.js';
import { generateSettings, generateSettingsLocal } from '../src/generators/settings.js';
import { generateLearningsContent } from '../src/generators/learnings.js';
import type { KnitConfig, ProjectKnowledge, LearningEntry } from '../src/engine/types.js';

// Sandbox engram data writes; generateSettings embeds paths under KNIT_HOME.
let knitHome: string;
const TEST_ROOT = '/tmp/test-project';
beforeAll(() => {
  knitHome = mkdtempSync(join(tmpdir(), 'knit-gen-test-'));
  process.env.KNIT_HOME = knitHome;
});
afterAll(() => {
  delete process.env.KNIT_HOME;
  try { rmSync(knitHome, { recursive: true, force: true }); } catch { /* best effort */ }
});

const testConfig: KnitConfig = {
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
    expect(md).toContain('<!-- knit:start -->');
    expect(md).toContain('<!-- knit:end -->');
    // start must appear before end
    expect(md.indexOf('<!-- knit:start -->')).toBeLessThan(md.indexOf('<!-- knit:end -->'));
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

  it('points to knit_get_workflow for protocol depth (not inlined)', () => {
    const md = generateClaudeMd(testConfig);
    expect(md).toContain('knit_get_workflow');
    // Must NOT inline the long-form protocol that v0.1 dumped here
    expect(md).not.toContain('Phase 1: RESEARCH');
    expect(md).not.toContain('Phase 6: REVIEW');
    expect(md).not.toContain('Domain Context Object');
    expect(md).not.toContain('MANDATORY, NEVER SKIP');
  });

  it('points to knit_load_session for session startup', () => {
    const md = generateClaudeMd(testConfig);
    expect(md).toContain('knit_load_session');
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
    expect(md).toContain('knit_get_workflow');
  });
});

describe('spliceKnitBlock', () => {
  it('replaces only the in-marker block, preserving surrounding content', async () => {
    const { spliceKnitBlock, KNIT_MARKER_START, KNIT_MARKER_END } = await import('../src/generators/claude-md.js');
    const existing = `# My Project

Some user content above.

${KNIT_MARKER_START}
old engram block
${KNIT_MARKER_END}

Some user content below.
`;
    const newBlock = `${KNIT_MARKER_START}\nnew engram block\n${KNIT_MARKER_END}`;
    const { content, mode } = spliceKnitBlock(existing, newBlock);
    expect(mode).toBe('replaced');
    expect(content).toContain('Some user content above');
    expect(content).toContain('Some user content below');
    expect(content).toContain('new engram block');
    expect(content).not.toContain('old engram block');
  });

  it('returns sidecar-needed when no markers exist', async () => {
    const { spliceKnitBlock } = await import('../src/generators/claude-md.js');
    const existing = `# My Project\n\nThis CLAUDE.md is user-curated.\n`;
    const { mode } = spliceKnitBlock(existing, '## new content');
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

  // ── Protocol Guard (v0.5.0) ──
  describe('Protocol Guard hooks', () => {
    it('emits a SessionStart hook tagged _knitOwned', () => {
      const settings = generateSettings(testConfig, TEST_ROOT) as Record<string, unknown>;
      const hooks = settings.hooks as Record<string, unknown[]>;
      expect(hooks.SessionStart).toBeDefined();
      expect(Array.isArray(hooks.SessionStart)).toBe(true);
      expect(hooks.SessionStart.length).toBeGreaterThan(0);
      expect((hooks.SessionStart[0] as any)._knitOwned).toBe(true);
      const cmd = (hooks.SessionStart[0] as any).hooks?.[0]?.command || '';
      expect(cmd).toContain('session marker');
    });

    it('emits a UserPromptSubmit hook that clears the classification marker', () => {
      const settings = generateSettings(testConfig, TEST_ROOT) as Record<string, unknown>;
      const hooks = settings.hooks as Record<string, unknown[]>;
      expect(hooks.UserPromptSubmit).toBeDefined();
      expect((hooks.UserPromptSubmit[0] as any)._knitOwned).toBe(true);
      const cmd = (hooks.UserPromptSubmit[0] as any).hooks?.[0]?.command || '';
      expect(cmd).toContain('.classified-current');
    });

    it('emits a PreToolUse classification gate for Edit/Write/MultiEdit', () => {
      const settings = generateSettings(testConfig, TEST_ROOT) as Record<string, unknown>;
      const hooks = settings.hooks as Record<string, unknown[]>;
      const gate = (hooks.PreToolUse as any[]).find((e) => e.matcher === 'Edit|Write|MultiEdit');
      expect(gate).toBeDefined();
      expect(gate._knitOwned).toBe(true);
      const cmd = gate.hooks?.[0]?.command || '';
      expect(cmd).toContain('protocol-config.json');
      expect(cmd).toContain('knit_classify_task');
      expect(cmd).toContain('process.exit(2)');
    });
  });

  // ── Cross-platform (Windows + macOS + Linux + WSL) ──
  describe('cross-platform hook commands (v0.3.1+)', () => {
    it('every hook command starts with node -e (no shell-only commands)', () => {
      const settings = generateSettings(testConfig, TEST_ROOT) as Record<string, unknown>;
      const hooks = settings.hooks as Record<string, unknown[]>;
      const allCommands: string[] = [];
      for (const phase of ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop']) {
        for (const entry of (hooks[phase] ?? []) as any[]) {
          for (const h of entry.hooks ?? []) {
            if (typeof h.command === 'string') allCommands.push(h.command);
          }
        }
      }
      expect(allCommands.length).toBeGreaterThan(0);
      for (const cmd of allCommands) {
        expect(cmd, `hook does not start with node -e: ${cmd.slice(0, 60)}...`)
          .toMatch(/^node -e /);
      }
    });

    it('no hook uses bash-only pipelines (jq, grep, awk, sed, tr, find -mmin)', () => {
      const settings = generateSettings(testConfig, TEST_ROOT) as Record<string, unknown>;
      const hooks = settings.hooks as Record<string, unknown[]>;
      const allCommands: string[] = [];
      for (const phase of ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop']) {
        for (const entry of (hooks[phase] ?? []) as any[]) {
          for (const h of entry.hooks ?? []) {
            if (typeof h.command === 'string') allCommands.push(h.command);
          }
        }
      }
      const allText = allCommands.join('\n');
      // Bash-only utilities that fail on native Windows shells
      // (jq, find -mmin, printf '%s', etc. — Windows has no out-of-the-box equivalents)
      const banned = [
        / jq /, / jq$/,           // jq not on Windows by default
        / find .* -mmin /,        // GNU find -mmin not on Windows
        / printf '%s'/,           // printf %s with single quotes is unix-only
        / \| wc -l/,              // wc not on Windows
        / \| tail -/,             // tail not on Windows
        / \| head -/,             // head not on Windows
        / \| awk /,               // awk not on Windows
        / \| sed /,               // sed not on Windows
        / \| tr /,                // tr not on Windows
      ];
      for (const pattern of banned) {
        expect(allText, `Hooks contain bash-only pattern ${pattern}`).not.toMatch(pattern);
      }
    });

    it('paths embedded in hooks use forward slashes (Windows + Unix compatible)', () => {
      const settings = generateSettings(testConfig, '/tmp/test-project') as Record<string, unknown>;
      const hooks = settings.hooks as Record<string, unknown[]>;
      const allCommands: string[] = [];
      for (const phase of ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop']) {
        for (const entry of (hooks[phase] ?? []) as any[]) {
          for (const h of entry.hooks ?? []) {
            if (typeof h.command === 'string') allCommands.push(h.command);
          }
        }
      }
      const allText = allCommands.join('\n');
      // Path separators that could leak through if we accidentally embed Windows-style paths
      // We explicitly normalize to forward slashes via jsLit() — this guards regressions.
      expect(allText).not.toMatch(/\\\\[A-Za-z]/);  // backslash-escaped paths
    });
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
