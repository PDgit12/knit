/**
 * v0.16 — coding-domain synonym expansion for BM25 query terms.
 *
 * BM25 is pure lexical match: a query for "hook events" won't match a doc
 * about "webhook signatures" even though they're semantically related. To
 * close the most common synonym gaps in coding-domain memory without
 * adding an embedding model or external API call, we hand-curate a small
 * dictionary of well-attested synonym pairs.
 *
 * Design rules for the dictionary:
 *
 * 1. **Conservative.** Only include pairs that ALWAYS mean substantially
 *    the same thing in coding context. "auth" ↔ "authentication" — yes.
 *    "auth" ↔ "authorization" — NO (different concepts).
 * 2. **Both directions.** Each pair appears once; lookup is symmetric.
 * 3. **Single-word only.** Multi-word phrases ("schema change" ↔
 *    "migration") are handled by the query-expansion layer at search
 *    time, not here.
 * 4. **Discounted weight.** A synonym match scores less than a direct
 *    match. Implemented at the BM25 caller via SYNONYM_WEIGHT in bm25.ts.
 * 5. **Tested.** Every pair has a regression test pin in bm25.test.ts so
 *    adding a synonym that breaks something is caught immediately.
 *
 * NOT a substitute for embeddings — see README "How search works" for
 * the honest framing. This closes the most common synonym gaps; the
 * paraphrase / abstraction-bridging boundary remains.
 */

/** Curated coding-domain synonym pairs. Symmetric: order doesn't matter. */
const SYNONYM_PAIRS: ReadonlyArray<readonly [string, string]> = [
  // HTTP / API
  ['webhook', 'hook'],
  ['endpoint', 'route'],
  ['handler', 'endpoint'],
  ['request', 'req'],
  ['response', 'res'],

  // Auth / security
  ['auth', 'authentication'],
  ['authn', 'authentication'],
  ['authz', 'authorization'],
  ['credential', 'secret'],
  ['credential', 'token'],
  ['token', 'secret'],
  ['redact', 'sanitize'],
  ['redact', 'scrub'],
  ['vulnerability', 'cve'],

  // Data / storage
  ['migration', 'schema'],
  ['db', 'database'],
  ['query', 'lookup'],
  ['query', 'search'],
  ['atomic', 'transactional'],
  ['rollback', 'revert'],

  // Concurrency
  ['mutex', 'lock'],
  ['race', 'racy'],
  ['concurrent', 'parallel'],
  ['async', 'asynchronous'],

  // Lifecycle / release
  ['deploy', 'release'],
  ['deploy', 'ship'],
  ['release', 'publish'],
  ['rollout', 'release'],
  ['regression', 'breakage'],

  // Testing
  ['test', 'spec'],
  ['unit', 'spec'],
  ['mock', 'stub'],
  ['fixture', 'sample'],
  ['assertion', 'expectation'],

  // Errors / observability
  ['error', 'exception'],
  ['error', 'failure'],
  ['exception', 'failure'],
  ['log', 'trace'],
  ['logs', 'logging'],
  ['debug', 'diagnostic'],
  ['warn', 'warning'],

  // Memory / caching
  ['cache', 'memo'],
  ['cached', 'memoized'],
  ['ttl', 'expiration'],
  ['stale', 'expired'],

  // Performance
  ['timeout', 'deadline'],
  ['latency', 'delay'],
  ['perf', 'performance'],
  ['throttle', 'ratelimit'],

  // Config
  ['config', 'settings'],
  ['config', 'options'],
  ['env', 'environment'],
  ['flag', 'option'],

  // Refactoring / change
  ['rename', 'refactor'],
  ['cleanup', 'tidy'],

  // Agents / AI
  ['agent', 'assistant'],
  ['agent', 'bot'],
  ['llm', 'model'],
  ['prompt', 'instruction'],
  ['handoff', 'handover'],

  // Protocol surfaces
  ['protocol', 'contract'],
  ['interface', 'contract'],
  ['api', 'interface'],

  // Memory layer
  ['memory', 'brain'],
  ['learning', 'lesson'],
  ['session', 'conversation'],
  ['session', 'turn'],
];

/** O(1) lookup: token → Set of its synonyms. Built once at module load. */
const SYNONYM_MAP: Map<string, Set<string>> = (() => {
  const m = new Map<string, Set<string>>();
  for (const [a, b] of SYNONYM_PAIRS) {
    if (!m.has(a)) m.set(a, new Set());
    if (!m.has(b)) m.set(b, new Set());
    m.get(a)!.add(b);
    m.get(b)!.add(a);
  }
  return m;
})();

/**
 * Returns the synonyms of a query token (excluding the token itself).
 * Returns empty array for unknown tokens — no allocation overhead on miss.
 */
export function synonymsOf(token: string): string[] {
  const s = SYNONYM_MAP.get(token);
  if (!s) return [];
  return Array.from(s);
}

/** Test-only: how many distinct tokens are in the dictionary. */
export function synonymVocabularySize(): number {
  return SYNONYM_MAP.size;
}
