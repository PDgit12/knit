/**
 * BM25 (Best Match 25) — the lexical retrieval algorithm behind Lucene, Elasticsearch,
 * and most "search-without-embeddings" systems. The full v0.7 plan defines this as the
 * primary retriever for Knit; v0.8 layers graph-traversal fusion on top via RRF.
 *
 * Why vectorless for Knit specifically:
 *   - Privacy — learnings never leave disk to compute embeddings.
 *   - Zero cold-start — no model download, no first-query latency spike.
 *   - Determinism — same query → same results, every time. Critical for the
 *     "didn't I see this before?" pattern that drives the memory layer.
 *   - Footprint — ~250 LOC of math, zero dependencies.
 *
 * The math (standard BM25, no Okapi/BM25+/BM25L variants — the basic recipe
 * is already 86%+ R@5 in the literature and the simple version is easier to audit):
 *
 *     IDF(t)        = ln( (N - df(t) + 0.5) / (df(t) + 0.5) + 1 )
 *     TF_norm(t,D)  = TF(t,D) * (k1 + 1) / ( TF(t,D) + k1 * (1 - b + b * |D|/avgdl) )
 *     Score(D, q)   = Σ_t∈q  IDF(t) * TF_norm(t, D)
 *
 * Defaults k1=1.5, b=0.75 are the canonical "good for most corpora" values
 * from Manning et al. / IR textbooks.
 */

export interface BM25Document {
  /** Stable identifier — caller uses this to map results back to source. */
  id: string;
  /** Document text. BM25Index tokenizes; caller doesn't need to. */
  text: string;
  /** Optional pass-through metadata (tags, domain, project, etc.) — Knit handlers
   *  use this to attach learning context. The index doesn't look at it. */
  metadata?: Record<string, unknown>;
}

export interface BM25SearchResult {
  id: string;
  score: number;
  document: BM25Document;
}

export interface BM25Options {
  /** Term-frequency saturation. Higher = TF matters more. Standard: 1.5. */
  k1?: number;
  /** Length normalization. 0 = ignore doc length, 1 = full normalization. Standard: 0.75. */
  b?: number;
  /** Custom tokenizer. Defaults to lowercase + word-char-split + stopword removal. */
  tokenize?: (text: string) => string[];
  /**
   * v0.15 (audit D1) — opt-in character 2-gram fallback. When a query
   * token has zero docFreq (no documents contain it — typically a typo
   * or rare compound word), fall back to scoring against the token's
   * 2-grams. This rescues queries like "knit_clasify" (typo of
   * "knit_classify") where standard BM25 would return no hits.
   * Off by default — the synthetic + learnings benches stay stable on
   * their tuned thresholds (86% / 83% top-1). Turn on for corpora with
   * known typo-heavy query distributions.
   */
  enableNgramFallback?: boolean;
}

/** Conservative English stopword set. Trimmed — we keep "no/not" because they
 *  matter in code-domain learnings ("not deprecated", "no retries"). */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
  'has', 'have', 'i', 'in', 'is', 'it', 'its', 'of', 'on', 'or',
  'that', 'the', 'this', 'to', 'was', 'were', 'will', 'with',
  's', 't', // possessives + contraction remnants after tokenization
]);

/** Default tokenizer: lowercase, split on non-word boundaries, drop tokens
 *  shorter than 2 chars, drop stopwords. Stable enough for code+prose corpora;
 *  callers with domain-specific needs (CJK, etc.) can pass their own. */
export function defaultTokenize(text: string): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  // Word chars + underscore (so identifiers like `knit_classify_task` survive)
  const tokens = lower.split(/[^a-z0-9_]+/);
  const out: string[] = [];
  for (const t of tokens) {
    if (t.length < 2) continue;
    if (STOPWORDS.has(t)) continue;
    out.push(t);
  }
  return out;
}

/** Generate character 2-grams from a token. Used as a fallback when the
 *  token itself has zero docFreq (typo or rare compound).
 *  Example: "knit_classify" → ["kn","ni","it","t_","_c","cl","la","as","ss","si","if","fy"] */
export function ngrams(token: string, n = 2): string[] {
  if (token.length < n) return [];
  const out: string[] = [];
  for (let i = 0; i <= token.length - n; i++) out.push(token.slice(i, i + n));
  return out;
}

/** In-memory BM25 index. Cheap to construct (~100 docs/ms on typical hardware);
 *  callers can rebuild on every write rather than maintaining incremental state.
 *  Knit's corpora are project-scoped — typically <1000 entries — so this is fine.
 *  For larger corpora consider an inverted-index variant; out of scope for v0.8. */
export class BM25Index {
  private readonly k1: number;
  private readonly b: number;
  private readonly tokenize: (text: string) => string[];
  private readonly enableNgramFallback: boolean;

  private readonly docs: BM25Document[] = [];
  /** Per-document token frequency map: docId → token → count. */
  private readonly termFreq = new Map<string, Map<string, number>>();
  /** Document lengths in tokens, indexed by docId. */
  private readonly docLengths = new Map<string, number>();
  /** Document frequency: token → number of docs containing it. */
  private readonly docFreq = new Map<string, number>();
  /** v0.15 (D1) — per-document 2-gram frequency, built lazily for the
   *  ngram-fallback path. Empty unless enableNgramFallback was set. */
  private readonly docNgramFreq = new Map<string, Map<string, number>>();
  private readonly ngramDocFreq = new Map<string, number>();
  private avgDocLength = 0;

  constructor(documents: BM25Document[] = [], options: BM25Options = {}) {
    this.k1 = options.k1 ?? 1.5;
    this.b = options.b ?? 0.75;
    this.tokenize = options.tokenize ?? defaultTokenize;
    this.enableNgramFallback = !!options.enableNgramFallback;
    for (const doc of documents) this.addInternal(doc);
    this.recomputeAvgDocLength();
  }

  /** Add a document. Triggers an avgDocLength recompute. For bulk additions
   *  during initial indexing, prefer constructor — same end state, single recompute. */
  add(document: BM25Document): void {
    this.addInternal(document);
    this.recomputeAvgDocLength();
  }

  /** Search the corpus. Returns up to `limit` documents ranked by BM25 score.
   *  Documents with zero score (no query terms match) are omitted entirely. */
  search(query: string, limit = 10): BM25SearchResult[] {
    const queryTerms = this.tokenize(query);
    if (queryTerms.length === 0 || this.docs.length === 0) return [];

    const scores = new Map<string, number>();
    const N = this.docs.length;

    for (const term of queryTerms) {
      const df = this.docFreq.get(term) ?? 0;
      if (df === 0) {
        // v0.15 (D1) — opt-in 2-gram fallback for unmatched terms (typos /
        // rare compounds). Adds a small score to docs sharing the term's
        // 2-grams. Weight discount (×0.25) keeps the fallback below any
        // genuine BM25 match while still rescuing the zero-hit case.
        if (this.enableNgramFallback) this.scoreNgramFallback(term, N, scores);
        continue;
      }

      // BM25 IDF — never negative under the +1 inside log
      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);

      for (const doc of this.docs) {
        const tf = this.termFreq.get(doc.id)?.get(term) ?? 0;
        if (tf === 0) continue;
        const docLen = this.docLengths.get(doc.id) ?? 0;
        const denom = tf + this.k1 * (1 - this.b + this.b * (docLen / (this.avgDocLength || 1)));
        const tfNorm = (tf * (this.k1 + 1)) / denom;
        scores.set(doc.id, (scores.get(doc.id) ?? 0) + idf * tfNorm);
      }
    }

    const ranked: BM25SearchResult[] = [];
    for (const doc of this.docs) {
      const score = scores.get(doc.id);
      if (score === undefined || score <= 0) continue;
      ranked.push({ id: doc.id, score, document: doc });
    }
    ranked.sort((a, b) => b.score - a.score);
    return ranked.slice(0, limit);
  }

  /** Number of indexed documents. */
  size(): number {
    return this.docs.length;
  }

  /** Number of unique tokens across the corpus — useful for diagnostics. */
  vocabularySize(): number {
    return this.docFreq.size;
  }

  // ── Internals ─────────────────────────────────────────────────

  /** v0.15 (D1) — N-gram fallback scoring. For a query term with zero
   *  docFreq, score each doc by the overlap between the term's 2-grams
   *  and the doc's 2-grams (computed once per doc at index time). Score
   *  is heavily discounted so it never outranks a genuine BM25 hit. */
  private scoreNgramFallback(term: string, N: number, scores: Map<string, number>): void {
    const queryNgrams = ngrams(term, 2);
    if (queryNgrams.length === 0) return;
    const NGRAM_WEIGHT = 0.25;
    for (const qn of queryNgrams) {
      const df = this.ngramDocFreq.get(qn) ?? 0;
      if (df === 0) continue;
      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
      for (const doc of this.docs) {
        const tf = this.docNgramFreq.get(doc.id)?.get(qn) ?? 0;
        if (tf === 0) continue;
        scores.set(doc.id, (scores.get(doc.id) ?? 0) + NGRAM_WEIGHT * idf * Math.log(1 + tf));
      }
    }
  }

  private addInternal(doc: BM25Document): void {
    // Don't double-add the same id; replace instead.
    if (this.termFreq.has(doc.id)) {
      this.removeInternal(doc.id);
    }

    this.docs.push(doc);
    const tokens = this.tokenize(doc.text);
    this.docLengths.set(doc.id, tokens.length);

    const tfMap = new Map<string, number>();
    for (const t of tokens) {
      tfMap.set(t, (tfMap.get(t) ?? 0) + 1);
    }
    this.termFreq.set(doc.id, tfMap);

    // v0.15 (D1) — pre-compute 2-gram frequencies for ngram-fallback path.
    if (this.enableNgramFallback) {
      const ngFreq = new Map<string, number>();
      for (const tok of tokens) {
        for (const g of ngrams(tok, 2)) ngFreq.set(g, (ngFreq.get(g) ?? 0) + 1);
      }
      this.docNgramFreq.set(doc.id, ngFreq);
      for (const g of ngFreq.keys()) {
        this.ngramDocFreq.set(g, (this.ngramDocFreq.get(g) ?? 0) + 1);
      }
    }

    // Update document-frequency for each unique token in this doc.
    for (const t of tfMap.keys()) {
      this.docFreq.set(t, (this.docFreq.get(t) ?? 0) + 1);
    }
  }

  private removeInternal(docId: string): void {
    const tfMap = this.termFreq.get(docId);
    if (!tfMap) return;
    for (const t of tfMap.keys()) {
      const df = this.docFreq.get(t) ?? 0;
      if (df <= 1) this.docFreq.delete(t);
      else this.docFreq.set(t, df - 1);
    }
    this.termFreq.delete(docId);
    this.docLengths.delete(docId);
    // v0.15 (D1) — clean up ngram counters for the removed doc.
    const ngFreq = this.docNgramFreq.get(docId);
    if (ngFreq) {
      for (const g of ngFreq.keys()) {
        const df = this.ngramDocFreq.get(g) ?? 0;
        if (df <= 1) this.ngramDocFreq.delete(g);
        else this.ngramDocFreq.set(g, df - 1);
      }
      this.docNgramFreq.delete(docId);
    }
    const idx = this.docs.findIndex((d) => d.id === docId);
    if (idx !== -1) this.docs.splice(idx, 1);
  }

  private recomputeAvgDocLength(): void {
    if (this.docs.length === 0) {
      this.avgDocLength = 0;
      return;
    }
    let total = 0;
    for (const len of this.docLengths.values()) total += len;
    this.avgDocLength = total / this.docs.length;
  }
}
