import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanProject } from '../src/engine/scanner.js';

const TEST_DIR = join(tmpdir(), 'knit-test-scanner');

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

describe('scanProject', () => {
  it('detects TypeScript + Next.js project', () => {
    writeFileSync(
      join(TEST_DIR, 'package.json'),
      JSON.stringify({
        name: 'test-nextjs',
        dependencies: { next: '16.0.0', react: '19.0.0' },
        devDependencies: { typescript: '5.7.0', vitest: '3.0.0' },
        scripts: { build: 'next build', lint: 'eslint .', typecheck: 'tsc --noEmit' },
      })
    );
    writeFileSync(join(TEST_DIR, 'tsconfig.json'), '{}');
    mkdirSync(join(TEST_DIR, 'app', 'api'), { recursive: true });
    mkdirSync(join(TEST_DIR, 'components'), { recursive: true });
    mkdirSync(join(TEST_DIR, 'lib'), { recursive: true });
    mkdirSync(join(TEST_DIR, 'tests'), { recursive: true });

    const scan = scanProject(TEST_DIR);

    expect(scan.stack.language).toBe('typescript');
    expect(scan.stack.framework).toBe('nextjs');
    expect(scan.stack.testFramework).toBe('vitest');
    expect(scan.packageManager).toBe('npm');
    expect(scan.domains.length).toBeGreaterThanOrEqual(3);
    expect(scan.domains.some((d) => d.name === 'UI')).toBe(true);
    expect(scan.domains.some((d) => d.name === 'API & Security')).toBe(true);
  });

  it('detects Python + FastAPI project', () => {
    writeFileSync(
      join(TEST_DIR, 'pyproject.toml'),
      '[project]\nname = "test"\ndependencies = ["fastapi", "pytest"]'
    );

    const scan = scanProject(TEST_DIR);

    expect(scan.stack.language).toBe('python');
    expect(scan.stack.framework).toBe('fastapi');
    expect(scan.stack.testFramework).toBe('pytest');
  });

  it('detects Go project', () => {
    writeFileSync(join(TEST_DIR, 'go.mod'), 'module example.com/test\ngo 1.22');

    const scan = scanProject(TEST_DIR);

    expect(scan.stack.language).toBe('go');
    expect(scan.stack.testFramework).toBe('go test');
    expect(scan.stack.buildCommand).toBe('go build ./...');
  });

  it('detects Rust project', () => {
    writeFileSync(join(TEST_DIR, 'Cargo.toml'), '[package]\nname = "test"');

    const scan = scanProject(TEST_DIR);

    expect(scan.stack.language).toBe('rust');
    expect(scan.stack.buildCommand).toBe('cargo build');
  });

  it('detects pnpm package manager', () => {
    writeFileSync(join(TEST_DIR, 'package.json'), '{"name":"test"}');
    writeFileSync(join(TEST_DIR, 'pnpm-lock.yaml'), '');

    const scan = scanProject(TEST_DIR);
    expect(scan.packageManager).toBe('pnpm');
  });

  it('detects yarn package manager', () => {
    writeFileSync(join(TEST_DIR, 'package.json'), '{"name":"test"}');
    writeFileSync(join(TEST_DIR, 'yarn.lock'), '');

    const scan = scanProject(TEST_DIR);
    expect(scan.packageManager).toBe('yarn');
  });

  it('detects bun package manager', () => {
    writeFileSync(join(TEST_DIR, 'package.json'), '{"name":"test"}');
    writeFileSync(join(TEST_DIR, 'bun.lockb'), '');

    const scan = scanProject(TEST_DIR);
    expect(scan.packageManager).toBe('bun');
  });

  it('returns unknown for empty directory', () => {
    const scan = scanProject(TEST_DIR);

    expect(scan.stack.language).toBe('unknown');
    expect(scan.packageManager).toBe('unknown');
  });

  it('detects existing .claude setup', () => {
    mkdirSync(join(TEST_DIR, '.claude'), { recursive: true });
    writeFileSync(join(TEST_DIR, 'CLAUDE.md'), '# test');

    const scan = scanProject(TEST_DIR);

    expect(scan.hasExistingSetup).toBe(true);
    expect(scan.hasExistingClaudeMd).toBe(true);
  });
});
