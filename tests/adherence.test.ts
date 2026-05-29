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
});
