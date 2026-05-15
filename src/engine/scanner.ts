import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import type { ProjectScan, StackInfo, Domain, GitInfo } from './types.js';

/**
 * Scans a project directory and detects stack, structure, and domains.
 * This is the entry point — everything else flows from scan results.
 */
export function scanProject(rootPath: string): ProjectScan {
  return {
    rootPath,
    packageManager: detectPackageManager(rootPath),
    stack: detectStack(rootPath),
    domains: detectDomains(rootPath),
    hasExistingSetup: existsSync(join(rootPath, '.claude')),
    hasExistingClaudeMd: existsSync(join(rootPath, 'CLAUDE.md')),
    git: detectGit(rootPath),
  };
}

function detectPackageManager(root: string): ProjectScan['packageManager'] {
  if (existsSync(join(root, 'bun.lockb')) || existsSync(join(root, 'bun.lock'))) return 'bun';
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(root, 'package-lock.json'))) return 'npm';
  if (existsSync(join(root, 'package.json'))) return 'npm';
  return 'unknown';
}

function detectStack(root: string): StackInfo {
  const stack: StackInfo = {
    language: 'unknown',
    framework: null,
    dependencies: [],
    testFramework: null,
    buildCommand: null,
    lintCommand: null,
    typecheckCommand: null,
  };

  // Node/JS/TS projects
  const pkgPath = join(root, 'package.json');
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    // Language
    if (allDeps.typescript || existsSync(join(root, 'tsconfig.json'))) {
      stack.language = 'typescript';
      stack.typecheckCommand = 'tsc --noEmit';
    } else {
      stack.language = 'javascript';
    }

    // Framework detection
    if (allDeps.next) stack.framework = 'nextjs';
    else if (allDeps.nuxt) stack.framework = 'nuxt';
    else if (allDeps.react) stack.framework = 'react';
    else if (allDeps.vue) stack.framework = 'vue';
    else if (allDeps.svelte || allDeps['@sveltejs/kit']) stack.framework = 'svelte';
    else if (allDeps.express) stack.framework = 'express';
    else if (allDeps.fastify) stack.framework = 'fastify';
    else if (allDeps.hono) stack.framework = 'hono';

    // Key dependencies
    stack.dependencies = Object.keys(allDeps).filter((d) =>
      !d.startsWith('@types/') && !d.startsWith('eslint')
    );

    // Test framework
    if (allDeps.vitest) stack.testFramework = 'vitest';
    else if (allDeps.jest) stack.testFramework = 'jest';
    else if (allDeps.mocha) stack.testFramework = 'mocha';
    else if (allDeps.playwright || allDeps['@playwright/test']) stack.testFramework = 'playwright';

    // Build/lint from scripts
    const scripts = pkg.scripts || {};
    if (scripts.build) stack.buildCommand = `${detectPackageManager(root)} run build`;
    if (scripts.lint) stack.lintCommand = `${detectPackageManager(root)} run lint`;
    if (scripts.typecheck) stack.typecheckCommand = `${detectPackageManager(root)} run typecheck`;

    return stack;
  }

  // Python projects
  if (existsSync(join(root, 'pyproject.toml')) || existsSync(join(root, 'requirements.txt'))) {
    stack.language = 'python';
    if (existsSync(join(root, 'pyproject.toml'))) {
      const pyproject = readFileSync(join(root, 'pyproject.toml'), 'utf-8');
      if (pyproject.includes('django')) stack.framework = 'django';
      else if (pyproject.includes('fastapi')) stack.framework = 'fastapi';
      else if (pyproject.includes('flask')) stack.framework = 'flask';
      if (pyproject.includes('pytest')) stack.testFramework = 'pytest';
    }
    return stack;
  }

  // Go projects
  if (existsSync(join(root, 'go.mod'))) {
    stack.language = 'go';
    stack.testFramework = 'go test';
    stack.buildCommand = 'go build ./...';
    return stack;
  }

  // Rust projects
  if (existsSync(join(root, 'Cargo.toml'))) {
    stack.language = 'rust';
    stack.testFramework = 'cargo test';
    stack.buildCommand = 'cargo build';
    return stack;
  }

  return stack;
}

function detectDomains(root: string): Domain[] {
  const domains: Domain[] = [];

  // Check for common project structures
  const hasSrc = existsSync(join(root, 'src'));
  const hasLib = existsSync(join(root, 'lib'));
  const hasComponents = existsSync(join(root, 'src', 'components')) || existsSync(join(root, 'components'));
  const hasApi = existsSync(join(root, 'app', 'api')) || existsSync(join(root, 'src', 'api')) || existsSync(join(root, 'api'));
  const hasTests = existsSync(join(root, 'tests')) || existsSync(join(root, '__tests__')) || existsSync(join(root, 'test'));

  if (hasComponents) {
    domains.push({
      name: 'UI',
      description: 'Frontend components, pages, and user-facing code',
      filePatterns: ['components/**', 'app/**/*.tsx', 'src/components/**', 'pages/**'],
      agents: ['code-reviewer', 'typescript-reviewer'],
    });
  }

  if (hasApi) {
    domains.push({
      name: 'API & Security',
      description: 'Route handlers, authentication, authorization, rate limiting',
      filePatterns: ['app/api/**', 'src/api/**', 'api/**'],
      agents: ['security-reviewer', 'typescript-reviewer', 'code-reviewer'],
    });
  }

  if (hasLib || hasSrc) {
    domains.push({
      name: 'Business Logic',
      description: 'Types, validations, calculations, data transformations',
      filePatterns: ['lib/**', 'src/lib/**', 'src/utils/**', 'src/services/**'],
      agents: ['type-design-analyzer', 'code-reviewer', 'code-architect', 'silent-failure-hunter'],
    });
  }

  // Infrastructure domain — DB, email, external integrations
  const infraPatterns = ['lib/db.*', 'lib/email.*', 'src/db/**', 'src/infra/**', 'prisma/**', 'drizzle/**'];
  domains.push({
    name: 'Infrastructure',
    description: 'Database, email, webhooks, middleware, external integrations',
    filePatterns: infraPatterns,
    agents: ['database-reviewer', 'performance-optimizer', 'code-reviewer', 'silent-failure-hunter'],
  });

  if (hasTests) {
    domains.push({
      name: 'Quality Assurance',
      description: 'Tests, build configs, lint configs, CI/CD',
      filePatterns: ['tests/**', '__tests__/**', 'test/**', '*.config.*'],
      agents: ['tdd-guide', 'pr-test-analyzer', 'build-error-resolver'],
    });
  }

  // Fallback: if nothing detected, create a generic domain structure
  if (domains.length === 0) {
    domains.push({
      name: 'Core',
      description: 'Main application code',
      filePatterns: ['src/**', 'lib/**', 'app/**'],
      agents: ['code-reviewer'],
    });
  }

  return domains;
}

function detectGit(root: string): GitInfo {
  const isRepo = existsSync(join(root, '.git'));
  let defaultBranch: string | null = null;
  let hasRemote = false;

  if (isRepo) {
    try {
      defaultBranch = execSync('git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null', {
        cwd: root,
        encoding: 'utf-8',
      }).trim().replace('refs/remotes/origin/', '');
    } catch {
      // Try common defaults
      try {
        execSync('git rev-parse --verify main 2>/dev/null', { cwd: root });
        defaultBranch = 'main';
      } catch {
        try {
          execSync('git rev-parse --verify master 2>/dev/null', { cwd: root });
          defaultBranch = 'master';
        } catch {
          defaultBranch = 'main'; // Assume main as default
        }
      }
    }

    try {
      const remotes = execSync('git remote', { cwd: root, encoding: 'utf-8' }).trim();
      hasRemote = remotes.length > 0;
    } catch {
      hasRemote = false;
    }
  }

  return { isRepo, defaultBranch, hasRemote };
}
