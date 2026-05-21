/**
 * Barrel + retrieval-layer helpers for building BM25 indices from
 * Knit's domain types (KBEntry, SessionSummary, GlobalLearning).
 *
 * Each builder turns Knit's persisted entries into BM25Document shape
 * — the doc.id maps back to the entry, doc.text concatenates the
 * searchable fields (summary + lesson, etc.), and doc.metadata carries
 * the full entry so callers can use the result without re-querying.
 */

import { BM25Index, type BM25Document } from './bm25.js';
import type { KBEntry, GlobalLearning, SessionSummary } from '../types.js';

export { BM25Index, defaultTokenize } from './bm25.js';
export type { BM25Document, BM25SearchResult, BM25Options } from './bm25.js';
export { rrfFuse, toRankedResults } from './rrf.js';
export type { RankedResult, FusedResult, RRFOptions } from './rrf.js';
export { computeNeighborhood, rankLearningsByGraph } from './graph-traversal.js';
export type { GraphNeighborhood, GraphRetrievalResult } from './graph-traversal.js';

/** Build a BM25 index over knowledgebase entries. The id is the entry's
 *  stable id; the text concatenates summary + lesson + tags (so a tag
 *  query like "auth" also finds entries tagged #auth). */
export function buildLearningsIndex(entries: KBEntry[]): BM25Index {
  const docs: BM25Document[] = entries.map((e) => ({
    id: e.id,
    text: [e.summary, e.lesson, e.approach ?? '', (e.tags ?? []).join(' '), (e.domains ?? []).join(' ')]
      .filter(Boolean)
      .join(' '),
    metadata: { entry: e },
  }));
  return new BM25Index(docs);
}

/** Build a BM25 index over cross-project learnings. Same shape as
 *  buildLearningsIndex but indexes GlobalLearning records from the
 *  ~/.knit/global/ pool. */
export function buildGlobalLearningsIndex(entries: GlobalLearning[]): BM25Index {
  const docs: BM25Document[] = entries.map((e) => ({
    id: e.id,
    text: [e.summary, e.lesson, (e.tags ?? []).join(' '), e.projectName ?? '']
      .filter(Boolean)
      .join(' '),
    metadata: { entry: e },
  }));
  return new BM25Index(docs);
}

/** Build a BM25 index over session summaries. Includes branch name + commits
 *  + tags + summary text so a query like "auth migration" finds sessions
 *  whose branch was `feature/auth-migration` even if the summary was sparse. */
export function buildSessionsIndex(sessions: SessionSummary[]): BM25Index {
  const docs: BM25Document[] = sessions.map((s) => ({
    id: s.id,
    text: [
      s.summary ?? '',
      (s.tags ?? []).join(' '),
      s.branch ?? '',
      s.commits ?? '',
      (s.domainsTouched ?? []).join(' '),
    ].filter(Boolean).join(' '),
    metadata: { session: s },
  }));
  return new BM25Index(docs);
}

/** Generic diversified-retrieval: cap the number of results sharing the
 *  same bucket key. The key extractor turns each result into a string
 *  bucket; null/empty buckets get their own '(empty)' lane. Used by the
 *  branch- and project-specific helpers below so one verbose source can't
 *  flood the top-K. From the v0.7 plan's step 9.5. */
export function diversifyBy<T>(
  results: T[],
  keyFn: (r: T) => string | null | undefined,
  maxPerKey = 2,
): T[] {
  const counts = new Map<string, number>();
  const out: T[] = [];
  for (const r of results) {
    const key = keyFn(r) ?? '(empty)';
    const c = counts.get(key) ?? 0;
    if (c >= maxPerKey) continue;
    counts.set(key, c + 1);
    out.push(r);
  }
  return out;
}

/** Session-diversified retrieval: cap results sharing the same git branch. */
export function diversifyByBranch<T extends { document: { metadata?: Record<string, unknown> } }>(
  results: T[],
  maxPerBranch = 2,
): T[] {
  return diversifyBy(
    results,
    (r) => (r.document.metadata as { session?: SessionSummary } | undefined)?.session?.branch ?? '(no-branch)',
    maxPerBranch,
  );
}

/** Global-learning diversified retrieval: cap results sharing the same
 *  source project. Prevents one chatty project's pool from drowning out
 *  lessons from quieter projects in cross-project searches. */
export function diversifyByProject<T extends { document: { metadata?: Record<string, unknown> } }>(
  results: T[],
  maxPerProject = 2,
): T[] {
  return diversifyBy(
    results,
    (r) => (r.document.metadata as { entry?: GlobalLearning } | undefined)?.entry?.projectName ?? '(no-project)',
    maxPerProject,
  );
}
