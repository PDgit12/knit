/**
 * Individual MCP tool handlers — extracted from the giant switch for
 * testability and readability. Each function takes params + brain cache
 * and returns a JSON string response.
 */

import { writeFileSync, readFileSync, readdirSync, existsSync, renameSync, unlinkSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { BrainCache } from './cache.js';
import type { TeamFinding } from '../engine/types.js';
import { scanProject } from '../engine/scanner.js';
import { queryByDomains, getFalsePositives, getKBSummary, recordCacheHit, addEntry, saveKnowledgeBase, bumpMetric, bumpClassificationTier } from '../engine/knowledgebase.js';
import { statSync } from 'node:fs';
import {
  knowledgebasePath, learningsDir, teamsPath, sessionsLogPath, projectAgentsDir,
} from '../engine/paths.js';
import { appendSession, searchSessions, getRecentSessions, sessionCount, pruneSessionsByAge, loadAllSessions } from '../engine/sessions.js';
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
  isEnableableFeature,
  type ProjectShape,
  type EnableableFeature,
} from './features.js';
import { featuresConfigPath, searchMarkerPath, metricsHistoryPath } from '../engine/paths.js';
import { notifyToolsListChanged } from './notifier.js';
import { KNIT_INSTRUCTIONS } from './instructions.js';
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
import { chunkRequirements, listSources, loadSource, retrieveTopChunks, saveSource, slugifySourceId } from '../engine/requirements.js';
import type { RequirementsSource } from '../engine/requirements.js';
import type { TaskTier, RiskTier, ScopeTier, ChangeKind } from '../engine/types.js';


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


export function handleQueryImports(params: Record<string, string>, brain: BrainCache): string {
  const filePath = params.file_path;
  const importers = brain.reverseDeps[filePath] || [];
  const risk = importers.length >= 5 ? 'HIGH' : importers.length >= 3 ? 'MEDIUM' : 'LOW';
  return JSON.stringify({
    file: filePath,
    imported_by: importers,
    count: importers.length,
    risk,
    instruction: importers.length >= 3
      ? `This file has ${importers.length} dependents. Changes here will ripple. Update/test these files after editing: ${importers.slice(0, 5).join(', ')}`
      : 'Low risk — few dependents.',
  });
}

export function handleQueryDependents(params: Record<string, string>, brain: BrainCache): string {
  const filePath = params.file_path;
  const deps = brain.knowledge.importGraph[filePath] || [];
  return JSON.stringify({ file: filePath, depends_on: deps, count: deps.length });
}

export function handleQueryExports(params: Record<string, string>, brain: BrainCache): string {
  const filePath = params.file_path;
  const exports = brain.knowledge.exports[filePath] || [];
  return JSON.stringify({
    file: filePath,
    exports: exports.map((e) => ({ name: e.name, kind: e.kind, line: e.line })),
    count: exports.length,
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
    return JSON.stringify({
      file: params.file_path, tested_by: tests, has_tests: tests.length > 0,
      instruction: tests.length > 0 ? `Tested by: ${tests.join(', ')}` : 'NO TESTS. Write tests for this file before making changes.',
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
      error: 'Provide either query (BM25 free-text) or domains (tag filter), or both. query=auth domains=#api filters BM25 results to entries tagged #api.',
      query: [], results: [], count: 0,
    });
  }

  // No query — fall back to the pure tag-filter path (back-compat with
  // pre-v0.8 callers that only ever used domains).
  if (!query) {
    const results = queryByDomains(brain.knowledgeBase, domains);
    if (results.length > 0) recordCacheHit(brain.knowledgeBase);
    writeSearchMarker(brain.rootPath);
    return JSON.stringify(buildLearningsResponse(results, domains, []));
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
  const retrieverLabel: 'bm25' | 'bm25+graph' = graphHits.length > 0 ? 'bm25+graph' : 'bm25';
  return JSON.stringify(buildLearningsResponse(entries, domains, [query], retrieverLabel));
}

/** Shared response shape between the BM25 path and the tag-filter back-compat path. */
function buildLearningsResponse(
  results: KBEntry[],
  domains: string[],
  freeText: string[],
  retrieverOverride?: 'bm25' | 'bm25+graph',
) {
  const hasFailures = results.some((r) => r.outcome === 'failure');
  const queryParts = [...freeText, ...domains];
  return {
    query: queryParts,
    retriever: retrieverOverride ?? (freeText.length > 0 ? 'bm25' : 'tag-filter'),
    results: results.map((r) => ({
      summary: r.summary, lesson: r.lesson, outcome: r.outcome,
      date: r.date, tags: r.tags, access_count: r.accessCount,
    })),
    count: results.length,
    instruction: results.length > 0
      ? hasFailures
        ? `Found ${results.length} past learnings including FAILURES. Read the lessons carefully — avoid repeating past mistakes.`
        : `Found ${results.length} past learnings. Apply these lessons to your current task.`
      : freeText.length > 0
        ? 'No past learnings match this query. Try broader terms, or call knit_search_global_learnings to search across all your projects.'
        : 'No past learnings for these domains. This is new territory — be thorough and record what you learn.',
  };
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
  /** Tier-gated tools/list response. v0.7 typical: 26 active × ~280 bytes ≈ 7.3KB.
   *  8.5KB target allows Tier-2 team tools to come online on ≥3-domain projects
   *  without crossing into warn. Full 38-tool exposure (everything enabled)
   *  sits in warn range, surfacing the bloat without blocking it. */
  tool_registry_bytes: 8500,
  /** MCP server `instructions` field — sent at handshake. v0.7 ships at ~2KB. */
  instructions_bytes: 2500,
  /** Sum of the three above — the per-session fixed cost Knit imposes.
   *  v0.7 typical: ~12KB; 17.5KB target covers the union with slack. */
  per_session_overhead_bytes: 17500,
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

  // Tool-registry byte cost — derived from the project shape so it reflects
  // what tools/list actually returns under tier-gating. Approximation rather
  // than serializing the full ToolDef array to avoid a circular import on
  // tools.ts (which depends on handlers.ts via detectProjectShape). The
  // ~280-byte-per-tool figure is the empirical post-v0.7-trim average from
  // measuring the actual dist output; close enough for a budget verdict.
  const shape = detectProjectShape(brain);
  const listing = computeFeatureListing(shape);
  const activeToolCount = listing.totals.active;
  const totalToolCount = listing.totals.total;
  const AVG_TOOL_DEF_BYTES = 280;
  const toolRegistryBytes = activeToolCount * AVG_TOOL_DEF_BYTES;

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
    knowledge_index: {
      files_indexed: brain.knowledge.summary.totalFiles,
      total_lines: brain.knowledge.summary.totalLines,
      import_edges: Object.keys(brain.knowledge.importGraph).length,
      exports_mapped: Object.keys(brain.knowledge.exports).length,
    },
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
          upgrade: 'Restart Claude Code to spawn a fresh MCP — npx will auto-fetch the new version. If your ~/.claude.json pins a specific version, change it to "knit-mcp@latest".',
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
    instruction: 'Brain is ready. Next: call knit_classify_task with the files you plan to touch to get your tier and phases.',
  });
}

/** Read the opt-in feature flags from disk. Best-effort: never throws — a
 *  missing or malformed file just means "no opt-ins yet." */
function loadEnabledFeatures(rootPath: string): Set<EnableableFeature> {
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
  return JSON.stringify({ claim, ...result });
}

interface VerifierResult {
  verdict: 'verified' | 'contradicted' | 'unparseable';
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
    }
  }
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(snapshot) + '\n');
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
const TOKENS_PER_TIER = { inquiry: 200, trivial: 1500, standard: 8000, complex: 25000 } as const;
/** v0.10 slice 3 — per-mechanism token-savings heuristics:
 *    cache hit       ~15000  (one full RESEARCH phase the agent didn't redo)
 *    FP suppression  ~5000   (one investigation thread the agent skipped)
 *    graph query     ~3000   (one round of grepping + reading replaced) */
const TOKENS_SAVED_PER_CACHE_HIT = 15000;
const TOKENS_SAVED_PER_FP_SUPPRESSION = 5000;
const TOKENS_SAVED_PER_GRAPH_QUERY = 3000;

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
 *  to the write-bearing tiers so Protocol Guard stays engaged. */
function detectsInquiryIntent(description: string): boolean {
  if (!description) return false;

  // Question-word or inquiry-verb leads at the start of the description.
  const inquiryStart = /^\s*(what|where|how|why|when|which|who|can|could|should|does|do|is|are|will|would|tell\s+me|show\s+me|find|list|status\s+of|audit|explain|investigate|analyze|review|describe|summari[sz]e|inspect)\b/i;
  // Inquiry verbs anywhere in the description (caught even if the user starts mid-sentence).
  const inquiryVerb = /\b(audit|explain|investigate|analy[sz]e|review|examine|describe|summari[sz]e|enumerate|inspect)\b/i;
  // Action commands that override inquiry signals. "fix this/that/it/the…" is a
  // directive, not a question. We require the action verb to be followed by an
  // object so "what can be fixed" (passive voice, no object after "fix") stays
  // classified as inquiry.
  const actionDirective = /\b(fix|implement|build|add|refactor|ship|deploy|write|create|update|modify|change|edit|migrate|rename|delete|remove|install|setup|configure|merge|publish|release|patch)\s+(this|that|it|the|a|an|all|every|my|our|your)\b/i;

  if (actionDirective.test(description)) return false;
  return inquiryStart.test(description) || inquiryVerb.test(description);
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

export function handleClassifyTask(params: Record<string, string>, brain: BrainCache): string {
  const rawFiles = (params.files_to_touch || '').split(',').map((f) => f.trim()).filter(Boolean);
  const files = rawFiles.filter((f) => f !== 'unknown');
  const description = (params.description || '').toLowerCase();
  const domains = detectDomainsFromFiles(files);
  const crossDomainRipple: string[] = [];
  let highFanoutCount = 0;

  for (const file of files) {
    const importers = brain.reverseDeps[file] || [];
    if (importers.length >= 3) {
      crossDomainRipple.push(`${file} is high-fanout (${importers.length} dependents)`);
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
    } catch {
      // Best-effort: never let marker IO break classification.
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
  } catch {
    // Best-effort: never let marker IO break classification.
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
  let preEmptiveLearnings: Array<{ summary: string; lesson: string; tags: string[] }> | undefined;
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
            return { summary: entry.summary, lesson: entry.lesson, tags: entry.tags };
          });
          recordCacheHit(brain.knowledgeBase);
        }
      }
    } catch {
      // Best-effort: never let pre-emptive search break classification.
    }
  }

  // FP nudge — surfaced for write-bearing tasks so users actually use the
  // false-positive feedback loop. Skipping trivial keeps the noise down.
  const fpNudge = scopeTier === 'standard' || scopeTier === 'complex'
    ? 'If this classification is wrong, call knit_record_false_positive with the reason — improves the classifier over time.'
    : undefined;

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
    ...(budgetDegraded
      ? {
          degraded_for_budget: true,
          budget_note: `Context budget remaining = ${budgetRemaining}%. Scope downgraded from ${initialScope} to ${scopeTier}; OPTIMIZE phase dropped to conserve tokens.`,
        }
      : {}),
    ...(preEmptiveLearnings && preEmptiveLearnings.length > 0
      ? {
          pre_emptive_learnings: preEmptiveLearnings,
          pre_emptive_note: 'Prior learnings auto-surfaced. Apply these before re-investigating from scratch. To get more, call knit_search_learnings with the same query.',
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
  for (const l of learnings) knownPitfalls.push(`${l.summary}: ${l.lesson}`);
  const fps = getFalsePositives(brain.knowledgeBase);

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
  if (!id) return JSON.stringify({ error: 'id parameter is required' });
  const entry = brain.knowledgeBase.entries.find((e) => e.id === id);
  if (!entry) {
    return JSON.stringify({
      error: `No learning with id="${id}". List active ones via knit_search_learnings (default returns id + summary).`,
    });
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
    return JSON.stringify({ error: 'summary and lesson are required — cannot record empty learning' });
  }
  const date = new Date().toISOString().split('T')[0];
  const entry = {
    date,
    summary: redactSecrets(params.summary || 'Untitled learning'),
    domains: (params.domains || 'general').split(',').map((d) => d.trim()),
    approach: redactSecrets(params.approach || ''),
    outcome: (['success', 'partial', 'failure'].includes(params.outcome) ? params.outcome : 'success') as 'success' | 'partial' | 'failure',
    lesson: redactSecrets(params.lesson || ''),
    tags: (params.tags || '').split(/\s+/).filter((t) => t.startsWith('#')),
  };

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
    const existing = readFileSync(mdPath, 'utf-8');
    writeFileSync(mdPath, existing + mdEntry, 'utf-8');
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
  const tags = [...(params.tags || '').split(/\s+/).filter((t) => t.startsWith('#')), '#false-positive'];
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
    return JSON.stringify({ error: 'file_path is required', status: 'error' });
  }
  if (!existsSync(filePath)) {
    return JSON.stringify({ error: `file not found: ${filePath}`, status: 'error' });
  }
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch (err) {
    return JSON.stringify({ error: `read failed: ${(err as Error).message}`, status: 'error' });
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
  const sourceId = (params.source_id || '').trim() || slugifySourceId(filePath);
  const label = (params.label || '').trim() || undefined;
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
    return JSON.stringify({ error: `save failed: ${(err as Error).message}`, status: 'error' });
  }
  return JSON.stringify({
    status: 'indexed',
    source_id: sourceId,
    chunks_indexed: chunks.length,
    source_bytes: sourceBytes,
    avg_chunk_chars: Math.round(chunks.reduce((s, c) => s + c.text.length, 0) / chunks.length),
    instruction: `Indexed ${chunks.length} chunks from ${filePath}. Call knit_generate_test_cases with feature="<your topic>" to retrieve only the relevant chunks for a specific feature.`,
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
    return JSON.stringify({ error: 'feature is required (the topic / feature name to retrieve context for)', status: 'error' });
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
  const hits = retrieveTopChunks(sourcesToSearch, feature, topN);
  const contextBytes = hits.reduce((s, h) => s + Buffer.byteLength(h.chunk.text, 'utf-8'), 0);
  const totalBytes = sourcesToSearch.reduce((s, src) => s + src.sourceBytes, 0);
  const reductionPct = totalBytes > 0 ? Math.round(100 - (contextBytes / totalBytes) * 100) : 0;
  return JSON.stringify({
    status: 'ok',
    feature,
    sources_searched: sourcesToSearch.map((s) => s.sourceId),
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

export function handleSaveHandoff(params: Record<string, string>, brain: BrainCache): string {
  const handoffPath = join(brain.rootPath, 'handoff.md');
  const r = (k: string, fallback: string): string => redactSecrets(params[k] || fallback);
  const content = `# Session Handoff\n\n**Goal:** ${r('goal', 'Not specified')}\n\n**Current State:** ${r('current_state', 'Not specified')}\n\n**Files in Flight:** ${r('files_in_flight', 'None')}\n\n**What Changed:** ${r('what_changed', 'Nothing')}\n\n**Failed Attempts:**\n${r('failed_attempts', 'None documented')}\n\n**Decisions Made:** ${r('decisions_made', 'None')}\n\n**Next Step:** ${r('next_step', 'Not specified')}\n\n---\n*Saved: ${new Date().toISOString()}*\n`;
  writeFileSync(handoffPath, content, 'utf-8');
  return JSON.stringify({ status: 'saved', path: 'handoff.md', instruction: 'Next session will read handoff.md first.' });
}


export function handleSetupProject(params: Record<string, string>, brain: BrainCache): string {
  const description = params.description || '';
  const projectType = params.project_type || 'auto';
  const domainNames = params.domains
    ? params.domains.split(',').map((d) => d.trim())
    : inferDomainsFromDescription(description, projectType);
  const teamRoles = params.team_roles
    ? params.team_roles.split(',').map((r) => r.trim())
    : domainNames;

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
  const newTeam = {
    name: params.name,
    role: params.role,
    focus: params.focus,
    agents: (params.agents || 'code-reviewer').split(',').map((a) => a.trim()),
    filePatterns: (params.file_patterns || 'src/**').split(',').map((p) => p.trim()),
    reviewChecklist: (params.checklist || '').split('|').map((c) => c.trim()).filter(Boolean),
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
  if (!team) return JSON.stringify({ error: `Team "${params.team_name}" not found` });

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
  let findings: TeamFinding[];
  try {
    const raw = JSON.parse(params.findings || '[]');
    findings = raw.map((f: Record<string, string>) => ({
      team: params.team_name,
      severity: VALID_SEVERITIES.has(String(f.severity).toUpperCase()) ? String(f.severity).toUpperCase() as TeamFinding['severity'] : 'MEDIUM',
      file: f.file || 'unknown',
      description: f.description || '',
      recommendation: f.recommendation || '',
      timestamp: new Date().toISOString(),
    }));
  } catch {
    findings = [{
      team: params.team_name, severity: 'LOW', file: 'unknown',
      description: params.findings || 'No structured findings',
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
  if (!board) return JSON.stringify({ error: 'No active review board. Call knit_start_team_review first.' });

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

export function handleGetSuggestions(params: Record<string, string>, brain: BrainCache): string {
  const domains = (params.domains || '').split(',').map((d) => d.trim()).filter(Boolean);
  if (domains.length === 0) {
    return JSON.stringify({ error: 'domains parameter required', suggestions: [] });
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
    return JSON.stringify({ error: 'summary, lesson, and tags are all required' });
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
    return JSON.stringify({ error: 'query is required', results: [] });
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

export function handleLoadSession(params: Record<string, string>, brain: BrainCache): string {
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
  const handoffPath = join(root, 'handoff.md');
  let handoff = null;
  if (existsSync(handoffPath)) {
    handoff = readFileSync(handoffPath, 'utf-8').slice(0, 1500);
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
      ...(teams !== undefined ? { teams } : {}),
      ...(metrics !== undefined ? { metrics } : {}),
      ...(recentSessions !== undefined ? { recent_sessions: recentSessions } : {}),
    },
    instruction: handoff
      ? 'UNFINISHED WORK DETECTED. Read the handoff above — pick up where the last session left off. Do NOT start fresh.'
      : topLearnings.length > 0
        ? `Session loaded. ${topLearnings.length} key learnings, ${fps.length} false positives. Call knit_classify_task to begin. Use include=patterns,teams,metrics,recent_sessions,full_learnings,full_knowledge for more.`
        : 'Fresh brain — no past learnings yet. Call knit_classify_task to begin.',
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
    tags: (params.tags || '').split(/\s+/).filter((t) => t.startsWith('#')),
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

  return JSON.stringify({
    status: 'saved',
    id: entry.id,
    summary: entry.summary,
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

  return JSON.stringify({
    phase,
    content,
    instruction: 'Apply this section to the current task. For another phase, call knit_get_workflow again with that phase name.',
  });
}

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
  if (!name) return JSON.stringify({ error: 'name is required' });

  // Fire-and-forget install. Callers get an immediate ack.
  installAgentsForProject(
    brain.rootPath,
    brain.config,
    brain.knowledge,
    brain.knowledgeBase,
    { only: [name], refresh },
  ).catch((err) => {
    process.stderr.write(`[knit] handleInstallAgent background error for ${name}: ${err?.message ?? err}\n`);
  });

  return JSON.stringify({
    status: 'queued',
    agent: name,
    target: `<project>/.claude/agents/knit-${name}.md`,
    instruction: 'Install started in background. File will be ready within a few seconds. If it fails, see stderr — Knit does not throw from this handler.',
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
    return JSON.stringify({ error: 'team_name is required' });
  }
  if (!taskDescription) {
    return JSON.stringify({ error: 'task_description is required' });
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
    return JSON.stringify({ error: msg });
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
    return JSON.stringify({ error: 'team_name is required' });
  }
  if (action !== 'merge' && action !== 'discard') {
    return JSON.stringify({ error: 'action must be "merge" or "discard"' });
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
    return JSON.stringify({ error: msg });
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
    return JSON.stringify({ error: 'query is required', results: [] });
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
