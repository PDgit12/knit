import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOOL_REGISTRY } from '../src/mcp/features.js';

/**
 * v0.17 — permanent guard against tool-count doc drift.
 *
 * The README's authoritative tool-count line is DERIVED from TOOL_REGISTRY,
 * not hand-typed. If the registry grows/shrinks, this test fails until the
 * README's authoritative line is updated to match — killing the class of bug
 * where docs claimed "49 active / 6 tier-gated" (mathematically impossible)
 * while the code said something else.
 *
 * Scope: README only. CHANGELOG legitimately records historical per-version
 * counts (53 tools at v0.12, 52 at v0.11, …) that must NOT be "corrected".
 */
const README = readFileSync(join(process.cwd(), 'README.md'), 'utf-8');

describe('tool-count drift guard', () => {
  const total = TOOL_REGISTRY.length;
  const alwaysOn = TOOL_REGISTRY.filter((t) => t.tier === 1).length;
  const conditional = TOOL_REGISTRY.filter((t) => t.tier !== 1).length;

  it('registry is the single source of truth (bump README authoritative line if these change)', () => {
    expect(total).toBe(55);
    expect(alwaysOn).toBe(36);
    expect(conditional).toBe(19);
    expect(alwaysOn + conditional).toBe(total);
  });

  it('README states the authoritative tiered counts derived from the registry', () => {
    expect(README).toContain(`${alwaysOn} always-on`);
    expect(README).toContain(`${conditional} conditional`);
    expect(README).toContain(`${total} total`);
  });

  it('README does not contain the v0.16 drift ("49 active" / "6 tier-gated")', () => {
    expect(README).not.toMatch(/49 active/i);
    expect(README).not.toMatch(/\b6 tier-gated/i);
  });

  it('the "55 MCP Tools" hero header matches the registry total', () => {
    expect(README).toContain(`## 🛠️ ${total} MCP Tools`);
  });
});
