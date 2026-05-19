/**
 * Graph-traversal retriever — the second ranker the RRF infrastructure was
 * plumbed for in v0.8.0. Surfaces learnings that mention files in the
 * import-graph neighborhood of the agent's current work, even when their
 * summary/lesson text doesn't lexically match the query.
 *
 * Example: agent is editing `src/api/auth.ts`. BM25 over the query "validate
 * tokens" finds entries whose lesson mentions "validate tokens" directly.
 * The graph retriever ALSO surfaces a learning whose lesson is "When
 * src/middleware/session.ts changes, re-run integration tests" — because
 * session.ts imports auth.ts. Pure lexical search would miss that.
 *
 * The retriever returns a ranked list of learning IDs, ranked by how many
 * graph-neighbor files their text mentions. RRF (k=60) fuses with BM25 in
 * the handler.
 */

import type { KBEntry } from '../types.js';

export interface GraphNeighborhood {
  /** Anchor files the agent passed as `affected_files` to the search call. */
  anchors: Set<string>;
  /** 1-hop neighbors: files that import or are imported by any anchor. */
  neighbors: Set<string>;
}

/** Compute the 1-hop import-graph neighborhood of a set of anchor files.
 *  Walks both directions: who imports the anchor (reverseDeps) and what the
 *  anchor imports (forwardDeps). Anchors themselves are kept in a separate
 *  set so callers can weight direct matches higher than 1-hop matches if
 *  needed. */
export function computeNeighborhood(
  anchorFiles: string[],
  forwardDeps: Record<string, string[]>,
  reverseDeps: Record<string, string[]>,
): GraphNeighborhood {
  const anchors = new Set(anchorFiles.filter(Boolean));
  const neighbors = new Set<string>();
  for (const anchor of anchors) {
    for (const dep of forwardDeps[anchor] ?? []) {
      if (!anchors.has(dep)) neighbors.add(dep);
    }
    for (const importer of reverseDeps[anchor] ?? []) {
      if (!anchors.has(importer)) neighbors.add(importer);
    }
  }
  return { anchors, neighbors };
}

export interface GraphRetrievalResult {
  id: string;
  /** Score: 2 per anchor mention + 1 per neighbor mention. Anchors get more
   *  weight because they're literally what the agent's editing. */
  score: number;
  /** Which files in the neighborhood were mentioned in this entry's text.
   *  Diagnostic; agents occasionally explain results via this. */
  matched: string[];
}

/** Rank learnings by graph-neighborhood file mention. Returns entries that
 *  mention at least one anchor or neighbor file in their summary/lesson/
 *  approach text. Empty list when neighborhood is empty (e.g. no anchor
 *  files passed, or the import graph has no edges through them). */
export function rankLearningsByGraph(
  entries: KBEntry[],
  neighborhood: GraphNeighborhood,
): GraphRetrievalResult[] {
  if (neighborhood.anchors.size === 0 && neighborhood.neighbors.size === 0) {
    return [];
  }

  const results: GraphRetrievalResult[] = [];
  for (const entry of entries) {
    const haystack = [entry.summary, entry.lesson, entry.approach ?? '']
      .filter(Boolean)
      .join(' ');

    const matched: string[] = [];
    let score = 0;
    for (const file of neighborhood.anchors) {
      if (haystack.includes(file)) {
        matched.push(file);
        score += 2;
      }
    }
    for (const file of neighborhood.neighbors) {
      if (haystack.includes(file)) {
        matched.push(file);
        score += 1;
      }
    }
    if (score > 0) {
      results.push({ id: entry.id, score, matched });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}
