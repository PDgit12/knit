import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VERSION } from '../src/version.js';

const PACKAGE_VERSION = (
  JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')) as { version: string }
).version;

describe('VERSION single source of truth', () => {
  it('exports the version declared in package.json', () => {
    expect(VERSION).toBe(PACKAGE_VERSION);
  });

  it('matches semver shape', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+(?:[-+].+)?$/);
  });
});
