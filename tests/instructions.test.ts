import { describe, it, expect } from 'vitest';
import { KNIT_INSTRUCTIONS } from '../src/mcp/instructions.js';

describe('KNIT_INSTRUCTIONS', () => {
  it('is a non-empty string', () => {
    expect(typeof KNIT_INSTRUCTIONS).toBe('string');
    expect(KNIT_INSTRUCTIONS.length).toBeGreaterThan(100);
  });

  it('stays under the v0.7 token budget (~500 tokens, conservatively bytes)', () => {
    // Rough heuristic: ≤2500 bytes ≈ ≤500 tokens at the GPT-ish 1:5 ratio.
    // Exceeding this means we're losing the token-discipline justification.
    expect(KNIT_INSTRUCTIONS.length).toBeLessThan(2500);
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
