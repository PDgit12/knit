/**
 * v0.11 slice 4 — per-project classifier calibration.
 *
 * The self-healing classifier loop:
 *   1. User flags a wrong classification via knit_record_false_positive with
 *      a #classifier tag describing the direction (e.g., #complex-was-trivial).
 *   2. We bump the direction counter in calibration.json.
 *   3. After 3+ same-direction FPs, we shift scopeAdjust/riskAdjust by 1.
 *   4. Future inferRiskTier / inferScopeTier reads the calibration and
 *      shifts its thresholds accordingly.
 *
 * Per-project, NOT cross-project — different projects have different
 * domain conventions (a fintech codebase wants stricter "auth" gates than
 * a CMS), so calibration leakage would create noise.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { calibrationPath } from './paths.js';
import type { Calibration } from './types.js';

/** Fresh default — returned by VALUE each call, not by shared reference.
 *  Returning `{ ...SHARED }` is a SHALLOW copy and would alias
 *  `fpDirections` across all callers; the first caller's mutation would
 *  show up in every subsequent caller's "fresh" defaults. */
function freshDefault(): Calibration {
  return {
    fpDirections: {},
    scopeAdjust: 0,
    riskAdjust: 0,
    updatedAt: new Date(0).toISOString(),
  };
}

/** How many same-direction FPs trigger a threshold shift. */
const ADJUSTMENT_THRESHOLD = 3;

/** Read calibration from disk; returns a fresh default if file is missing
 *  or malformed (never throws). */
export function loadCalibration(rootPath: string): Calibration {
  const path = calibrationPath(rootPath);
  if (!existsSync(path)) return freshDefault();
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<Calibration>;
    return {
      fpDirections: parsed.fpDirections && typeof parsed.fpDirections === 'object' ? { ...parsed.fpDirections } : {},
      scopeAdjust: typeof parsed.scopeAdjust === 'number' ? parsed.scopeAdjust : 0,
      riskAdjust: typeof parsed.riskAdjust === 'number' ? parsed.riskAdjust : 0,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString(),
    };
  } catch {
    return freshDefault();
  }
}

/** Atomically write calibration via temp + renameSync. Same pattern as
 *  saveKnowledgeBase / saveEnabledFeatures for crash-safety. */
export function saveCalibration(rootPath: string, calibration: Calibration): void {
  const path = calibrationPath(rootPath);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(calibration, null, 2), 'utf-8');
  renameSync(tmp, path);
}

/** Parse a direction from FP tags. Returns null if no recognizable
 *  classifier-direction tag is present. Accepts both long form
 *  ("#high-risk-was-low-risk") and short ("#high-risk-was-low"); normalizes
 *  to long form so all counter keys are consistent. */
export function parseDirection(tags: string[]): string | null {
  const tierSlot = '(?:complex|standard|trivial|(?:low|medium|high)(?:-risk)?)';
  const re = new RegExp(`^#?(${tierSlot}-was-${tierSlot})$`, 'i');
  for (const t of tags) {
    const m = re.exec(t);
    if (m) {
      return m[1]
        .toLowerCase()
        .replace(/(^|-was-)(low|medium|high)(?=$|-was-)/g, (_, sep, risk) => `${sep}${risk}-risk`);
    }
  }
  return null;
}

/** Record a classifier-direction FP. Bumps the counter, and if the count
 *  hits ADJUSTMENT_THRESHOLD, shifts scopeAdjust/riskAdjust by 1 in the
 *  direction implied by the FP. Returns the new calibration. */
export function recordClassifierFP(rootPath: string, direction: string): Calibration {
  const cal = loadCalibration(rootPath);
  const before = cal.fpDirections[direction] ?? 0;
  cal.fpDirections[direction] = before + 1;
  // Threshold-reached: shift the adjustment by 1 in the direction implied,
  // then RESET the counter so the next 3 FPs are needed before another shift.
  if (cal.fpDirections[direction] >= ADJUSTMENT_THRESHOLD) {
    applyAdjustment(cal, direction);
    cal.fpDirections[direction] = 0;
  }
  cal.updatedAt = new Date().toISOString();
  saveCalibration(rootPath, cal);
  return cal;
}

/** Shift scopeAdjust / riskAdjust based on the direction of accumulated FPs.
 *  Matches the LONG-FORM directions that parseDirection normalizes to —
 *  "high-risk-was-low-risk" rather than the shorthand "high-risk-was-low".
 *  Pre-v0.11.1 bug: this matched only the shorthand, so every risk-direction
 *  FP coming through parseDirection silently dropped the calibration shift.
 *
 *  Scope directions:
 *  - "complex-was-trivial" / "complex-was-standard" → scope over-sensitive
 *    → scopeAdjust + 1 (require more files before classifying complex).
 *  - "trivial-was-complex" / "standard-was-complex" → scope under-sensitive
 *    → scopeAdjust - 1.
 *  Risk directions:
 *  - "high-risk-was-low-risk" / "high-risk-was-medium-risk" → risk
 *    over-sensitive → riskAdjust + 1.
 *  - "low-risk-was-high-risk" / "medium-risk-was-high-risk" → risk
 *    under-sensitive → riskAdjust - 1.
 *  Other directions don't shift today; they're just counted. */
function applyAdjustment(cal: Calibration, direction: string): void {
  if (direction === 'complex-was-trivial' || direction === 'complex-was-standard') {
    cal.scopeAdjust += 1;
  } else if (direction === 'trivial-was-complex' || direction === 'standard-was-complex') {
    cal.scopeAdjust -= 1;
  } else if (direction === 'high-risk-was-low-risk' || direction === 'high-risk-was-medium-risk') {
    cal.riskAdjust += 1;
  } else if (direction === 'low-risk-was-high-risk' || direction === 'medium-risk-was-high-risk') {
    cal.riskAdjust -= 1;
  }
}

/** Reset calibration to default. Used by knit_reset_calibration (admin). */
export function resetCalibration(rootPath: string): Calibration {
  const fresh = freshDefault();
  fresh.updatedAt = new Date().toISOString();
  saveCalibration(rootPath, fresh);
  return fresh;
}
