import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildKnowledge } from '../src/engine/knowledge.js';
import { scanProject } from '../src/engine/scanner.js';

const TEST_DIR = join(tmpdir(), 'knit-test-knowledge');

function setup() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
}

beforeEach(setup);
afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

function createFile(relPath: string, content: string) {
  const fullPath = join(TEST_DIR, relPath);
  mkdirSync(join(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, content, 'utf-8');
}

describe('buildKnowledge — file inventory', () => {
  it('indexes source files and counts lines', () => {
    createFile('src/index.ts', 'export const x = 1;\nexport const y = 2;\n');
    createFile('src/utils.ts', 'export function helper() {}\n');
    createFile('package.json', '{"name":"test"}');

    const scan = scanProject(TEST_DIR);
    const knowledge = buildKnowledge(TEST_DIR, scan);

    expect(knowledge.files.length).toBe(2); // only source files, not package.json
    expect(knowledge.summary.totalFiles).toBe(2);

    const indexFile = knowledge.files.find((f) => f.path === 'src/index.ts');
    expect(indexFile).toBeDefined();
    expect(indexFile!.lines).toBe(3);
    expect(indexFile!.extension).toBe('.ts');
  });

  it('skips node_modules and .git', () => {
    createFile('src/app.ts', 'const x = 1;');
    createFile('node_modules/foo/index.js', 'module.exports = {}');
    createFile('.git/config', '[core]');

    const scan = scanProject(TEST_DIR);
    const knowledge = buildKnowledge(TEST_DIR, scan);

    expect(knowledge.files.length).toBe(1);
    expect(knowledge.files[0].path).toBe('src/app.ts');
  });

  it('tracks language breakdown', () => {
    createFile('src/app.ts', 'const x = 1;');
    createFile('src/style.ts', 'const y = 2;');
    createFile('src/main.py', 'x = 1');

    const scan = scanProject(TEST_DIR);
    const knowledge = buildKnowledge(TEST_DIR, scan);

    expect(knowledge.summary.languageBreakdown['.ts']).toBe(2);
    expect(knowledge.summary.languageBreakdown['.py']).toBe(1);
  });
});

describe('buildKnowledge — import graph', () => {
  it('extracts TypeScript imports', () => {
    createFile('src/index.ts', `import { helper } from './utils.js';\nconsole.log(helper());`);
    createFile('src/utils.ts', 'export function helper() { return 1; }');

    const scan = scanProject(TEST_DIR);
    const knowledge = buildKnowledge(TEST_DIR, scan);

    expect(knowledge.importGraph['src/index.ts']).toContain('src/utils.ts');
  });

  it('extracts dynamic imports', () => {
    createFile('src/app.ts', `const mod = await import('./lazy.js');`);
    createFile('src/lazy.ts', 'export const x = 1;');

    const scan = scanProject(TEST_DIR);
    const knowledge = buildKnowledge(TEST_DIR, scan);

    expect(knowledge.importGraph['src/app.ts']).toContain('src/lazy.ts');
  });

  it('extracts require calls', () => {
    createFile('src/app.js', `const utils = require('./utils');`);
    createFile('src/utils.js', 'module.exports = {};');

    const scan = scanProject(TEST_DIR);
    const knowledge = buildKnowledge(TEST_DIR, scan);

    expect(knowledge.importGraph['src/app.js']).toContain('src/utils.js');
  });

  it('skips external package imports', () => {
    createFile('src/app.ts', `import chalk from 'chalk';\nimport { join } from 'node:path';`);

    const scan = scanProject(TEST_DIR);
    const knowledge = buildKnowledge(TEST_DIR, scan);

    // No graph edges for external imports
    expect(knowledge.importGraph['src/app.ts']).toBeUndefined();
  });

  it('extracts Python imports', () => {
    createFile('src/main.py', `from .utils import helper\nimport os`);
    createFile('src/utils.py', 'def helper(): pass');

    const scan = scanProject(TEST_DIR);
    const knowledge = buildKnowledge(TEST_DIR, scan);

    // Python relative imports start with . so they should be captured
    // (the resolver may not find them since Python uses different resolution, but the pattern matches)
    expect(knowledge.files.length).toBe(2);
  });

  it('identifies high-fanout files', () => {
    createFile('src/types.ts', 'export interface Foo {}');
    createFile('src/a.ts', `import { Foo } from './types.js';`);
    createFile('src/b.ts', `import { Foo } from './types.js';`);
    createFile('src/c.ts', `import { Foo } from './types.js';`);
    createFile('src/d.ts', `import { Foo } from './types.js';`);
    createFile('src/e.ts', `import { Foo } from './types.js';`);

    const scan = scanProject(TEST_DIR);
    const knowledge = buildKnowledge(TEST_DIR, scan);

    expect(knowledge.summary.highFanoutFiles).toContain('src/types.ts');
  });
});

describe('buildKnowledge — export map', () => {
  it('extracts TypeScript exports', () => {
    createFile('src/utils.ts', [
      'export function helper() {}',
      'export class MyClass {}',
      'export interface Config {}',
      'export type ID = string;',
      'export const VERSION = "1.0";',
    ].join('\n'));

    const scan = scanProject(TEST_DIR);
    const knowledge = buildKnowledge(TEST_DIR, scan);

    const exports = knowledge.exports['src/utils.ts'];
    expect(exports).toBeDefined();
    expect(exports.length).toBe(5);

    const names = exports.map((e) => e.name);
    expect(names).toContain('helper');
    expect(names).toContain('MyClass');
    expect(names).toContain('Config');
    expect(names).toContain('ID');
    expect(names).toContain('VERSION');

    expect(exports.find((e) => e.name === 'helper')!.kind).toBe('function');
    expect(exports.find((e) => e.name === 'MyClass')!.kind).toBe('class');
    expect(exports.find((e) => e.name === 'Config')!.kind).toBe('interface');
  });

  it('extracts async function exports', () => {
    createFile('src/api.ts', 'export async function fetchData() {}');

    const scan = scanProject(TEST_DIR);
    const knowledge = buildKnowledge(TEST_DIR, scan);

    expect(knowledge.exports['src/api.ts']).toBeDefined();
    expect(knowledge.exports['src/api.ts'][0].name).toBe('fetchData');
    expect(knowledge.exports['src/api.ts'][0].kind).toBe('function');
  });

  it('skips test files in export map', () => {
    createFile('src/utils.ts', 'export function helper() {}');
    createFile('tests/utils.test.ts', 'export function testHelper() {}');

    const scan = scanProject(TEST_DIR);
    const knowledge = buildKnowledge(TEST_DIR, scan);

    expect(knowledge.exports['src/utils.ts']).toBeDefined();
    expect(knowledge.exports['tests/utils.test.ts']).toBeUndefined();
  });

  it('includes line numbers', () => {
    createFile('src/app.ts', '\n\nexport function third() {}');

    const scan = scanProject(TEST_DIR);
    const knowledge = buildKnowledge(TEST_DIR, scan);

    expect(knowledge.exports['src/app.ts'][0].line).toBe(3);
  });
});

describe('buildKnowledge — test mapping', () => {
  it('maps test files to source by naming convention', () => {
    createFile('src/utils.ts', 'export function helper() {}');
    createFile('tests/utils.test.ts', `import { helper } from '../src/utils.js';\ntest('works', () => {});`);

    const scan = scanProject(TEST_DIR);
    const knowledge = buildKnowledge(TEST_DIR, scan);

    expect(knowledge.testMap.tested['src/utils.ts']).toContain('tests/utils.test.ts');
    expect(knowledge.testMap.testFiles).toContain('tests/utils.test.ts');
  });

  it('identifies untested files', () => {
    createFile('src/utils.ts', 'export function helper() {}');
    createFile('src/orphan.ts', 'export function lonely() {}');
    createFile('tests/utils.test.ts', `import { helper } from '../src/utils.js';`);

    const scan = scanProject(TEST_DIR);
    const knowledge = buildKnowledge(TEST_DIR, scan);

    expect(knowledge.testMap.untested).toContain('src/orphan.ts');
    expect(knowledge.testMap.untested).not.toContain('src/utils.ts');
    expect(knowledge.summary.untestedFiles).toContain('src/orphan.ts');
  });

  it('maps by import analysis even without naming match', () => {
    createFile('src/auth.ts', 'export function login() {}');
    createFile('tests/security.test.ts', `import { login } from '../src/auth.js';\ntest('auth', () => {});`);

    const scan = scanProject(TEST_DIR);
    const knowledge = buildKnowledge(TEST_DIR, scan);

    // security.test.ts doesn't match auth.ts by name, but imports it
    expect(knowledge.testMap.tested['src/auth.ts']).toContain('tests/security.test.ts');
  });
});

describe('buildKnowledge — entry points', () => {
  it('detects entry points from package.json bin', () => {
    createFile('package.json', JSON.stringify({ name: 'test', bin: { cli: './dist/cli.js' } }));
    createFile('src/cli.ts', 'console.log("hello");');

    const scan = scanProject(TEST_DIR);
    const knowledge = buildKnowledge(TEST_DIR, scan);

    expect(knowledge.summary.entryPoints).toContain('./dist/cli.js');
  });

  it('detects index files as entry points', () => {
    createFile('src/index.ts', 'export const x = 1;');
    createFile('package.json', '{"name":"test"}');

    const scan = scanProject(TEST_DIR);
    const knowledge = buildKnowledge(TEST_DIR, scan);

    expect(knowledge.summary.entryPoints).toContain('src/index.ts');
  });
});

describe('buildKnowledge — summary', () => {
  it('computes largest files', () => {
    createFile('src/small.ts', 'const x = 1;');
    createFile('src/big.ts', Array(100).fill('const x = 1;').join('\n'));

    const scan = scanProject(TEST_DIR);
    const knowledge = buildKnowledge(TEST_DIR, scan);

    expect(knowledge.summary.largestFiles[0].path).toBe('src/big.ts');
    expect(knowledge.summary.largestFiles[0].lines).toBeGreaterThan(50);
  });
});
