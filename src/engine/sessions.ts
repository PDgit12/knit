import { existsSync, mkdirSync, appendFileSync, readFileSync, statSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { sessionsJsonlPath, projectDataDir } from './paths.js';
import type { SessionSummary } from './types.js';

/**
 * Append a session entry to ~/.knit/projects/<hash>/sessions.jsonl.
 * One JSON object per line. Append-only — no rewrites, no race conditions
 * across concurrent writers.
 */
export function appendSession(rootPath: string, entry: SessionSummary): void {
  const path = sessionsJsonlPath(rootPath);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(entry) + '\n', 'utf-8');
}

/**
 * Search sessions by free-text query over summary + tags + branch.
 * Returns last `limit` matches, most recent first.
 *
 * No indexing. Simple substring match. Stays fast for thousands of entries
 * because we scan in reverse and stop at `limit`. Beyond ~10k sessions per
 * project we'd want a real index — revisit then.
 */
export function searchSessions(
  rootPath: string,
  query: string,
  limit = 10,
): SessionSummary[] {
  const lines = readAllLines(rootPath);
  if (lines.length === 0) return [];

  const q = query.toLowerCase();
  const matches: SessionSummary[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const entry = parseLine(lines[i]);
    if (!entry) continue;
    const haystack = [
      entry.summary ?? '',
      (entry.tags ?? []).join(' '),
      entry.branch ?? '',
    ].join(' ').toLowerCase();
    if (haystack.includes(q)) {
      matches.push(entry);
      if (matches.length >= limit) break;
    }
  }
  return matches;
}

/** Return the last N session entries, most recent first. */
export function getRecentSessions(rootPath: string, n = 3): SessionSummary[] {
  const lines = readAllLines(rootPath);
  if (lines.length === 0) return [];
  const start = Math.max(0, lines.length - n);
  const recent: SessionSummary[] = [];
  for (let i = lines.length - 1; i >= start; i--) {
    const entry = parseLine(lines[i]);
    if (entry) recent.push(entry);
  }
  return recent;
}

/** Total count of session entries on disk (cheap — single stat). */
export function sessionCount(rootPath: string): number {
  return readAllLines(rootPath).length;
}

/**
 * Prune session entries older than `maxAgeDays` from sessions.jsonl.
 *
 * Treats each entry's `date` field (ISO YYYY-MM-DD) as midnight UTC, compares
 * against `now - maxAgeDays * 86400000` ms. Entries with missing or
 * unparseable dates are conservatively KEPT — we never discard data we can't
 * confidently classify as stale.
 *
 * Rewrites the file atomically via temp + renameSync to avoid leaving a
 * half-written log if the process is killed mid-write.
 */
export function pruneSessionsByAge(
  rootPath: string,
  maxAgeDays: number,
): { kept: number; pruned: number } {
  const path = sessionsJsonlPath(rootPath);
  if (!existsSync(path)) return { kept: 0, pruned: 0 };

  const lines = readAllLines(rootPath);
  if (lines.length === 0) return { kept: 0, pruned: 0 };

  const cutoffMs = Date.now() - maxAgeDays * 86400000;

  const keptLines: string[] = [];
  let pruned = 0;

  for (const line of lines) {
    const entry = parseLine(line);
    if (!entry) {
      // Unparseable: keep (don't silently lose data we can't classify).
      keptLines.push(line);
      continue;
    }
    const dateMs = parseDateUtc(entry.date);
    if (dateMs === null) {
      // Corrupted/missing date: keep.
      keptLines.push(line);
      continue;
    }
    if (dateMs >= cutoffMs) {
      keptLines.push(line);
    } else {
      pruned++;
    }
  }

  if (pruned === 0) {
    return { kept: keptLines.length, pruned: 0 };
  }

  // Atomic rewrite: temp file + rename. Same pattern as the worktree registry.
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  const body = keptLines.length === 0 ? '' : keptLines.join('\n') + '\n';
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(tmpPath, body, 'utf-8');
  renameSync(tmpPath, path);

  return { kept: keptLines.length, pruned };
}

// ── internals ────────────────────────────────────────────────────

function readAllLines(rootPath: string): string[] {
  const path = sessionsJsonlPath(rootPath);
  if (!existsSync(path)) return [];
  try {
    const stat = statSync(path);
    if (stat.size === 0) return [];
    // Guard: anything beyond ~100 MB suggests a malformed log; bail.
    if (stat.size > 100 * 1024 * 1024) return [];
    return readFileSync(path, 'utf-8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/** Parse YYYY-MM-DD as midnight UTC. Returns null for malformed input. */
function parseDateUtc(date: string): number | null {
  if (typeof date !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const ms = Date.UTC(y, mo - 1, d);
  return Number.isFinite(ms) ? ms : null;
}

function parseLine(line: string): SessionSummary | null {
  try {
    const obj = JSON.parse(line);
    if (typeof obj !== 'object' || obj === null) return null;
    if (typeof obj.id !== 'string' || typeof obj.date !== 'string') return null;
    if (!obj.outcome) obj.outcome = 'unknown';
    return obj as SessionSummary;
  } catch {
    return null;
  }
}

// Re-export for handlers that need the project data dir for status output.
export { projectDataDir };
