import { describe, it, expect } from 'vitest';
import { projectId } from '../src/engine/project-id.js';

describe('projectId', () => {
  it('returns a 16-char hex string', () => {
    const id = projectId('/Users/test/some-project');
    expect(id).toMatch(/^[a-f0-9]{16}$/);
  });

  it('is stable — same path always returns the same id', () => {
    const a = projectId('/Users/test/some-project');
    const b = projectId('/Users/test/some-project');
    expect(a).toBe(b);
  });

  it('normalizes paths — trailing slash does not change the id', () => {
    expect(projectId('/Users/test/some-project'))
      .toBe(projectId('/Users/test/some-project/'));
  });

  it('normalizes paths — redundant segments do not change the id', () => {
    expect(projectId('/Users/test/some-project'))
      .toBe(projectId('/Users/test/./some-project'));
    expect(projectId('/Users/test/some-project'))
      .toBe(projectId('/Users/test/other/../some-project'));
  });

  it('different absolute paths produce different ids', () => {
    expect(projectId('/Users/test/project-a'))
      .not.toBe(projectId('/Users/test/project-b'));
  });

  it('handles paths with spaces and unusual chars', () => {
    const id = projectId('/Users/test/some project (v2)');
    expect(id).toMatch(/^[a-f0-9]{16}$/);
  });
});
