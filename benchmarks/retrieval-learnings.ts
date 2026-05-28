#!/usr/bin/env tsx
/**
 * v0.15.0 (audit D5) — retrieval bench against real-learning-shape content.
 *
 * The synthetic bench (retrieval-synthetic.ts) measures BM25+RRF on
 * spec-doc paragraphs ("Payments must support idempotency keys..."). Real
 * Knit learnings are narrative-prose insights ("When you rename a project's
 * brand, the rename is incomplete until... Reason: ... How to apply: ...")
 * — different surface area, different IDF distribution, different recall
 * characteristics. This bench stresses the retrieval pipeline against the
 * actual shape Knit ships in production.
 *
 * Pass criterion: top-1 ≥ 75% (intentionally lower than the spec-doc 85%
 * gate — narrative prose is harder to retrieve cleanly). Recall@5 ≥ 90%.
 *
 * Run: npx tsx benchmarks/retrieval-learnings.ts
 */

import { buildSourceIndex, chunkRequirements, retrieveTopChunks } from '../src/engine/requirements.js';

interface QA {
  q: string;
  expected: string;
}

const CORPUS = [
  'When you rename a project brand (engram → knit), the rename is only complete after you bump HOOKS_VERSION so existing users\' upgrade paths activate. Forgetting this leaves hook regeneration as a no-op for the rename window. How to apply: any rename PR must include a HOOKS_VERSION bump and a brief migration note in CHANGELOG.',
  'POSIX O_APPEND atomicity is only guaranteed for writes ≤ PIPE_BUF (~4KB on Linux/macOS). A learning entry with a long lesson body can exceed this, allowing concurrent writers to interleave. Why: PIPE_BUF is the kernel-defined boundary. How to apply: for any append-only persistence path, gate large payloads behind an mkdir-based lock or use temp+rename rewrites.',
  'Never use plain writeFileSync for structured state files. A mid-write crash leaves a torn file that breaks downstream readers. Why: writeFileSync is not atomic on POSIX. How to apply: use temp+rename — write to path + ".tmp" + pid + ts, then renameSync. Every new persistence path must use this pattern.',
  'When introducing a new MCP tool, audit its description claim against the handler code. Marketing copy that the handler doesn\'t implement (e.g., "skips duplicates") will be caught by the next claims-vs-reality audit. How to apply: every tool description is a code-level contract; trace before merging.',
  'BM25 retrieval with RRF fusion (k=60) is the right primitive for narrative-prose memory. Substring fallback covers the long tail of partial-word queries. How to apply: always over-fetch ×3 before diversification — diversifying tiny result sets leaves you with empty top-K.',
  'Diversify by branch on session search (cap 2 per branch). Without it, a chatty branch floods results and useful sessions from other branches get drowned. Why: BM25 alone has no notion of "spread". How to apply: extract diversifyBy<T>(results, keyFn, max) as a generic, write thin branch/project wrappers.',
  'When extracting a generic helper from a specific one, keep the specific wrapper as a thin function around the generic so call sites stay grep-able. Why: diversifyByBranch(...) reads better than diversifyBy(..., r => r.metadata.session.branch). How to apply: always preserve the specific name even after generalizing.',
  'Schema changes ship by bumping HOOKS_VERSION + writing a migration that runs on next brain load. Why: existing users\' settings.json carries their old hook version. How to apply: writer always emits the new shape; reader recognizes legacy markers and replaces them in-place.',
  'Cross-platform protocol enforcement is solved by server-side soft-gates in the MCP response, NOT host-side hooks. Only Claude Code has lifecycle hooks; Cursor/Codex/Cline/Continue/Copilot don\'t. How to apply: when an invariant must hold across all 6 agents, return {status: "protocol_required", next_action: "..."} from the handler. The agent reads, follows, retries.',
  'MCP server instructions field is the only universally-read surface at handshake. CLAUDE.md is harness-wrapped with "may or may not be relevant" caveats; tool descriptions are only read when choosing a tool. How to apply: any signal that must reach the agent BEFORE first action goes into buildInstructions, not CLAUDE.md.',
  'classify_task is non-negotiable BEFORE Edit/Write even when the work feels small. High-fanout files (handlers.ts, cache.ts, types.ts) turn 2-line patches into complex tasks because the blast radius extends to all 31+ dependents. How to apply: pre-flight every edit with knit_classify_task, regardless of perceived size.',
  'When marketing token-optimization claims, ship enforcement BEFORE diagnostic. Telling-without-fixing is the failure mode: knit_brain_status reporting CLAUDE.md over-budget but no path that acted on it. How to apply: any optimization feature must answer "what surfaces this BEFORE the cost is paid?"',
  'The right enforcement point for the REVIEW-phase claim gate is the Stop hook, not PreToolUse on knit_record_learning. Why: Stop fires reliably at turn end whether or not the agent invokes LEARN — catches the silent-finish case. How to apply: turn-end invariants belong on Stop; pre-tool invariants on PreToolUse.',
  'Honest measurement beats honest description. v0.12.1 fix that replaced AVG_TOOL_DEF_BYTES=280 with estimateActiveToolRegistryBytes() exposed that the registry was 30% larger than the constant claimed. How to apply: never use a hardcoded byte estimate when the value can be measured at runtime via Buffer.byteLength.',
  'Patch-vs-minor scope discipline: anything that bumps HOOKS_VERSION or changes the protocol surface is minor-scope, not patch-scope. Why: HOOKS_VERSION bumps trigger user-side regeneration; that\'s a behavior change. How to apply: scope decisions ask "does this need a HOOKS_VERSION bump?" — if yes, route to a minor release.',
  'Atomics.wait + existsSync poll is the right idiom for sync-handler file-existence waits in Node. Block up to 2s for the target file to land, then return honest installed|pending status. Why: avoids busy-wait + no async signature refactor needed. How to apply: const buf = new Int32Array(new SharedArrayBuffer(4)); Atomics.wait(buf, 0, 0, 50).',
  'Split TaskClassification into risk × scope × changeKind. The v0.9 compound tier conflated risk (auth/types/breaking) and scope (file count). 1-line edits to types.ts are high-risk-low-scope and DESERVE plan mode. How to apply: emit three independent signals; let auto_plan_mode key off risk, not scope.',
  'Self-healing classifier: 3 same-direction FPs shifts the threshold by 1 unit. Reset counter after each adjustment so users re-confirm before further shifts. Why: gives users 3 chances to confirm intent before tuning moves. How to apply: per-project calibration state lives in calibration.json; cross-project pool stays global.',
  'Object-spread DEFAULT_CALIBRATION is a SHALLOW copy. First mutation poisons the shared default; subsequent "fresh" loads return polluted state. Why: nested object refs are aliased. How to apply: use a freshDefault() factory that returns brand-new nested objects each call. Same rule for any per-call config object.',
  'Snake-case vs camelCase consistency: TS modules use camelCase; MCP response payloads emit snake_case. Always convert at the handler boundary. Why: callers depend on snake_case shape; module ergonomics depend on camelCase. How to apply: never expose camelCase in MCP responses, even by accident.',
  'Direction-tag regex must accept both long and short forms (#high-risk-was-low-risk AND #high-risk-was-low) since users naturally type the short form. Normalize to long form for counter keys. Why: avoids dual-bucket pollution. How to apply: parser canonicalizes; counter only sees the canonical key.',
  'Generic helper extraction principle: when you pull a specific implementation up into a generic, keep the specific name as a one-line wrapper. Why: diversifyByBranch reads better at call sites than the inlined generic call. How to apply: never delete the specific function; thin-wrapper it instead.',
  'When auditing claim-vs-reality across many tools, parallel Explore agents grouped by handler region (not category) produce focused 1500-2000-word reports without overlap. Why: handler regions have natural locality. How to apply: 4-6 agents, one per handler region; hand each the locked SHA so they all grade the same code.',
  'Empirical retrieval verification needs live queries, not just code reading. Tracing the BM25+RRF code looks correct on inspection; running 5 live queries against the actual 22-entry corpus confirms it AND surfaces data hygiene issues like empty-lesson entries. How to apply: every retrieval audit must include live queries.',
  'Audit doc location matters. Raw audit findings go to a gitignored sidecar dir, not committed. The clean public version goes to the repo only after redline. Why: raw findings often contain "oversold" language that\'s accurate but not the right tone for public docs. How to apply: never commit raw audit findings.',
  'Pre-publish leak grep is a real release gate. v0.14.1 audit added scripts/check-leaks.mjs scanning source and docs for references to maintainer-only paths. Why: those files ship to npm; leaks point at files the user doesn\'t have. How to apply: chain check-leaks into prepublishOnly.',
  'execFile with array args is the safe primitive for spawning git. execSync with shell-quoted strings has a quoting surface even with single-quote escaping. Why: no shell, no quoting, no injection. How to apply: every child-process invocation in security-sensitive paths must use execFileSync(cmd, [args]).',
  'Agent-fetcher cache writes need SHA256 sidecars so subsequent reads detect post-cache tampering. Why: someone editing a cached agent md file on disk should not be served back unchanged. How to apply: write the sha256 next to every cached file; verify on read; re-fetch on mismatch; backfill on missing sidecar.',
  'Schema-validate persisted entries on read. Empty-shell entries (missing summary or lesson) pollute BM25 retrieval results by matching too generously. How to apply: at read time, skip entries failing structural checks AND emit a one-line stderr count so the user knows the corpus has noise.',
  'Prune-by-age must conservatively keep entries with unparseable dates and #false-positive tags. Why: never silently lose data we can\'t classify as stale; FP entries feed the self-healing classifier and outlast retrieval freshness. How to apply: dateMs unparseable → keep; tag includes #false-positive → keep regardless of age.',
];

const QUESTIONS: QA[] = [
  { q: 'how do project renames stay safe across upgrades', expected: 'c1' },
  { q: 'what limits append-only atomicity at the kernel level', expected: 'c2' },
  { q: 'why do we use temp file plus rename for structured writes', expected: 'c3' },
  { q: 'how do we make sure tool descriptions match handler behavior', expected: 'c4' },
  { q: 'what is the right retrieval primitive for narrative memory', expected: 'c5' },
  { q: 'how do we prevent one branch from flooding session search results', expected: 'c6' },
  { q: 'why keep the specific wrapper when generalizing a helper', expected: 'c7' },
  { q: 'what triggers user-side hook regeneration on upgrade', expected: 'c8' },
  { q: 'how do we enforce protocol invariants on non-Claude MCP agents', expected: 'c9' },
  { q: 'what surface does the agent read first at handshake', expected: 'c10' },
  { q: 'why classify before editing even small changes', expected: 'c11' },
  { q: 'what is the failure mode of diagnostic-without-enforcement', expected: 'c12' },
  { q: 'where should turn-end invariants live', expected: 'c13' },
  { q: 'why is hardcoded byte estimation worse than runtime measurement', expected: 'c14' },
  { q: 'when does a change require minor scope versus patch', expected: 'c15' },
  { q: 'how do we block synchronously for a file to appear in Node', expected: 'c16' },
  { q: 'why split classification into separate risk and scope signals', expected: 'c17' },
  { q: 'how does the classifier tune itself from user feedback', expected: 'c18' },
  { q: 'what is wrong with object-spreading a default config', expected: 'c19' },
  { q: 'why must mcp responses use snake case shape', expected: 'c20' },
  { q: 'how should direction tag parsing handle long and short forms', expected: 'c21' },
  { q: 'why keep specific names after generalizing', expected: 'c22' },
  { q: 'how should we group agents for parallel codebase audits', expected: 'c23' },
  { q: 'why is live retrieval query checking needed during audits', expected: 'c24' },
  { q: 'where do raw audit findings belong', expected: 'c25' },
  { q: 'how do we prevent maintainer paths from leaking to npm', expected: 'c26' },
  { q: 'why is execFile with array args safer than execSync', expected: 'c27' },
  { q: 'how do we detect post-cache tampering of agent files', expected: 'c28' },
  { q: 'why skip empty shell entries during learnings read', expected: 'c29' },
  { q: 'what entries should age-based pruning preserve', expected: 'c30' },
];

async function main(): Promise<void> {
  const docText = CORPUS.join('\n\n');
  const chunks = chunkRequirements(docText);
  const remapped = chunks.map((c, i) => ({ ...c, id: `c${i + 1}` }));
  const source = {
    id: 'learnings-corpus',
    label: 'Real-learning-shape corpus',
    chunks: remapped,
  };
  const index = buildSourceIndex(source);

  let top1 = 0;
  let top5 = 0;
  const misses: Array<{ q: string; expected: string; got: string[] }> = [];

  for (const qa of QUESTIONS) {
    const hits = retrieveTopChunks([source], qa.q, 5);
    const gotIds = hits.map((h) => h.chunk.id);
    void index.search(qa.q, 5);
    if (gotIds[0] === qa.expected) top1++;
    if (gotIds.includes(qa.expected)) top5++;
    else misses.push({ q: qa.q, expected: qa.expected, got: gotIds });
  }

  const total = QUESTIONS.length;
  const top1Pct = (top1 / total) * 100;
  const top5Pct = (top5 / total) * 100;

  console.log('\nKnit retrieval learnings benchmark (v0.15.0)');
  console.log('============================================');
  console.log(`Corpus:     ${CORPUS.length} learnings (~${Math.round(docText.length / 1024)}KB)`);
  console.log(`Questions:  ${total}`);
  console.log(`Pipeline:   BM25 + RRF (k=60) via retrieveTopChunks`);
  console.log();
  console.log(`Top-1 accuracy: ${top1}/${total} = ${top1Pct.toFixed(1)}%`);
  console.log(`Recall@5:       ${top5}/${total} = ${top5Pct.toFixed(1)}%`);
  console.log();

  if (misses.length > 0 && misses.length <= 8) {
    console.log('Misses (recall@5):');
    for (const m of misses) {
      console.log(`  q="${m.q}" expected=${m.expected} got=[${m.got.join(', ')}]`);
    }
    console.log();
  }

  console.log('--');
  console.log('Real-learnings-shape regression bench. Narrative prose is harder than');
  console.log('spec-doc text — pass threshold is intentionally 75% top-1, 90% recall@5.');

  if (top1Pct < 75) {
    console.error(`\n✗ REGRESSION: top-1 ${top1Pct.toFixed(1)}% < 75% threshold.`);
    process.exit(1);
  }
  if (top5Pct < 90) {
    console.error(`\n✗ REGRESSION: recall@5 ${top5Pct.toFixed(1)}% < 90% threshold.`);
    process.exit(1);
  }
  console.log(`\n✓ Pass — top-1 ${top1Pct.toFixed(1)}% ≥ 75%, recall@5 ${top5Pct.toFixed(1)}% ≥ 90%.`);
}

main().catch((err) => {
  console.error('Benchmark crashed:', err);
  process.exit(1);
});
