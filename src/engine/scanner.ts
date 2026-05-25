import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import type { ProjectScan, StackInfo, Domain, GitInfo, ProjectFingerprint } from './types.js';
import { agentsForRole } from './agent-registry.js';

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

/** v0.12 phase 0 — Project fingerprinting.
 *
 *  Wraps the existing stack/package-manager detection into a single
 *  ProjectFingerprint object plus adds CI-file detection (which the legacy
 *  StackInfo didn't track). Output is what v0.12 phase 1 + 2 consume to
 *  generate accurate per-project CLAUDE.md from real signals. */
export function scanProjectFingerprint(rootPath: string): ProjectFingerprint {
  const stack = detectStack(rootPath);
  const pm = detectPackageManager(rootPath);
  const languages: string[] = [];
  if (stack.language && stack.language !== 'unknown') languages.push(stack.language);
  // Secondary language detection: a TS/JS project that also has python
  // scripts (common for data-science / ML repos) or a polyglot monorepo.
  if (stack.language !== 'python' && existsSync(join(rootPath, 'pyproject.toml'))) languages.push('python');
  if (stack.language !== 'go' && existsSync(join(rootPath, 'go.mod'))) languages.push('go');
  if (stack.language !== 'rust' && existsSync(join(rootPath, 'Cargo.toml'))) languages.push('rust');
  return {
    languages,
    framework: stack.framework,
    testRunner: stack.testFramework,
    linter: detectLinter(rootPath, stack.language),
    buildCommand: stack.buildCommand,
    lintCommand: stack.lintCommand,
    typecheckCommand: stack.typecheckCommand,
    packageManager: pm === 'unknown' ? null : pm,
    ciFiles: detectCiFiles(rootPath),
    scannedAt: new Date().toISOString(),
  };
}

/** Detect a linter from common config-file presence + dep signals. Linter
 *  detection lives separately from StackInfo for back-compat (legacy
 *  StackInfo doesn't track linter as a first-class field). */
function detectLinter(rootPath: string, language: string | null): string | null {
  if (existsSync(join(rootPath, '.eslintrc.json')) || existsSync(join(rootPath, '.eslintrc.js'))
      || existsSync(join(rootPath, 'eslint.config.js')) || existsSync(join(rootPath, 'eslint.config.mjs'))
      || existsSync(join(rootPath, 'eslint.config.ts'))) return 'eslint';
  if (existsSync(join(rootPath, '.ruff.toml')) || existsSync(join(rootPath, 'ruff.toml'))) return 'ruff';
  if (existsSync(join(rootPath, '.golangci.yml')) || existsSync(join(rootPath, '.golangci.yaml'))) return 'golangci-lint';
  if (existsSync(join(rootPath, 'clippy.toml'))) return 'clippy';
  // Fallbacks by language convention.
  if (language === 'python' && existsSync(join(rootPath, 'pyproject.toml'))) {
    try {
      const py = readFileSync(join(rootPath, 'pyproject.toml'), 'utf-8');
      if (py.includes('ruff')) return 'ruff';
      if (py.includes('flake8')) return 'flake8';
      if (py.includes('pylint')) return 'pylint';
    } catch { /* malformed — skip */ }
  }
  if (language === 'go') return 'golangci-lint';
  if (language === 'rust') return 'clippy';
  return null;
}

/** Detect CI configuration files (GitHub Actions, GitLab CI, CircleCI,
 *  Travis, Jenkins). Returns relative paths to all matched files. */
function detectCiFiles(rootPath: string): string[] {
  const out: string[] = [];
  // GitHub Actions
  const ghDir = join(rootPath, '.github', 'workflows');
  if (existsSync(ghDir)) {
    try {
      for (const f of readdirSync(ghDir)) {
        if (f.endsWith('.yml') || f.endsWith('.yaml')) {
          out.push(join('.github/workflows', f));
        }
      }
    } catch { /* unreadable — skip */ }
  }
  // GitLab CI / CircleCI / Travis / Jenkins
  for (const f of ['.gitlab-ci.yml', '.circleci/config.yml', '.travis.yml', 'Jenkinsfile', 'azure-pipelines.yml']) {
    if (existsSync(join(rootPath, f))) out.push(f);
  }
  return out;
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
    // TODO(v0.12): `pkg` is typed as `any` — add runtime shape validation (e.g., check
    // that pkg.dependencies and pkg.devDependencies are objects or undefined before spread).
    // Risk is low (try/catch handles parse errors; spread of undefined is safe), but
    // a non-object `dependencies` value (e.g. a string) would silently produce NaN keys.
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
    // TODO(v0.12): when detectPackageManager returns 'unknown', these produce the literal
    // string "unknown run build" / "unknown run lint". Guard with a check like
    // `const pm = detectPackageManager(root); if (pm !== 'unknown') { ... }` before assigning.
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

/**
 * Get the right agents for a language + domain role.
 * v0.4+ delegates to the VoltAgent registry so the names returned actually
 * resolve to real .md files engram installs into <project>/.claude/agents/.
 */
function getAgentsForLanguage(lang: string, role: 'core' | 'security' | 'qa'): string[] {
  return agentsForRole(role, lang);
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
