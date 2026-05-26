import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v0.12 — Token-economy bench shape tests.
 *
 * The bench itself runs `npm run bench:tokens` and emits both a human-readable
 * report and a baseline JSON. These tests pin the baseline contract so a
 * future refactor of the bench doesn't silently change the schema, and so
 * the committed baseline always reflects healthy MCP-on values.
 */

const BASELINE_PATH = join(process.cwd(), 'benchmarks', 'token-economy.baseline.json');

describe('token-economy baseline', () => {
  it('baseline file exists in the repo (committed for CI tracking)', () => {
    expect(existsSync(BASELINE_PATH)).toBe(true);
  });

  it('baseline schema includes all required top-level keys', () => {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'));
    expect(baseline).toHaveProperty('version');
    expect(baseline).toHaveProperty('generated_at');
    expect(baseline).toHaveProperty('mcp_on');
    expect(baseline).toHaveProperty('mcp_off');
    expect(baseline).toHaveProperty('per_recall');
    expect(baseline).toHaveProperty('per_classify');
    expect(baseline).toHaveProperty('session_delta_bytes');
  });

  it('baseline mcp_on has the 3 measured surfaces', () => {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'));
    expect(baseline.mcp_on).toHaveProperty('instructions');
    expect(baseline.mcp_on).toHaveProperty('claudeMd');
    expect(baseline.mcp_on).toHaveProperty('toolsList');
    expect(baseline.mcp_on).toHaveProperty('total');
    expect(typeof baseline.mcp_on.instructions).toBe('number');
    expect(typeof baseline.mcp_on.toolsList).toBe('number');
  });

  it('baseline MCP-on surfaces are within hard caps (regression gate)', () => {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'));
    // Instructions field ≤ 4KB (cap matches TOKEN_BUDGETS.instructions_bytes).
    expect(baseline.mcp_on.instructions).toBeLessThanOrEqual(4096);
    // Tools list ≤ 18KB (signals tier-1 hasn't bloated; full 51-tool exposure
    // would land around 14KB so 18KB gives growth room).
    expect(baseline.mcp_on.toolsList).toBeLessThanOrEqual(18432);
    // CLAUDE.md ≤ 8.1KB (6.5KB target + 25% slack — hard cap before doctor errors).
    expect(baseline.mcp_on.claudeMd).toBeLessThanOrEqual(6500 * 1.25);
  });

  it('per-recall savings vs flat-dump baseline is substantial (>= 80%)', () => {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'));
    expect(baseline.per_recall.savings_pct).toBeGreaterThanOrEqual(80);
  });

  it('per-classify savings vs inline-rule baseline is real (>= 30%)', () => {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'));
    expect(baseline.per_classify.savings_pct).toBeGreaterThanOrEqual(30);
  });
});
