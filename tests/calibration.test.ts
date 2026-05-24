import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  loadCalibration,
  saveCalibration,
  parseDirection,
  recordClassifierFP,
  resetCalibration,
} from '../src/engine/calibration.js';
import { calibrationPath, projectDataDir } from '../src/engine/paths.js';

/**
 * v0.11 slice 4 — per-project classifier calibration.
 *
 * The self-healing loop: knit_record_false_positive with a direction tag
 * bumps a per-direction counter; after 3+ same-direction FPs, scopeAdjust
 * or riskAdjust shifts by 1; future inferScopeTier / inferRiskTier read
 * the calibration and shift their thresholds accordingly.
 */

let knitHome: string;
let projectRoot: string;

beforeEach(() => {
  knitHome = mkdtempSync(join(tmpdir(), 'knit-calibration-test-'));
  process.env.KNIT_HOME = knitHome;
  projectRoot = mkdtempSync(join(tmpdir(), 'knit-calibration-project-'));
  mkdirSync(projectDataDir(projectRoot), { recursive: true });
});

afterEach(() => {
  delete process.env.KNIT_HOME;
  try { rmSync(knitHome, { recursive: true, force: true }); } catch { /* best-effort */ }
  try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('loadCalibration', () => {
  it('returns default zeros when no calibration file exists', () => {
    const cal = loadCalibration(projectRoot);
    expect(cal.fpDirections).toEqual({});
    expect(cal.scopeAdjust).toBe(0);
    expect(cal.riskAdjust).toBe(0);
  });

  it('returns defaults when calibration file is malformed', () => {
    saveCalibration(projectRoot, { fpDirections: {}, scopeAdjust: 0, riskAdjust: 0, updatedAt: '' });
    // Corrupt the file
    const fs = require('node:fs');
    fs.writeFileSync(calibrationPath(projectRoot), 'not valid json', 'utf-8');
    const cal = loadCalibration(projectRoot);
    expect(cal.scopeAdjust).toBe(0);
    expect(cal.riskAdjust).toBe(0);
  });

  it('round-trips through saveCalibration', () => {
    saveCalibration(projectRoot, {
      fpDirections: { 'complex-was-trivial': 2 },
      scopeAdjust: 1,
      riskAdjust: -1,
      updatedAt: '2026-05-22T00:00:00Z',
    });
    const cal = loadCalibration(projectRoot);
    expect(cal.fpDirections['complex-was-trivial']).toBe(2);
    expect(cal.scopeAdjust).toBe(1);
    expect(cal.riskAdjust).toBe(-1);
  });
});

describe('parseDirection', () => {
  it('extracts complex-was-trivial from hashtag', () => {
    expect(parseDirection(['#complex-was-trivial'])).toBe('complex-was-trivial');
  });

  it('extracts trivial-was-complex with or without hashtag', () => {
    expect(parseDirection(['#trivial-was-complex'])).toBe('trivial-was-complex');
    expect(parseDirection(['trivial-was-complex'])).toBe('trivial-was-complex');
  });

  it('returns null when no direction tag is present', () => {
    expect(parseDirection(['#auth', '#api'])).toBeNull();
    expect(parseDirection([])).toBeNull();
  });

  it('matches case-insensitively (normalizes risk shorthand to long form)', () => {
    expect(parseDirection(['#HIGH-RISK-was-LOW'])).toBe('high-risk-was-low-risk');
  });

  it('recognizes risk directions (short form normalizes to long form)', () => {
    expect(parseDirection(['#high-risk-was-low'])).toBe('high-risk-was-low-risk');
    expect(parseDirection(['#low-risk-was-high'])).toBe('low-risk-was-high-risk');
  });
});

describe('recordClassifierFP', () => {
  it('bumps a fresh counter to 1', () => {
    const cal = recordClassifierFP(projectRoot, 'complex-was-trivial');
    expect(cal.fpDirections['complex-was-trivial']).toBe(1);
    expect(cal.scopeAdjust).toBe(0);
  });

  it('does not shift scope until 3 same-direction FPs accumulate', () => {
    recordClassifierFP(projectRoot, 'complex-was-trivial');
    recordClassifierFP(projectRoot, 'complex-was-trivial');
    const cal = loadCalibration(projectRoot);
    expect(cal.fpDirections['complex-was-trivial']).toBe(2);
    expect(cal.scopeAdjust).toBe(0);
  });

  it('shifts scopeAdjust +1 on 3rd complex-was-trivial FP and resets the counter', () => {
    recordClassifierFP(projectRoot, 'complex-was-trivial');
    recordClassifierFP(projectRoot, 'complex-was-trivial');
    const after3 = recordClassifierFP(projectRoot, 'complex-was-trivial');
    expect(after3.scopeAdjust).toBe(1);
    expect(after3.fpDirections['complex-was-trivial']).toBe(0);
  });

  it('shifts scopeAdjust -1 on 3rd trivial-was-complex FP (opposite direction)', () => {
    recordClassifierFP(projectRoot, 'trivial-was-complex');
    recordClassifierFP(projectRoot, 'trivial-was-complex');
    const after3 = recordClassifierFP(projectRoot, 'trivial-was-complex');
    expect(after3.scopeAdjust).toBe(-1);
  });

  it('shifts riskAdjust +1 on 3rd high-risk-was-low FP', () => {
    recordClassifierFP(projectRoot, 'high-risk-was-low');
    recordClassifierFP(projectRoot, 'high-risk-was-low');
    const after3 = recordClassifierFP(projectRoot, 'high-risk-was-low');
    expect(after3.riskAdjust).toBe(1);
  });

  it('persists calibration across loads', () => {
    recordClassifierFP(projectRoot, 'complex-was-trivial');
    recordClassifierFP(projectRoot, 'high-risk-was-low');
    const reloaded = loadCalibration(projectRoot);
    expect(reloaded.fpDirections['complex-was-trivial']).toBe(1);
    expect(reloaded.fpDirections['high-risk-was-low']).toBe(1);
  });

  it('accumulates 6 same-direction FPs → scopeAdjust = +2 (two threshold crossings)', () => {
    for (let i = 0; i < 6; i++) {
      recordClassifierFP(projectRoot, 'complex-was-trivial');
    }
    const cal = loadCalibration(projectRoot);
    expect(cal.scopeAdjust).toBe(2);
  });
});

describe('resetCalibration', () => {
  it('wipes all state back to defaults', () => {
    for (let i = 0; i < 3; i++) recordClassifierFP(projectRoot, 'complex-was-trivial');
    expect(loadCalibration(projectRoot).scopeAdjust).toBe(1);
    const reset = resetCalibration(projectRoot);
    expect(reset.scopeAdjust).toBe(0);
    expect(reset.riskAdjust).toBe(0);
    expect(reset.fpDirections).toEqual({});
  });

  it('writes a fresh updatedAt', () => {
    const reset = resetCalibration(projectRoot);
    expect(new Date(reset.updatedAt).getTime()).toBeGreaterThan(0);
  });
});

describe('integration with handleRecordFalsePositive', () => {
  it('FP with classifier-direction tag bumps calibration; response surfaces the update', async () => {
    const { handleToolCall } = await import('../src/mcp/tools.js');
    const brain = buildMinimalBrain();
    // 3rd FP should trigger a shift.
    for (let i = 0; i < 2; i++) {
      handleToolCall('knit_record_false_positive', {
        summary: 'flagged complex but was trivial',
        reason: 'single-file rename',
        tags: '#complex-was-trivial',
      }, brain);
    }
    const res = JSON.parse(handleToolCall('knit_record_false_positive', {
      summary: 'flagged complex but was trivial',
      reason: 'single-file rename',
      tags: '#complex-was-trivial',
    }, brain));
    expect(res.calibration_update).toBeDefined();
    expect(res.calibration_update.scope_adjust).toBe(1);
  });

  it('FP without a direction tag does NOT touch calibration', async () => {
    const { handleToolCall } = await import('../src/mcp/tools.js');
    const brain = buildMinimalBrain();
    const res = JSON.parse(handleToolCall('knit_record_false_positive', {
      summary: 'flagged a non-issue',
      reason: 'API is intentional',
      tags: '#api',
    }, brain));
    expect(res.calibration_update).toBeUndefined();
  });

  it('knit_get_calibration returns current state', async () => {
    const { handleToolCall } = await import('../src/mcp/tools.js');
    const brain = buildMinimalBrain();
    handleToolCall('knit_record_false_positive', {
      summary: 'x', reason: 'y', tags: '#complex-was-trivial',
    }, brain);
    const cal = JSON.parse(handleToolCall('knit_get_calibration', {}, brain));
    expect(cal.fp_directions['complex-was-trivial']).toBe(1);
    expect(cal.scope_adjust).toBe(0);
    expect(cal.pending_fp_count).toBe(1);
  });

  it('knit_reset_calibration wipes state', async () => {
    const { handleToolCall } = await import('../src/mcp/tools.js');
    const brain = buildMinimalBrain();
    for (let i = 0; i < 3; i++) {
      handleToolCall('knit_record_false_positive', {
        summary: 'x', reason: 'y', tags: '#complex-was-trivial',
      }, brain);
    }
    expect(JSON.parse(handleToolCall('knit_get_calibration', {}, brain)).scope_adjust).toBe(1);
    handleToolCall('knit_reset_calibration', {}, brain);
    expect(JSON.parse(handleToolCall('knit_get_calibration', {}, brain)).scope_adjust).toBe(0);
  });

  function buildMinimalBrain() {
    return {
      rootPath: projectRoot,
      knowledge: {
        generatedAt: new Date().toISOString(),
        summary: { totalFiles: 0, totalLines: 0, languageBreakdown: {}, entryPoints: [], highFanoutFiles: [], untestedFiles: [], largestFiles: [] },
        files: [], importGraph: {}, exports: {}, testMap: { tested: {}, untested: [], testFiles: [] },
      },
      reverseDeps: {},
      knowledgeBase: { version: 1, projectName: 'test', entries: [], metrics: { totalSessions: 0, totalLearnings: 0, cacheHits: 0, domainDistribution: {}, sessions: [] } },
      config: { name: 'test', packageManager: 'npm', stack: { language: 'typescript', dependencies: [], buildCommand: '', lintCommand: '', typecheckCommand: '' }, domains: [], targetAgent: 'claude-code', tokenOptimization: 'standard' },
      loadedAt: Date.now(),
      autoInitialized: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }
});

describe('classifier reads calibration', () => {
  it('inferScopeTier honors scopeAdjust=+1 (requires more files before complex)', async () => {
    const { handleToolCall } = await import('../src/mcp/tools.js');
    const brain = buildMinimalBrainShared();
    // Bump calibration to scopeAdjust=+1 (3 same-direction FPs)
    for (let i = 0; i < 3; i++) {
      handleToolCall('knit_record_false_positive', {
        summary: 'too sensitive', reason: 'r', tags: '#complex-was-trivial',
      }, brain);
    }
    // With default thresholds, 4 files = complex. With scopeAdjust=+1,
    // threshold rises to >4 files → standard for exactly 4 files.
    const result = JSON.parse(handleToolCall('knit_classify_task', {
      files_to_touch: 'a.txt,b.txt,c.txt,d.txt',
      description: 'add helpers',
    }, brain));
    expect(result.scope_tier).toBe('standard');
  });

  function buildMinimalBrainShared() {
    const fs = require('node:fs');
    fs.mkdirSync(projectDataDir(projectRoot), { recursive: true });
    return {
      rootPath: projectRoot,
      knowledge: {
        generatedAt: new Date().toISOString(),
        summary: { totalFiles: 0, totalLines: 0, languageBreakdown: {}, entryPoints: [], highFanoutFiles: [], untestedFiles: [], largestFiles: [] },
        files: [], importGraph: {}, exports: {}, testMap: { tested: {}, untested: [], testFiles: [] },
      },
      reverseDeps: {},
      knowledgeBase: { version: 1, projectName: 'test', entries: [], metrics: { totalSessions: 0, totalLearnings: 0, cacheHits: 0, domainDistribution: {}, sessions: [] } },
      config: { name: 'test', packageManager: 'npm', stack: { language: 'typescript', dependencies: [], buildCommand: '', lintCommand: '', typecheckCommand: '' }, domains: [], targetAgent: 'claude-code', tokenOptimization: 'standard' },
      loadedAt: Date.now(),
      autoInitialized: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }
});

// Avoid unused import warning
void existsSync;
