import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { observeAndNudge, resetAdherenceState } from '../src/mcp/adherence.js';
import { writeProtocolConfig } from '../src/engine/protocol-guard.js';

let knitHome: string;
const ROOT = '/tmp/adherence-test-project';

beforeEach(() => {
  knitHome = mkdtempSync(join(tmpdir(), 'knit-adherence-'));
  process.env.KNIT_HOME = knitHome;
  resetAdherenceState();
});

afterEach(() => {
  delete process.env.KNIT_HOME;
  try { rmSync(knitHome, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('protocol adherence re-surfacing', () => {
  it('stays silent when classify precedes writes (the correct flow)', () => {
    expect(observeAndNudge('knit_classify_task', ROOT)).toBeNull();
    expect(observeAndNudge('knit_record_learning', ROOT)).toBeNull();
    expect(observeAndNudge('knit_save_handoff', ROOT)).toBeNull();
  });

  it('nudges on drift — a write tool before any classify this session', () => {
    const msg = observeAndNudge('knit_record_learning', ROOT);
    expect(msg).toBeTruthy();
    expect(msg).toMatch(/knit_classify_task/);
  });

  it('throttles consecutive drift writes (no every-call bleed)', () => {
    expect(observeAndNudge('knit_record_learning', ROOT)).toBeTruthy(); // first fires
    expect(observeAndNudge('knit_save_handoff', ROOT)).toBeNull();      // throttled
    expect(observeAndNudge('knit_record_false_positive', ROOT)).toBeNull();
  });

  it('escalates the message on repeated drift across the session', () => {
    expect(observeAndNudge('knit_record_learning', ROOT)).toMatch(/protocol:/i);
    for (let i = 0; i < 12; i++) observeAndNudge('knit_get_suggestions', ROOT); // clear throttle
    const msg = observeAndNudge('knit_record_learning', ROOT);
    expect(msg).toMatch(/drift \(×2\)/);
  });

  it('classify clears drift and silences further write nudges', () => {
    observeAndNudge('knit_record_learning', ROOT); // drift
    observeAndNudge('knit_classify_task', ROOT);   // corrected
    expect(observeAndNudge('knit_record_learning', ROOT)).toBeNull();
    expect(observeAndNudge('knit_save_handoff', ROOT)).toBeNull();
  });

  it('off strictness silences all nudges', () => {
    writeProtocolConfig(ROOT, 'off');
    expect(observeAndNudge('knit_record_learning', ROOT)).toBeNull();
  });

  it('periodic check-in fires in a long session', () => {
    let last: string | null = null;
    for (let i = 0; i < 30; i++) last = observeAndNudge('knit_get_suggestions', ROOT);
    expect(last).toMatch(/check-in \(call 30\)/);
  });

  // v0.22 — under-utilization (full tool-use) nudge.
  it('nudges a classified agent that collapsed onto ≤2 tools with no graph/verify tool', () => {
    observeAndNudge('knit_classify_task', ROOT); // classified → eligible for under-util
    let fired: string | null = null;
    // Only ever record_learning + save_handoff (2 work tools, no insight tool).
    for (let i = 0; i < 14 && !fired; i++) {
      const m = observeAndNudge(i % 2 ? 'knit_save_handoff' : 'knit_record_learning', ROOT);
      if (m && /full-tool-use/i.test(m)) fired = m;
    }
    expect(fired).toMatch(/full-tool-use/i);
    expect(fired).toMatch(/knit_query_imports|knit_verify_claim/);
  });

  it('does NOT fire the under-util nudge once a graph/verify tool has been used', () => {
    observeAndNudge('knit_classify_task', ROOT);
    observeAndNudge('knit_query_imports', ROOT); // an insight tool → not collapsed
    let msg: string | null = null;
    for (let i = 0; i < 14; i++) msg = observeAndNudge('knit_record_learning', ROOT);
    expect(msg ?? '').not.toMatch(/full-tool-use/i);
  });

  it('does NOT fire under-util before classify (drift takes priority)', () => {
    let sawUnderUtil = false;
    for (let i = 0; i < 14; i++) {
      const m = observeAndNudge('knit_get_suggestions', ROOT);
      if (m && /full-tool-use/i.test(m)) sawUnderUtil = true;
    }
    expect(sawUnderUtil).toBe(false);
  });
});
