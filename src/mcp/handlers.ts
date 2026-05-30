/**
 * Individual MCP tool handlers — extracted from the giant switch for
 * testability and readability. Each function takes params + brain cache
 * and returns a JSON string response.
 */

import { writeFileSync, readFileSync, readdirSync, existsSync, renameSync, unlinkSync, appendFileSync, mkdirSync, openSync, fstatSync, closeSync, constants as fsConstants } from 'node:fs';
import { join, dirname } from 'node:path';
import type { BrainCache } from './cache.js';
import { refreshBrain } from './cache.js';
import type { TeamFinding } from '../engine/types.js';
import { scanProject, scanProjectFingerprint } from '../engine/scanner.js';
import { queryByDomains, getFalsePositives, getKBSummary, recordCacheHit, addEntry, saveKnowledgeBase, bumpMetric, bumpClassificationTier } from '../engine/knowledgebase.js';
import { statSync } from 'node:fs';
import {
  knowledgebasePath, learningsDir, teamsPath, sessionsLogPath, projectAgentsDir,
} from '../engine/paths.js';
import { appendSession, searchSessions, getRecentSessions, sessionCount, pruneSessionsByAge, loadAllSessions } from '../engine/sessions.js';
import { isStale, resolveRef, sourceExists, extractFileRefs, FRESHNESS } from '../engine/freshness.js';
import { resetAdherenceState } from './adherence.js';
import { loadPreferences, savePreferences, type ProjectPreferences } from '../engine/preferences.js';
import type { SessionSummary, SessionOutcome } from '../engine/types.js';
import { getWorkflowSection, listWorkflowSections } from '../generators/workflow-protocol.js';
import { spawnWorktree, listWorktrees, finalizeWorktree } from '../engine/worktrees.js';
import {
  appendGlobalLearning, searchGlobalLearnings, buildGlobalLearning, loadAllGlobalLearnings,
} from '../engine/global-learnings.js';
import { getAdaptiveSuggestions } from '../engine/reflect.js';
import { installAgentsForProject } from '../engine/install-agents.js';
import { redactSecrets } from './sanitize.js';
import {
  computeFeatureListing,
  summarizeActiveTools,
  isEnableableFeature,
  type ProjectShape,
  type EnableableFeature,
} from './features.js';
import { featuresConfigPath, searchMarkerPath, metricsHistoryPath, projectDataDir } from '../engine/paths.js';
import {
  getAgentCommands,
  suggestCommandsForPhase,
  summarize as summarizeAgentCommands,
} from '../engine/agent-command-scanner.js';
import { notifyToolsListChanged } from './notifier.js';
import { KNIT_INSTRUCTIONS } from './instructions.js';
// Note: tools.ts imports many handlers from this file. Importing back is a
// circular dependency, but estimateActiveToolRegistryBytes is only ever
// called at runtime (inside handleBrainStatus), not at module init, so ESM
// resolves the binding lazily and the cycle is safe.
import { estimateActiveToolRegistryBytes } from './tools.js';
import { getCachedLatestVersion, isNewerVersion } from './update-check.js';
import { VERSION } from '../version.js';
import { scanIntegrations, persistScanResult, loadScanResult } from '../engine/integration-scanner.js';
import {
  buildLearningsIndex, buildGlobalLearningsIndex, buildSessionsIndex,
  diversifyByBranch, diversifyByProject, rrfFuse, toRankedResults,
  computeNeighborhood, rankLearningsByGraph,
} from '../engine/retrieval/index.js';
import type { KBEntry, GlobalLearning } from '../engine/types.js';
import {
  buildDefaultTeams, generateTeamPrompt, loadCustomTeams, saveCustomTeams,
  startTeamBoard, getTeamBoard, markTeamWorking, postTeamFindings,
  getOtherTeamFindings, getBoardSummary,
} from '../engine/teams.js';
import {
  isValidStrictness, readProtocolConfig, writeClassificationMarker, writeClaimMarker, writeProtocolConfig,
} from '../engine/protocol-guard.js';
import { loadCalibration, parseDirection, recordClassifierFP, resetCalibration } from '../engine/calibration.js';
import { chunkRequirements, deleteSource, listSources, loadSource, MAX_CHUNKS_PER_SOURCE, retrieveTopChunks, saveSource, slugifySourceId } from '../engine/requirements.js';
import type { RequirementsSource } from '../engine/requirements.js';
import { inferDomains } from '../engine/domain-inference.js';
import { composeAutoConfiguredSections } from '../generators/auto-config.js';
import type { TaskTier, RiskTier, ScopeTier, ChangeKind } from '../engine/types.js';

/** v0.11.2 — Standard error envelope. Every handler error path should go
 *  through this so callers can pattern-match on `status === 'error'`
 *  uniformly. `extra` is for domain-specific fields callers expect on
 *  error (e.g. `results: []` for search tools so the response shape
 *  stays stable). */
export function errorResponse(error: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ status: 'error', error, ...extra });
}

// Best-effort side-effects (marker writes, pre-emptive search) used to
// silently swallow failures. v0.14.1 audit E1: log to stderr so the
// failure is debuggable while preserving the never-crash-the-handler
// contract. Sample-rate-limited via the handlers.ts module scope so a
// failing disk doesn't drown the user's terminal.
let bestEffortFailuresLogged = 0;
function logBestEffortFailure(site: string, e: unknown): void {
  if (bestEffortFailuresLogged >= 3) return;
  bestEffortFailuresLogged++;
  const msg = e instanceof Error ? e.message : String(e);
  process.stderr.write(`[knit] ${site} (best-effort) failed: ${msg}\n`);
}


export function detectDomainsFromFiles(files: string[]): Set<string> {
  const domains = new Set<string>();
  for (const file of files) {
    if (file.includes('api/') || file.includes('auth')) domains.add('API & Security');
    if (file.includes('components/') || file.includes('.tsx')) domains.add('UI');
    if (file.includes('lib/') || file.includes('utils') || file.includes('types')) domains.add('Business Logic');
    if (file.includes('db') || file.includes('email') || file.includes('middleware')) domains.add('Infrastructure');
    if (file.includes('test')) domains.add('QA');
  }
  return domains;
}

const VALID_SEVERITIES = new Set(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);


/**
 * v0.22 — honest breadcrumb for the rare case the staleness guard's throttle
 * window suppressed a re-probe: if the queried file ISN'T in the index but DOES
 * exist on disk, the index is stale, not the file empty. Surface that instead of
 * silently returning nothing (which is what pushed users back to grep). The
 * getBrain probe normally refreshes before the query, so this seldom fires.
 */
function staleIndexHint(brain: BrainCache, filePath: string): string | undefined {
  if (!filePath) return undefined;
  if (brain.knowledge.files.some((f) => f.path === filePath)) return undefined;
  try {
    if (existsSync(join(brain.rootPath, filePath))) {
      return 'NOTE: this file exists on disk but is not in the code index — the index may be stale. Call knit_refresh_index, then retry this query.';
    }
  } catch { /* path probe is best-effort */ }
  return undefined;
}

export function handleQueryImports(params: Record<string, string>, brain: BrainCache): string {
  const filePath = params.file_path;
  const importers = brain.reverseDeps[filePath] || [];
  const risk = importers.length >= 5 ? 'HIGH' : importers.length >= 3 ? 'MEDIUM' : 'LOW';
  const hint = importers.length === 0 ? staleIndexHint(brain, filePath) : undefined;
  return JSON.stringify({
    file: filePath,
    imported_by: importers,
    count: importers.length,
    risk,
    instruction: importers.length >= 3
      ? `This file has ${importers.length} dependents. Changes here will ripple. Update/test these files after editing: ${importers.slice(0, 5).join(', ')}`
      : 'Low risk — few dependents.',
    ...(hint ? { stale_index_hint: hint } : {}),
  });
}

export function handleQueryDependents(params: Record<string, string>, brain: BrainCache): string {
  const filePath = params.file_path;
  const deps = brain.knowledge.importGraph[filePath] || [];
  const hint = deps.length === 0 ? staleIndexHint(brain, filePath) : undefined;
  return JSON.stringify({ file: filePath, depends_on: deps, count: deps.length, ...(hint ? { stale_index_hint: hint } : {}) });
}

export function handleQueryExports(params: Record<string, string>, brain: BrainCache): string {
  const filePath = params.file_path;
  const exports = brain.knowledge.exports[filePath] || [];
  const hint = exports.length === 0 ? staleIndexHint(brain, filePath) : undefined;
  return JSON.stringify({
    file: filePath,
    exports: exports.map((e) => ({ name: e.name, kind: e.kind, line: e.line })),
    count: exports.length,
    ...(hint ? { stale_index_hint: hint } : {}),
  });
}

export function handleQueryTests(params: Record<string, string>, brain: BrainCache): string {
  if (params.filter === 'untested') {
    const untested = brain.knowledge.testMap.untested;
    return JSON.stringify({
      untested_files: untested,
      count: untested.length,
      instruction: untested.length > 0
        ? `${untested.length} files have no tests. Write tests for these before shipping.`
        : 'All files have test coverage.',
    });
  }
  if (params.file_path) {
    const tests = brain.knowledge.testMap.tested[params.file_path] || [];
    const hint = tests.length === 0 ? staleIndexHint(brain, params.file_path) : undefined;
    return JSON.stringify({
      file: params.file_path, tested_by: tests, has_tests: tests.length > 0,
      instruction: tests.length > 0 ? `Tested by: ${tests.join(', ')}` : 'NO TESTS. Write tests for this file before making changes.',
      ...(hint ? { stale_index_hint: hint } : {}),
    });
  }
  return JSON.stringify({
    tested_files: Object.keys(brain.knowledge.testMap.tested).length,
    untested_files: brain.knowledge.testMap.untested.length,
    test_files: brain.knowledge.testMap.testFiles.length,
  });
}

export function handleFindFanout(params: Record<string, string>, brain: BrainCache): string {
  const minImporters = parseInt(params.min_importers || '3') || 3;
  const fanout: Array<{ file: string; importers: number; imported_by: string[] }> = [];
  for (const [file, importers] of Object.entries(brain.reverseDeps)) {
    if (importers.length >= minImporters) {
      fanout.push({ file, importers: importers.length, imported_by: importers });
    }
  }
  fanout.sort((a, b) => b.importers - a.importers);
  return JSON.stringify({ high_fanout_files: fanout, count: fanout.length });
}

/** v0.9 — write a per-turn marker that the PreToolUse gate reads to enforce
 *  the "search before Edit" discipline on standard/complex tasks. Best-effort:
 *  failure to write doesn't block the search itself. Cleared on the next
 *  UserPromptSubmit hook (turn boundary). */
function writeSearchMarker(rootPath: string): void {
  try {
    writeFileSync(searchMarkerPath(rootPath), new Date().toISOString(), 'utf-8');
  } catch {
    // best-effort; if the marker can't be written, the agent will see the
    // PreToolUse warning but the search itself already succeeded
  }
}

/** v0.8 — BM25 + import-graph retrieval for knit_search_learnings.
 *
 *  Two parameters now drive the search:
 *    - `query` (NEW, optional): free-text BM25 search over summary + lesson +
 *      approach + tags + domains. Returns the top-K entries by relevance.
 *    - `domains` (existing, optional): comma-separated tag filter. Pre-v0.8
 *      this was the only mode; still works as the back-compat path.
 *
 *  Combination semantics:
 *    - query only           → BM25 ranked list
 *    - domains only         → tag filter (back-compat path)
 *    - query + domains      → BM25 filtered to entries with ≥1 matching tag
 *    - neither              → error
 *
 *  RRF wiring: BM25 is currently the only retriever; the rrfFuse plumbing
 *  is in place so phase 3 can layer the import-graph traversal retriever in
 *  without changing the handler shape. */
export function handleSearchLearnings(params: Record<string, string>, brain: BrainCache): string {
  const domains = (params.domains || '').split(',').map((d) => d.trim()).filter(Boolean);
  const query = (params.query || '').trim();
  const limit = Math.max(1, Math.min(50, parseInt(params.limit || '10', 10) || 10));

  if (!query && domains.length === 0) {
    return JSON.stringify({
      status: 'error',
      error: 'Provide either query (BM25 free-text) or domains (tag filter), or both. query=auth domains=#api filters BM25 results to entries tagged #api.',
      results: [], count: 0,
    });
  }

  // No query — fall back to the pure tag-filter path (back-compat with
  // pre-v0.8 callers that only ever used domains).
  if (!query) {
    const results = queryByDomains(brain.knowledgeBase, domains);
    if (results.length > 0) recordCacheHit(brain.knowledgeBase);
    writeSearchMarker(brain.rootPath);
    // queryByDomains mutates accessCount + lastAccessed in-memory; persist
    // so the brain_status accessed_pct metric reflects actual retrieval.
    // Without this, mutations are discarded on session end (root cause of
    // pre-v0.12.1 "0% recall" reporting).
    saveKnowledgeBase(knowledgebasePath(brain.rootPath), brain.knowledgeBase);
    return JSON.stringify(buildLearningsResponse(results, domains, [], undefined, brain.rootPath));
  }

  // BM25 path. Build the index over the current corpus on demand —
  // typical project has <100 entries, build cost is <10ms.
  const index = buildLearningsIndex(brain.knowledgeBase.entries);
  const bm25Hits = index.search(query, Math.min(limit * 3, 50));

  // v0.10 slice 3 — retrieval counters. Top-result score > 5.0 (empirical
  // BM25 relevance threshold for Knit-shaped corpora) signals a probably-
  // relevant hit. Used to compute retrieval_high_score_rate_pct.
  bumpMetric(brain.knowledgeBase, 'totalRetrievalQueries');
  if (bm25Hits.length > 0 && bm25Hits[0].score > 5.0) {
    bumpMetric(brain.knowledgeBase, 'highScoreHits');
  }

  // Graph-traversal retriever (v0.8.1). When the agent passes `files`
  // it's editing, walk the import graph one hop and rank learnings that
  // mention graph-neighbor files. This catches the case where lexical
  // search misses ("When session.ts changes, re-run integration tests"
  // doesn't match "validate tokens" but IS relevant when editing auth.ts).
  const affectedFiles = (params.files || '').split(',').map((f) => f.trim()).filter(Boolean);
  let graphHits: ReturnType<typeof rankLearningsByGraph> = [];
  if (affectedFiles.length > 0) {
    const neighborhood = computeNeighborhood(
      affectedFiles,
      brain.knowledge.importGraph ?? {},
      brain.reverseDeps ?? {},
    );
    graphHits = rankLearningsByGraph(brain.knowledgeBase.entries, neighborhood);
    if (graphHits.length > 0) bumpMetric(brain.knowledgeBase, 'graphQueries');
  }

  // RRF fuses BM25 (lexical) with graph-traversal (structural) without
  // needing comparable scores. k=60 from Cormack et al. 2009.
  const rankings = [toRankedResults(bm25Hits)];
  if (graphHits.length > 0) rankings.push(toRankedResults(graphHits));
  const fused = rrfFuse(rankings, { k: 60 });

  // Map back to KBEntry, then optionally filter by domain tag.
  const entryById = new Map<string, KBEntry>();
  for (const e of brain.knowledgeBase.entries) entryById.set(e.id, e);

  let entries: KBEntry[] = [];
  for (const f of fused) {
    const entry = entryById.get(f.id);
    if (!entry) continue;
    entries.push(entry);
  }

  if (domains.length > 0) {
    entries = entries.filter((e) =>
      e.tags.some((t) => domains.includes(t)) || e.domains.some((d) => domains.includes(d)),
    );
  }

  entries = entries.slice(0, limit);
  // v0.10 slice 3 — bump fp_suppressions per FP-tagged entry surfaced.
  // Each surfaced FP is a saved investigation: agents are instructed to
  // skip false-positives, so seeing one in results == avoiding a re-chase.
  const fpInResults = entries.filter((e) => e.tags.includes('#false-positive')).length;
  if (fpInResults > 0) bumpMetric(brain.knowledgeBase, 'fpSuppressions', fpInResults);
  if (entries.length > 0) recordCacheHit(brain.knowledgeBase);
  writeSearchMarker(brain.rootPath);
  // v0.12.1 — the BM25/RRF path returns entries directly from the index
  // without touching accessCount. Bump it here so per-entry recall is
  // visible in brain_status (matches queryByDomains behavior).
  const nowIso = new Date().toISOString();
  for (const entry of entries) {
    entry.accessCount = (entry.accessCount ?? 0) + 1;
    entry.lastAccessed = nowIso;
  }
  // Persist accessCount + bumped metrics; otherwise both are discarded on
  // session end (root cause of pre-v0.12.1 "0% recall" reporting).
  saveKnowledgeBase(knowledgebasePath(brain.rootPath), brain.knowledgeBase);
  const retrieverLabel: 'bm25' | 'bm25+graph' = graphHits.length > 0 ? 'bm25+graph' : 'bm25';
  return JSON.stringify(buildLearningsResponse(entries, domains, [query], retrieverLabel, brain.rootPath));
}

/** Shared response shape between the BM25 path and the tag-filter back-compat path. */
function buildLearningsResponse(
  results: KBEntry[],
  domains: string[],
  freeText: string[],
  retrieverOverride?: 'bm25' | 'bm25+graph',
  rootPath?: string,
) {
  const hasFailures = results.some((r) => r.outcome === 'failure');
  const queryParts = [...freeText, ...domains];
  return {
    query: queryParts,
    retriever: retrieverOverride ?? (freeText.length > 0 ? 'bm25' : 'tag-filter'),
    results: results.map((r) => {
      // v0.17 freshness layer — annotate (never re-rank) learnings whose prose
      // names a source file that no longer exists. Bench-safe: order/score/
      // count are untouched; the agent just sees that the lesson may be stale.
      const staleRefs = rootPath
        ? extractFileRefs(`${r.summary} ${r.lesson}`).filter((ref) => !sourceExists(rootPath, ref))
        : [];
      // v0.22 token-opt — TRUE hierarchical retrieval. Search returns the
      // headline + id + a short preview; the full multi-paragraph lesson is
      // paid for on demand via knit_get_learning({id}). Pre-v0.22 every search
      // dumped all full lessons (the exact anti-pattern Knit's own docs warn
      // against) — 10 hits could cost ~15KB; headlines+preview cut that ~10x.
      return {
        id: r.id,
        summary: r.summary,
        lesson_preview: lessonPreview(r.lesson),
        outcome: r.outcome,
        date: r.date, tags: r.tags, access_count: r.accessCount,
        ...(staleRefs.length > 0 ? { stale_refs: staleRefs } : {}),
      };
    }),
    count: results.length,
    instruction: results.length > 0
      ? hasFailures
        ? `Found ${results.length} past learnings including FAILURES (headlines only). Call knit_get_learning({id}) for the full lesson of any relevant one before re-investigating — avoid repeating past mistakes.`
        : `Found ${results.length} past learnings (headlines only). Call knit_get_learning({id}) for the full lesson of any that look relevant.`
      : freeText.length > 0
        ? 'No past learnings match this query. Try broader terms, or call knit_search_global_learnings to search across all your projects.'
        : 'No past learnings for these domains. This is new territory — be thorough and record what you learn.',
  };
}

/** Headline-length lesson preview for hierarchical retrieval — first sentence
 *  or 160 chars, whichever is shorter. Full lesson via knit_get_learning. */
function lessonPreview(lesson: string): string {
  const flat = (lesson || '').replace(/\s+/g, ' ').trim();
  if (flat.length <= 160) return flat;
  const cut = flat.slice(0, 160);
  const lastStop = cut.lastIndexOf('. ');
  return (lastStop > 60 ? cut.slice(0, lastStop + 1) : cut.trimEnd()) + ' …';
}

export function handleGetFalsePositives(_params: Record<string, string>, brain: BrainCache): string {
  const fps = getFalsePositives(brain.knowledgeBase);
  return JSON.stringify({
    false_positives: fps.map((fp) => ({ summary: fp.summary, lesson: fp.lesson, date: fp.date })),
    count: fps.length,
    instruction: 'Include these in review agent prompts as DO NOT FLAG items.',
  });
}

/** v0.7 token-budget targets — the discipline made measurable. These are the
 *  per-surface ceilings declared in V0.7-PLAN.md. knit_brain_status compares
 *  the live numbers against these so drift becomes visible, not vibes-based.
 *
 *  Targets are calibrated to what v0.7 actually delivers on a typical project,
 *  with modest headroom. Drift past the target → "warn"; past 25% → "over-budget".
 *  These numbers are the ship promise: if they regress, the guardrail catches it. */
const TOKEN_BUDGETS = {
  /** Generated CLAUDE.md block. v0.7 trim landed at ~2KB on typical projects;
   *  6.5KB target allows for projects with many domains / large project map. */
  claude_md_bytes: 6500,
  /** Tier-gated tools/list response. v0.12.1 measured: 40 active first-session
   *  (34 Tier-1 + 6 auto-exposed setup diagnostics) ≈ 15.5KB; 34 active
   *  post-onboarding ≈ 13.7KB; 53 active fully-enabled ≈ 19.7KB. Real avg is
   *  ~387 bytes/tool (not the 280 the pre-v0.12.1 estimator assumed — that's
   *  why budget verdicts looked healthier than they actually were). 14KB
   *  target → 17.5KB slack covers first-session honestly; full opt-in
   *  correctly flags as over-budget. v0.13 architecture work targets <12KB
   *  via tool description trimming. */
  tool_registry_bytes: 14000,
  /** MCP server `instructions` field — sent at handshake. v0.11.1 surfaces
   *  9 new tools (verify_claim, calibration, requirements ingestion,
   *  fingerprint, infer_domains, compose_template) → ~3.5KB. v0.12 may
   *  append a one-line budget verdict (~200B) when CLAUDE.md is over
   *  budget. The discoverability-vs-budget trade-off favors surfacing
   *  real tools. */
  instructions_bytes: 4000,
  /** Sum of the three above — the per-session fixed cost Knit imposes.
   *  v0.12.1 typical (honest measurement): ~19KB on first session
   *  (CLAUDE.md ~2KB + tools ~15.5KB + instructions ~3.4KB); ~17KB
   *  post-onboarding. 24KB target → 30KB slack covers the honest first-
   *  session reality. v0.13 trim work targets <20KB. */
  per_session_overhead_bytes: 24000,
} as const;

function verdict(actual: number, target: number): 'healthy' | 'warn' | 'over-budget' {
  if (actual <= target) return 'healthy';
  if (actual <= target * 1.25) return 'warn';
  return 'over-budget';
}

/** Rough char-to-token ratio. Real tokenization is BPE and varies by content
 *  (~3.5–4.5 chars/token for English+code). 4 is the conventional shorthand. */
const CHARS_PER_TOKEN = 4;

export function handleBrainStatus(_params: Record<string, string>, brain: BrainCache): string {
  const summary = getKBSummary(brain.knowledgeBase);

  // CLAUDE.md byte cost — the per-turn context tax.
  const claudeMdBytes = (() => {
    try { return statSync(join(brain.rootPath, 'CLAUDE.md')).size; }
    catch { return 0; }
  })();

  // Tool-registry byte cost — v0.12.1 computes the exact serialized byte
  // length of the active ToolDef array via tools.ts. Pre-v0.12.1 used a
  // hardcoded 280-byte-per-tool average that understated real defs (~370
  // average) and silently masked an over-budget condition. The estimator
  // function lives in tools.ts to avoid duplicating tool descriptions here;
  // see import note at the top of this file re: the circular dep.
  const shape = detectProjectShape(brain);
  const listing = computeFeatureListing(shape);
  const activeToolCount = listing.totals.active;
  const totalToolCount = listing.totals.total;
  const toolRegistryBytes = estimateActiveToolRegistryBytes(shape);

  // MCP server instructions — same string the Server constructor surfaces at handshake.
  const instructionsBytes = KNIT_INSTRUCTIONS.length;

  const perSessionOverheadBytes = claudeMdBytes + toolRegistryBytes + instructionsBytes;

  const totalSessions = sessionCount(brain.rootPath);
  const hitRate = summary.totalEntries > 0
    ? Math.round((summary.accessedEntries / summary.totalEntries) * 100)
    : 0;

  const budgets = {
    claude_md: {
      bytes: claudeMdBytes,
      kb: Math.round(claudeMdBytes / 1024 * 10) / 10,
      target_bytes: TOKEN_BUDGETS.claude_md_bytes,
      verdict: verdict(claudeMdBytes, TOKEN_BUDGETS.claude_md_bytes),
    },
    tool_registry: {
      active_tool_count: activeToolCount,
      total_tool_count: totalToolCount,
      bytes: toolRegistryBytes,
      target_bytes: TOKEN_BUDGETS.tool_registry_bytes,
      verdict: verdict(toolRegistryBytes, TOKEN_BUDGETS.tool_registry_bytes),
    },
    instructions: {
      bytes: instructionsBytes,
      target_bytes: TOKEN_BUDGETS.instructions_bytes,
      verdict: verdict(instructionsBytes, TOKEN_BUDGETS.instructions_bytes),
    },
    per_session_overhead: {
      bytes: perSessionOverheadBytes,
      kb: Math.round(perSessionOverheadBytes / 1024 * 10) / 10,
      tokens_estimate: Math.round(perSessionOverheadBytes / CHARS_PER_TOKEN),
      target_bytes: TOKEN_BUDGETS.per_session_overhead_bytes,
      verdict: verdict(perSessionOverheadBytes, TOKEN_BUDGETS.per_session_overhead_bytes),
    },
  };

  // Overall verdict — worst-of-four. "warn" if any single surface is warning,
  // "over-budget" if any is over.
  const verdicts = [budgets.claude_md.verdict, budgets.tool_registry.verdict, budgets.instructions.verdict, budgets.per_session_overhead.verdict];
  const overall: 'healthy' | 'warn' | 'over-budget' =
    verdicts.includes('over-budget') ? 'over-budget'
    : verdicts.includes('warn') ? 'warn'
    : 'healthy';

  // Compounding-memory signal — the value side of the ledger. The higher the
  // hit rate and the more sessions accumulated, the more Knit is paying back
  // the per-session overhead by preventing re-investigations.
  const compounding = {
    session_count: totalSessions,
    total_learnings: summary.totalEntries,
    learnings_hit_rate_pct: hitRate,
    note: totalSessions === 0
      ? 'Fresh brain — no sessions yet. Compounding kicks in around session 3.'
      : hitRate >= 30
        ? 'Strong compounding — learnings are getting reused across sessions.'
        : hitRate < 20 && summary.totalEntries > 10
          ? 'Low hit rate — many learnings unused. Consider pruning stale entries.'
          : 'Compounding building up.',
  };

  return JSON.stringify({
    ...summary,
    knowledge_index: (() => {
      // v0.22 — surface index FRESHNESS, not just size. verify_claim/query_*
      // tell agents to "check index freshness" but there was no way to see it.
      const builtAtMs = Date.parse(brain.knowledge.generatedAt);
      const ageMinutes = Number.isFinite(builtAtMs)
        ? Math.max(0, Math.round((Date.now() - builtAtMs) / 60000))
        : null;
      return {
        files_indexed: brain.knowledge.summary.totalFiles,
        total_lines: brain.knowledge.summary.totalLines,
        import_edges: Object.keys(brain.knowledge.importGraph).length,
        exports_mapped: Object.keys(brain.knowledge.exports).length,
        generated_at: brain.knowledge.generatedAt,
        age_minutes: ageMinutes,
        // getBrain auto-refreshes on source drift (v0.22+), so the index is
        // normally current. The honest fallback if a query still looks stale:
        freshness_note: 'Index auto-refreshes on source-tree drift. If a query/verify result looks stale, call knit_refresh_index.',
      };
    })(),
    // Back-compat: the flat token_accounting shape from pre-v0.7.2 is kept so
    // anything that hard-coded those field names still works.
    token_accounting: {
      claude_md_bytes: claudeMdBytes,
      claude_md_kb: budgets.claude_md.kb,
      session_count: totalSessions,
      learnings_hit_rate_pct: hitRate,
      note: budgets.per_session_overhead.verdict === 'over-budget'
        ? 'Per-session overhead exceeds budget — see token_budget for the offending surface.'
        : compounding.note,
    },
    // v0.7.2 — structured per-surface budget with target ceilings + verdicts.
    token_budget: {
      budgets,
      overall_verdict: overall,
      compounding,
    },
    cache_age_ms: Date.now() - brain.loadedAt,
    ...(() => {
      // Update notification — best-effort. Surfaces only when the cached
      // npm dist-tag `latest` is strictly newer than the installed VERSION.
      // Pre-warm happens at brain load; this read is sync.
      const latest = getCachedLatestVersion();
      if (!latest || !isNewerVersion(latest, VERSION)) return {};
      return {
        update_available: {
          current: VERSION,
          latest,
          upgrade: 'Restart your MCP host (Claude Code / Cursor / Codex / Cline / Continue / VS Code) to spawn a fresh MCP — npx will auto-fetch the new version. If your MCP config pins a specific version, change it to "knit-mcp@latest".',
          changelog: 'https://github.com/PDgit12/knit/blob/main/CHANGELOG.md',
        },
      };
    })(),
    ...(() => {
      // Surface detected integrations (Ruflo, gstack, CodeTour, etc.) — best-effort
      // read from ~/.knit/projects/<hash>/integrations.json. Null if no scan
      // has run yet. v0.7.2 surfaces; v0.8 will tailor server instructions
      // per-project based on what's detected.
      const integrations = loadScanResult(brain.rootPath);
      if (!integrations) return {};
      return {
        integrations: {
          scanned_at: integrations.scannedAt,
          detected: integrations.detected,
          summary: integrations.summary,
        },
      };
    })(),
    ...(() => {
      // v0.11 — calibration snapshot. Best-effort: never let a malformed
      // calibration file break status.
      try {
        const cal = loadCalibration(brain.rootPath);
        const pendingFp = Object.values(cal.fpDirections || {}).reduce<number>(
          (acc, v) => acc + (typeof v === 'number' ? v : 0),
          0,
        );
        return {
          calibration: {
            scope_adjust: cal.scopeAdjust ?? 0,
            risk_adjust: cal.riskAdjust ?? 0,
            pending_fp_count: pendingFp,
          },
        };
      } catch {
        return { calibration: { scope_adjust: 0, risk_adjust: 0, pending_fp_count: 0 } };
      }
    })(),
    ...(() => {
      // v0.11 — requirements index snapshot.
      try {
        const sources = listSources(brain.rootPath);
        const totalChunks = sources.reduce((acc, s) => acc + (s.chunkCount ?? 0), 0);
        return {
          requirements: {
            source_count: sources.length,
            total_chunks: totalChunks,
          },
        };
      } catch {
        return { requirements: { source_count: 0, total_chunks: 0 } };
      }
    })(),
    ...(() => {
      // v0.11 — project fingerprint (slim).
      try {
        const fp = scanProjectFingerprint(brain.rootPath);
        return {
          fingerprint: {
            languages: fp.languages ?? [],
            framework: fp.framework ?? null,
            test_runner: fp.testRunner ?? null,
          },
        };
      } catch {
        return { fingerprint: { languages: [], framework: null, test_runner: null } };
      }
    })(),
    instruction: 'Brain is ready. Next: call knit_classify_task with the files you plan to touch to get your tier and phases. Call knit_get_calibration / knit_list_requirements / knit_get_fingerprint for details.',
  });
}

/** Read the opt-in feature flags from disk. Best-effort: never throws — a
 *  missing or malformed file just means "no opt-ins yet." */
export function loadEnabledFeatures(rootPath: string): Set<EnableableFeature> {
  const enabled = new Set<EnableableFeature>();
  try {
    const path = featuresConfigPath(rootPath);
    if (!existsSync(path)) return enabled;
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as { enabled?: string[] };
    if (Array.isArray(parsed?.enabled)) {
      for (const name of parsed.enabled) {
        if (isEnableableFeature(name)) enabled.add(name);
      }
    }
  } catch {
    // best-effort: never let a malformed features.json break the brain.
  }
  return enabled;
}

function saveEnabledFeatures(rootPath: string, enabled: Set<EnableableFeature>): void {
  const path = featuresConfigPath(rootPath);
  const payload = {
    enabled: [...enabled].sort(),
    updatedAt: new Date().toISOString(),
  };
  // Atomic write: stage to a sibling temp file, then rename onto the target.
  // POSIX rename is atomic within a filesystem, so a mid-write crash cannot
  // leave features.json in a half-written state — readers either see the
  // prior committed payload or the new one, never a torn write.
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf-8');
    renameSync(tmpPath, path);
  } catch (err) {
    // Best-effort cleanup if the temp file landed but the rename failed.
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}

/** Build the ProjectShape signal for this project. Used by tier-gating in
 *  computeFeatureListing and getToolDefinitions. knit_list_features surfaces
 *  the same signals so the agent can explain why a tool is hidden. */
export function detectProjectShape(brain: BrainCache): ProjectShape {
  return {
    hasAnalyzableCode: brain.knowledge.summary.totalFiles >= 10,
    domainCount: brain.config?.domains?.length ?? 0,
    hasInstalledSubagents: existsSync(projectAgentsDir(brain.rootPath)),
    sessionCount: sessionCount(brain.rootPath),
    enabledFeatures: loadEnabledFeatures(brain.rootPath),
  };
}

/** knit_list_features — the discoverability escape hatch.
 *  Returns the active/available split for this project plus a per-category
 *  breakdown. Tier-2 tools auto-activate when the project shape matches; Tier-3
 *  is strictly opt-in via knit_enable_feature. */
export function handleListFeatures(_params: Record<string, string>, brain: BrainCache): string {
  const shape = detectProjectShape(brain);
  const listing = computeFeatureListing(shape);
  return JSON.stringify({
    summary: summarizeActiveTools(shape),
    ...listing,
    project_shape: {
      has_analyzable_code: shape.hasAnalyzableCode,
      domain_count: shape.domainCount,
      has_installed_subagents: shape.hasInstalledSubagents,
      session_count: shape.sessionCount,
      enabled_features: [...shape.enabledFeatures],
    },
    instruction: 'If a tool you want is in `available` rather than `active`, the `enable_via` field tells you how to switch it on. Most commonly: knit_enable_feature({ feature: "teams" | "subagents" | "admin" }).',
  });
}

/** knit_enable_feature — flip on a Tier-2/3 feature flag. Persists to
 *  features.json so the next session sees the change too. */
export function handleEnableFeature(params: Record<string, string>, brain: BrainCache): string {
  const feature = (params.feature || '').trim().toLowerCase();
  if (!isEnableableFeature(feature)) {
    return JSON.stringify({
      status: 'error',
      error: `Invalid feature: "${params.feature}". Valid values: teams, subagents, admin.`,
    });
  }
  const enabled = loadEnabledFeatures(brain.rootPath);
  const wasAlreadyOn = enabled.has(feature);
  enabled.add(feature);
  if (!wasAlreadyOn) {
    saveEnabledFeatures(brain.rootPath, enabled);
    // Tell the MCP client the active tool surface just expanded.
    // Client re-fetches tools/list and sees the newly-enabled tools
    // appear in this same session, without requiring a Claude Code restart.
    notifyToolsListChanged();
  }
  return JSON.stringify({
    status: wasAlreadyOn ? 'already-enabled' : 'enabled',
    feature,
    enabled_features: [...enabled].sort(),
    instruction: wasAlreadyOn
      ? 'Already enabled. Call knit_list_features to see the active tool list.'
      : 'Tools list updated for this session. The newly-enabled tools should be available immediately — call knit_list_features to confirm.',
  });
}

/** v0.9 #10 — knit_consolidate_learnings.
 *
 *  Detects clusters of similar learnings and proposes a single consolidated
 *  pattern entry. Two signals: heavy tag overlap (Jaccard ≥ 0.5) AND high
 *  token overlap in summary+lesson (BM25 self-similarity). When a cluster
 *  forms, the handler:
 *    - Generates a pattern entry summarizing the cluster
 *    - Tags the originals with #consolidated (preserved for history)
 *    - Returns the cluster + the proposed pattern; agent applies via
 *      knit_record_learning if it confirms
 *
 *  Dry-run by default (no writes). Pass commit=true to persist. Safe because
 *  knowledgebase mutations can corrupt the access-count history if a bad
 *  consolidation runs unattended. */
export function handleConsolidateLearnings(params: Record<string, string>, brain: BrainCache): string {
  const minClusterSize = Math.max(2, Math.min(20, parseInt(params.min_cluster_size || '3', 10) || 3));
  const jaccardThreshold = parseFloat(params.jaccard_threshold || '0.5') || 0.5;
  const commit = params.commit === 'true' || params.commit === '1';

  const entries = brain.knowledgeBase.entries.filter((e) => !e.tags.includes('#consolidated'));
  if (entries.length < minClusterSize) {
    return JSON.stringify({
      status: 'no-op',
      reason: `Need at least ${minClusterSize} non-consolidated learnings; found ${entries.length}.`,
      clusters: [],
    });
  }

  // Build a tag-set per entry for Jaccard comparison.
  const tagSets: Map<string, Set<string>> = new Map();
  for (const e of entries) {
    tagSets.set(e.id, new Set([...e.tags, ...e.domains.map((d) => `#${d.toLowerCase()}`)]));
  }

  // Greedy clustering: for each unclustered entry, find others with high
  // tag overlap. Seed = entry with the most accesses (likely the canonical
  // version of the pattern). O(N^2) is fine at Knit's typical entry count.
  const clustered = new Set<string>();
  const clusters: Array<{ seed: KBEntry; members: KBEntry[] }> = [];

  const sortedByAccess = [...entries].sort((a, b) => b.accessCount - a.accessCount);
  for (const seed of sortedByAccess) {
    if (clustered.has(seed.id)) continue;
    const seedTags = tagSets.get(seed.id)!;
    const members: KBEntry[] = [seed];
    for (const candidate of entries) {
      if (candidate.id === seed.id || clustered.has(candidate.id)) continue;
      const candTags = tagSets.get(candidate.id)!;
      const intersection = [...seedTags].filter((t) => candTags.has(t)).length;
      const union = new Set([...seedTags, ...candTags]).size;
      const jaccard = union === 0 ? 0 : intersection / union;
      if (jaccard >= jaccardThreshold) {
        members.push(candidate);
      }
    }
    if (members.length >= minClusterSize) {
      for (const m of members) clustered.add(m.id);
      clusters.push({ seed, members });
    }
  }

  if (clusters.length === 0) {
    return JSON.stringify({
      status: 'no-op',
      reason: `No clusters of ≥${minClusterSize} entries with Jaccard ≥ ${jaccardThreshold}. Either the corpus is heterogeneous or thresholds are too strict.`,
      clusters: [],
    });
  }

  // For each cluster, propose a consolidated pattern. The pattern summary is
  // a digest of the seed; the lesson concatenates the unique lessons. Tags
  // are the union of all member tags PLUS #pattern.
  const proposals = clusters.map((c) => {
    const allTags = new Set<string>();
    for (const m of c.members) for (const t of m.tags) allTags.add(t);
    allTags.add('#pattern');
    const allDomains = new Set<string>();
    for (const m of c.members) for (const d of m.domains) allDomains.add(d);
    return {
      cluster_size: c.members.length,
      seed_id: c.seed.id,
      member_ids: c.members.map((m) => m.id),
      proposed_pattern: {
        summary: `[Pattern] ${c.seed.summary} (consolidates ${c.members.length} similar learnings)`,
        domains: [...allDomains],
        approach: c.seed.approach,
        outcome: c.seed.outcome,
        lesson: c.members.map((m) => `- ${m.summary}: ${m.lesson}`).join('\n'),
        tags: [...allTags].sort(),
      },
    };
  });

  // If commit=true, mark originals as #consolidated and emit a new pattern
  // entry per cluster. Otherwise it's a dry-run report — agent reviews,
  // edits if needed, and calls knit_record_learning manually.
  let committed = 0;
  if (commit) {
    const today = new Date().toISOString().split('T')[0];
    for (const proposal of proposals) {
      // Mark originals
      for (const memberId of proposal.member_ids) {
        const entry = brain.knowledgeBase.entries.find((e) => e.id === memberId);
        if (entry && !entry.tags.includes('#consolidated')) {
          entry.tags.push('#consolidated');
        }
      }
      // Record the new pattern entry
      addEntry(brain.knowledgeBase, {
        date: today,
        summary: proposal.proposed_pattern.summary,
        domains: proposal.proposed_pattern.domains,
        approach: proposal.proposed_pattern.approach,
        outcome: proposal.proposed_pattern.outcome,
        lesson: proposal.proposed_pattern.lesson,
        tags: proposal.proposed_pattern.tags,
      });
      committed++;
    }
    saveKnowledgeBase(knowledgebasePath(brain.rootPath), brain.knowledgeBase);
  }

  return JSON.stringify({
    status: commit ? 'committed' : 'dry-run',
    clusters_found: clusters.length,
    entries_clustered: [...clustered].length,
    committed,
    proposals,
    instruction: commit
      ? `Consolidated ${committed} clusters. Originals tagged #consolidated and deprioritized in future retrieval; the new pattern entries surface in their place.`
      : 'Dry run — no changes written. Call again with commit=true to apply, or edit a proposal manually via knit_record_learning then mark originals via #consolidated tag.',
  });
}

/** v0.9 — knit_verify_claim.
 *
 *  Single-call fact-check against the knowledge graph. The agent passes a
 *  claim string ("src/auth.ts imports src/types.ts"); the verifier parses
 *  the structure, looks up the relevant graph table, and returns a verdict.
 *
 *  Supported claim patterns:
 *    - "A imports B" / "A depends on B" → check importGraph[A] includes B
 *    - "A is imported by B" / "B uses A" → check reverseDeps[A] includes B
 *    - "X exports Y" / "Y is exported from X" → check exports[X] has Y
 *    - "A is tested by B" / "B tests A" → check testMap.tested[A] includes B
 *    - "X exists" / "X is in the codebase" → check X is in files
 *
 *  Verdict shapes:
 *    - "verified" — claim matches the graph
 *    - "contradicted" — claim is structurally parseable but the graph
 *      disagrees (the named edge does not exist)
 *    - "unparseable" — claim doesn't match any known pattern; agent should
 *      reformulate or use a more specific query tool
 *
 *  This is the on-demand companion to the v0.7 query tools. Those answer
 *  "what does X import?"; this one answers "is A's claim that X imports Y
 *  actually true?". */
export function handleVerifyClaim(params: Record<string, string>, brain: BrainCache): string {
  const claim = (params.claim || '').trim();
  if (!claim) {
    return JSON.stringify({ verdict: 'unparseable', error: 'claim parameter is required' });
  }
  const result = parseAndVerifyClaim(claim, brain);
  // v0.11 slice 1 — claim verification marker. Stop hook reads this to
  // enforce the "verify ≥1 claim before LEARN" gate on standard/complex
  // scope tasks. Best-effort: marker IO failure never breaks verification.
  try {
    writeClaimMarker(brain.rootPath);
  } catch {
    // best-effort
  }

  // v0.22 — never hand back a CONFIDENT contradiction that's really a
  // stale-index artifact. If the claim's subject file was modified AFTER the
  // index was built (its on-disk mtime is newer than knowledge.generatedAt),
  // the index can't be trusted to refute it. This is the exact failure that
  // misled real sessions: verify said a freshly-added export was "contradicted"
  // because the index predated the edit (probeSourceTree; feedback.ts:67).
  //
  // Rather than tell the agent to "refresh and retry", SELF-HEAL: rebuild the
  // index and re-verify against fresh data, so the caller gets ground truth in
  // one call. Bounded — only fires when staleness is actually detected, which
  // is rare because getBrain already auto-refreshes per call (this covers the
  // sub-throttle-window edge). If the rebuild itself fails, fall back to an
  // honest stale_index verdict instead of a false contradiction.
  if (result.verdict === 'contradicted' && result.parsed?.subject && isSourceFilePath(result.parsed.subject)
      && fileNewerThanIndex(brain, result.parsed.subject)) {
    try {
      const fresh = refreshBrain(brain.rootPath);
      const reverified = parseAndVerifyClaim(claim, fresh);
      return JSON.stringify({
        claim,
        ...reverified,
        index_refreshed: true,
        note: 'The code index was behind this file (modified after the last build); auto-refreshed and re-verified — this verdict is against current source.',
      });
    } catch {
      return JSON.stringify({
        claim,
        verdict: 'stale_index',
        parsed: result.parsed,
        evidence: result.evidence,
        stale_index_hint:
          'The code index predates a recent change to this file and an auto-refresh failed, so this contradiction is not trustworthy.',
        instruction:
          'UNVERIFIABLE (stale index). Do NOT trust this contradiction. Call knit_refresh_index and retry, or confirm directly (grep/read).',
      });
    }
  }
  return JSON.stringify({ claim, ...result });
}

/** True if a path looks like an indexable source file. */
function isSourceFilePath(p: string): boolean {
  return /\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs)$/.test(p);
}

/**
 * True if `file` exists on disk and was modified after the index was built —
 * i.e. the index is too old to be trusted about this file. Best-effort: any IO
 * error or an unparseable build timestamp returns false (don't mask real
 * contradictions on a benign error).
 */
function fileNewerThanIndex(brain: BrainCache, file: string): boolean {
  try {
    const abs = join(brain.rootPath, file);
    if (!existsSync(abs)) return false;
    const builtAtMs = Date.parse(brain.knowledge.generatedAt);
    if (!Number.isFinite(builtAtMs)) return false;
    return statSync(abs).mtimeMs > builtAtMs;
  } catch {
    return false;
  }
}

interface VerifierResult {
  verdict: 'verified' | 'contradicted' | 'unparseable' | 'stale_index';
  parsed?: { type: string; subject: string; object?: string };
  evidence?: string;
  instruction: string;
}

function parseAndVerifyClaim(claim: string, brain: BrainCache): VerifierResult {
  const kn = brain.knowledge;

  // Pattern: "A imports B" / "A depends on B" / "A includes B"
  const importMatch = claim.match(/['"`]?([\w./_-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs))['"`]?\s+(?:imports|depends on|requires|uses)\s+['"`]?([\w./_-]+(?:\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs))?)['"`]?/i);
  if (importMatch) {
    const from = importMatch[1];
    const to = importMatch[2];
    const imports = kn.importGraph[from];
    if (!imports) {
      return {
        verdict: 'contradicted',
        parsed: { type: 'import', subject: from, object: to },
        evidence: `No entry for ${from} in importGraph — either the file doesn't exist or has no imports indexed.`,
        instruction: `Run knit_query_imports({file_path: "${from}"}) to inspect, or knit_brain_status to verify index freshness.`,
      };
    }
    const found = imports.some((dep) => dep === to || dep.endsWith(`/${to}`) || dep === to.replace(/\.(?:ts|tsx|js|jsx)$/, ''));
    return {
      verdict: found ? 'verified' : 'contradicted',
      parsed: { type: 'import', subject: from, object: to },
      evidence: found
        ? `importGraph[${from}] contains ${to}.`
        : `importGraph[${from}] = [${imports.slice(0, 5).join(', ')}${imports.length > 5 ? ', ...' : ''}]. ${to} not present.`,
      instruction: found
        ? 'Verified. Safe to assert.'
        : `Contradicted. The codebase does not have ${from} → ${to}. Re-check via knit_query_dependents.`,
    };
  }

  // Pattern: "X exports Y" / "Y is exported from X"
  const exportMatch =
    claim.match(/['"`]?([\w./_-]+\.(?:ts|tsx|js|jsx))['"`]?\s+exports\s+['"`]?(\w+)['"`]?/i) ||
    claim.match(/['"`]?(\w+)['"`]?\s+is\s+exported\s+from\s+['"`]?([\w./_-]+\.(?:ts|tsx|js|jsx))['"`]?/i);
  if (exportMatch) {
    // Determine which group is the file vs the symbol based on extension.
    const a = exportMatch[1];
    const b = exportMatch[2];
    const file = /\.(ts|tsx|js|jsx)$/.test(a) ? a : b;
    const symbol = file === a ? b : a;
    const exports = kn.exports[file];
    if (!exports) {
      return {
        verdict: 'contradicted',
        parsed: { type: 'export', subject: file, object: symbol },
        evidence: `No export entry for ${file}. File may not exist or has no exports indexed.`,
        instruction: `Run knit_query_exports({file_path: "${file}"}) to inspect.`,
      };
    }
    const found = exports.some((e) => e.name === symbol);
    return {
      verdict: found ? 'verified' : 'contradicted',
      parsed: { type: 'export', subject: file, object: symbol },
      evidence: found
        ? `exports[${file}] contains ${symbol}.`
        : `exports[${file}] = [${exports.slice(0, 5).map((e) => e.name).join(', ')}${exports.length > 5 ? ', ...' : ''}]. ${symbol} not present.`,
      instruction: found ? 'Verified.' : 'Contradicted. Symbol not exported from that file.',
    };
  }

  // Pattern: "A is tested by B" / "B tests A"
  const testMatch =
    claim.match(/['"`]?([\w./_-]+\.(?:ts|tsx|js|jsx))['"`]?\s+is\s+tested\s+by\s+['"`]?([\w./_-]+)['"`]?/i) ||
    claim.match(/['"`]?([\w./_-]+)['"`]?\s+tests\s+['"`]?([\w./_-]+\.(?:ts|tsx|js|jsx))['"`]?/i);
  if (testMatch) {
    const a = testMatch[1];
    const b = testMatch[2];
    // testMap.tested maps src file → test file(s); we want src as the key.
    const src = /test|spec/i.test(a) ? b : a;
    const testFile = src === a ? b : a;
    const tests = kn.testMap?.tested?.[src];
    if (!tests || tests.length === 0) {
      return {
        verdict: 'contradicted',
        parsed: { type: 'test', subject: src, object: testFile },
        evidence: `${src} has no test mapping in the index.`,
        instruction: `Run knit_query_tests({file_path: "${src}"}) to inspect.`,
      };
    }
    const found = tests.some((t) => t === testFile || t.endsWith(`/${testFile}`));
    return {
      verdict: found ? 'verified' : 'contradicted',
      parsed: { type: 'test', subject: src, object: testFile },
      evidence: found ? `${src} is tested by ${testFile}.` : `Test mapping: ${tests.join(', ')}. ${testFile} not in the set.`,
      instruction: found ? 'Verified.' : 'Contradicted.',
    };
  }

  // Pattern: "X exists" / "X is in the codebase"
  const existsMatch = claim.match(/['"`]?([\w./_-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs))['"`]?\s+(?:exists|is in the codebase|is part of the project)/i);
  if (existsMatch) {
    const path = existsMatch[1];
    const found = kn.importGraph[path] !== undefined || kn.exports[path] !== undefined;
    return {
      verdict: found ? 'verified' : 'contradicted',
      parsed: { type: 'exists', subject: path },
      evidence: found ? `${path} is present in the knowledge index.` : `${path} not found in knowledge index.`,
      instruction: found ? 'Verified.' : 'Contradicted. The file may be excluded from indexing, or hallucinated.',
    };
  }

  return {
    verdict: 'unparseable',
    instruction: 'Claim shape not recognized. Supported patterns: "A imports B", "A is imported by B", "X exports Y", "Y is exported from X", "A is tested by B", "X exists". For arbitrary lookups, call knit_query_imports / _exports / _dependents / _tests directly.',
  };
}

/** v0.8.1 — knit_compounding_metrics.
 *
 *  Quantifies the "Knit gets cheaper over time" claim. Returns:
 *    - sessions_recorded: total session count
 *    - learnings_recorded: total learnings in this project's KB
 *    - learnings_per_session: rate of new lessons captured
 *    - cache_hits: how many times prior learnings were reused (recordCacheHit)
 *    - reuse_ratio_pct: cache_hits / sessions_recorded — how often a session
 *      benefits from prior work. Higher = stronger compounding.
 *    - access_density_pct: fraction of total learnings that have been
 *      accessed at least once. Low = many learnings are dead weight; agent
 *      should prune. High = the index is paying for its cost.
 *    - estimated_tokens_saved: rough estimate of context tokens NOT spent
 *      because a prior learning was surfaced and skipped re-investigation.
 *      Conservative ~5000 tokens per cache hit (typical research-phase cost).
 *
 *  Companion to knit_brain_status's `token_budget` surface: budget tells you
 *  the per-session COST; compounding_metrics tells you the cumulative PAYOFF. */
/** v0.10 slice 3 — frozen metrics snapshot persisted weekly to metrics-history.jsonl.
 *  Each line is one JSON object; deltas computed by knit_get_metrics_history. */
interface MetricsSnapshot {
  ts: string;
  sessions_recorded: number;
  learnings_recorded: number;
  cache_hits: number;
  total_classifications: number;
  plan_mode_triggers: number;
  fp_suppressions: number;
  graph_queries: number;
  high_score_hits: number;
  total_retrieval_queries: number;
  tokens_spent_estimate: number;
  tokens_saved_estimate: number;
}

const SNAPSHOT_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Append a snapshot to metrics-history.jsonl iff the last one is >7 days old
 *  (or the file doesn't exist). Best-effort: any IO failure is swallowed by
 *  the caller's try/catch. */
function maybeAppendMetricsSnapshot(rootPath: string, snapshot: MetricsSnapshot): void {
  const path = metricsHistoryPath(rootPath);
  if (existsSync(path)) {
    try {
      const content = readFileSync(path, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      if (lines.length > 0) {
        const last = JSON.parse(lines[lines.length - 1]) as MetricsSnapshot;
        const lastTs = Date.parse(last.ts);
        const nowTs = Date.parse(snapshot.ts);
        if (Number.isFinite(lastTs) && Number.isFinite(nowTs) && nowTs - lastTs < SNAPSHOT_MIN_AGE_MS) {
          return;
        }
      }
    } catch {
      // Corrupt file → append a fresh snapshot. We don't try to repair history.
      process.stderr.write('[knit] metrics-history.jsonl parse failed — appending fresh snapshot, prior history may be unreadable\n');
    }
  }
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify(snapshot) + '\n');
  } catch (err) {
    process.stderr.write('[knit] metrics-history.jsonl append failed at ' + path + ': ' + (err as Error).message + '\n');
  }
}

/** v0.10 slice 3 — knit_get_metrics_history.
 *
 *  Returns the last N weekly snapshots (default 12) plus week-over-week
 *  deltas for the key compounding signals. Pair with knit_compounding_metrics
 *  (which gives the point-in-time current state) to see "Knit got X% cheaper
 *  by week N" trends. Tier 2 — opt-in via knit_enable_feature. */
export function handleGetMetricsHistory(params: Record<string, string>, brain: BrainCache): string {
  const limit = Math.max(1, Math.min(52, parseInt(params.limit || '12', 10) || 12));
  const path = metricsHistoryPath(brain.rootPath);
  if (!existsSync(path)) {
    return JSON.stringify({
      snapshots: [],
      deltas: [],
      count: 0,
      instruction: 'No history yet. Snapshots accumulate weekly each time knit_compounding_metrics is called.',
    });
  }
  let snapshots: MetricsSnapshot[] = [];
  try {
    const content = readFileSync(path, 'utf-8');
    snapshots = content
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as MetricsSnapshot);
  } catch {
    return JSON.stringify({
      snapshots: [],
      deltas: [],
      count: 0,
      error: 'Failed to parse metrics-history.jsonl. File may be corrupt.',
    });
  }
  const recent = snapshots.slice(-limit);
  const deltas: Array<{
    from: string;
    to: string;
    tokens_saved_delta: number;
    cache_hits_delta: number;
    plan_mode_triggers_delta: number;
    total_classifications_delta: number;
  }> = [];
  for (let i = 1; i < recent.length; i++) {
    const prev = recent[i - 1];
    const curr = recent[i];
    deltas.push({
      from: prev.ts,
      to: curr.ts,
      tokens_saved_delta: curr.tokens_saved_estimate - prev.tokens_saved_estimate,
      cache_hits_delta: curr.cache_hits - prev.cache_hits,
      plan_mode_triggers_delta: curr.plan_mode_triggers - prev.plan_mode_triggers,
      total_classifications_delta: curr.total_classifications - prev.total_classifications,
    });
  }
  return JSON.stringify({
    snapshots: recent,
    deltas,
    count: recent.length,
    instruction:
      recent.length === 0
        ? 'No snapshots yet.'
        : `Last ${recent.length} weekly snapshot(s). Compare deltas to see Knit's payoff week-over-week. Suggested chart: x=ts, y=tokens_saved_estimate.`,
  });
}

/** v0.10 slice 3 — per-tier token-spent heuristics. Each tier has a typical
 *  per-classification token cost based on its phase set:
 *    inquiry   ~200    (read-only answer, no phases)
 *    trivial   ~1500   (EXECUTE → VERIFY → LEARN, 1 file)
 *    standard  ~8000   (RESEARCH → EXECUTE → OPTIMIZE → REVIEW → LEARN)
 *    complex   ~25000  (full 6-phase + parallel agents)
 *  Directional indicator only; real spend varies with file size, agent depth, etc. */
const TOKENS_PER_TIER_DEFAULT = { inquiry: 200, trivial: 1500, standard: 8000, complex: 25000 } as const;

/** v0.15 (audit D6) — calibrated savings constants. The defaults come
 *  from instrumented Claude Code sessions on Knit's own repo (2026-05).
 *  Users can override via env vars when their workflow has different
 *  cache/FP/graph-query payback profiles:
 *    KNIT_TOKENS_PER_CACHE_HIT          default 15000
 *    KNIT_TOKENS_PER_FP_SUPPRESSION     default 5000
 *    KNIT_TOKENS_PER_GRAPH_QUERY        default 3000
 *
 *  Methodology note (exposed via compounding-metrics methodology field):
 *  these are derived from observed RESEARCH-phase token costs when an
 *  agent does the work cold vs. when it gets a relevant cached learning
 *  back from knit_search_learnings. See benchmarks/token-economy.ts for
 *  the measurement harness.
 */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
const TOKENS_SAVED_PER_CACHE_HIT = envInt('KNIT_TOKENS_PER_CACHE_HIT', 15000);
const TOKENS_SAVED_PER_FP_SUPPRESSION = envInt('KNIT_TOKENS_PER_FP_SUPPRESSION', 5000);
const TOKENS_SAVED_PER_GRAPH_QUERY = envInt('KNIT_TOKENS_PER_GRAPH_QUERY', 3000);
const TOKENS_PER_TIER = TOKENS_PER_TIER_DEFAULT;

export function handleCompoundingMetrics(_params: Record<string, string>, brain: BrainCache): string {
  const kb = brain.knowledgeBase;
  const totalSessions = sessionCount(brain.rootPath);
  const totalLearnings = kb.entries.length;
  const accessedLearnings = kb.entries.filter((e) => e.accessCount > 0).length;
  const totalAccesses = kb.entries.reduce((sum, e) => sum + e.accessCount, 0);
  const cacheHits = kb.metrics.cacheHits ?? 0;
  const totalClassifications = kb.metrics.totalClassifications ?? 0;
  const planModeTriggers = kb.metrics.planModeTriggers ?? 0;
  const fpSuppressions = kb.metrics.fpSuppressions ?? 0;
  const graphQueries = kb.metrics.graphQueries ?? 0;
  const highScoreHits = kb.metrics.highScoreHits ?? 0;
  const totalRetrievalQueries = kb.metrics.totalRetrievalQueries ?? 0;
  const tierBreakdown = kb.metrics.classificationsByTier ?? {};
  const fpEntries = kb.entries.filter((e) => e.tags.includes('#false-positive')).length;

  const learningsPerSession = totalSessions > 0
    ? Math.round((totalLearnings / totalSessions) * 100) / 100
    : 0;
  const reuseRatioPct = totalSessions > 0
    ? Math.min(100, Math.round((cacheHits / totalSessions) * 100))
    : 0;
  const accessDensityPct = totalLearnings > 0
    ? Math.round((accessedLearnings / totalLearnings) * 100)
    : 0;
  const planModeTriggerRatePct = totalClassifications > 0
    ? Math.round((planModeTriggers / totalClassifications) * 100)
    : 0;
  const retrievalHighScoreRatePct = totalRetrievalQueries > 0
    ? Math.round((highScoreHits / totalRetrievalQueries) * 100)
    : 0;
  // Classification accuracy = 1 − (FP entries that were learnings) / total classifications.
  // Heuristic: each FP entry represents a wrong call the user reported, not a wrong
  // classification per se, but it's the best proxy until we instrument the FP-on-classifier
  // path explicitly in slice 4 (Verify Layer).
  const classificationAccuracyPct = totalClassifications > 0
    ? Math.max(0, Math.min(100, Math.round((1 - fpEntries / totalClassifications) * 100)))
    : 100;

  // Tokens spent (directional): sum of per-tier × per-tier-cost.
  const tokensSpentEstimate =
    (tierBreakdown.inquiry ?? 0) * TOKENS_PER_TIER.inquiry +
    (tierBreakdown.trivial ?? 0) * TOKENS_PER_TIER.trivial +
    (tierBreakdown.standard ?? 0) * TOKENS_PER_TIER.standard +
    (tierBreakdown.complex ?? 0) * TOKENS_PER_TIER.complex;

  // Tokens saved (directional): the cumulative payoff of cache hits + FP
  // suppressions + graph queries.
  const tokensSavedEstimate =
    cacheHits * TOKENS_SAVED_PER_CACHE_HIT +
    fpSuppressions * TOKENS_SAVED_PER_FP_SUPPRESSION +
    graphQueries * TOKENS_SAVED_PER_GRAPH_QUERY;

  const netTokenDelta = tokensSavedEstimate - tokensSpentEstimate;

  // Verdict — same scale as token_budget verdicts so callers can render
  // them uniformly.
  let verdict: 'cold' | 'warming' | 'compounding' | 'strong';
  if (totalSessions < 3) verdict = 'cold';
  else if (reuseRatioPct < 20) verdict = 'warming';
  else if (reuseRatioPct < 50) verdict = 'compounding';
  else verdict = 'strong';

  // Append a weekly snapshot if the last one is >7 days old (or none exists).
  // This builds the metrics-history.jsonl that knit_get_metrics_history reads.
  // Wrapped in try/catch: metrics IO must never break the response.
  try {
    maybeAppendMetricsSnapshot(brain.rootPath, {
      ts: new Date().toISOString(),
      sessions_recorded: totalSessions,
      learnings_recorded: totalLearnings,
      cache_hits: cacheHits,
      total_classifications: totalClassifications,
      plan_mode_triggers: planModeTriggers,
      fp_suppressions: fpSuppressions,
      graph_queries: graphQueries,
      high_score_hits: highScoreHits,
      total_retrieval_queries: totalRetrievalQueries,
      tokens_spent_estimate: tokensSpentEstimate,
      tokens_saved_estimate: tokensSavedEstimate,
    });
  } catch {
    // Best-effort.
  }

  return JSON.stringify({
    sessions_recorded: totalSessions,
    learnings_recorded: totalLearnings,
    learnings_per_session: learningsPerSession,
    accessed_learnings: accessedLearnings,
    total_accesses: totalAccesses,
    cache_hits: cacheHits,
    reuse_ratio_pct: reuseRatioPct,
    access_density_pct: accessDensityPct,
    // v0.10 slice 3 — token economics fields.
    total_classifications: totalClassifications,
    classifications_by_tier: tierBreakdown,
    plan_mode_triggers: planModeTriggers,
    plan_mode_trigger_rate_pct: planModeTriggerRatePct,
    classification_accuracy_pct: classificationAccuracyPct,
    fp_suppressions: fpSuppressions,
    graph_queries: graphQueries,
    total_retrieval_queries: totalRetrievalQueries,
    retrieval_high_score_rate_pct: retrievalHighScoreRatePct,
    tokens_spent_estimate: tokensSpentEstimate,
    tokens_saved_estimate: tokensSavedEstimate,
    // v0.15 (audit D6) — surface methodology so the numbers are honest
    // claims, not opaque constants.
    methodology: {
      per_cache_hit: TOKENS_SAVED_PER_CACHE_HIT,
      per_fp_suppression: TOKENS_SAVED_PER_FP_SUPPRESSION,
      per_graph_query: TOKENS_SAVED_PER_GRAPH_QUERY,
      per_tier: TOKENS_PER_TIER,
      origin: 'Defaults calibrated from instrumented Claude Code RESEARCH phases on Knit\'s own repo (2026-05). Override via env: KNIT_TOKENS_PER_CACHE_HIT, KNIT_TOKENS_PER_FP_SUPPRESSION, KNIT_TOKENS_PER_GRAPH_QUERY.',
    },
    net_token_delta: netTokenDelta,
    // Back-compat field: keep `estimated_tokens_saved` so v0.9 callers don't break.
    estimated_tokens_saved: tokensSavedEstimate,
    verdict,
    note: verdict === 'cold'
      ? 'Fresh project. Compounding signal kicks in around session 3 once the KB has a few entries.'
      : verdict === 'warming'
        ? 'KB building up but reuse is low. Either learnings are too project-specific to recur, or the agent isn\'t calling knit_search_learnings before re-investigating.'
        : verdict === 'compounding'
          ? 'Healthy reuse. Knit is preventing re-investigation often enough to pay back the per-session overhead.'
          : 'Strong compounding — the KB is doing real work. Token budget cost is dominated by the savings on prevented re-investigations.',
    instruction: 'Pair with knit_brain_status\'s token_budget surface to see cost-vs-payoff side by side. Call knit_get_metrics_history for week-over-week trend.',
  });
}

/** knit_scan_integrations — explicit re-scan of the host for existing
 *  workflow frameworks (Ruflo, gstack, CodeTour, other MCP servers, custom
 *  CLAUDE.md sections). Persists to ~/.knit/projects/<hash>/integrations.json
 *  and returns the structured result. Also runs implicitly at autoInitialize
 *  so users typically don't need to call this — it's the manual re-trigger. */
export function handleScanIntegrations(_params: Record<string, string>, brain: BrainCache): string {
  try {
    const result = scanIntegrations(brain.rootPath, { knitVersion: VERSION });
    persistScanResult(brain.rootPath, result);
    return JSON.stringify({
      status: 'scanned',
      ...result,
      instruction: result.detected.ruflo.present || result.detected.gstack.present || result.detected.codetour.present || result.detected.conductor.present
        ? 'Existing frameworks detected. v0.7.2 surfaces them under knit_brain_status; v0.8 will tailor server instructions to defer to them where appropriate.'
        : 'No existing workflow frameworks detected. Knit operates in full-protocol mode.',
    });
  } catch (err) {
    return JSON.stringify({
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** knit_disable_feature — flip off a previously-enabled feature flag. */
export function handleDisableFeature(params: Record<string, string>, brain: BrainCache): string {
  const feature = (params.feature || '').trim().toLowerCase();
  if (!isEnableableFeature(feature)) {
    return JSON.stringify({
      status: 'error',
      error: `Invalid feature: "${params.feature}". Valid values: teams, subagents, admin.`,
    });
  }
  const enabled = loadEnabledFeatures(brain.rootPath);
  const wasOn = enabled.delete(feature);
  if (wasOn) {
    saveEnabledFeatures(brain.rootPath, enabled);
    // Tool surface contracted — notify the client to re-fetch tools/list.
    // Tools auto-exposed by project-shape detection (e.g. teams when ≥3
    // domains) stay visible regardless; only opt-in-only tools disappear.
    notifyToolsListChanged();
  }
  return JSON.stringify({
    status: wasOn ? 'disabled' : 'already-disabled',
    feature,
    enabled_features: [...enabled].sort(),
    instruction: wasOn
      ? 'Tools list updated for this session. Opt-in-only tools for this feature are no longer visible.'
      : 'Already disabled. Auto-exposed tools (e.g. teams when ≥3 domains) stay visible regardless of this flag.',
  });
}


/** Detects read-only "audit / explain / what / where / status" intent from the
 *  task description. Returns true when the user is asking, not commanding.
 *  Action verbs ("fix this", "implement X", "refactor Y") override even if an
 *  inquiry word appears, because "fix it" is a command despite containing
 *  no question word. Conservative on purpose — when in doubt, fall through
 *  to the write-bearing tiers so Protocol Guard stays engaged.
 *
 *  v0.12.1: widened action-verb override after observing that descriptions
 *  like "Reduce budget by trimming tools, consolidate learnings, and audit
 *  codebase" misclassified as inquiry. Three changes:
 *    1. Extended verb list with: reduce, trim, shrink, consolidate, demote,
 *       promote, harden, secure, polish, clean, tidy, prune, optimize,
 *       repair, resolve, address, sharpen, tighten, wire, hook, gate.
 *    2. Loosened the determiner requirement: action verb followed by ANY
 *       word (\w+) counts, not just determiner pronouns. "consolidate
 *       learnings" is just as much a command as "consolidate the learnings".
 *    3. Multi-verb override: if the description contains ≥2 action verbs
 *       from the extended list, treat as write-bearing regardless of any
 *       inquiry words present. "Reduce X, consolidate Y, and audit Z" has
 *       2 actions + 1 inquiry → still a write task. */
const ACTION_VERB = '(?:fix|implement|build|add|refactor|ship|deploy|write|create|update|modify|change|edit|migrate|rename|delete|remove|install|setup|configure|merge|publish|release|patch|reduce|trim|shrink|consolidate|demote|promote|harden|secure|polish|clean|tidy|prune|optimi[sz]e|repair|resolve|address|sharpen|tighten|wire|hook|gate)';

function detectsInquiryIntent(description: string): boolean {
  if (!description) return false;

  // Question-word or inquiry-verb leads at the start of the description.
  const inquiryStart = /^\s*(what|where|how|why|when|which|who|can|could|should|does|do|is|are|will|would|tell\s+me|show\s+me|find|list|status\s+of|audit|explain|investigate|analyze|review|describe|summari[sz]e|inspect)\b/i;
  // Inquiry verbs anywhere in the description (caught even if the user starts mid-sentence).
  const inquiryVerb = /\b(audit|explain|investigate|analy[sz]e|review|examine|describe|summari[sz]e|enumerate|inspect)\b/i;
  // Action commands that override mid-sentence inquiry signals. Action verb
  // + any following word (object/target). "consolidate learnings",
  // "demote diagnostics", "reduce budget" all count.
  const actionDirective = new RegExp(`\\b${ACTION_VERB}\\s+\\w+`, 'i');
  // Count distinct action verbs in the description.
  const actionVerbMatches = description.match(new RegExp(`\\b${ACTION_VERB}\\b`, 'gi')) || [];
  const distinctActionVerbs = new Set(actionVerbMatches.map((v) => v.toLowerCase())).size;

  // ≥2 distinct action verbs = unambiguously a multi-step write task,
  // even if "audit" or "review" appears in the same sentence.
  // ("Reduce budget, consolidate learnings, and audit codebase" → not inquiry.)
  if (distinctActionVerbs >= 2) return false;

  // Question-word lead wins — if the description starts with a question word
  // ("what should I fix before shipping"), it's inquiry even when an action
  // verb appears later. The user is asking, not commanding.
  if (inquiryStart.test(description)) return true;

  // No question lead. A single action-directive ("fix the bug", "consolidate
  // learnings") is a write command — overrides any mid-sentence inquiry verb.
  if (actionDirective.test(description)) return false;

  // Pure inquiry verb anywhere ("audit the codebase") with no action verb —
  // read-only task.
  return inquiryVerb.test(description);
}

/** v0.10 — Infer change kind from file existence + description verbs.
 *  Uses existsSync against `rootPath` per file. Safe-defaults to 'modify'
 *  on any IO error so risk inference stays conservative. */
function inferChangeKind(files: string[], description: string, rootPath: string): ChangeKind {
  const lower = description.toLowerCase();
  const deleteVerb = /\b(delete|remove|drop|rip\s+out|tear\s+down|deprecate|kill)\b/.test(lower);
  const deleteObject = /\b(this|that|it|the|file|module|column|table|endpoint|route|method|function|class)\b/.test(lower);
  const isDeleteHint = deleteVerb && deleteObject;
  // Delete intent overrides file-presence inference: a "remove the legacy
  // module" task is `delete` whether the file still exists on disk or is
  // already gone (cleanup pass). Conservative — requires both verb AND
  // object to trigger, so "add helper that removes whitespace" stays additive.
  if (isDeleteHint) return 'delete';
  if (files.length === 0) {
    if (/\b(add|create|new|introduce|implement|build|generate|scaffold)\b/.test(lower)) return 'additive';
    return 'modify';
  }
  let additive = 0;
  let modify = 0;
  for (const f of files) {
    try {
      if (existsSync(join(rootPath, f))) modify++;
      else additive++;
    } catch {
      modify++;
    }
  }
  if (additive > 0 && modify === 0) return 'additive';
  if (modify > 0 && additive === 0) return 'modify';
  return 'mixed';
}

/** v0.10 — Risk tier inference. Drives `auto_plan_mode`, not scope. */
function inferRiskTier(
  files: string[],
  description: string,
  changeKind: ChangeKind,
  isTypes: boolean,
  isAuth: boolean,
  highFanoutCount: number,
  riskAdjust = 0,
): RiskTier {
  const lower = description.toLowerCase();
  const breakingHints = /\b(migration|breaking|rewrite|schema\s+change|deprecate|backwards?[-\s]incompatible)\b/.test(lower);
  // v0.11 slice 4 — calibration shift. Positive riskAdjust → downweight
  // risky signals (require more signals to classify high). Negative → upweight.
  // Each unit of riskAdjust requires +1 additional risky signal to escalate.
  const riskSignals = (isTypes ? 1 : 0) + (isAuth ? 1 : 0) + (breakingHints ? 1 : 0) +
                      (changeKind === 'delete' ? 1 : 0) + (highFanoutCount >= 1 ? 1 : 0);
  if (riskSignals >= 1 + Math.max(0, riskAdjust)) return 'high';
  if ((changeKind === 'modify' || changeKind === 'mixed') && files.length >= 2) {
    return 'medium';
  }
  return 'low';
}

/** v0.10 — Scope tier inference. Drives phase count, not plan-mode. */
function inferScopeTier(
  files: string[],
  domains: Set<string>,
  isNewProject: boolean,
  descriptionIsComplex: boolean,
  scopeAdjust = 0,
): ScopeTier {
  if (isNewProject) {
    return descriptionIsComplex ? 'complex' : 'standard';
  }
  // v0.11 slice 4 — calibration shift. Positive scopeAdjust → require more
  // files before classifying complex (less sensitive). Negative → more.
  const complexFileThreshold = Math.max(1, 3 + scopeAdjust);
  const standardFileThreshold = Math.max(1, 1 + Math.floor(scopeAdjust / 2));
  if (domains.size >= 3 || files.length > complexFileThreshold) return 'complex';
  if (domains.size >= 2 || files.length > standardFileThreshold) return 'standard';
  return 'trivial';
}

/** v0.10 — Map risk × scope to legacy `tier` for back-compat. */
function deriveLegacyTier(risk: RiskTier, scope: ScopeTier): TaskTier {
  if (risk === 'high' || scope === 'complex') return 'complex';
  if (risk === 'medium' || scope === 'standard') return 'standard';
  return 'trivial';
}

/** v0.10 — Phases from scope + plan-mode flag. PLAN is prepended when a
 *  medium/high-risk task lands on a non-complex scope (the case the v0.9
 *  classifier missed). */
function phasesForScope(scope: ScopeTier, autoPlanMode: boolean): string[] {
  if (scope === 'complex') {
    return ['RESEARCH', 'IDEATE', 'PLAN', 'EXECUTE', 'OPTIMIZE', 'REVIEW', 'LEARN'];
  }
  if (scope === 'standard') {
    return autoPlanMode
      ? ['RESEARCH', 'PLAN', 'EXECUTE', 'OPTIMIZE', 'REVIEW', 'LEARN']
      : ['RESEARCH', 'EXECUTE', 'OPTIMIZE', 'REVIEW', 'LEARN'];
  }
  return autoPlanMode
    ? ['PLAN', 'EXECUTE', 'VERIFY', 'LEARN']
    : ['EXECUTE', 'VERIFY', 'LEARN'];
}

/** v0.10 — Apply context-budget downgrade. When the host agent has <30%
 *  context remaining, scope drops one level and OPTIMIZE is skipped (callers
 *  read the returned `degraded` flag to know to surface it). */
function applyContextBudget(scope: ScopeTier, budgetRemaining: number): { scope: ScopeTier; degraded: boolean } {
  if (budgetRemaining >= 30) return { scope, degraded: false };
  if (scope === 'complex') return { scope: 'standard', degraded: true };
  if (scope === 'standard') return { scope: 'trivial', degraded: true };
  return { scope: 'trivial', degraded: true };
}

/** One ordered step in a classify `tool_plan`. */
interface ToolPlanStep {
  phase: string;
  tool: string;
  why: string;
  args_hint?: string;
}

/** A spec/RFC/requirements doc worth ingesting via knit_index_requirements. */
function isSpecFile(f: string): boolean {
  return /\.(md|markdown|txt|rst)$/i.test(f) && /(spec|rfc|requirements?|prd|design)/i.test(f);
}

/**
 * v0.22 full-tool-use — turn the TASK SHAPE classify already computed into an
 * ordered, callable tool sequence. Root cause it fixes: agents collapse to 1–2
 * tools because Knit surfaces a flat tool dict in once-read prose. Every step is
 * GATED by a signal classify computed (high-fanout, domain count, types/auth,
 * spec file, scope) so the plan is right-sized — a docs-only repo gets a short
 * plan; a multi-domain monorepo names the graph + team tools. Naming a tool here
 * is ALSO the discovery signal for hosts that defer-load tool schemas. Additive
 * + droppable: the caller omits it entirely under budget pressure.
 */
function buildToolPlan(o: {
  files: string[];
  rippleFiles: string[];
  domainCount: number;
  isTypes: boolean;
  isAuth: boolean;
  scopeTier: ScopeTier;
  tier: TaskTier;
}): ToolPlanStep[] {
  const plan: ToolPlanStep[] = [];
  const standardPlus = o.scopeTier === 'standard' || o.scopeTier === 'complex';

  // RESEARCH — understand blast radius before editing.
  for (const f of o.rippleFiles.slice(0, 2)) {
    plan.push({ phase: 'RESEARCH', tool: 'knit_query_imports', why: `${f} is high-fanout — see what ripples before editing it`, args_hint: `file_path="${f}"` });
  }
  if (o.isTypes || o.isAuth) {
    const f = o.files.find((x) => /types|schema|auth|security/i.test(x));
    plan.push({
      phase: 'RESEARCH',
      tool: 'knit_query_dependents',
      why: o.isAuth ? 'security-sensitive surface — map the blast radius' : 'shared type/contract — map who depends on it',
      ...(f ? { args_hint: `file_path="${f}"` } : {}),
    });
  }
  const spec = o.files.find(isSpecFile);
  if (spec) {
    plan.push({ phase: 'RESEARCH', tool: 'knit_index_requirements', why: 'spec/requirements doc — index once, retrieve only relevant chunks per feature', args_hint: `file_path="${spec}"` });
    plan.push({ phase: 'PLAN', tool: 'knit_generate_test_cases', why: 'derive test cases from the indexed spec' });
  }

  // PLAN — parallelize and fetch protocol depth.
  if (o.domainCount >= 3) {
    plan.push({ phase: 'PLAN', tool: 'knit_spawn_team_worktree', why: `${o.domainCount} domains affected — parallelize the work in isolated worktrees` });
  }
  if (o.tier === 'complex') {
    plan.push({ phase: 'PLAN', tool: 'knit_get_workflow', why: 'fetch per-phase protocol depth on demand (do not reconstruct it)', args_hint: 'phase="plan"' });
  }

  // EXECUTE — coverage awareness for the files actually changing.
  if (standardPlus && o.files.length > 0) {
    plan.push({ phase: 'EXECUTE', tool: 'knit_query_tests', why: 'know each file’s coverage before changing it', args_hint: `file_path="${o.files[0]}"` });
  }

  // REVIEW / LEARN — the gates.
  if (standardPlus) {
    plan.push({ phase: 'REVIEW', tool: 'knit_verify_claim', why: 'fact-check ≥1 codebase claim before asserting or LEARN (Stop-gate enforces this)' });
    plan.push({ phase: 'LEARN', tool: 'knit_record_learning', why: 'capture the non-obvious insight so the next session skips re-investigation' });
  }

  return plan.slice(0, 8);
}

export function handleClassifyTask(params: Record<string, string>, brain: BrainCache): string {
  const rawFiles = (params.files_to_touch || '').split(',').map((f) => f.trim()).filter(Boolean);
  const files = rawFiles.filter((f) => f !== 'unknown');
  const description = (params.description || '').toLowerCase();
  const domains = detectDomainsFromFiles(files);
  const crossDomainRipple: string[] = [];
  const rippleFiles: string[] = [];
  let highFanoutCount = 0;

  for (const file of files) {
    const importers = brain.reverseDeps[file] || [];
    if (importers.length >= 3) {
      crossDomainRipple.push(`${file} is high-fanout (${importers.length} dependents)`);
      rippleFiles.push(file);
      if (importers.length >= 10) highFanoutCount++;
    }
  }

  // Inquiry tier — read-only "what / audit / explain" tasks. Detected before
  // file/domain counting because audit-style questions can touch many files
  // without requiring any write. This stops the v0.6.3-style over-routing
  // where "what should I fix?" got auto-promoted to Complex + plan mode.
  if (detectsInquiryIntent(params.description || '')) {
    try {
      writeClassificationMarker(brain.rootPath, {
        turnId: `${Date.now()}-${process.pid}`,
        classifiedAt: new Date().toISOString(),
        tier: 'inquiry',
        files,
      });
    } catch (e) {
      logBestEffortFailure('classification-marker', e);
    }
    // v0.10 slice 3 — count every classification (inquiry too).
    bumpMetric(brain.knowledgeBase, 'totalClassifications');
    bumpClassificationTier(brain.knowledgeBase, 'inquiry');
    return JSON.stringify({
      tier: 'inquiry',
      risk_tier: 'low',
      scope_tier: 'trivial',
      change_kind: 'modify',
      affected_domains: [...domains],
      phases: [],
      files_count: files.length,
      cross_domain_ripple: crossDomainRipple,
      auto_plan_mode: false,
      instruction: 'Read-only task. Answer directly — no plan mode, no LEARN unless something durable surfaced. If scope grows into writes, re-classify with knit_classify_task.',
      reasoning: `Inquiry: read-only intent detected${files.length > 0 ? `, ${files.length} file(s) referenced for context` : ''}`,
    });
  }

  const isTypes = files.some((f) => f.includes('types') || f.includes('schema'));
  const isAuth = files.some((f) => f.includes('auth') || f.includes('security'));

  // If files are unknown (new project), classify from description
  const isNewProject = files.length === 0 || rawFiles.includes('unknown');
  const descriptionIsComplex = description.includes('architect') || description.includes('build from scratch')
    || description.includes('new project') || description.includes('system')
    || description.length > 100;

  // v0.10 — compute the three new dimensions before deriving back-compat tier.
  // v0.11 slice 4 — load per-project calibration and apply its scope/risk
  // adjustments. Default state is zero offsets (no change from v0.10 behavior).
  const calibration = loadCalibration(brain.rootPath);
  const changeKind = inferChangeKind(files, params.description || '', brain.rootPath);
  const riskTier = inferRiskTier(files, params.description || '', changeKind, isTypes, isAuth, highFanoutCount, calibration.riskAdjust);
  const initialScope = inferScopeTier(files, domains, isNewProject, descriptionIsComplex, calibration.scopeAdjust);

  // v0.10 — context budget downgrade. <30% remaining → scope drops one level.
  const rawBudget = parseInt(params.context_budget_remaining || '100', 10);
  const budgetRemaining = Number.isFinite(rawBudget) && rawBudget >= 0 && rawBudget <= 100 ? rawBudget : 100;
  const { scope: scopeTier, degraded: budgetDegraded } = applyContextBudget(initialScope, budgetRemaining);

  // auto_plan_mode is now risk-driven, not scope-driven.
  const autoPlanMode = riskTier === 'high' || riskTier === 'medium';

  const tier = deriveLegacyTier(riskTier, scopeTier);
  let phases = phasesForScope(scopeTier, autoPlanMode);
  // Budget-degraded tasks always drop OPTIMIZE — it's the most expensive phase
  // (parallel review agents). Saves tokens when the host is already constrained.
  if (budgetDegraded) {
    phases = phases.filter((p) => p !== 'OPTIMIZE');
  }

  // v0.11 slice 1 — verify reminder gets appended on standard/complex scope.
  // Stop hook enforces it (warn or block per strictness); the instruction text
  // here is the upfront nudge so the agent knows to budget for a verify call.
  const verifyReminder = (scopeTier === 'standard' || scopeTier === 'complex')
    ? ' Before LEARN, verify ≥1 claim with knit_verify_claim — the REVIEW gate enforces this for standard/complex tasks.'
    : '';
  const instruction = autoPlanMode
    ? `ENTER PLAN MODE NOW. Risk=${riskTier}, scope=${scopeTier}, change=${changeKind}. Call EnterPlanMode tool immediately. Do NOT start coding without a plan.${verifyReminder}`
    : scopeTier === 'complex'
      ? `Many-file additive change. Follow phases: RESEARCH → IDEATE → PLAN → EXECUTE → OPTIMIZE → REVIEW → LEARN.${verifyReminder}`
      : scopeTier === 'standard'
        ? `Follow phases: RESEARCH → EXECUTE → OPTIMIZE → REVIEW → LEARN. No plan mode needed but do research first.${verifyReminder}`
        : 'Simple task. EXECUTE → VERIFY → LEARN. Do it directly, then record what you learned.';

  // Protocol Guard side effect: write classification marker so PreToolUse
  // hook lets Edit/Write through this turn. See src/engine/protocol-guard.ts.
  try {
    writeClassificationMarker(brain.rootPath, {
      turnId: `${Date.now()}-${process.pid}`,
      classifiedAt: new Date().toISOString(),
      tier,
      riskTier,
      scopeTier,
      changeKind,
      files,
    });
  } catch (e) {
    logBestEffortFailure('classification-marker-main', e);
  }

  // v0.10 slice 3 — counters for compounding-metrics. Bumped in-memory;
  // persists piggybacking on the next saveKnowledgeBase call (same pattern
  // as recordCacheHit since v0.8).
  bumpMetric(brain.knowledgeBase, 'totalClassifications');
  bumpClassificationTier(brain.knowledgeBase, scopeTier);
  if (autoPlanMode) bumpMetric(brain.knowledgeBase, 'planModeTriggers');

  // v0.9 — pre-emptive learnings injection. When the task warrants RESEARCH
  // (standard or complex scope), auto-run BM25 over the description + affected
  // domains and embed the top 3 hits in the response.
  // v0.22 token-opt — surface pre-emptive learnings as HEADLINES (id + summary +
  // tags + a short preview), not full lesson bodies. classify fires on every
  // standard/complex task, so dumping 3 multi-paragraph lessons here was the
  // single biggest avoidable per-call token cost. The agent pulls the full
  // lesson on demand via knit_get_learning({id}) — hierarchical retrieval.
  let preEmptiveLearnings: Array<{ id: string; summary: string; lesson_preview: string; tags: string[] }> | undefined;
  if (scopeTier === 'standard' || scopeTier === 'complex') {
    try {
      const trimmed = (params.description || '').trim();
      const queryText = trimmed || [...domains].join(' ');
      if (queryText) {
        const index = buildLearningsIndex(brain.knowledgeBase.entries);
        const hits = index.search(queryText, 3);
        if (hits.length > 0) {
          preEmptiveLearnings = hits.map((h) => {
            const entry = (h.document.metadata as { entry: KBEntry }).entry;
            return { id: entry.id, summary: entry.summary, lesson_preview: lessonPreview(entry.lesson), tags: entry.tags };
          });
          recordCacheHit(brain.knowledgeBase);
        }
      }
    } catch (e) {
      logBestEffortFailure('pre-emptive-search', e);
    }
  }

  // FP nudge — surfaced for write-bearing tasks so users actually use the
  // false-positive feedback loop. Skipping trivial keeps the noise down.
  const fpNudge = scopeTier === 'standard' || scopeTier === 'complex'
    ? 'If this classification is wrong, call knit_record_false_positive with the reason — improves the classifier over time.'
    : undefined;

  // v0.22 full-tool-use — ordered, signal-gated tool sequence. Dropped entirely
  // under budget pressure (token discipline: additive-or-nothing).
  const toolPlan = budgetDegraded
    ? []
    : buildToolPlan({ files, rippleFiles, domainCount: domains.size, isTypes, isAuth, scopeTier, tier });

  const verbose = params.verbose === 'true' || params.verbose === '1';
  const base = {
    tier,
    risk_tier: riskTier,
    scope_tier: scopeTier,
    change_kind: changeKind,
    affected_domains: [...domains],
    phases,
    auto_plan_mode: autoPlanMode,
    instruction,
    ...(toolPlan.length > 0
      ? {
          tool_plan: toolPlan,
          tool_plan_note: 'Ordered tools for THIS task shape — follow it; do not collapse to 1–2 tools or reconstruct the loop from prose. Each step is gated by your task’s signals.',
        }
      : {}),
    ...(budgetDegraded
      ? {
          degraded_for_budget: true,
          budget_note: `Context budget remaining = ${budgetRemaining}%. Scope downgraded from ${initialScope} to ${scopeTier}; OPTIMIZE phase dropped to conserve tokens.`,
        }
      : {}),
    ...(preEmptiveLearnings && preEmptiveLearnings.length > 0
      ? {
          pre_emptive_learnings: preEmptiveLearnings,
          pre_emptive_note: 'Prior learnings auto-surfaced as HEADLINES. Call knit_get_learning({id}) for the full lesson of any relevant one before re-investigating. More via knit_search_learnings.',
        }
      : {}),
    ...(fpNudge ? { fp_nudge: fpNudge } : {}),
  };
  if (!verbose) {
    return JSON.stringify(base);
  }
  return JSON.stringify({
    ...base,
    files_count: files.length,
    cross_domain_ripple: crossDomainRipple,
    reasoning: autoPlanMode
      ? `Risk=${riskTier}: ${isTypes ? 'types/schema touched, ' : ''}${isAuth ? 'auth/security touched, ' : ''}${changeKind === 'delete' ? 'delete intent, ' : ''}${highFanoutCount > 0 ? `${highFanoutCount} high-fanout file(s), ` : ''}scope=${scopeTier}`
      : `Scope=${scopeTier}: ${domains.size} domain(s), ${files.length} file(s), change=${changeKind}`,
  });
}

export function handleSetProtocolStrictness(params: Record<string, string>, brain: BrainCache): string {
  const level = (params.level || '').trim().toLowerCase();
  if (!isValidStrictness(level)) {
    return JSON.stringify({
      status: 'error',
      error: `Invalid level: "${params.level}". Must be one of: off, warn, block.`,
    });
  }
  const config = writeProtocolConfig(brain.rootPath, level);
  return JSON.stringify({
    status: 'set',
    level: config.level,
    updated_at: config.updatedAt,
    applies_to: 'next-tool-call',
    note: level === 'block'
      ? 'PreToolUse hook will now HARD BLOCK Edit/Write without knit_classify_task first.'
      : level === 'warn'
        ? 'PreToolUse hook will print a reminder but not block.'
        : 'Protocol Guard disabled. No checks on Edit/Write.',
  });
}

export function handleGetProtocolStrictness(_params: Record<string, string>, brain: BrainCache): string {
  const config = readProtocolConfig(brain.rootPath);
  return JSON.stringify({ level: config.level, updated_at: config.updatedAt });
}

export function handleBuildContext(params: Record<string, string>, brain: BrainCache): string {
  const files = (params.files_to_touch || '').split(',').map((f) => f.trim()).filter(Boolean);
  const affectedDomains = detectDomainsFromFiles(files);
  const knownPitfalls: string[] = [];
  const ripple: string[] = [];

  for (const file of files) {
    const importers = brain.reverseDeps[file] || [];
    if (importers.length > 0) ripple.push(`${file} is imported by: ${importers.join(', ')}`);
  }

  const domainTags = [...affectedDomains].map((d) => d.toLowerCase().replace(/[^a-z]/g, ''));
  const learnings = queryByDomains(brain.knowledgeBase, domainTags);
  // v0.22 token-opt — pitfalls as headline + preview, not full lesson bodies.
  // Full lesson on demand via knit_get_learning({id}).
  for (const l of learnings) knownPitfalls.push(`[${l.id}] ${l.summary}: ${lessonPreview(l.lesson)}`);
  const fps = getFalsePositives(brain.knowledgeBase);

  // v0.22 full-tool-use — name the tools this CONTEXT warrants, gated by signals
  // already computed here (ripple, untested, domain count). Mirrors classify's
  // tool_plan at the context layer so the diverse tool surface gets exercised.
  const suggestedTools: Array<{ name: string; why: string; args_hint?: string }> = [];
  const topRipple = files.find((f) => (brain.reverseDeps[f] || []).length >= 3);
  if (topRipple) {
    suggestedTools.push({ name: 'knit_query_imports', why: `${topRipple} has dependents — confirm the ripple before editing`, args_hint: `file_path="${topRipple}"` });
  }
  const untestedTouched = files.find((f) => brain.knowledge.testMap?.untested?.includes(f));
  if (untestedTouched) {
    suggestedTools.push({ name: 'knit_query_tests', why: `${untestedTouched} has no tests indexed — add coverage before changing it`, args_hint: `file_path="${untestedTouched}"` });
  }
  if (affectedDomains.size >= 3) {
    suggestedTools.push({ name: 'knit_spawn_team_worktree', why: `${affectedDomains.size} domains — parallelize in isolated worktrees` });
  }

  // v0.9 #8 — suggested_reads. For the agent that already passed
  // files_to_touch, compute a curated list of additional files worth
  // reading first. Two signals:
  //   1. Graph: 1-hop neighbors of files_to_touch (importers + imports)
  //   2. Memory: files mentioned in past learnings about these domains
  // Caps at 8 entries so the response stays light. Each entry has a `reason`
  // string so the agent can decide whether to actually open it.
  const suggestedReads = computeSuggestedReads(files, brain, learnings);

  return JSON.stringify({
    domain_context: {
      affected_domains: [...affectedDomains], files_to_touch: files,
      cross_domain_ripple: ripple, known_pitfalls: knownPitfalls,
      false_positives: fps.map((fp) => `${fp.summary}: ${fp.lesson}`),
      ...(suggestedReads.length > 0 ? { suggested_reads: suggestedReads } : {}),
      ...(suggestedTools.length > 0 ? { suggested_tools: suggestedTools } : {}),
    },
    instruction: 'Pass this entire object to every agent prompt in EXECUTE, OPTIMIZE, and REVIEW phases.',
  });
}

interface SuggestedRead {
  path: string;
  reason: string;
  /** "graph-importer" | "graph-import" | "memory-mention" — debug. */
  via: string;
}

function computeSuggestedReads(
  filesToTouch: string[],
  brain: BrainCache,
  learnings: KBEntry[],
): SuggestedRead[] {
  if (filesToTouch.length === 0) return [];
  const seen = new Set<string>(filesToTouch);
  const out: SuggestedRead[] = [];

  // 1. Graph: who imports the files-to-touch (consumers — break things if changed)
  for (const file of filesToTouch) {
    for (const importer of brain.reverseDeps[file] ?? []) {
      if (seen.has(importer)) continue;
      seen.add(importer);
      out.push({
        path: importer,
        reason: `Depends on ${file} — change-blast-radius candidate.`,
        via: 'graph-importer',
      });
      if (out.length >= 8) return out;
    }
  }

  // 2. Graph: what the files-to-touch import (likely needed for the work)
  for (const file of filesToTouch) {
    for (const dep of brain.knowledge.importGraph?.[file] ?? []) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      out.push({
        path: dep,
        reason: `${file} imports it — read alongside the edit target.`,
        via: 'graph-import',
      });
      if (out.length >= 8) return out;
    }
  }

  // 3. Memory: files referenced by past learnings in these domains. Catches
  // "this domain has known gotchas in file X" cases.
  for (const learning of learnings) {
    const haystack = [learning.summary, learning.lesson, learning.approach ?? ''].join(' ');
    // Pull anything that looks like a relative source path.
    const matches = haystack.match(/\b[\w./_-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs)\b/g) ?? [];
    for (const m of matches) {
      if (seen.has(m)) continue;
      // Only suggest if it's actually in the knowledge index.
      if (!brain.knowledge.importGraph?.[m] && !brain.knowledge.exports?.[m]) continue;
      seen.add(m);
      out.push({
        path: m,
        reason: `Past learning "${learning.summary}" mentions this file.`,
        via: 'memory-mention',
      });
      if (out.length >= 8) return out;
    }
  }

  return out;
}

/** v0.9 #6 — Hierarchical retrieval companion. knit_load_session returns
 *  truncated summaries; this returns the full entry for a single id. Lets
 *  the agent expand only the learning that turned out to be relevant,
 *  instead of paying for full bodies upfront. */
export function handleGetLearning(params: Record<string, string>, brain: BrainCache): string {
  const id = (params.id || '').trim();
  if (!id) return errorResponse('id parameter is required');
  const entry = brain.knowledgeBase.entries.find((e) => e.id === id);
  if (!entry) {
    return errorResponse(`No learning with id="${id}". List active ones via knit_search_learnings (default returns id + summary).`);
  }
  recordCacheHit(brain.knowledgeBase);
  return JSON.stringify({
    id: entry.id,
    date: entry.date,
    summary: entry.summary,
    domains: entry.domains,
    approach: entry.approach,
    outcome: entry.outcome,
    lesson: entry.lesson,
    tags: entry.tags,
    access_count: entry.accessCount,
  });
}

export function handleRecordLearning(params: Record<string, string>, brain: BrainCache): string {
  if (!params.summary?.trim() && !params.lesson?.trim()) {
    return errorResponse('summary and lesson are required — cannot record empty learning');
  }

  // v0.14 — cross-platform soft-gate. The existing PreToolUse search-gate
  // hook only fires inside Claude Code; for the 5 other MCP-speaking
  // agents (Cursor, Codex CLI, Cline, Continue, Copilot) the MCP
  // response is the only enforcement surface. Pre-record_learning we
  // expect knit_search_learnings to have fired so the agent isn't
  // adding a duplicate of what's already in the brain.
  //
  // Only active in `block` strictness. Default `warn` + `off` preserve
  // pre-v0.14 behavior — existing tests + UX unchanged. Users who want
  // cross-platform enforcement opt in via knit_set_protocol_strictness.
  const strictness = readProtocolConfig(brain.rootPath).level;
  if (strictness === 'block' && !existsSync(searchMarkerPath(brain.rootPath))) {
    return JSON.stringify({
      status: 'protocol_required',
      next_action: 'knit_search_learnings',
      error: 'Block strictness active: call knit_search_learnings before knit_record_learning so the new learning is checked against existing ones.',
      rationale: 'Recording without prior search risks duplicating an existing learning. Search first; if nothing similar exists, then record.',
      strictness,
    });
  }

  const date = new Date().toISOString().split('T')[0];
  const entry = {
    date,
    summary: redactSecrets(params.summary || 'Untitled learning'),
    domains: (params.domains || 'general').split(',').map((d) => redactSecrets(d.trim())),
    approach: redactSecrets(params.approach || ''),
    outcome: (['success', 'partial', 'failure'].includes(params.outcome) ? params.outcome : 'success') as 'success' | 'partial' | 'failure',
    lesson: redactSecrets(params.lesson || ''),
    tags: (params.tags || '').split(/\s+/).filter((t) => t.startsWith('#')).map((t) => redactSecrets(t)),
  };

  // v0.14.1 audit C1 — substring dedup. Prior versions advertised "skip
  // duplicates" via tool description but the handler did no actual check;
  // the soft-gate above (block strictness only) was the only enforcement.
  // Now: refuse if a recent entry's summary is a substring of the new one
  // (or vice versa) after lowercasing. Skips the dedup if the new summary
  // is very short (<24 chars) — too small to be a meaningful match.
  const normSummary = entry.summary.toLowerCase().trim();
  if (normSummary.length >= 24) {
    const duplicate = brain.knowledgeBase.entries.find((existing) => {
      const existingSummary = (existing.summary || '').toLowerCase().trim();
      if (existingSummary.length < 24) return false;
      return existingSummary.includes(normSummary) || normSummary.includes(existingSummary);
    });
    if (duplicate) {
      return JSON.stringify({
        status: 'duplicate',
        existing: { id: duplicate.id, summary: duplicate.summary, date: duplicate.date },
        instruction: 'A learning with substantially overlapping summary already exists. Either refine the new summary to capture what is genuinely new, or call knit_get_learning on the existing id to extend it instead of duplicating.',
      });
    }
  }

  addEntry(brain.knowledgeBase, entry);
  saveKnowledgeBase(knowledgebasePath(brain.rootPath), brain.knowledgeBase);

  // Also append to markdown learnings file
  const learnDir = learningsDir(brain.rootPath);
  const mdFiles = existsSync(learnDir)
    ? readdirSync(learnDir).filter((f: string) => f.endsWith('.md') && f !== 'sessions.md')
    : [];
  if (mdFiles.length > 0) {
    const mdPath = join(learnDir, mdFiles[0]);
    const mdEntry = `\n## ${date} ${entry.summary}\n**Domain(s):** ${entry.domains.join(', ')}\n**Approach:** ${entry.approach}\n**Outcome:** ${entry.outcome}\n**Lesson:** ${entry.lesson}\n**Tags:** ${entry.tags.join(' ')}\n`;
    // v0.12.1 (MEDIUM-5 closed): replaced the prior read-modify-write with
    // O_APPEND. POSIX guarantees a single write(2) under PIPE_BUF (4096 bytes)
    // is atomic against concurrent O_APPEND writers, so parallel
    // knit_record_learning calls from team worktrees may interleave entry
    // ordering but never clobber each other. mdEntry is well under PIPE_BUF.
    appendFileSync(mdPath, mdEntry, 'utf-8');
  }

  return JSON.stringify({
    status: 'recorded',
    entry: { date, summary: entry.summary, tags: entry.tags },
    kb_total: brain.knowledgeBase.entries.length,
    instruction: 'Learning recorded. You may now report task as complete.',
  });
}

export function handleRecordFalsePositive(params: Record<string, string>, brain: BrainCache): string {
  const date = new Date().toISOString().split('T')[0];
  const tags = [...(params.tags || '').split(/\s+/).filter((t) => t.startsWith('#')).map((t) => redactSecrets(t)), '#false-positive'];
  const entry = {
    date,
    summary: redactSecrets(params.summary || 'Untitled FP'),
    domains: ['General'],
    approach: 'Verified manually',
    outcome: 'success' as const,
    lesson: redactSecrets(params.reason || 'Confirmed non-issue'),
    tags,
  };

  addEntry(brain.knowledgeBase, entry);
  saveKnowledgeBase(knowledgebasePath(brain.rootPath), brain.knowledgeBase);

  // v0.11 slice 4 — self-healing classifier. If the FP tags include a
  // direction (e.g., #complex-was-trivial), bump the per-project
  // calibration counter; after 3+ same-direction FPs the classifier
  // thresholds shift to absorb the feedback.
  let calibrationUpdate: { direction: string; scope_adjust: number; risk_adjust: number } | undefined;
  const direction = parseDirection(tags);
  if (direction) {
    try {
      const cal = recordClassifierFP(brain.rootPath, direction);
      calibrationUpdate = { direction, scope_adjust: cal.scopeAdjust, risk_adjust: cal.riskAdjust };
    } catch {
      // best-effort: never let calibration IO break FP recording
    }
  }

  return JSON.stringify({
    status: 'recorded', summary: entry.summary,
    total_false_positives: getFalsePositives(brain.knowledgeBase).length,
    ...(calibrationUpdate ? { calibration_update: calibrationUpdate } : {}),
    instruction: 'This will be included in future agent prompts as a DO NOT FLAG item.' + (calibrationUpdate ? ' Classifier calibration updated.' : ''),
  });
}

/** v0.11 slice 4 — knit_get_calibration. Returns the per-project
 *  classifier calibration state: accumulated FP counters by direction,
 *  current scope/risk adjustments, last-updated timestamp. Pair with
 *  knit_compounding_metrics for a complete view of how the classifier
 *  is tuning itself over time. */
export function handleGetCalibration(_params: Record<string, string>, brain: BrainCache): string {
  const cal = loadCalibration(brain.rootPath);
  const totalFps = Object.values(cal.fpDirections).reduce((s, n) => s + n, 0);
  const adjustments = Math.abs(cal.scopeAdjust) + Math.abs(cal.riskAdjust);
  return JSON.stringify({
    fp_directions: cal.fpDirections,
    scope_adjust: cal.scopeAdjust,
    risk_adjust: cal.riskAdjust,
    pending_fp_count: totalFps,
    accumulated_adjustments: adjustments,
    updated_at: cal.updatedAt,
    instruction: adjustments === 0 && totalFps === 0
      ? 'No calibration yet. The classifier uses default thresholds. To teach it: when a classification is wrong, call knit_record_false_positive with a tag like "#complex-was-trivial" — 3 same-direction FPs shift the threshold by 1 unit.'
      : `Classifier has been tuned ${adjustments} unit(s); ${totalFps} FP(s) accumulating toward the next shift. Call knit_reset_calibration to wipe.`,
  });
}

/** v0.11 slice 4 — knit_reset_calibration. Wipes the per-project
 *  calibration back to default zeros. Use when calibration drifted in a
 *  bad direction (e.g., overzealous user reporting). Admin tier. */
export function handleResetCalibration(_params: Record<string, string>, brain: BrainCache): string {
  const fresh = resetCalibration(brain.rootPath);
  return JSON.stringify({
    status: 'reset',
    scope_adjust: fresh.scopeAdjust,
    risk_adjust: fresh.riskAdjust,
    instruction: 'Calibration wiped. Classifier reverts to default thresholds.',
  });
}

/** v0.12 phase 2 — knit_compose_template.
 *
 *  Generates auto-configured CLAUDE.md sections (Project Identity,
 *  Build & Verify, Domain Architecture) from the project's detected
 *  fingerprint + inferred domains. Returns a preview string the user can
 *  paste into CLAUDE.md (between knit markers) — no file IO done here.
 *
 *  This is phase 2 of the v0.12 auto-config trifecta:
 *    phase 0 — detect (knit_get_fingerprint)
 *    phase 1 — infer (knit_infer_domains)
 *    phase 2 — compose (knit_compose_template) ← here */
export function handleComposeTemplate(params: Record<string, string>, brain: BrainCache): string {
  const projectName = (params.project_name || brain.config?.name || 'Project').trim();
  const fingerprint = scanProjectFingerprint(brain.rootPath);
  const importGraph = brain.knowledge?.importGraph ?? {};
  const testMap = brain.knowledge?.testMap ?? { tested: {}, untested: [], testFiles: [] };
  const inferred = inferDomains(brain.rootPath, importGraph, testMap as { tested: Record<string, string[]>; testFiles: string[] });
  const composed = composeAutoConfiguredSections(projectName, fingerprint, inferred.candidates);
  return JSON.stringify({
    project_name: projectName,
    fingerprint,
    inferred_domains: inferred.candidates.length,
    signal_coverage: inferred.signalCoverage,
    composed_sections: {
      project_identity: composed.projectIdentity,
      build_and_verify: composed.buildAndVerify,
      domain_architecture: composed.domainArchitecture,
    },
    combined_preview: composed.combined,
    instruction: 'Preview only — paste between <!-- knit:start --> and <!-- knit:end --> in CLAUDE.md to accept. Re-run after stack or domain changes to refresh.',
  });
}

/** v0.12 phase 1 — knit_infer_domains.
 *
 *  Fuses three signals into ranked domain candidates: git co-change
 *  clustering, import-graph centrality, test colocation. RRF fuses
 *  rankings so a domain strong in one signal still surfaces. Output is
 *  intended for user review before being accepted into CLAUDE.md's
 *  Domain Architecture block (v0.12 phase 2). */
export function handleInferDomains(params: Record<string, string>, brain: BrainCache): string {
  const lookbackRaw = parseInt(params.lookback_days || '90', 10);
  const lookbackDays = Number.isFinite(lookbackRaw) && lookbackRaw > 0 && lookbackRaw <= 730 ? lookbackRaw : 90;
  const importGraph = brain.knowledge?.importGraph ?? {};
  const testMap = brain.knowledge?.testMap ?? { tested: {}, untested: [], testFiles: [] };
  const result = inferDomains(brain.rootPath, importGraph, testMap as { tested: Record<string, string[]>; testFiles: string[] }, lookbackDays);
  return JSON.stringify({
    ...result,
    instruction: result.candidates.length === 0
      ? 'No domain signals available yet. Ensure the project has commits in the last 90 days AND src/ structure AND an indexed import graph (run knit_brain_status to verify).'
      : `Found ${result.candidates.length} candidate domain(s). Review the file lists; accepted candidates feed into v0.12 phase 2 (template composition) so CLAUDE.md's Domain Architecture block stays accurate.`,
  });
}

/** v0.12 phase 0 — knit_get_fingerprint.
 *
 *  Returns the detected ProjectFingerprint: languages, framework, test
 *  runner, linter, build/lint/typecheck commands, package manager, CI
 *  files. Foundation for v0.12 phases 1 (domain inference) and 2
 *  (template composition). Computed fresh on each call — cheap. */
export function handleGetFingerprint(_params: Record<string, string>, brain: BrainCache): string {
  const fp = scanProjectFingerprint(brain.rootPath);
  const detected = [
    fp.languages.length > 0 ? `lang=${fp.languages.join('+')}` : null,
    fp.framework ? `framework=${fp.framework}` : null,
    fp.testRunner ? `test=${fp.testRunner}` : null,
    fp.linter ? `lint=${fp.linter}` : null,
    fp.packageManager ? `pm=${fp.packageManager}` : null,
    fp.ciFiles.length > 0 ? `ci=${fp.ciFiles.length} file(s)` : null,
  ].filter(Boolean).join(', ');
  return JSON.stringify({
    fingerprint: fp,
    summary: detected || 'no signals detected — likely an empty or unsupported project shape',
    instruction: 'Use this fingerprint when generating CLAUDE.md / agent prompts so build commands and test runner match the project. Re-run on knit refresh to pick up stack changes.',
  });
}

/** v0.11 slice 5 — knit_index_requirements.
 *
 *  Ingest a long-form requirements / spec / RFC document into a
 *  BM25-indexed per-project store. Chunks on paragraph boundaries, persists
 *  to ~/.knit/projects/<hash>/requirements/<source-id>.json.
 *
 *  Companion to knit_generate_test_cases — same problem solved at ingest
 *  vs query time. Designed for the enterprise-requirements use case
 *  (200KB Jira spec → retrieved 5-7KB relevant context per query). */
export function handleIndexRequirements(params: Record<string, string>, brain: BrainCache): string {
  const filePath = (params.file_path || '').trim();
  if (!filePath) {
    return errorResponse('file_path is required');
  }
  // v0.12.1 (MEDIUM-4 closed): open with O_NOFOLLOW, then fstat + read from
  // the same fd. This collapses existsSync → statSync → readFileSync (three
  // separate path resolutions) into one resolution against a single open
  // file descriptor — eliminating the TOCTOU window where a symlink swap
  // could redirect the read to /etc/passwd or ~/.ssh/id_rsa.
  //
  // v0.16.0 (HANG FIX): also pass O_NONBLOCK so opening a FIFO / named pipe
  // returns immediately instead of blocking until a writer connects. Without
  // this, the exploit-test FIFO case hangs the entire test suite. Regular
  // files ignore O_NONBLOCK on POSIX, so the read path stays identical for
  // the common case.
  let fd: number;
  try {
    fd = openSync(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ELOOP') {
      return errorResponse(`refusing to follow symlink at ${filePath}`);
    }
    if (e.code === 'ENOENT') {
      return errorResponse(`file not found: ${filePath}`);
    }
    return errorResponse(`open failed: ${e.message}`);
  }
  let content: string;
  try {
    // H1: Reject non-regular-files and files exceeding 5 MB before reading.
    const stat = fstatSync(fd);
    if (!stat.isFile()) {
      return JSON.stringify({ status: 'error', error: 'Not a regular file' });
    }
    if (stat.size > 5 * 1024 * 1024) {
      return JSON.stringify({ status: 'error', error: 'File exceeds 5MB limit; chunk-index your spec in pieces or contact maintainer' });
    }
    content = readFileSync(fd, 'utf-8');
  } catch (err) {
    return errorResponse(`read failed: ${(err as Error).message}`);
  } finally {
    try { closeSync(fd); } catch { /* defensive: fd may have been closed by an exception path — ignore */ }
  }
  const sourceBytes = Buffer.byteLength(content, 'utf-8');
  const minCharsRaw = parseInt(params.min_chars || '50', 10);
  const minChars = Number.isFinite(minCharsRaw) && minCharsRaw > 0 ? minCharsRaw : 50;
  const chunks = chunkRequirements(content, minChars);
  if (chunks.length === 0) {
    return JSON.stringify({
      status: 'error',
      error: 'No chunks produced — every paragraph was shorter than min_chars. Lower min_chars or check the input.',
    });
  }
  // H2: Redact secrets from each chunk before persisting.
  for (const c of chunks) { c.text = redactSecrets(c.text); }
  // C1: Validate user-supplied source_id before using it.
  const userSourceId = (params.source_id || '').trim();
  if (userSourceId && !/^[A-Za-z0-9._-]{1,80}$/.test(userSourceId)) {
    return JSON.stringify({ status: 'error', error: 'Invalid source_id — must be 1-80 chars, alphanumeric + . _ - only' });
  }
  const sourceId = userSourceId || slugifySourceId(filePath);
  const rawLabel = (params.label || '').trim();
  const label = rawLabel ? redactSecrets(rawLabel) : undefined;
  const source: RequirementsSource = {
    sourceId,
    sourcePath: filePath,
    sourceBytes,
    indexedAt: new Date().toISOString(),
    label,
    chunks,
  };
  try {
    saveSource(brain.rootPath, source);
  } catch (err) {
    return errorResponse(`save failed: ${(err as Error).message}`);
  }
  const chunksTruncated = chunks.length >= MAX_CHUNKS_PER_SOURCE;
  return JSON.stringify({
    status: 'indexed',
    source_id: sourceId,
    chunks_indexed: chunks.length,
    chunks_truncated: chunksTruncated,
    max_chunks_per_source: MAX_CHUNKS_PER_SOURCE,
    source_bytes: sourceBytes,
    avg_chunk_chars: Math.round(chunks.reduce((s, c) => s + c.text.length, 0) / chunks.length),
    instruction: chunksTruncated
      ? `Indexed ${chunks.length} chunks from ${filePath} (HIT THE ${MAX_CHUNKS_PER_SOURCE}-CHUNK CAP — input is likely too long or paragraph-dense; split it). Call knit_generate_test_cases with feature="<your topic>" to retrieve only the relevant chunks for a specific feature.`
      : `Indexed ${chunks.length} chunks from ${filePath}. Call knit_generate_test_cases with feature="<your topic>" to retrieve only the relevant chunks for a specific feature.`,
  });
}

/** v0.11 slice 5 — knit_generate_test_cases.
 *
 *  Free-text query against all indexed requirements sources. Returns the
 *  top-N most relevant chunks via BM25 + RRF across sources, plus a
 *  structured template the agent can use to generate test cases from the
 *  retrieved context. Optional source_id filter to scope to one doc.
 *
 *  This is the "200KB doc → 5-7KB relevant context" core of the enterprise
 *  pilot. The agent gets only what's relevant to the named feature, not
 *  the whole spec. */
export function handleGenerateTestCases(params: Record<string, string>, brain: BrainCache): string {
  const feature = (params.feature || '').trim();
  if (!feature) {
    return errorResponse('feature is required (the topic / feature name to retrieve context for)');
  }
  const topNRaw = parseInt(params.top_n || '5', 10);
  const topN = Number.isFinite(topNRaw) && topNRaw > 0 && topNRaw <= 30 ? topNRaw : 5;
  const sourceFilter = (params.source_id || '').trim();
  const summaries = listSources(brain.rootPath);
  if (summaries.length === 0) {
    return JSON.stringify({
      status: 'no_sources',
      error: 'No requirements indexed yet. Call knit_index_requirements first with the path to your spec / Jira export / Swagger doc.',
    });
  }
  const sourcesToSearch: RequirementsSource[] = [];
  if (sourceFilter) {
    const s = loadSource(brain.rootPath, sourceFilter);
    if (!s) {
      return JSON.stringify({
        status: 'error',
        error: `source_id "${sourceFilter}" not found. Available: ${summaries.map((x) => x.sourceId).join(', ')}`,
      });
    }
    sourcesToSearch.push(s);
  } else {
    for (const summary of summaries) {
      const s = loadSource(brain.rootPath, summary.sourceId);
      if (s) sourcesToSearch.push(s);
    }
  }
  const MAX_RESPONSE_BYTES = 100 * 1024; // 100 KB ceiling — prevents multi-MB MCP responses
  const hits = retrieveTopChunks(sourcesToSearch, feature, topN);
  // Enforce byte cap: drop trailing chunks until total fits within MAX_RESPONSE_BYTES.
  let contextBytes = hits.reduce((s, h) => s + Buffer.byteLength(h.chunk.text, 'utf-8'), 0);
  while (contextBytes > MAX_RESPONSE_BYTES && hits.length > 1) {
    const dropped = hits.pop()!;
    contextBytes -= Buffer.byteLength(dropped.chunk.text, 'utf-8');
  }
  const totalBytes = sourcesToSearch.reduce((s, src) => s + src.sourceBytes, 0);
  const reductionPct = totalBytes > 0 ? Math.round(100 - (contextBytes / totalBytes) * 100) : 0;
  // v0.17 freshness layer — flag indexed sources whose on-disk file has been
  // deleted or edited since indexing. We still return the cached chunks (the
  // index is the source of truth for retrieval), but warn the agent that the
  // grounding may be out of date so it can re-index instead of trusting stale
  // requirements. Detection-only; never silently drops chunks.
  const staleSources = sourcesToSearch
    .filter((s) => {
      const abs = resolveRef(brain.rootPath, s.sourcePath);
      if (!abs || !existsSync(abs)) return true; // source file gone
      try {
        return statSync(abs).mtimeMs > Date.parse(s.indexedAt); // edited since index
      } catch {
        return false;
      }
    })
    .map((s) => s.sourceId);
  return JSON.stringify({
    status: 'ok',
    feature,
    sources_searched: sourcesToSearch.map((s) => s.sourceId),
    ...(staleSources.length > 0
      ? {
          stale_sources: staleSources,
          stale_warning: `These indexed sources have been deleted or edited since indexing: ${staleSources.join(', ')}. The chunks below may be out of date — re-run knit_index_requirements to refresh.`,
        }
      : {}),
    context_chunks: hits.map((h) => ({
      source_id: h.sourceId,
      source_label: h.sourceLabel,
      chunk_id: h.chunk.id,
      start_line: h.chunk.startLine,
      end_line: h.chunk.endLine,
      text: h.chunk.text,
    })),
    context_bytes: contextBytes,
    total_source_bytes: totalBytes,
    reduction_pct: reductionPct,
    suggested_template: `Given the retrieved context for feature "${feature}", generate test cases covering: happy path, edge cases (boundaries, empty/null inputs), failure modes (invalid input, downstream errors), and any compliance requirements stated in the chunks above. Cite chunk_id when a test maps to a specific requirement.`,
    instruction: `Retrieved ${hits.length} chunk(s) — ${contextBytes} bytes of ${totalBytes} total (${reductionPct}% reduction). Use the chunks as the LLM's grounding context; cite chunk_id per test case.`,
  });
}

/** v0.11 slice 5 — knit_list_requirements (helper). Returns all indexed
 *  sources with header info (no chunks). Cheap; for showing the agent
 *  what's available before calling knit_generate_test_cases. */
export function handleListRequirements(_params: Record<string, string>, brain: BrainCache): string {
  const summaries = listSources(brain.rootPath);
  return JSON.stringify({
    count: summaries.length,
    sources: summaries,
    instruction: summaries.length === 0
      ? 'No requirements indexed yet. Call knit_index_requirements with a file_path to ingest one.'
      : 'Use source_id with knit_generate_test_cases to scope retrieval to one doc, or omit it to search across all.',
  });
}

export function handleDeleteRequirements(params: Record<string, string>, brain: BrainCache): string {
  const rawId = (params.source_id || '').toString();
  const sourceId = slugifySourceId(rawId);
  const deleted = deleteSource(brain.rootPath, sourceId);
  return JSON.stringify({
    status: deleted ? 'deleted' : 'not_found',
    deleted,
    source_id: sourceId,
    instruction: deleted
      ? 'Source removed. Call knit_list_requirements to see what remains.'
      : 'No source with that id. Call knit_list_requirements to see indexed source ids.',
  });
}

/** Freshness sidecar for handoff.md. Written next to it so load_session can
 *  decide whether an existing handoff is still in-flight without parsing the
 *  markdown body. A handoff with NO sidecar is treated as legacy/superseded —
 *  that single rule auto-clears pre-v0.17 ghost handoffs (e.g. a v0.14 handoff
 *  that still reported unfinished work three releases later). */
interface HandoffMeta {
  version: string;
  savedAt: string;
  resolved: boolean;
}

function handoffMetaPath(root: string): string {
  return join(root, 'handoff.meta.json');
}

function readHandoffMeta(root: string): HandoffMeta | null {
  const p = handoffMetaPath(root);
  if (!existsSync(p)) return null;
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf-8')) as Partial<HandoffMeta>;
    if (typeof parsed.savedAt !== 'string') return null;
    return {
      version: typeof parsed.version === 'string' ? parsed.version : '0.0.0',
      savedAt: parsed.savedAt,
      resolved: parsed.resolved === true,
    };
  } catch {
    return null;
  }
}

function writeHandoffMeta(root: string, meta: HandoffMeta): void {
  const p = handoffMetaPath(root);
  const tmp = `${p}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(meta, null, 2), 'utf-8');
  renameSync(tmp, p);
}

/** Is there a live, in-flight handoff for this project? True only when the
 *  handoff file exists AND its freshness sidecar says it is unresolved and
 *  within the TTL. Missing sidecar (legacy) or a resolved/stale one → false. */
function handoffIsActive(root: string): boolean {
  if (!existsSync(join(root, 'handoff.md'))) return false;
  const meta = readHandoffMeta(root);
  if (!meta) return false; // legacy handoff with no freshness stamp — superseded
  if (meta.resolved) return false;
  if (isStale(meta.savedAt, FRESHNESS.HANDOFF_TTL_DAYS)) return false;
  return true;
}

/** Mark an open handoff as resolved (superseded). Called when a session
 *  summary lands — the work reached a narratable conclusion, so the next
 *  session shouldn't be told to "resume unfinished work". No-op if there's
 *  no sidecar to update. */
function resolveHandoff(root: string): void {
  const meta = readHandoffMeta(root);
  if (!meta || meta.resolved) return;
  writeHandoffMeta(root, { ...meta, resolved: true });
}

export function handleSaveHandoff(params: Record<string, string>, brain: BrainCache): string {
  const handoffPath = join(brain.rootPath, 'handoff.md');
  const r = (k: string, fallback: string): string => redactSecrets(params[k] || fallback);
  const content = `# Session Handoff\n\n**Goal:** ${r('goal', 'Not specified')}\n\n**Current State:** ${r('current_state', 'Not specified')}\n\n**Files in Flight:** ${r('files_in_flight', 'None')}\n\n**What Changed:** ${r('what_changed', 'Nothing')}\n\n**Failed Attempts:**\n${r('failed_attempts', 'None documented')}\n\n**Decisions Made:** ${r('decisions_made', 'None')}\n\n**Next Step:** ${r('next_step', 'Not specified')}\n\n---\n*Saved: ${new Date().toISOString()}*\n`;
  // v0.12.1 (MEDIUM-5 closed): temp file + atomic rename. POSIX renameSync
  // is atomic, so handoff.md is always either the prior complete file or the
  // new complete file — never a partial write. Parallel handoff saves from
  // team worktrees may overwrite (last-writer-wins) but cannot corrupt or
  // truncate the file.
  const tmpPath = `${handoffPath}.tmp.${process.pid}`;
  writeFileSync(tmpPath, content, 'utf-8');
  renameSync(tmpPath, handoffPath);
  // v0.17 — stamp freshness. A fresh save reopens the handoff (resolved:false)
  // so load_session surfaces it; the sidecar's TTL + resolved flag let the
  // brain auto-clear it later instead of it lingering forever.
  writeHandoffMeta(brain.rootPath, { version: VERSION, savedAt: new Date().toISOString(), resolved: false });
  return JSON.stringify({ status: 'saved', path: 'handoff.md', instruction: 'Next session will read handoff.md first.' });
}

/** v0.21 — knit_onboard. Run once after connecting Knit (the README onboarding
 *  prompt tells the agent to call it). The user describes their project + how
 *  they want Knit to behave; this persists those preferences, applies them
 *  (strictness, feature flags), records the project intent into the brain so
 *  retrieval reflects it, and is host-agnostic (works on any MCP host). */
export function handleOnboard(params: Record<string, string>, brain: BrainCache): string {
  const projectDescription = redactSecrets((params.project_description || '').slice(0, 1000)).trim();
  const intent = redactSecrets((params.intent || '').slice(0, 1000)).trim();
  if (!projectDescription && !intent) {
    return errorResponse('Provide at least project_description (what the project is) or intent (what you are building).');
  }
  const strictnessRaw = (params.strictness || '').trim().toLowerCase();
  const strictness = isValidStrictness(strictnessRaw) ? strictnessRaw : null;
  const focusDomains = (params.focus_domains || '')
    .split(',').map((d) => redactSecrets(d.trim())).filter(Boolean).slice(0, 12);
  const enableRaw = (params.enable || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

  const prefs: ProjectPreferences = {
    version: 1,
    projectDescription,
    intent,
    strictness,
    focusDomains,
    onboardedAt: new Date().toISOString(),
  };
  savePreferences(brain.rootPath, prefs);

  const applied: string[] = [];

  if (strictness) {
    writeProtocolConfig(brain.rootPath, strictness);
    applied.push(`strictness=${strictness}`);
  }

  const featuresEnabled: string[] = [];
  if (enableRaw.length > 0) {
    const set = loadEnabledFeatures(brain.rootPath);
    for (const f of enableRaw) {
      if (isEnableableFeature(f) && !set.has(f)) { set.add(f); featuresEnabled.push(f); }
    }
    if (featuresEnabled.length > 0) {
      saveEnabledFeatures(brain.rootPath, set);
      notifyToolsListChanged();
      applied.push(`features=${featuresEnabled.join('+')}`);
    }
  }

  // Record the project intent as a learning so it surfaces in retrieval.
  const summary = `Project intent: ${(intent || projectDescription).slice(0, 160)}`;
  addEntry(brain.knowledgeBase, {
    date: new Date().toISOString().split('T')[0],
    summary,
    domains: focusDomains.length > 0 ? focusDomains : ['project'],
    approach: 'onboarding',
    outcome: 'success',
    lesson: `${projectDescription}${intent ? ` — building: ${intent}` : ''}`.slice(0, 500),
    tags: ['#onboarding', '#project-intent'],
  });
  saveKnowledgeBase(knowledgebasePath(brain.rootPath), brain.knowledgeBase);
  applied.push('intent recorded');

  return JSON.stringify({
    status: 'onboarded',
    project_description: projectDescription,
    intent,
    strictness: strictness ?? '(unchanged)',
    focus_domains: focusDomains,
    features_enabled: featuresEnabled,
    applied,
    instruction: 'Onboarding saved. Knit will surface this project intent at the start of every session. Call knit_classify_task to begin your first task.',
  });
}


export function handleSetupProject(params: Record<string, string>, brain: BrainCache): string {
  // User-supplied description/domains/team_roles flow into teams.json and the
  // KB. Redact at the persistence boundary — same rule every sibling record_*
  // handler follows. v0.14 setup-orchestration introduced this gap; v0.14.1
  // closes it (audit B1).
  const description = redactSecrets(params.description || '');
  const projectType = redactSecrets(params.project_type || 'auto');
  const domainNames = (params.domains
    ? params.domains.split(',').map((d) => d.trim())
    : inferDomainsFromDescription(params.description || '', params.project_type || 'auto')
  ).map((d) => redactSecrets(d));
  const teamRoles = (params.team_roles
    ? params.team_roles.split(',').map((r) => r.trim())
    : domainNames
  ).map((r) => redactSecrets(r));

  // Build teams from the description
  const teams = domainNames.map((domain, i) => ({
    name: domain.charAt(0).toUpperCase() + domain.slice(1).replace(/-/g, ' '),
    role: `${teamRoles[i] || domain} specialist`,
    focus: `${domain} domain for: ${description.slice(0, 200)}`,
    agents: ['code-reviewer'], // generic — the PROMPT is what matters, not the agent type
    filePatterns: ['**/*'],
    reviewChecklist: [`Review ${domain} quality`, `Check ${domain} completeness`, `Verify ${domain} accuracy`],
  }));

  // Save as custom teams
  saveCustomTeams(brain.rootPath, teams);

  // Record this as a learning so future sessions know what the project is
  addEntry(brain.knowledgeBase, {
    date: new Date().toISOString().split('T')[0],
    summary: `Project setup: ${description.slice(0, 100)}`,
    domains: domainNames,
    approach: `Project type: ${projectType}. Domains: ${domainNames.join(', ')}`,
    outcome: 'success',
    lesson: `This is a ${projectType} project. Key domains: ${domainNames.join(', ')}`,
    tags: ['#project-setup', ...domainNames.map((d) => `#${d.toLowerCase().replace(/\s+/g, '-')}`)],
  });
  saveKnowledgeBase(knowledgebasePath(brain.rootPath), brain.knowledgeBase);

  return JSON.stringify({
    status: 'configured',
    project_type: projectType,
    domains: domainNames,
    teams_created: teams.length,
    teams: teams.map((t) => ({ name: t.name, role: t.role })),
    instruction: `Project configured with ${teams.length} teams. Use knit_start_team_review to run parallel team analysis. Use knit_classify_task to classify tasks before starting.`,
  });
}

/** Infer domains from a project description when none are specified */
/** Project type → domain templates. Covers common non-code use cases. */
const DOMAIN_TEMPLATES: Record<string, string[]> = {
  // Code (handled by scanner, these are fallbacks)
  code: ['frontend', 'backend', 'database', 'testing', 'devops'],

  // Business
  startup: ['market-research', 'business-model', 'financial-projections', 'competitive-analysis', 'pitch-preparation'],
  marketing: ['market-research', 'content-strategy', 'campaign-creation', 'analytics', 'optimization'],
  sales: ['prospecting', 'outreach', 'pipeline-management', 'deal-analysis', 'forecasting'],

  // Research & Analysis
  research: ['literature-review', 'data-collection', 'analysis', 'synthesis', 'reporting'],
  finance: ['market-analysis', 'risk-assessment', 'portfolio-strategy', 'compliance', 'reporting'],
  'data-science': ['data-collection', 'data-cleaning', 'feature-engineering', 'model-training', 'evaluation'],

  // Creative
  writing: ['research', 'outlining', 'drafting', 'editing', 'publishing'],
  journalism: ['source-management', 'investigation', 'fact-checking', 'writing', 'editorial-review'],
  music: ['songwriting', 'arrangement', 'production', 'mixing-mastering', 'distribution'],
  video: ['pre-production', 'scripting', 'filming', 'editing', 'distribution'],

  // Design & Product
  design: ['user-research', 'information-architecture', 'visual-design', 'prototyping', 'usability-testing'],
  product: ['discovery', 'requirements', 'design', 'development', 'launch'],
  gamedev: ['game-design', 'level-design', 'art-assets', 'programming', 'playtesting'],

  // Technical
  devops: ['inventory', 'migration-planning', 'implementation', 'security-review', 'monitoring'],
  security: ['threat-modeling', 'vulnerability-assessment', 'penetration-testing', 'remediation', 'compliance'],
  architecture: ['requirements-analysis', 'system-design', 'component-design', 'integration', 'documentation'],

  // Domain-specific
  legal: ['document-review', 'risk-identification', 'compliance-check', 'contract-analysis', 'recommendations'],
  medical: ['data-collection', 'clinical-analysis', 'safety-review', 'statistical-analysis', 'reporting'],
  education: ['curriculum-design', 'content-creation', 'assessment-design', 'review', 'delivery'],
  realestate: ['market-research', 'property-valuation', 'financial-analysis', 'risk-assessment', 'recommendations'],
  hr: ['job-analysis', 'candidate-sourcing', 'screening', 'interview-assessment', 'onboarding'],
  consulting: ['discovery', 'analysis', 'strategy', 'recommendations', 'implementation-planning'],
};

function inferDomainsFromDescription(description: string, projectType: string): string[] {
  // 1. Exact project type match
  if (DOMAIN_TEMPLATES[projectType]) {
    return DOMAIN_TEMPLATES[projectType];
  }

  const desc = description.toLowerCase();

  // 2. Fuzzy match project type from description keywords
  const typeScores: Array<[string, number]> = [];
  for (const [type, domains] of Object.entries(DOMAIN_TEMPLATES)) {
    let score = 0;
    // Check if type name appears in description
    if (desc.includes(type.replace('-', ' '))) score += 10;
    if (desc.includes(type)) score += 10;

    // Check if domain keywords appear in description
    for (const domain of domains) {
      const keywords = domain.replace(/-/g, ' ').split(' ');
      for (const kw of keywords) {
        if (kw.length > 3 && desc.includes(kw)) score += 2;
      }
    }

    if (score > 0) typeScores.push([type, score]);
  }

  typeScores.sort((a, b) => b[1] - a[1]);
  if (typeScores.length > 0 && typeScores[0][1] >= 4) {
    return DOMAIN_TEMPLATES[typeScores[0][0]];
  }

  // 3. Final fallback — generic project domains
  return ['planning', 'research', 'execution', 'review', 'delivery'];
}


export function handleGetTeams(_params: Record<string, string>, brain: BrainCache): string {
  const custom = loadCustomTeams(brain.rootPath);
  if (custom) return JSON.stringify({ source: 'custom', teams: custom, count: custom.length });

  // Use the ACTUAL detected domains from the scanner — not hardcoded ones
  // The brain is built from scanProject() which detects language-appropriate domains
  const scan = scanProject(brain.rootPath);
  const defaults = buildDefaultTeams(scan.domains);
  return JSON.stringify({ source: 'auto-detected', teams: defaults, count: defaults.length });
}

export function handleDefineTeam(params: Record<string, string>, brain: BrainCache): string {
  const existing = loadCustomTeams(brain.rootPath) || [];
  // v0.14 audit fix: redact secrets from every user-supplied field before
  // persisting to .claude/teams.json. Team metadata is unlikely to contain
  // secrets, but the rest of the write-side handlers redact and this one
  // had drifted out of the pattern — keep coverage uniform.
  const newTeam = {
    name: redactSecrets(params.name || ''),
    role: redactSecrets(params.role || ''),
    focus: redactSecrets(params.focus || ''),
    agents: (params.agents || 'code-reviewer').split(',').map((a) => redactSecrets(a.trim())),
    filePatterns: (params.file_patterns || 'src/**').split(',').map((p) => redactSecrets(p.trim())),
    reviewChecklist: (params.checklist || '').split('|').map((c) => redactSecrets(c.trim())).filter(Boolean),
  };
  const idx = existing.findIndex((t) => t.name === newTeam.name);
  if (idx >= 0) existing[idx] = newTeam;
  else existing.push(newTeam);
  saveCustomTeams(brain.rootPath, existing);
  return JSON.stringify({ status: 'saved', team: newTeam, total_teams: existing.length });
}

export function handleStartTeamReview(params: Record<string, string>, brain: BrainCache): string {
  const teamNames = params.teams === 'all' || !params.teams
    ? (loadCustomTeams(brain.rootPath) || buildDefaultTeams([])).map((t) => t.name)
    : params.teams.split(',').map((t) => t.trim());
  const board = startTeamBoard(`review-${Date.now()}`, params.task_description, teamNames);
  return JSON.stringify({
    status: 'started', board_id: board.taskId, teams: teamNames,
    instruction: `Launch ${teamNames.length} agents IN PARALLEL. For each team, call knit_get_team_prompt, then spawn an Agent. After each returns, call knit_post_team_findings. Finally, call knit_get_board_summary.`,
  });
}

export function handleGetTeamPrompt(params: Record<string, string>, brain: BrainCache): string {
  const teams = loadCustomTeams(brain.rootPath) || buildDefaultTeams([
    { name: params.team_name, description: '', filePatterns: ['src/**'], agents: ['code-reviewer'] },
  ]);
  const team = teams.find((t) => t.name === params.team_name);
  if (!team) return errorResponse(`Team "${params.team_name}" not found`);

  markTeamWorking(params.team_name);
  const files = (params.files_to_review || '').split(',').map((f) => f.trim()).filter(Boolean);
  const domainContext = {
    files_to_review: files.length > 0 ? files : team.filePatterns,
    knowledge_summary: {
      total_files: brain.knowledge.summary.totalFiles,
      high_fanout: brain.knowledge.summary.highFanoutFiles,
      untested: brain.knowledge.summary.untestedFiles,
    },
  };
  const otherFindings = getOtherTeamFindings(params.team_name);
  const prompt = generateTeamPrompt(team, getTeamBoard()?.taskDescription || '', domainContext, otherFindings);
  return JSON.stringify({ team: team.name, prompt, agents_to_use: team.agents, instruction: 'Spawn an Agent with this prompt.' });
}

export function handlePostTeamFindings(params: Record<string, string>, _brain: BrainCache): string {
  // v0.14 audit fix: redact secrets from description / recommendation /
  // file fields. These are persisted via postTeamFindings() to the in-
  // memory board and (when knit_get_board_summary is called) echoed in
  // the summary string the agent receives. An agent pasting a token
  // into a finding's description would otherwise persist plaintext.
  let findings: TeamFinding[];
  try {
    const raw = JSON.parse(params.findings || '[]');
    findings = raw.map((f: Record<string, string>) => ({
      team: params.team_name,
      severity: VALID_SEVERITIES.has(String(f.severity).toUpperCase()) ? String(f.severity).toUpperCase() as TeamFinding['severity'] : 'MEDIUM',
      file: redactSecrets(f.file || 'unknown'),
      description: redactSecrets(f.description || ''),
      recommendation: redactSecrets(f.recommendation || ''),
      timestamp: new Date().toISOString(),
    }));
  } catch {
    findings = [{
      team: params.team_name, severity: 'LOW', file: 'unknown',
      description: redactSecrets(params.findings || 'No structured findings'),
      recommendation: '', timestamp: new Date().toISOString(),
    }];
  }

  postTeamFindings(params.team_name, findings);
  const summary = getBoardSummary();
  return JSON.stringify({
    status: 'posted', team: params.team_name, findings_count: findings.length,
    board_summary: summary, all_done: summary.allDone,
  });
}

export function handleGetBoardSummary(_params: Record<string, string>, _brain: BrainCache): string {
  const board = getTeamBoard();
  if (!board) return errorResponse('No active review board. Call knit_start_team_review first.');

  const summary = getBoardSummary();
  const criticals = board.findings.filter((f) => f.severity === 'CRITICAL');
  const highs = board.findings.filter((f) => f.severity === 'HIGH');

  return JSON.stringify({
    task: board.taskDescription, ...summary, team_status: board.status,
    critical_findings: criticals.map((f) => `[${f.team}] ${f.file}: ${f.description}`),
    high_findings: highs.map((f) => `[${f.team}] ${f.file}: ${f.description}`),
    gate: summary.critical > 0 ? 'BLOCKED — fix CRITICAL findings before proceeding'
      : summary.high > 0 ? 'WARNING — HIGH findings should be addressed' : 'PASSED — no blocking findings',
  });
}


// Pattern reflection — re-enabled in v0.3 alongside the cross-project (Model C)
// learnings pool. With Model C, a fresh project can benefit from patterns
// across all other projects on the machine, so reflect() is no longer
// "useless with 1 learning" — the global pool provides the data.
import { reflect } from '../engine/reflect.js';

export function handleReflect(_params: Record<string, string>, brain: BrainCache): string {
  const patterns = reflect(brain.knowledgeBase);

  if (patterns.length === 0) {
    return JSON.stringify({
      patterns: [],
      message: 'Not enough data yet. Record more learnings (minimum 3) for patterns to emerge. Also try knit_search_global_learnings for cross-project patterns.',
    });
  }

  return JSON.stringify({
    patterns: patterns.slice(0, 10).map((p) => ({
      type: p.type,
      description: p.description,
      confidence: p.confidence,
      occurrences: p.occurrences,
      domains: p.domains,
    })),
    total_patterns: patterns.length,
    insight: patterns[0].confidence >= 7
      ? `Strongest pattern: ${patterns[0].description}`
      : 'Patterns are forming but not yet high-confidence. Keep recording learnings.',
  });
}

// ─── v0.14 — agent-native slash-command discovery ───────────────────────
// Two tools that surface the user's existing slash commands / custom
// prompts so Knit's workflow protocol composes with them instead of
// duplicating them. Read-only scan; the AGENT invokes — Knit never
// shells out.

export function handleScanAgentCommands(_params: Record<string, string>, brain: BrainCache): string {
  const scan = getAgentCommands(brain.rootPath, projectDataDir(brain.rootPath));
  const byAgent = new Map<string, number>();
  for (const c of scan.commands) byAgent.set(c.agent, (byAgent.get(c.agent) ?? 0) + 1);
  return JSON.stringify({
    scanned_at: scan.scannedAt,
    workspace: scan.workspace,
    commands_count: scan.commands.length,
    by_agent: Object.fromEntries(byAgent.entries()),
    commands: summarizeAgentCommands(scan.commands),
    instruction:
      scan.commands.length === 0
        ? 'No agent-native slash commands detected. If the user adds one later (e.g. .claude/commands/test.md), re-call this tool to refresh the cache.'
        : 'When a protocol phase matches a command name (test, lint, review, ship), call knit_suggest_command({phase}) and invoke the returned command via the agent\'s native slash mechanism. Honors the user\'s existing setup instead of duplicating it.',
  });
}

export function handleSuggestCommand(params: Record<string, string>, brain: BrainCache): string {
  const phase = (params.phase || '').trim();
  if (!phase) {
    return errorResponse('phase is required (e.g. "test", "lint", "review", "ship")', { matching_commands: [] });
  }
  const scan = getAgentCommands(brain.rootPath, projectDataDir(brain.rootPath));
  const matches = suggestCommandsForPhase(scan, phase);
  return JSON.stringify({
    phase,
    matching_commands: summarizeAgentCommands(matches),
    invocation_hint:
      matches.length === 0
        ? `No agent-native command matches phase "${phase}". Proceed with the work yourself.`
        : `Invoke /${matches[0].name} via the agent's slash-command mechanism instead of describing the steps. This honors the user's existing setup.`,
  });
}

export function handleGetSuggestions(params: Record<string, string>, brain: BrainCache): string {
  const domains = (params.domains || '').split(',').map((d) => d.trim()).filter(Boolean);
  if (domains.length === 0) {
    return errorResponse('domains parameter required', { suggestions: [] });
  }

  const suggestions = getAdaptiveSuggestions(brain.knowledgeBase, domains);
  if (suggestions.length === 0) {
    return JSON.stringify({
      suggestions: [],
      message: `No patterns yet for domains: ${domains.join(', ')}. Try knit_search_global_learnings for cross-project insights.`,
    });
  }

  return JSON.stringify({
    domains_queried: domains,
    suggestions,
    message: `${suggestions.length} adaptive suggestions based on past patterns in these domains.`,
  });
}

export function handleRecordGlobalLearning(params: Record<string, string>, brain: BrainCache): string {
  const summary = redactSecrets((params.summary || '').slice(0, 500));
  const lesson = redactSecrets((params.lesson || '').slice(0, 2000));
  const tags = (params.tags || '').split(/\s+/).filter((t) => t.startsWith('#'));
  const outcomeRaw = (params.outcome || '').toLowerCase();
  const outcome = ['success', 'partial', 'failure'].includes(outcomeRaw)
    ? (outcomeRaw as 'success' | 'partial' | 'failure')
    : undefined;

  if (!summary || !lesson || tags.length === 0) {
    return errorResponse('summary, lesson, and tags are all required');
  }

  const entry = buildGlobalLearning(brain.rootPath, { summary, lesson, tags, outcome });
  appendGlobalLearning(entry);

  return JSON.stringify({
    status: 'saved',
    id: entry.id,
    project: entry.projectName,
    instruction: 'Cross-project learning saved. Future knit_search_global_learnings calls from any project will find it.',
  });
}

/** v0.8 — BM25-backed search over the cross-project global learnings pool.
 *  Same shape as v0.7.x (single `query` string), but the retriever is now
 *  BM25 with proper term-frequency saturation + IDF + length normalization.
 *  Falls back to the original substring scan if BM25 returns nothing — keeps
 *  partial-word queries like "auth bug" working even when no tokenized term
 *  fully matches. */
export function handleSearchGlobalLearnings(params: Record<string, string>, brain: BrainCache): string {
  const _brain = brain;
  const query = (params.query || '').trim();
  const limit = Math.max(1, Math.min(50, parseInt(params.limit || '10', 10) || 10));
  if (!query) {
    return errorResponse('query is required', { results: [] });
  }

  // BM25 over the full pool.
  const entries = loadAllGlobalLearnings();
  let matches: GlobalLearning[] = [];
  let retriever: 'bm25' | 'substring-fallback' = 'bm25';

  if (entries.length > 0) {
    const index = buildGlobalLearningsIndex(entries);
    // Over-fetch so the project-diversifier has candidates to pick from.
    const bm25Hits = index.search(query, Math.min(limit * 5, 50));
    // v0.10 slice 3 — global retrieval counters. Same threshold as the
    // per-project search path.
    bumpMetric(_brain.knowledgeBase, 'totalRetrievalQueries');
    if (bm25Hits.length > 0 && bm25Hits[0].score > 5.0) {
      bumpMetric(_brain.knowledgeBase, 'highScoreHits');
    }
    // v0.10 — cap per source project so one chatty project doesn't drown out
    // lessons from quieter projects in the cross-project pool.
    const diversified = diversifyByProject(bm25Hits, 2);
    const fused = rrfFuse([toRankedResults(diversified)], { k: 60 });
    const byId = new Map<string, GlobalLearning>();
    for (const e of entries) byId.set(e.id, e);
    for (const f of fused) {
      const entry = byId.get(f.id);
      if (entry) matches.push(entry);
      if (matches.length >= limit) break;
    }
  }

  // Fallback: substring scan handles partial-word queries that don't survive
  // the BM25 tokenizer (e.g. min-length filter) and tiny pools where BM25 IDF
  // hasn't accumulated enough signal.
  if (matches.length === 0) {
    matches = searchGlobalLearnings(query, limit);
    if (matches.length > 0) retriever = 'substring-fallback';
  }

  // Mark turn as having searched — same gate as knit_search_learnings.
  writeSearchMarker(_brain.rootPath);

  return JSON.stringify({
    query,
    retriever,
    count: matches.length,
    results: matches.map((m) => ({
      id: m.id,
      date: m.date,
      from_project: m.projectName,
      summary: m.summary,
      lesson: m.lesson,
      tags: m.tags,
      outcome: m.outcome,
    })),
    instruction: matches.length === 0
      ? 'No cross-project matches. This area might be new across all your projects.'
      : `Found ${matches.length} cross-project learning(s). Review before duplicating work.`,
  });
}


/** Parse the optional `include` parameter on knit_load_session.
 *  Comma-separated list of optional sections to add to the default lean
 *  response. Unknown names are ignored. Supported: patterns, teams, metrics,
 *  recent_sessions, full_learnings, full_knowledge. */
function parseLoadSessionInclude(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * v0.11.5 — concise budget + learnings health for knit_load_session.
 *
 * knit_brain_status returns the full diagnostic surface (~1KB). load_session
 * is on the hot path of every session — surface a one-line nudge only when
 * action is warranted, so over-budget repos see "fix this" instead of
 * burying the verdict in a tool the agent rarely calls.
 *
 * Read-only: returns suggestion strings; never auto-fixes.
 */
function computeBudgetHealth(brain: BrainCache): {
  verdict: 'healthy' | 'warn' | 'over-budget';
  per_session_kb: number;
  worst_surface: 'claude_md' | 'tool_registry' | 'instructions' | null;
  suggestion?: string;
} | undefined {
  let claudeMdBytes = 0;
  try { claudeMdBytes = statSync(join(brain.rootPath, 'CLAUDE.md')).size; } catch { /* missing */ }

  const shape = detectProjectShape(brain);
  const listing = computeFeatureListing(shape);
  const toolRegistryBytes = listing.totals.active * 280;
  const instructionsBytes = KNIT_INSTRUCTIONS.length;
  const perSessionOverheadBytes = claudeMdBytes + toolRegistryBytes + instructionsBytes;

  const cv = verdict(claudeMdBytes, TOKEN_BUDGETS.claude_md_bytes);
  const tv = verdict(toolRegistryBytes, TOKEN_BUDGETS.tool_registry_bytes);
  const iv = verdict(instructionsBytes, TOKEN_BUDGETS.instructions_bytes);
  const ov = verdict(perSessionOverheadBytes, TOKEN_BUDGETS.per_session_overhead_bytes);

  // Worst-of-four for overall; pick the worst single surface for the suggestion.
  const verdicts = [cv, tv, iv, ov];
  const overall: 'healthy' | 'warn' | 'over-budget' = verdicts.includes('over-budget')
    ? 'over-budget'
    : verdicts.includes('warn')
      ? 'warn'
      : 'healthy';

  if (overall === 'healthy') return undefined; // Don't add a nudge when nothing's wrong.

  // Find the worst single per-surface offender for the suggestion.
  const rank = (v: 'healthy' | 'warn' | 'over-budget'): number =>
    v === 'over-budget' ? 2 : v === 'warn' ? 1 : 0;
  const surfaces: Array<['claude_md' | 'tool_registry' | 'instructions', 'healthy' | 'warn' | 'over-budget']> = [
    ['claude_md', cv],
    ['tool_registry', tv],
    ['instructions', iv],
  ];
  surfaces.sort((a, b) => rank(b[1]) - rank(a[1]));
  const worst = surfaces[0][0];

  const suggestions: Record<typeof worst, string> = {
    claude_md: 'CLAUDE.md is over the 6.5KB target — run `knit refresh` to splice the lean marker-block, or check that the file is using the generator (not hand-curated).',
    tool_registry: 'Tool registry over budget — call knit_list_features to see which Tier-2/3 tools are active and disable any you do not need.',
    instructions: 'Instructions block over budget — likely a v0.x → v0.y growth. Restart your MCP host to pick up the trimmed instructions.',
  };

  return {
    verdict: overall,
    per_session_kb: Math.round(perSessionOverheadBytes / 1024 * 10) / 10,
    worst_surface: worst,
    suggestion: suggestions[worst],
  };
}

/**
 * v0.11.5 — learnings utilization nudge.
 *
 * Hit rate at 0% with N learnings recorded means the memory layer isn't
 * paying off — either learnings are too narrow to recall, or sessions
 * aren't calling knit_search_learnings. Surfacing this once per session
 * (only when N ≥ 5) lets the agent act on it instead of letting the
 * accumulation drift.
 *
 * Read-only: never auto-prunes; just suggests.
 */
function computeLearningsHealth(brain: BrainCache): {
  total: number;
  accessed_pct: number;
  verdict: 'healthy' | 'low-utilization';
  suggestion?: string;
} | undefined {
  const total = brain.knowledgeBase.entries.length;
  if (total < 5) return undefined; // Not enough signal — skip.
  const accessed = brain.knowledgeBase.entries.filter((e) => e.accessCount > 0).length;
  const pct = total > 0 ? Math.round((accessed / total) * 100) : 0;
  if (pct >= 30) return { total, accessed_pct: pct, verdict: 'healthy' };
  // Under 30% utilization → low. Surface a concrete next step.
  return {
    total,
    accessed_pct: pct,
    verdict: 'low-utilization',
    suggestion: `${total} learnings recorded but only ${pct}% have been recalled. Either call knit_search_learnings before re-investigating, or prune stale entries with knit_consolidate_learnings.`,
  };
}

export function handleLoadSession(params: Record<string, string>, brain: BrainCache): string {
  // v0.18 — knit_load_session marks a new logical session. Re-arm the
  // adherence tracker so a warm/resumed MCP process (which keeps module state
  // across sessions) doesn't carry a prior session's "already classified" flag
  // forward and silently stop nudging. The post-handler observeAndNudge call
  // then re-counts this load_session as call #1 of the fresh session.
  resetAdherenceState();

  const include = parseLoadSessionInclude(params.include);
  const wantAll = include.has('all');

  const root = brain.rootPath;

  // 1. Last session info — always; the agent uses this to verify continuity
  const sessionsFile = sessionsLogPath(root);
  let lastSession = null;
  if (existsSync(sessionsFile)) {
    const content = readFileSync(sessionsFile, 'utf-8');
    const sessions = content.split(/^## Session/m).slice(1);
    if (sessions.length > 0) {
      const last = sessions[sessions.length - 1].trim();
      // Default truncation: 200 chars (was 300). Full session in `include=recent_sessions`.
      lastSession = last.slice(0, 200);
    }
  }

  // 2. Handoff — always. This is the load-bearing field. Truncated to 1.5KB
  //    (was 2KB); the full handoff lives on disk and the agent can read it
  //    explicitly with the Read tool if needed.
  // v0.17 freshness layer: only surface a handoff that is still in-flight
  //    (fresh + unresolved per its sidecar). A resolved, stale (>TTL), or
  //    legacy (no sidecar) handoff is treated as superseded — it no longer
  //    resurrects "unfinished work". This auto-clears pre-v0.17 ghosts.
  // SECURITY (audit D2): handoff.md lives at the PROJECT ROOT (so the agent can
  // read it directly), which means a hostile cloned repo could ship a
  // handoff.md + handoff.meta.json to inject "resume this work" instructions on
  // first open. A genuine handoff is created by the user's OWN prior session,
  // which would have left brain state in ~/.knit — so on a project's first-ever
  // Knit touch (autoInitialized), any pre-existing root handoff is untrusted
  // and ignored. Subsequent sessions (autoInitialized=false) surface it normally.
  const handoffPath = join(root, 'handoff.md');
  let handoff = null;
  if (!brain.autoInitialized && existsSync(handoffPath) && handoffIsActive(root)) {
    // redactSecrets at READ as well as write (audit D2 defense-in-depth) — the
    // body lands in the agent's context in an instruction-framing position, so
    // re-scrub in case a handoff predates write-time redaction or was written
    // by another process (team worktrees).
    handoff = redactSecrets(readFileSync(handoffPath, 'utf-8').slice(0, 1500));
  }

  // 3. Top learnings — default 3 (was 5). include=full_learnings restores 5.
  const learningsLimit = wantAll || include.has('full_learnings') ? 5 : 3;
  const topLearnings = brain.knowledgeBase.entries
    .filter((e) => e.accessCount > 0)
    .sort((a, b) => b.accessCount - a.accessCount)
    .slice(0, learningsLimit)
    .map((e) => ({ summary: e.summary, lesson: e.lesson, tags: e.tags, accessed: e.accessCount }));

  // 4. False positives — cap at 5 by default; full list in include=full_learnings.
  const fpsLimit = wantAll || include.has('full_learnings') ? 50 : 5;
  const fps = brain.knowledgeBase.entries
    .filter((e) => e.tags.includes('#false-positive'))
    .slice(0, fpsLimit)
    .map((e) => ({ summary: e.summary, lesson: e.lesson }));

  // 5. Project knowledge summary — counts always; arrays opt-in via
  //    include=full_knowledge (otherwise fetch with knit_find_fanout / knit_query_tests).
  const wantFullKnowledge = wantAll || include.has('full_knowledge');
  const knowledge = wantFullKnowledge
    ? {
        files: brain.knowledge.summary.totalFiles,
        imports: Object.keys(brain.knowledge.importGraph).length,
        high_fanout: brain.knowledge.summary.highFanoutFiles,
        untested: brain.knowledge.summary.untestedFiles.slice(0, 5),
      }
    : {
        files: brain.knowledge.summary.totalFiles,
        imports: Object.keys(brain.knowledge.importGraph).length,
        high_fanout_count: brain.knowledge.summary.highFanoutFiles.length,
        untested_count: brain.knowledge.summary.untestedFiles.length,
      };

  // 6. Optional opt-in sections — all skipped unless explicitly requested.
  //    These were always-on pre-v0.7 and contributed most of the response bloat.
  let teams: string[] | undefined;
  if (wantAll || include.has('teams')) {
    const teamsFile = teamsPath(root);
    if (existsSync(teamsFile)) {
      try {
        const t = JSON.parse(readFileSync(teamsFile, 'utf-8'));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        teams = (t as Array<{ name: string }>).map((team: any) => team.name);
      } catch {
        teams = [];
      }
    } else {
      teams = [];
    }
  }

  let metrics: { total_sessions: number; total_learnings: number; cache_hits: number } | undefined;
  if (wantAll || include.has('metrics')) {
    metrics = {
      total_sessions: brain.knowledgeBase.metrics.totalSessions,
      total_learnings: brain.knowledgeBase.entries.length,
      cache_hits: brain.knowledgeBase.metrics.cacheHits,
    };
  }

  let recentSessions: Array<{ date: string; branch: string | null; summary: string; tags: string[]; outcome: SessionOutcome | undefined }> | undefined;
  if (wantAll || include.has('recent_sessions')) {
    recentSessions = getRecentSessions(root, 3).map((s) => ({
      date: s.date,
      branch: s.branch ?? null,
      summary: s.summary ?? '',
      tags: s.tags ?? [],
      outcome: s.outcome,
    }));
  }

  let patterns: Array<{ type: string; description: string; confidence: number }> | undefined;
  if (wantAll || include.has('patterns')) {
    patterns = reflect(brain.knowledgeBase)
      .slice(0, 3)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((p: any) => ({ type: p.type, description: p.description, confidence: p.confidence }));
  }

  // v0.11.3 — surface update_available in knit_load_session response so
  // EVERY Knit session sees the upgrade notice on the first MCP call
  // (per protocol, knit_load_session is the agent's first action).
  // brain_status had this flag since earlier but agents rarely called it;
  // load_session reaches ~100% of sessions.
  let updateAvailable: { current: string; latest: string; upgrade: string; changelog: string } | undefined;
  const cachedLatest = getCachedLatestVersion();
  if (cachedLatest && isNewerVersion(cachedLatest, VERSION)) {
    updateAvailable = {
      current: VERSION,
      latest: cachedLatest,
      upgrade: 'Restart Claude Code (quit fully + reopen) to spawn a fresh MCP. If npx serves cache, run: rm -rf ~/.npm/_npx/$(ls ~/.npm/_npx | head -1) then reopen.',
      changelog: 'https://github.com/PDgit12/knit/blob/main/CHANGELOG.md',
    };
  }

  // v0.11.5 — actionable nudges (read-only). Only surfaced when worth acting on.
  const budgetHealth = computeBudgetHealth(brain);
  const learningsHealth = computeLearningsHealth(brain);

  // v0.21 — surface onboarding preferences so the brain reflects the user's
  // stated project intent every session. Re-redact at read (defense-in-depth).
  const prefs = loadPreferences(root);
  const intentRedacted = prefs ? redactSecrets(prefs.intent || prefs.projectDescription) : '';

  const response: Record<string, unknown> = {
    session_context: {
      last_session: lastSession,
      handoff,
      has_unfinished_work: handoff !== null,
    },
    intelligence: {
      top_learnings: topLearnings,
      false_positives: fps,
      ...(patterns !== undefined ? { patterns } : {}),
    },
    project: {
      knowledge,
      ...(prefs ? { preferences: { intent: intentRedacted, strictness: prefs.strictness, focus_domains: prefs.focusDomains } } : {}),
      ...(teams !== undefined ? { teams } : {}),
      ...(metrics !== undefined ? { metrics } : {}),
      ...(recentSessions !== undefined ? { recent_sessions: recentSessions } : {}),
    },
    ...(updateAvailable ? { update_available: updateAvailable } : {}),
    ...(budgetHealth ? { budget_health: budgetHealth } : {}),
    ...(learningsHealth && learningsHealth.verdict === 'low-utilization' ? { learnings_health: learningsHealth } : {}),
    instruction: handoff
      ? 'UNFINISHED WORK DETECTED. Read the handoff above — pick up where the last session left off. Do NOT start fresh.'
      : prefs
        ? `Session loaded. Project intent: ${intentRedacted.slice(0, 160)}. ${topLearnings.length} key learnings, ${fps.length} false positives. Call knit_classify_task to begin.`
        : topLearnings.length > 0
          ? `Session loaded. ${topLearnings.length} key learnings, ${fps.length} false positives — but not onboarded yet: run knit_onboard to set this project's intent + how you want Knit to behave. Then knit_classify_task. (include=patterns,teams,metrics,recent_sessions,full_learnings,full_knowledge for more.)`
          : 'Fresh brain — not onboarded yet. Run knit_onboard to describe this project and how you want Knit to behave, then knit_classify_task to begin.',
  };

  return JSON.stringify(response);
}


/**
 * Save a session summary. OPT-IN — agent only calls this when there's a
 * narratable accomplishment a future session would search for.
 *
 * Stop hook auto-captures structured tuples (date, branch, files); this
 * adds the narrative layer (summary, tags, outcome) that makes search useful.
 */
export function handleSaveSessionSummary(params: Record<string, string>, brain: BrainCache): string {
  const validOutcomes: SessionOutcome[] = ['shipped', 'wip', 'failed', 'unknown'];
  const outcomeRaw = params.outcome || 'unknown';
  const outcome: SessionOutcome = (validOutcomes as string[]).includes(outcomeRaw)
    ? (outcomeRaw as SessionOutcome)
    : 'unknown';

  // Sanitize before persistence — every sibling write handler (record_learning,
  // record_false_positive, save_handoff) already redacts. Sessions skipped it
  // until now; pasted tokens would persist plaintext and surface forever via
  // knit_search_sessions, plus sync to the global pool when cross-project
  // learnings are enabled.
  const entry: SessionSummary = {
    id: `${Date.now()}-agent`,
    date: new Date().toISOString().split('T')[0],
    timestamp: new Date().toISOString(),
    summary: redactSecrets((params.summary || '').slice(0, 500)),
    tags: (params.tags || '').split(/\s+/).filter((t) => t.startsWith('#')).map((t) => redactSecrets(t)),
    outcome,
    filesTouched: params.files_touched
      ? params.files_touched.split(',').map((f) => f.trim()).filter(Boolean)
      : undefined,
    domainsTouched: params.domains
      ? params.domains.split(',').map((d) => d.trim()).filter(Boolean)
      : undefined,
  };

  try {
    appendSession(brain.rootPath, entry);
  } catch (err) {
    return JSON.stringify({
      status: 'error',
      error: `Failed to persist session summary: ${(err as Error).message}`,
    });
  }

  // v0.17 freshness layer — a terminal session summary supersedes any open
  // handoff. 'wip' means work continues, so we leave the handoff in-flight;
  // 'shipped'/'failed' reached a conclusion, so the next session must NOT be
  // told to "resume unfinished work". This closes the stale-handoff loop.
  const supersededHandoff = outcome === 'shipped' || outcome === 'failed';
  if (supersededHandoff) resolveHandoff(brain.rootPath);

  return JSON.stringify({
    status: 'saved',
    id: entry.id,
    summary: entry.summary,
    ...(supersededHandoff && existsSync(join(brain.rootPath, 'handoff.md'))
      ? { handoff_superseded: true }
      : {}),
    instruction: 'Session summary recorded. Future knit_search_sessions calls can find this.',
  });
}

/**
 * Fetch protocol depth for a specific workflow phase. CLAUDE.md is intentionally
 * thin — this is how agents pull the actual procedure when they need it.
 */
export function handleGetWorkflow(params: Record<string, string>, brain: BrainCache): string {
  const phase = (params.phase || '').trim().toLowerCase();

  if (!phase) {
    return JSON.stringify({
      sections: listWorkflowSections(),
      instruction: 'Call knit_get_workflow with one of the section names to fetch its content.',
    });
  }

  const buildCommands = {
    typecheck: brain.config.stack.typecheckCommand ?? undefined,
    lint: brain.config.stack.lintCommand ?? undefined,
    test: brain.config.stack.testFramework
      ? `${brain.config.packageManager === 'unknown' ? 'npm' : brain.config.packageManager} test`
      : undefined,
    build: brain.config.stack.buildCommand ?? undefined,
  };

  const content = getWorkflowSection(phase, { buildCommands });
  if (content === null) {
    return JSON.stringify({
      error: `Unknown phase: "${phase}".`,
      available: listWorkflowSections().map((s) => s.name),
    });
  }

  const toolsForPhase = PHASE_TOOLS[phase];
  return JSON.stringify({
    phase,
    content,
    ...(toolsForPhase && toolsForPhase.length > 0 ? { tools_for_phase: toolsForPhase } : {}),
    instruction: 'Apply this section to the current task. For another phase, call knit_get_workflow again with that phase name.',
  });
}

/**
 * v0.22 full-tool-use — which Knit tools to actually CALL in each phase. The
 * workflow prose says what to do; this names the tools that do it, so the agent
 * exercises the right slice of the surface instead of collapsing to 1–2 tools.
 */
const PHASE_TOOLS: Record<string, Array<{ tool: string; why: string }>> = {
  research: [
    { tool: 'knit_search_learnings', why: 'reuse prior findings before re-investigating' },
    { tool: 'knit_query_imports', why: 'map dependents / blast radius of files you’ll touch' },
    { tool: 'knit_query_exports', why: 'confirm a file’s public surface' },
  ],
  plan: [
    { tool: 'knit_spawn_team_worktree', why: 'parallelize independent multi-domain work' },
    { tool: 'knit_index_requirements', why: 'ingest a spec/RFC for per-feature retrieval' },
    { tool: 'knit_get_workflow', why: 'pull the next phase’s depth on demand' },
  ],
  execute: [
    { tool: 'knit_query_tests', why: 'know each file’s coverage before changing it' },
    { tool: 'knit_query_dependents', why: 'confirm what a change touches' },
  ],
  tdd: [
    { tool: 'knit_generate_test_cases', why: 'derive cases from indexed requirements' },
    { tool: 'knit_query_tests', why: 'find the untested files first' },
  ],
  review: [
    { tool: 'knit_verify_claim', why: 'fact-check codebase claims against the graph' },
    { tool: 'knit_query_tests', why: 'verify coverage of changed files' },
  ],
  learn: [
    { tool: 'knit_verify_claim', why: 'verify ≥1 claim before LEARN (Stop-gate)' },
    { tool: 'knit_record_learning', why: 'persist the non-obvious insight' },
  ],
  handoff: [
    { tool: 'knit_save_handoff', why: 'checkpoint state so the next session resumes cheaply' },
    { tool: 'knit_save_session_summary', why: 'make this session searchable' },
  ],
  ship: [
    { tool: 'knit_suggest_command', why: 'get the project’s test/lint/build/ship command' },
    { tool: 'knit_verify_claim', why: 'final fact-check before asserting done' },
  ],
};

/**
 * Install or refresh a subagent into <project>/.claude/agents/knit-<name>.md.
 * For runtime self-heal when a team references an agent that hasn't been
 * fetched yet. Returns a snapshot of what changed on disk.
 *
 * Note: this handler returns a Promise. The MCP dispatch layer handles
 * both sync (string) and Promise<string> returns transparently — but the
 * existing handler signature is sync. We wrap async work in a sync-looking
 * shape by returning a stringified "queued" status and letting the install
 * complete in the background. Mid-session callers get a fast ack; the file
 * lands within ~1s for bundled/cached, a few seconds for network fetches.
 */
export function handleInstallAgent(params: Record<string, string>, brain: BrainCache): string {
  const name = (params.name || '').trim();
  const refresh = (params.refresh || '').toLowerCase() === 'true';
  if (!name) return errorResponse('name is required');

  const targetPath = join(brain.rootPath, '.claude', 'agents', `knit-${name}.md`);

  // Fire the install. Background-safe — caller doesn't await.
  installAgentsForProject(
    brain.rootPath,
    brain.config,
    brain.knowledge,
    brain.knowledgeBase,
    { only: [name], refresh },
  ).catch((err) => {
    process.stderr.write(`[knit] handleInstallAgent background error for ${name}: ${err?.message ?? err}\n`);
  });

  // v0.12.2 — block up to ~2s for the file to appear so the response is
  // honest about whether the agent is invocable. Pre-v0.12.2 returned
  // `queued` immediately, and an agent that tried to invoke the subagent
  // right after would race a not-yet-written file. The audit flagged this
  // as `partial`. The wait uses Atomics.wait on a SharedArrayBuffer for a
  // proper kernel-level sleep (no busy-wait, no CPU burn). Bundled/cached
  // installs land in <100ms; network fetches usually within 2s. Beyond
  // that we return `pending` honestly so the caller knows to retry later.
  const deadline = Date.now() + 2000;
  const waitBuf = new Int32Array(new SharedArrayBuffer(4));
  while (Date.now() < deadline && !existsSync(targetPath)) {
    Atomics.wait(waitBuf, 0, 0, 50);
  }
  const installed = existsSync(targetPath);

  return JSON.stringify({
    status: installed ? 'installed' : 'pending',
    agent: name,
    target: `<project>/.claude/agents/knit-${name}.md`,
    instruction: installed
      ? `Agent ${name} installed and available for invocation.`
      : 'Install queued but file not yet on disk after 2s wait. Likely a slow network fetch; retry invocation in ~5s, or check stderr for fetch errors.',
  });
}

/**
 * Spawn a git worktree for a team. The team's agents work inside this path
 * without stepping on other teams' work.
 */
export function handleSpawnTeamWorktree(params: Record<string, string>, brain: BrainCache): string {
  const teamName = (params.team_name || '').trim();
  const taskDescription = (params.task_description || '').trim();

  if (!teamName) {
    return errorResponse('team_name is required');
  }
  if (!taskDescription) {
    return errorResponse('task_description is required');
  }

  try {
    const record = spawnWorktree(brain.rootPath, teamName, taskDescription);
    return JSON.stringify({
      status: 'spawned',
      team_name: record.teamName,
      team_slug: record.teamSlug,
      path: record.path,
      branch: record.branch,
      task_description: record.taskDescription,
      instruction: `Worktree ready at ${record.path}. Pass this path to the team's agents. They should cd there and make their changes on branch ${record.branch}. When done, call knit_finalize_team_worktree with action="merge".`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResponse(msg);
  }
}

/** List active (and optionally finalized) team worktrees for this project. */
export function handleListTeamWorktrees(params: Record<string, string>, brain: BrainCache): string {
  const includeFinalized = (params.include_finalized || '').toLowerCase() === 'true';
  const records = listWorktrees(brain.rootPath, includeFinalized);
  return JSON.stringify({
    count: records.length,
    worktrees: records.map((w) => ({
      team_name: w.teamName,
      team_slug: w.teamSlug,
      path: w.path,
      branch: w.branch,
      task_description: w.taskDescription,
      created_at: w.createdAt,
      status: w.status,
    })),
  });
}

/** Merge or discard a team's worktree. */
export function handleFinalizeTeamWorktree(params: Record<string, string>, brain: BrainCache): string {
  const teamName = (params.team_name || '').trim();
  const action = (params.action || '').trim().toLowerCase();

  if (!teamName) {
    return errorResponse('team_name is required');
  }
  if (action !== 'merge' && action !== 'discard') {
    return errorResponse('action must be "merge" or "discard"');
  }

  try {
    const result = finalizeWorktree(brain.rootPath, teamName, action);
    return JSON.stringify({
      status: result.status,
      team_name: result.worktree.teamName,
      branch: result.worktree.branch,
      conflict_files: result.conflictFiles,
      message: result.message,
      instruction: result.status === 'merged'
        ? `Worktree merged and removed. Branch ${result.worktree.branch} deleted.`
        : result.status === 'discarded'
          ? `Worktree discarded. Branch ${result.worktree.branch} deleted; changes lost.`
          : `Merge conflict on ${result.conflictFiles?.length ?? 0} file(s). Resolve in the main repo, then call this tool again with action="merge" to retry, or "discard" to throw away.`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResponse(msg);
  }
}

/**
 * Search this project's sessions.jsonl by free text over summary + tags + branch.
 * Returns most recent matches first.
 */
/** v0.8 — BM25-backed search over session summaries with branch diversification.
 *  Diversification caps results-per-branch to 2 so one verbose feature branch
 *  doesn't flood the response. The v0.7-plan's step 9.5 — trivial to add
 *  once BM25 lands, surprisingly useful in practice. */
export function handleSearchSessions(params: Record<string, string>, brain: BrainCache): string {
  const query = (params.query || '').trim();
  const limit = Math.max(1, Math.min(50, parseInt(params.limit || '10', 10) || 10));

  if (!query) {
    return errorResponse('query is required', { results: [] });
  }

  const sessions = loadAllSessions(brain.rootPath);
  let matches: SessionSummary[] = [];
  let retriever: 'bm25' | 'substring-fallback' = 'bm25';

  if (sessions.length > 0) {
    const index = buildSessionsIndex(sessions);
    // Over-fetch so diversification has candidates to choose from.
    const bm25Hits = index.search(query, Math.min(limit * 5, 50));
    // v0.10 slice 3 — session retrieval counters.
    bumpMetric(brain.knowledgeBase, 'totalRetrievalQueries');
    if (bm25Hits.length > 0 && bm25Hits[0].score > 5.0) {
      bumpMetric(brain.knowledgeBase, 'highScoreHits');
    }
    const diversified = diversifyByBranch(bm25Hits, 2);
    const byId = new Map<string, SessionSummary>();
    for (const s of sessions) byId.set(s.id, s);
    for (const r of diversified) {
      const session = byId.get(r.id);
      if (session) matches.push(session);
      if (matches.length >= limit) break;
    }
  }

  // Fallback to the original substring scan for partial-word queries that
  // don't survive tokenization.
  if (matches.length === 0) {
    matches = searchSessions(brain.rootPath, query, limit);
    if (matches.length > 0) retriever = 'substring-fallback';
  }

  return JSON.stringify({
    query,
    retriever,
    count: matches.length,
    results: matches.map((s) => ({
      id: s.id,
      date: s.date,
      branch: s.branch ?? null,
      summary: s.summary ?? '',
      tags: s.tags ?? [],
      outcome: s.outcome,
      files_modified: s.filesModified ?? (s.filesTouched?.length ?? 0),
    })),
    instruction: matches.length === 0
      ? 'No matching sessions. This might be the first time we tackle this area.'
      : `Found ${matches.length} matching past session(s). Review summaries before duplicating prior work.`,
  });
}

/**
 * Prune entries from this project's sessions.jsonl older than max_age_days.
 * Default 90 days. Atomically rewrites the file.
 */
export function handlePruneSessions(params: Record<string, string>, brain: BrainCache): string {
  const raw = parseInt(params.max_age_days || '90', 10);
  const maxAgeDays = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 36500) : 90;

  try {
    const { kept, pruned } = pruneSessionsByAge(brain.rootPath, maxAgeDays);
    return JSON.stringify({
      status: 'ok',
      kept,
      pruned,
      max_age_days: maxAgeDays,
      instruction: pruned === 0
        ? `No sessions older than ${maxAgeDays} days. Nothing to prune.`
        : `Pruned ${pruned} session(s) older than ${maxAgeDays} days. ${kept} kept.`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ status: 'error', error: msg });
  }
}
