/**
 * Reciprocal Rank Fusion — combines rankings from independent retrievers
 * (BM25 lexical, import-graph traversal, future vector layers, etc.) into a
 * single fused ranking without requiring any of them to produce comparable
 * scores. Same algorithm used by Lucene's hybrid search, Elasticsearch's
 * RRF, and the IR literature since Cormack et al. 2009.
 *
 *     score(d) = Σ_r∈R  1 / (k + rank_r(d))
 *
 * where rank_r(d) is the 1-indexed position of document d in ranker r's
 * output, and k smooths the contribution. k=60 is the paper's default —
 * higher k flattens the contribution curve so deep-ranked results still
 * matter; lower k makes top-1 dominate. Documents not appearing in a
 * given ranker contribute 0 from that ranker (NOT a penalty).
 *
 * Properties this gives us "for free":
 *   - No score calibration needed across retrievers (BM25 scores aren't
 *     comparable to graph-hop scores; RRF doesn't care).
 *   - A document ranked top-1 by one retriever and bottom by another
 *     still beats a document ranked mid-pack by both — which is the
 *     intent of fusion.
 *   - Stable: same inputs → same output, every time.
 */

export interface RankedResult {
  /** Caller's stable identifier; passed through unchanged. */
  id: string;
  /** 1-indexed position in this retriever's ranking. */
  rank: number;
}

export interface FusedResult {
  id: string;
  /** Sum of RRF contributions across all input rankers. */
  score: number;
  /** Per-retriever rank breakdown (rankerIndex → rank). Diagnostic; agents
   *  occasionally use it to explain "this surfaced because X said top-2,
   *  Y said top-5". */
  ranks: Record<number, number>;
}

export interface RRFOptions {
  /** Smoothing constant — Cormack et al. recommend 60. Lower = top results
   *  dominate; higher = deep-rank contributions matter more. */
  k?: number;
  /** Cap on output size. Defaults to no cap. */
  limit?: number;
}

/** Fuse N ranking lists into a single ranking via Reciprocal Rank Fusion.
 *  Each input list is a retriever's output in descending relevance order.
 *  The `id` of each entry is the unifier — matching ids across rankers
 *  accumulate their contributions. */
export function rrfFuse(
  rankings: RankedResult[][],
  options: RRFOptions = {},
): FusedResult[] {
  const k = options.k ?? 60;

  const acc = new Map<string, { score: number; ranks: Record<number, number> }>();

  for (let rankerIdx = 0; rankerIdx < rankings.length; rankerIdx++) {
    const ranking = rankings[rankerIdx];
    for (const result of ranking) {
      const contribution = 1 / (k + result.rank);
      const entry = acc.get(result.id) ?? { score: 0, ranks: {} };
      entry.score += contribution;
      entry.ranks[rankerIdx] = result.rank;
      acc.set(result.id, entry);
    }
  }

  const fused: FusedResult[] = [];
  for (const [id, { score, ranks }] of acc) {
    fused.push({ id, score, ranks });
  }
  fused.sort((a, b) => b.score - a.score);

  return options.limit !== undefined ? fused.slice(0, options.limit) : fused;
}

/** Convenience: convert a BM25-style scored list to RRF-input format
 *  (just the id + rank position). Caller's scores are discarded — RRF
 *  uses rank, not score. */
export function toRankedResults<T extends { id: string }>(scored: T[]): RankedResult[] {
  return scored.map((s, i) => ({ id: s.id, rank: i + 1 }));
}
