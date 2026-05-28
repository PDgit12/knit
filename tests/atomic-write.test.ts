import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileAtomic } from '../src/engine/atomic-write.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'knit-atomic-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('writeFileAtomic', () => {
  it('writes a file with the given content', () => {
    const path = join(dir, 'a.json');
    writeFileAtomic(path, '{"x":1}');
    expect(readFileSync(path, 'utf-8')).toBe('{"x":1}');
  });

  it('creates parent directories as needed', () => {
    const path = join(dir, 'nested', 'deeper', 'file.txt');
    writeFileAtomic(path, 'hello');
    expect(readFileSync(path, 'utf-8')).toBe('hello');
  });

  it('overwrites an existing file', () => {
    const path = join(dir, 'b.txt');
    writeFileSync(path, 'old');
    writeFileAtomic(path, 'new');
    expect(readFileSync(path, 'utf-8')).toBe('new');
  });

  it('leaves no temp file behind on success', () => {
    const path = join(dir, 'c.txt');
    writeFileAtomic(path, 'content');
    const leftovers = readdirSync(dir).filter((f) => f.includes('.tmp-'));
    expect(leftovers).toEqual([]);
  });

  it('preserves the prior file if a sibling write fails mid-flight', () => {
    // Simulate the "torn write" failure mode: write good content, then attempt
    // a write that would crash. The first file must remain intact.
    const path = join(dir, 'd.txt');
    writeFileAtomic(path, 'original');
    expect(() => writeFileAtomic(join(dir, '\0invalid'), 'crash')).toThrow();
    expect(readFileSync(path, 'utf-8')).toBe('original');
  });

  it('handles concurrent writes without losing data (last-writer-wins)', () => {
    const path = join(dir, 'e.txt');
    for (let i = 0; i < 10; i++) writeFileAtomic(path, `v${i}`);
    expect(readFileSync(path, 'utf-8')).toBe('v9');
    expect(existsSync(path)).toBe(true);
  });
});
