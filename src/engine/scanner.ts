import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import type { ProjectScan, StackInfo, Domain, GitInfo } from './types.js';

/**
 * Scans a project directory and detects stack, structure, and domains.
 * This is the entry point — everything else flows from scan results.
 */
export function scanProject(rootPath: string): ProjectScan {
  const stack = detectStack(rootPath);
  return {
    rootPath,
    packageManager: detectPackageManager(rootPath),
    stack,
    domains: detectDomains(rootPath, stack.language),
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pkg: any;
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    } catch {
      return stack; // malformed package.json — return what we have
    }
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

function detectDomains(root: string, lang: StackInfo['language'] = 'unknown'): Domain[] {
  const domains: Domain[] = [];

  // ── Language-aware agent selection ─────────────────────────────
  const coreAgents = getAgentsForLanguage(lang, 'core');
  const securityAgents = getAgentsForLanguage(lang, 'security');
  const qaAgents = getAgentsForLanguage(lang, 'qa');

  // ── UI / Frontend ─────────────────────────────────────────────
  const hasComponents = existsSync(join(root, 'src', 'components')) || existsSync(join(root, 'components'))
    || existsSync(join(root, 'pages')) || existsSync(join(root, 'app'))
    || existsSync(join(root, 'templates')); // Django/Flask
  if (hasComponents) {
    domains.push({
      name: 'UI',
      description: 'Frontend components, pages, templates, and user-facing code',
      filePatterns: ['components/**', 'app/**/*.tsx', 'src/components/**', 'pages/**', 'templates/**'],
      agents: coreAgents,
    });
  }

  // ── API / Endpoints ───────────────────────────────────────────
  const hasApi = existsSync(join(root, 'app', 'api')) || existsSync(join(root, 'src', 'api'))
    || existsSync(join(root, 'api')) || existsSync(join(root, 'handlers'))
    || existsSync(join(root, 'routes')) || existsSync(join(root, 'controllers'))
    || existsSync(join(root, 'cmd')); // Go
  if (hasApi) {
    domains.push({
      name: 'API & Security',
      description: 'Route handlers, endpoints, authentication, authorization, input validation',
      filePatterns: ['app/api/**', 'src/api/**', 'api/**', 'handlers/**', 'routes/**', 'controllers/**', 'cmd/**'],
      agents: securityAgents,
    });
  }

  // ── Core Logic ────────────────────────────────────────────────
  const hasSrc = existsSync(join(root, 'src'));
  const hasLib = existsSync(join(root, 'lib'));
  const hasPkg = existsSync(join(root, 'pkg')); // Go
  const hasInternal = existsSync(join(root, 'internal')); // Go
  if (hasSrc || hasLib || hasPkg || hasInternal) {
    domains.push({
      name: 'Core Logic',
      description: 'Types, models, business rules, calculations, data transformations',
      filePatterns: ['src/**', 'lib/**', 'pkg/**', 'internal/**', 'models/**'],
      agents: coreAgents,
    });
  }

  // ── Infrastructure ────────────────────────────────────────────
  const hasInfra = existsSync(join(root, 'prisma')) || existsSync(join(root, 'drizzle'))
    || existsSync(join(root, 'migrations')) || existsSync(join(root, 'docker-compose.yml'))
    || existsSync(join(root, 'Dockerfile')) || existsSync(join(root, 'terraform'))
    || existsSync(join(root, '.github'));
  if (hasInfra) {
    domains.push({
      name: 'Infrastructure',
      description: 'Database, migrations, Docker, CI/CD, deployment, external integrations',
      filePatterns: ['prisma/**', 'drizzle/**', 'migrations/**', 'Dockerfile*', 'docker-compose*', '.github/**', 'terraform/**'],
      agents: ['code-reviewer', 'performance-optimizer'],
    });
  }

  // ── Quality Assurance ─────────────────────────────────────────
  // Language-aware test detection
  const hasTests = existsSync(join(root, 'tests')) || existsSync(join(root, '__tests__'))
    || existsSync(join(root, 'test')) || existsSync(join(root, 'spec'));

  // Go/Rust have inline tests — check for _test.go / #[test]
  const hasInlineTests = lang === 'go' || lang === 'rust';

  if (hasTests || hasInlineTests) {
    domains.push({
      name: 'Quality Assurance',
      description: 'Tests, test coverage, build configs, CI/CD pipelines',
      filePatterns: ['tests/**', '__tests__/**', 'test/**', 'spec/**', '**/*_test.go', '**/*.test.*'],
      agents: qaAgents,
    });
  }

  // ── Fallback: if nothing detected ─────────────────────────────
  if (domains.length === 0) {
    domains.push({
      name: 'Core',
      description: 'Main application code',
      filePatterns: ['src/**', 'lib/**', 'app/**', '**/*'],
      agents: coreAgents,
    });
  }

  return domains;
}

/** Get the right agents for a language + domain role */
function getAgentsForLanguage(lang: string, role: 'core' | 'security' | 'qa'): string[] {
  const langReviewers: Record<string, string> = {
    typescript: 'typescript-reviewer',
    javascript: 'typescript-reviewer',
    python: 'python-reviewer',
    go: 'go-reviewer',
    rust: 'rust-reviewer',
    java: 'java-reviewer',
  };

  const langBuildResolvers: Record<string, string> = {
    typescript: 'build-error-resolver',
    javascript: 'build-error-resolver',
    python: 'build-error-resolver',
    go: 'go-build-resolver',
    rust: 'rust-build-resolver',
    java: 'java-build-resolver',
  };

  const reviewer = langReviewers[lang] || 'code-reviewer';
  const buildResolver = langBuildResolvers[lang] || 'build-error-resolver';

  switch (role) {
    case 'core':
      return ['code-reviewer', reviewer, 'code-architect'];
    case 'security':
      return ['security-reviewer', reviewer, 'code-reviewer'];
    case 'qa':
      return ['tdd-guide', 'pr-test-analyzer', buildResolver];
  }
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
