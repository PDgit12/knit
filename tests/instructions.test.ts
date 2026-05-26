import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  KNIT_INSTRUCTIONS,
  buildInstructions,
  buildBudgetVerdict,
  CLAUDE_MD_BUDGET_BYTES,
} from '../src/mcp/instructions.js';

describe('KNIT_INSTRUCTIONS', () => {
  it('is a non-empty string', () => {
    expect(typeof KNIT_INSTRUCTIONS).toBe('string');
    expect(KNIT_INSTRUCTIONS.length).toBeGreaterThan(100);
  });

  it('stays under the v0.11.1 token budget (~1000 tokens, conservatively bytes)', () => {
    // v0.9 widened 2500 → 3000 for the citation rule. v0.11.1 widens
    // 3000 → 4000 to surface the new v0.11 tools (verify_claim, calibration,
    // requirements ingestion, fingerprint, infer_domains, compose_template).
    // The "discoverability vs budget" trade-off: hidden tools cost more than
    // a few hundred extra bytes in the system prompt, because agents won't
    // call what they don't know exists. Capped at 4KB to keep the floor.
    expect(KNIT_INSTRUCTIONS.length).toBeLessThan(4000);
  });

  it('tells the agent to call knit_load_session at session start', () => {
    expect(KNIT_INSTRUCTIONS).toMatch(/knit_load_session/);
    // Position matters — should be a first-step directive, not buried at the bottom.
    const idx = KNIT_INSTRUCTIONS.indexOf('knit_load_session');
    expect(idx).toBeLessThan(KNIT_INSTRUCTIONS.length / 2);
  });

  it('mentions all four tiers including inquiry', () => {
    expect(KNIT_INSTRUCTIONS).toMatch(/inquiry/i);
    expect(KNIT_INSTRUCTIONS).toMatch(/trivial/i);
    expect(KNIT_INSTRUCTIONS).toMatch(/standard/i);
    expect(KNIT_INSTRUCTIONS).toMatch(/complex/i);
  });

  it('tells the agent to enter plan mode on complex auto-plan tasks', () => {
    expect(KNIT_INSTRUCTIONS).toMatch(/EnterPlanMode/);
    expect(KNIT_INSTRUCTIONS).toMatch(/auto_plan_mode/);
  });

  it('references the on-demand workflow fetch instead of inlining phases', () => {
    expect(KNIT_INSTRUCTIONS).toMatch(/knit_get_workflow/);
  });

  it('mentions knit_record_learning for the LEARN step', () => {
    expect(KNIT_INSTRUCTIONS).toMatch(/knit_record_learning/);
  });
});

// v0.12 — handshake-time budget verdict.
//
// The verdict surfaces in the MCP server `instructions` field — the agent
// reads it BEFORE any tool description, so over-budget projects can't sail
// through unnoticed. Tests pin: returns nothing when healthy (no noise),
// surfaces verdict + actionable fix command when warn/over-budget.

describe('buildBudgetVerdict', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'knit-instr-test-'));
  });

  afterEach(() => {
    try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* best */ }
  });

  it('returns empty string when CLAUDE.md is missing (no false alarm)', () => {
    expect(buildBudgetVerdict(tmpRoot)).toBe('');
  });

  it('returns empty string when CLAUDE.md is under the 6.5KB target', () => {
    writeFileSync(join(tmpRoot, 'CLAUDE.md'), 'A'.repeat(CLAUDE_MD_BUDGET_BYTES - 100), 'utf-8');
    expect(buildBudgetVerdict(tmpRoot)).toBe('');
  });

  it('returns warn verdict when CLAUDE.md is just over target but within 25% slack', () => {
    writeFileSync(join(tmpRoot, 'CLAUDE.md'), 'A'.repeat(CLAUDE_MD_BUDGET_BYTES + 500), 'utf-8');
    const v = buildBudgetVerdict(tmpRoot);
    expect(v).toMatch(/^BUDGET warn:/);
    expect(v).toContain('engram doctor');
    expect(v).toContain('engram refresh');
  });

  it('returns over-budget verdict when CLAUDE.md exceeds 25% slack', () => {
    writeFileSync(join(tmpRoot, 'CLAUDE.md'), 'A'.repeat(CLAUDE_MD_BUDGET_BYTES * 2), 'utf-8');
    const v = buildBudgetVerdict(tmpRoot);
    expect(v).toMatch(/^BUDGET over-budget:/);
    expect(v).toContain('CLAUDE.md');
  });
});

describe('buildInstructions — budget verdict surfacing', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'knit-bi-test-'));
  });

  afterEach(() => {
    try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* best */ }
  });

  it('omits the budget block when CLAUDE.md is healthy', () => {
    writeFileSync(join(tmpRoot, 'CLAUDE.md'), 'A'.repeat(2000), 'utf-8');
    const out = buildInstructions(null, tmpRoot);
    expect(out).not.toMatch(/Budget check/);
    expect(out).not.toMatch(/BUDGET (warn|over-budget)/);
  });

  it('appends the budget block when CLAUDE.md is over budget — no scan', () => {
    writeFileSync(join(tmpRoot, 'CLAUDE.md'), 'A'.repeat(20000), 'utf-8');
    const out = buildInstructions(null, tmpRoot);
    expect(out).toMatch(/— Budget check —/);
    expect(out).toMatch(/BUDGET over-budget:/);
  });

  it('appends the budget block AFTER per-project integrations when both apply', () => {
    writeFileSync(join(tmpRoot, 'CLAUDE.md'), 'A'.repeat(20000), 'utf-8');
    const scan = {
      detected: {
        ruflo: { present: true } as { present: boolean },
        gstack: { present: false } as { present: boolean },
        codetour: { present: false } as { present: boolean },
        conductor: { present: false } as { present: boolean },
        custom_workflow_sections: [] as string[],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const out = buildInstructions(scan, tmpRoot);
    const integrationIdx = out.indexOf('Per-project integrations');
    const budgetIdx = out.indexOf('Budget check');
    expect(integrationIdx).toBeGreaterThan(0);
    expect(budgetIdx).toBeGreaterThan(integrationIdx);
  });

  it('back-compat: buildInstructions(null) with no rootPath returns clean baseline', () => {
    expect(buildInstructions(null)).toBe(KNIT_INSTRUCTIONS);
  });
});
