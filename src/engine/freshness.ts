/**
 * v0.17 — the brain's freshness layer.
 *
 * A single shared primitive every store uses to answer one question:
 * "is this datum still trustworthy?" Before v0.17 staleness was handled
 * ad-hoc per store (sessions pruned at 90d on first-touch, learnings pruned
 * manually, handoffs/global-learnings/calibration/requirements never at all).
 * The result: a v0.14 handoff could still report unfinished work three
 * releases later. This module unifies the contract.
 *
 * Design rule (load-bearing): freshness drives PRUNE / CLEAR / FLAG decisions
 * only. It MUST NOT alter live BM25 ranking — that surface is bench-gated
 * (top-1 ≥ 85%) and silent score decay would regress retrieval invisibly.
 * Stale entries are removed (prune), superseded (clear), or annotated (flag)
 * — never quietly down-ranked inside the scorer.
 *
 * All helpers are pure and side-effect-free. Unparseable / missing timestamps
 * are treated as NOT stale (conservative keep) — we never discard data we
 * cannot confidently classify, matching the prior pruneSessionsByAge contract.
 */

import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

const MS_PER_DAY = 86_400_000;

/**
 * Per-store TTL / decay windows, centralized so freshness policy lives in one
 * place instead of scattered magic numbers. Tuned conservatively — the goal is
 * to clear genuinely-abandoned data, not to churn active projects.
 */
export const FRESHNESS = {
  /** A handoff older than this is considered abandoned, not in-flight. */
  HANDOFF_TTL_DAYS: 14,
  /** Global cross-project learnings older than this drop out of search. */
  GLOBAL_LEARNING_TTL_DAYS: 365,
  /** Classifier FP counters idle longer than this decay (stale tuning signal). */
  CALIBRATION_DECAY_DAYS: 120,
  /** Project session entries older than this are pruned. */
  SESSION_TTL_DAYS: 90,
  /** Project learnings older than this are pruned (FPs + accessed entries kept). */
  LEARNING_TTL_DAYS: 180,
  /** Re-run throttle: at most one age-prune sweep per project per this window. */
  PRUNE_THROTTLE_DAYS: 1,
} as const;

/**
 * Age of an ISO timestamp in days, or null if missing/unparseable.
 * Accepts full ISO ("2026-05-29T08:32:17Z") and date-only ("2026-05-29").
 */
export function ageDays(iso: string | undefined | null, nowMs: number = Date.now()): number | null {
  if (typeof iso !== 'string' || iso.length === 0) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return (nowMs - t) / MS_PER_DAY;
}

/**
 * True iff the timestamp is older than `maxAgeDays`. Missing/unparseable
 * timestamps return false (conservative keep) — callers that want the opposite
 * (treat unknown as stale) should check `ageDays(...) === null` explicitly.
 */
export function isStale(
  iso: string | undefined | null,
  maxAgeDays: number,
  nowMs: number = Date.now(),
): boolean {
  const age = ageDays(iso, nowMs);
  if (age === null) return false;
  return age > maxAgeDays;
}

/**
 * Resolve a stored ref to an absolute path: relative refs against the project
 * root, absolute refs as-is. Returns null for empty/garbage input.
 */
export function resolveRef(rootPath: string, ref: string): string | null {
  if (typeof ref !== 'string' || ref.trim().length === 0) return null;
  const r = ref.trim();
  return isAbsolute(r) ? r : resolve(rootPath, r);
}

/**
 * Does a path referenced by a stored datum still exist on disk?
 * Relative paths resolve against the project root; absolute paths are checked
 * as-is. Empty/garbage refs return false. Used to flag learnings/requirements
 * that point at code which has since been deleted or moved.
 */
export function sourceExists(rootPath: string, ref: string): boolean {
  const abs = resolveRef(rootPath, ref);
  return abs !== null && existsSync(abs);
}

/**
 * Extract file-path-like tokens from free-text (a learning summary/lesson).
 * Matches dotted source paths with a known-ish extension and at least one path
 * separator or a leading dir, e.g. "src/mcp/handlers.ts", "webapp/index.html".
 * Intentionally conservative: returns only tokens that look like real repo
 * paths so we don't flag prose that merely mentions a bare filename.
 */
export function extractFileRefs(text: string): string[] {
  if (typeof text !== 'string' || text.length === 0) return [];
  // path segment(s) + filename.ext — requires at least one "/" to avoid
  // matching ordinary words, and a 1–5 char alpha-numeric extension.
  const re = /\b([\w.-]+\/[\w./-]+\.[a-z0-9]{1,5})\b/gi;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.add(m[1]);
  }
  return [...out];
}
