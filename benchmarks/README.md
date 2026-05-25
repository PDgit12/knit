# Knit benchmarks

Honest measurement of Knit's retrieval primitives. Run with `npm run bench`.

## What's here

### `retrieval-synthetic.ts` — 50-question retrieval harness (ships in v0.11.2)

A small synthetic corpus + 50 Q&A pairs with known-correct chunks.
Measures Knit's BM25 + RRF + graph-traversal pipeline's **top-1
accuracy** (does the most-relevant chunk come back first?) and
**recall@5** (is the right chunk anywhere in the top 5?).

Run:

```bash
npx tsx benchmarks/retrieval-synthetic.ts
```

**Intentional limit:** 50 hand-authored questions ≠ LongMemEval-S
(1500 questions, real conversational long-context). The synthetic
harness is a *unit-test-grade* sanity check that the retrieval
primitives wire correctly, not a competitive claim against mem0 /
Letta / agentmemory.

The numbers it produces tell you the architecture is healthy. They do
not tell you Knit beats anyone. Real comparison requires running
**LongMemEval-S** (planned for v0.13) and **LOCOMO** (planned for
v0.13).

## What's NOT here yet

| Benchmark | Status | Why deferred |
|---|---|---|
| LongMemEval-S R@5 | v0.13 roadmap | Requires dataset download (~few GB), full eval run (multi-hour), $10-30 LLM judge cost. Out of scope for v0.11.2. |
| LOCOMO LLM-as-Judge | v0.13 roadmap | Same. |
| BEIR / MTEB | v0.13+ | Different category (information retrieval benchmarks); useful but not the workflow-layer comparison story. |

## Methodology note

The synthetic corpus is 50 paragraphs about a fictional payments
product, each ~80-120 chars, indexed via `chunkRequirements` exactly
the way real user docs would be. The 50 questions are deliberately
diverse: exact-phrase, synonym, semantic-implication, requirement-
to-test-case translation.

When you change the retrieval logic (e.g. tune BM25 k1/b, change RRF
k constant, add embeddings) — re-run this harness. A drop in top-1
accuracy is a regression signal, even if no unit test catches it.
