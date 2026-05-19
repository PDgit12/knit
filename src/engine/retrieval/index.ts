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

/** Session-diversified retrieval: cap the number of results per session
 *  branch in the final ranking. Prevents one verbose feature branch from
 *  flooding the results when many of its sessions match a query. From
 *  the v0.7 plan's step 9.5 — the trivial-to-add diversification once
 *  BM25 landed.
 *
 *  Returns the input list, in original rank order, but with no more than
 *  `maxPerBranch` results sharing the same branch. A null branch is
 *  treated as its own bucket. */
export function diversifyByBranch<T extends { document: { metadata?: Record<string, unknown> } }>(
  results: T[],
  maxPerBranch = 2,
): T[] {
  const counts = new Map<string, number>();
  const out: T[] = [];
  for (const r of results) {
    const session = (r.document.metadata as { session?: SessionSummary } | undefined)?.session;
    const branch = session?.branch ?? '(no-branch)';
    const c = counts.get(branch) ?? 0;
    if (c >= maxPerBranch) continue;
    counts.set(branch, c + 1);
    out.push(r);
  }
  return out;
}
