import { describe, it, expect } from 'vitest';
import { BM25Index, defaultTokenize, type BM25Document } from '../src/engine/retrieval/bm25.js';
import { diversifyBy, diversifyByBranch, diversifyByProject } from '../src/engine/retrieval/index.js';

/**
 * v0.8 phase 1 — standalone BM25 module.
 *
 * Tests pin the algorithm's mathematical properties (IDF, length normalization,
 * stopword handling) AND its behavior on a Knit-shaped corpus of learnings.
 * If a reviewer later substitutes BM25+ or rolls Porter stemming in, these
 * tests fail-fast on observable changes.
 */

describe('defaultTokenize', () => {
  it('lowercases tokens', () => {
    expect(defaultTokenize('Hello WORLD')).toEqual(['hello', 'world']);
  });

  it('splits on non-word boundaries', () => {
    expect(defaultTokenize('foo, bar; baz!')).toEqual(['foo', 'bar', 'baz']);
  });

  it('preserves underscores so identifiers stay intact', () => {
    expect(defaultTokenize('knit_classify_task is great')).toEqual(['knit_classify_task', 'great']);
  });

  it('drops tokens shorter than 2 chars (noise)', () => {
    expect(defaultTokenize('a I to we go')).toEqual(['we', 'go']);
  });

  it('drops English stopwords', () => {
    expect(defaultTokenize('the cat is on the mat')).toEqual(['cat', 'mat']);
  });

  it('returns [] for empty / whitespace input', () => {
    expect(defaultTokenize('')).toEqual([]);
    expect(defaultTokenize('   \n\t  ')).toEqual([]);
  });

  it('handles unicode-ish content gracefully (drops non-word chars; <2-char fragments fall out)', () => {
    // "café" splits to ['caf'] (é dropped), "résumé" splits to ['r','sum'] (é dropped),
    // then min-length filter removes 'r'. Result: ['caf', 'sum']. Not pretty for
    // non-ASCII text but stable and predictable. Real CJK/Unicode support is a v0.9+ concern.
    expect(defaultTokenize('café — résumé')).toEqual(['caf', 'sum']);
  });
});

describe('BM25Index — construction + basic search', () => {
  it('empty corpus returns empty results for any query', () => {
    const idx = new BM25Index([]);
    expect(idx.search('anything')).toEqual([]);
    expect(idx.size()).toBe(0);
  });

  it('empty query returns empty results', () => {
    const idx = new BM25Index([
      { id: '1', text: 'fix the auth bug' },
    ]);
    expect(idx.search('')).toEqual([]);
  });

  it('finds the only document matching a query term', () => {
    const idx = new BM25Index([
      { id: '1', text: 'fix the auth bug' },
      { id: '2', text: 'refactor the payment module' },
    ]);
    const results = idx.search('auth');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('1');
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('ranks the more-relevant document higher when both match', () => {
    const idx = new BM25Index([
      { id: '1', text: 'auth auth auth fix' },
      { id: '2', text: 'auth bug in payment' },
    ]);
    const results = idx.search('auth');
    expect(results[0].id).toBe('1'); // doc1 has 3 hits, doc2 has 1
    expect(results[1].id).toBe('2');
  });

  it('returns documents in descending score order', () => {
    const idx = new BM25Index([
      { id: 'a', text: 'apple apple banana' },
      { id: 'b', text: 'banana cherry cherry' },
      { id: 'c', text: 'apple cherry' },
    ]);
    const results = idx.search('apple cherry');
    const scores = results.map((r) => r.score);
    expect(scores).toEqual([...scores].sort((x, y) => y - x));
  });

  it('honors the `limit` parameter', () => {
    const docs: BM25Document[] = Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      text: 'auth bug fix',
    }));
    const idx = new BM25Index(docs);
    expect(idx.search('auth', 5)).toHaveLength(5);
    expect(idx.search('auth', 1)).toHaveLength(1);
    expect(idx.search('auth', 100)).toHaveLength(20); // limit > corpus
  });

  it('returns the metadata pass-through unchanged in results', () => {
    const idx = new BM25Index([
      { id: '1', text: 'auth fix', metadata: { tags: ['#auth', '#security'], domain: 'API' } },
    ]);
    const result = idx.search('auth')[0];
    expect(result.document.metadata).toEqual({ tags: ['#auth', '#security'], domain: 'API' });
  });
});

describe('BM25Index — algorithmic properties', () => {
  it('IDF gives RARE terms more weight than common ones', () => {
    // "auth" appears in every document → IDF tiny. "stripe" appears in one → IDF large.
    const idx = new BM25Index([
      { id: '1', text: 'auth fix' },
      { id: '2', text: 'auth refactor' },
      { id: '3', text: 'auth bug' },
      { id: '4', text: 'auth stripe webhook' },
    ]);
    const authResults = idx.search('auth');
    const stripeResults = idx.search('stripe');
    // Top stripe result should outscore top auth result because stripe is rarer.
    expect(stripeResults[0].score).toBeGreaterThan(authResults[0].score);
  });

  it('length normalization penalizes long documents (b > 0)', () => {
    const idx = new BM25Index([
      { id: 'short', text: 'auth' },
      { id: 'long', text: 'auth ' + 'filler '.repeat(50) },
    ]);
    const results = idx.search('auth');
    // Short doc should rank above long doc — same term frequency, less noise.
    expect(results[0].id).toBe('short');
  });

  it('with b=0 disables length normalization', () => {
    const idx = new BM25Index(
      [
        { id: 'short', text: 'auth' },
        { id: 'long', text: 'auth ' + 'filler '.repeat(50) },
      ],
      { b: 0 },
    );
    const results = idx.search('auth');
    // With no length penalty, both docs have the same TF=1 and same IDF → equal scores.
    expect(Math.abs(results[0].score - results[1].score)).toBeLessThan(1e-9);
  });

  it('non-matching terms contribute 0 (they do not depress scores)', () => {
    const idx = new BM25Index([
      { id: '1', text: 'fix the auth bug' },
    ]);
    const withMatch = idx.search('auth');
    const withGarbage = idx.search('auth xyzzyplover');
    expect(withMatch).toHaveLength(1);
    expect(withGarbage).toHaveLength(1);
    expect(withGarbage[0].score).toBe(withMatch[0].score);
  });

  it('zero-score documents are omitted entirely from results', () => {
    const idx = new BM25Index([
      { id: '1', text: 'auth' },
      { id: '2', text: 'payment' },
    ]);
    const results = idx.search('payment');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('2');
  });
});

describe('BM25Index — corpus mutation', () => {
  it('add() updates the document-frequency table', () => {
    const idx = new BM25Index([{ id: '1', text: 'auth' }]);
    expect(idx.search('payment')).toHaveLength(0);
    idx.add({ id: '2', text: 'payment refactor' });
    expect(idx.search('payment')).toHaveLength(1);
  });

  it('add() with an existing id replaces (does not duplicate)', () => {
    const idx = new BM25Index([{ id: '1', text: 'auth' }]);
    idx.add({ id: '1', text: 'payment' });
    expect(idx.size()).toBe(1);
    expect(idx.search('auth')).toHaveLength(0);
    expect(idx.search('payment')).toHaveLength(1);
  });

  it('size() and vocabularySize() track the corpus', () => {
    const idx = new BM25Index();
    expect(idx.size()).toBe(0);
    expect(idx.vocabularySize()).toBe(0);

    idx.add({ id: '1', text: 'auth bug' });
    expect(idx.size()).toBe(1);
    expect(idx.vocabularySize()).toBe(2); // 'auth', 'bug'

    idx.add({ id: '2', text: 'auth fix' });
    expect(idx.size()).toBe(2);
    expect(idx.vocabularySize()).toBe(3); // 'auth' (shared), 'bug', 'fix'
  });
});

describe('BM25Index — Knit-shaped corpus (realistic smoke test)', () => {
  // Mirrors the rough shape of a real learnings corpus: ~5-20 entries, each
  // a one-liner summary + a multi-sentence lesson. The point isn't to validate
  // exact scores (those depend on k1/b/IDF math), but that a domain-specific
  // query surfaces the right entry as the top hit.
  function knitCorpus(): BM25Document[] {
    return [
      { id: 'l1', text: 'OpenAI streaming response handling. Need to handle abrupt disconnects gracefully because production tokens get cut off and the SSE stream never closes cleanly.' },
      { id: 'l2', text: 'Stripe webhook signature verification fails silently when the body is parsed before raw bytes are captured. Always read req.rawBody first.' },
      { id: 'l3', text: 'TypeScript narrowing breaks across async boundaries when using union types with a discriminant. Re-narrow inside the then() callback.' },
      { id: 'l4', text: 'Atomic file writes via temp + renameSync are the right pattern for any single-writer JSON config. writeFileSync alone risks torn writes on crash.' },
      { id: 'l5', text: 'Auth token rotation: invalidate the prior token immediately, do not keep both valid during a grace period. Race conditions multiply.' },
      { id: 'l6', text: 'Node 22+ strict mode rejects top-level return in node -e eval payloads. Wrap in IIFE.' },
    ];
  }

  it('"stripe webhook" surfaces the Stripe entry as top hit', () => {
    const idx = new BM25Index(knitCorpus());
    const results = idx.search('stripe webhook');
    expect(results[0].id).toBe('l2');
  });

  it('"atomic write" surfaces the atomic-write entry as top hit', () => {
    const idx = new BM25Index(knitCorpus());
    const results = idx.search('atomic write');
    expect(results[0].id).toBe('l4');
  });

  it('"node -e return" surfaces the IIFE / Node strict-mode entry', () => {
    const idx = new BM25Index(knitCorpus());
    const results = idx.search('node return');
    expect(results[0].id).toBe('l6');
  });

  it('multi-word queries with one rare term find the right doc even if other terms are noise', () => {
    const idx = new BM25Index(knitCorpus());
    // "fix" is generic noise across the corpus; "iife" is rare → should drive the result.
    const results = idx.search('iife fix');
    expect(results[0].id).toBe('l6');
  });

  it('unrelated query returns empty', () => {
    const idx = new BM25Index(knitCorpus());
    expect(idx.search('quantum cryptography')).toEqual([]);
  });
});

// ── v0.10 — diversifiers ──────────────────────────────────────────
//
// `diversifyBy` is the generic key-extractor capper used by the session-
// and project-specific helpers. Tests pin (1) the cap actually applies,
// (2) original rank order is preserved within each bucket, (3) empty/null
// bucket keys get their own '(empty)' lane.

describe('diversifyBy — generic key-capper', () => {
  it('caps results sharing the same key', () => {
    const items = ['a1', 'a2', 'a3', 'b1', 'a4'];
    const out = diversifyBy(items, (s) => s[0], 2);
    expect(out).toEqual(['a1', 'a2', 'b1']);
  });

  it('preserves original rank order within each bucket', () => {
    const items = ['a3', 'a1', 'a2'];
    const out = diversifyBy(items, (s) => s[0], 5);
    expect(out).toEqual(['a3', 'a1', 'a2']);
  });

  it('null/undefined keys all land in the (empty) bucket and are capped together', () => {
    const items = [{ k: null }, { k: undefined }, { k: null }, { k: 'x' }];
    const out = diversifyBy(items, (i) => i.k as string | null, 1);
    expect(out).toHaveLength(2);
    expect(out[0].k).toBeNull();
    expect(out[1].k).toBe('x');
  });

  it('cap=0 returns empty', () => {
    expect(diversifyBy(['a', 'b'], (s) => s, 0)).toEqual([]);
  });
});

describe('diversifyByBranch — session-branch capper', () => {
  function fakeHit(id: string, branch: string | null) {
    return { id, score: 1, document: { id, text: '', metadata: { session: { branch } } } };
  }

  it('caps at maxPerBranch (default 2) per branch', () => {
    const hits = [
      fakeHit('1', 'feature/x'),
      fakeHit('2', 'feature/x'),
      fakeHit('3', 'feature/x'),
      fakeHit('4', 'main'),
    ];
    const out = diversifyByBranch(hits);
    expect(out.map((h) => h.id)).toEqual(['1', '2', '4']);
  });

  it('treats null branch as its own bucket', () => {
    const hits = [
      fakeHit('1', null),
      fakeHit('2', null),
      fakeHit('3', null),
      fakeHit('4', 'main'),
    ];
    const out = diversifyByBranch(hits, 2);
    expect(out.map((h) => h.id)).toEqual(['1', '2', '4']);
  });
});

// ── v0.11.4 — BM25 retrieval edge cases ─────────────────────────────────────

describe('BM25Index — additional edge cases (v0.11.4)', () => {
  it('1-char query — no crash (tokenizer drops short tokens; returns empty gracefully)', () => {
    const idx = new BM25Index([
      { id: '1', text: 'auth fix bug' },
    ]);
    // Single char 'a' is shorter than 2-char min — tokenizer drops it → empty query → []
    expect(() => idx.search('a')).not.toThrow();
    const results = idx.search('a');
    expect(Array.isArray(results)).toBe(true);
  });

  it('query >1000 chars — no slowdown, no crash', () => {
    const docs = Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      text: `auth fix bug module${i} payment webhook stripe`,
    }));
    const idx = new BM25Index(docs);
    const longQuery = 'auth '.repeat(210); // ~1050 chars
    const start = Date.now();
    expect(() => idx.search(longQuery)).not.toThrow();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500);
  });

  it('corpus with one document — BM25 IDF math does not divide by zero, returns result', () => {
    // N=1, df=1 → IDF = ln((1 - 1 + 0.5)/(1 + 0.5) + 1) = ln(0.5/1.5 + 1) = ln(1.333) > 0
    // avgDocLength guard uses || 1 — no division by zero.
    const idx = new BM25Index([
      { id: 'only', text: 'payment idempotency webhook retry logic is important' },
    ]);
    const results = idx.search('payment');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('only');
    expect(Number.isFinite(results[0].score)).toBe(true);
    expect(results[0].score).toBeGreaterThan(0);
  });
});

describe('diversifyByProject — global-learnings project capper', () => {
  function fakeHit(id: string, projectName: string | null) {
    return { id, score: 1, document: { id, text: '', metadata: { entry: { projectName } } } };
  }

  it('caps at maxPerProject (default 2) per source project', () => {
    const hits = [
      fakeHit('a', 'proj-a'),
      fakeHit('b', 'proj-a'),
      fakeHit('c', 'proj-a'),
      fakeHit('d', 'proj-b'),
      fakeHit('e', 'proj-a'),
    ];
    const out = diversifyByProject(hits);
    expect(out.map((h) => h.id)).toEqual(['a', 'b', 'd']);
  });

  it('keeps quieter projects visible when a chatty one would dominate', () => {
    const hits = [
      fakeHit('chatty1', 'proj-loud'),
      fakeHit('chatty2', 'proj-loud'),
      fakeHit('chatty3', 'proj-loud'),
      fakeHit('chatty4', 'proj-loud'),
      fakeHit('quiet1', 'proj-quiet'),
    ];
    const out = diversifyByProject(hits, 2);
    const projects = out.map((h) => (h.document.metadata as { entry: { projectName: string } }).entry.projectName);
    expect(projects).toContain('proj-quiet');
    expect(projects.filter((p) => p === 'proj-loud')).toHaveLength(2);
  });
});
