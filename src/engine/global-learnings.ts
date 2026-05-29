import { existsSync, mkdirSync, appendFileSync, readFileSync, statSync } from 'node:fs';
import { dirname, basename } from 'node:path';
import { globalLearningsPath, globalDataDir } from './paths.js';
import { projectId, canonicalRepoRoot } from './project-id.js';
import { isStale, FRESHNESS } from './freshness.js';
import type { GlobalLearning } from './types.js';

/**
 * Cross-project learnings pool, stored at ~/.knit/global/learnings.jsonl.
 *
 * Opt-in by design: per-project learnings remain the primary surface. The
 * agent (or user) chooses when to escalate an insight to the global pool —
 * specifically when it generalizes beyond the project it was discovered in.
 *
 * Format: append-only JSONL, one GlobalLearning per line. Tagged with the
 * source project's hash + name so we can filter or attribute later.
 *
 * Search is reverse-scan, substring match over summary + lesson + tags +
 * project name. Same shape as session search — fast for thousands of entries,
 * no indexing needed at v0.3 scale.
 */

/** Append a global learning. Caller has already passed the agent's quality gate. */
export function appendGlobalLearning(entry: GlobalLearning): void {
  const path = globalLearningsPath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify(entry) + '\n', 'utf-8');
  } catch (err) {
    process.stderr.write(
      `[knit] global learning append failed at ${path}: ${(err as Error).message}\n`,
    );
    throw err;
  }
}

/** Search global learnings by free text, most recent first. */
export function searchGlobalLearnings(query: string, limit = 10): GlobalLearning[] {
  const lines = readAllLines();
  if (lines.length === 0) return [];

  const q = query.toLowerCase();
  const matches: GlobalLearning[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const entry = parseLine(lines[i]);
    if (!entry) continue;
    // v0.17 freshness layer — don't serve cross-project learnings past TTL.
    // Undated entries are kept (conservative). This filters reads only; the
    // pool stays append-only on disk, so nothing is lost — just not surfaced.
    if (isStale(entry.date, FRESHNESS.GLOBAL_LEARNING_TTL_DAYS)) continue;
    const haystack = [
      entry.summary,
      entry.lesson,
      entry.tags.join(' '),
      entry.projectName,
    ].join(' ').toLowerCase();
    if (haystack.includes(q)) {
      matches.push(entry);
      if (matches.length >= limit) break;
    }
  }
  return matches;
}

/** Return the N most recent global learnings, most recent first. */
export function getRecentGlobalLearnings(n = 5): GlobalLearning[] {
  const lines = readAllLines();
  if (lines.length === 0) return [];
  // Scan from the newest end, skipping TTL-stale entries, until we have n.
  const out: GlobalLearning[] = [];
  for (let i = lines.length - 1; i >= 0 && out.length < n; i--) {
    const entry = parseLine(lines[i]);
    if (!entry) continue;
    if (isStale(entry.date, FRESHNESS.GLOBAL_LEARNING_TTL_DAYS)) continue;
    out.push(entry);
  }
  return out;
}

/** Total count of global learnings. */
export function globalLearningCount(): number {
  return readAllLines().length;
}

/** Return ALL global learnings. Used by the BM25 retrieval layer to build
 *  an index over the full pool. For pools larger than a few thousand entries
 *  this should grow into a streaming/iterator API; we're below that threshold. */
export function loadAllGlobalLearnings(): GlobalLearning[] {
  const lines = readAllLines();
  const out: GlobalLearning[] = [];
  for (const line of lines) {
    const entry = parseLine(line);
    if (entry) out.push(entry);
  }
  return out;
}

/** Build a GlobalLearning record from an agent-supplied payload + the source project root. */
export function buildGlobalLearning(
  sourceProjectRoot: string,
  payload: { summary: string; lesson: string; tags: string[]; outcome?: GlobalLearning['outcome']; id?: string },
): GlobalLearning {
  return {
    id: payload.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    date: new Date().toISOString().split('T')[0],
    projectId: projectId(sourceProjectRoot),
    projectName: basename(canonicalRepoRoot(sourceProjectRoot)),
    summary: payload.summary,
    lesson: payload.lesson,
    tags: payload.tags,
    outcome: payload.outcome,
  };
}

// ── internals ────────────────────────────────────────────────────

function readAllLines(): string[] {
  const path = globalLearningsPath();
  if (!existsSync(path)) return [];
  try {
    const stat = statSync(path);
    if (stat.size === 0) return [];
    if (stat.size > 100 * 1024 * 1024) return [];
    return readFileSync(path, 'utf-8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function parseLine(line: string): GlobalLearning | null {
  try {
    const obj = JSON.parse(line);
    if (typeof obj !== 'object' || obj === null) return null;
    if (typeof obj.id !== 'string' || typeof obj.summary !== 'string'
        || typeof obj.lesson !== 'string' || !Array.isArray(obj.tags)) return null;
    return obj as GlobalLearning;
  } catch {
    return null;
  }
}

// Re-exported for status output convenience.
export { globalDataDir };
