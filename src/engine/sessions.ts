import { existsSync, mkdirSync, appendFileSync, readFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { sessionsJsonlPath, projectDataDir } from './paths.js';
import type { SessionSummary } from './types.js';

/**
 * Append a session entry to ~/.engram/projects/<hash>/sessions.jsonl.
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
