/**
 * Individual MCP tool handlers — extracted from the giant switch for
 * testability and readability. Each function takes params + brain cache
 * and returns a JSON string response.
 */

import { writeFileSync, readFileSync, readdirSync, existsSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { BrainCache } from './cache.js';
import type { TeamFinding } from '../engine/types.js';
import { scanProject } from '../engine/scanner.js';
import { queryByDomains, getFalsePositives, getKBSummary, recordCacheHit, addEntry, saveKnowledgeBase } from '../engine/knowledgebase.js';
import { statSync } from 'node:fs';
import {
  knowledgebasePath, learningsDir, teamsPath, sessionsLogPath, projectAgentsDir,
} from '../engine/paths.js';
import { appendSession, searchSessions, getRecentSessions, sessionCount, pruneSessionsByAge } from '../engine/sessions.js';
import type { SessionSummary, SessionOutcome } from '../engine/types.js';
import { getWorkflowSection, listWorkflowSections } from '../generators/workflow-protocol.js';
import { spawnWorktree, listWorktrees, finalizeWorktree } from '../engine/worktrees.js';
import {
  appendGlobalLearning, searchGlobalLearnings, buildGlobalLearning,
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
import { featuresConfigPath } from '../engine/paths.js';
import { notifyToolsListChanged } from './notifier.js';
import { KNIT_INSTRUCTIONS } from './instructions.js';
import { getCachedLatestVersion, isNewerVersion } from './update-check.js';
import { VERSION } from '../version.js';
import {
  buildDefaultTeams, generateTeamPrompt, loadCustomTeams, saveCustomTeams,
  startTeamBoard, getTeamBoard, markTeamWorking, postTeamFindings,
  getOtherTeamFindings, getBoardSummary,
} from '../engine/teams.js';
import {
  isValidStrictness, readProtocolConfig, writeClassificationMarker, writeProtocolConfig,
} from '../engine/protocol-guard.js';
import type { TaskTier } from '../engine/types.js';


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

export function handleSearchLearnings(params: Record<string, string>, brain: BrainCache): string {
  const domains = (params.domains || '').split(',').map((d) => d.trim()).filter(Boolean);
  if (domains.length === 0) return JSON.stringify({ error: 'domains parameter is required', query: [], results: [], count: 0 });
  const results = queryByDomains(brain.knowledgeBase, domains);
  if (results.length > 0) recordCacheHit(brain.knowledgeBase);
  const hasFailures = results.some((r) => r.outcome === 'failure');
  return JSON.stringify({
    query: domains,
    results: results.map((r) => ({
      summary: r.summary, lesson: r.lesson, outcome: r.outcome,
      date: r.date, tags: r.tags, access_count: r.accessCount,
    })),
    count: results.length,
    instruction: results.length > 0
      ? hasFailures
        ? `Found ${results.length} past learnings including FAILURES. Read the lessons carefully — avoid repeating past mistakes.`
        : `Found ${results.length} past learnings. Apply these lessons to your current task.`
      : 'No past learnings for these domains. This is new territory — be thorough and record what you learn.',
  });
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

export function handleClassifyTask(params: Record<string, string>, brain: BrainCache): string {
  const rawFiles = (params.files_to_touch || '').split(',').map((f) => f.trim()).filter(Boolean);
  const files = rawFiles.filter((f) => f !== 'unknown');
  const description = (params.description || '').toLowerCase();
  const domains = detectDomainsFromFiles(files);
  const crossDomainRipple: string[] = [];

  for (const file of files) {
    const importers = brain.reverseDeps[file] || [];
    if (importers.length >= 3) crossDomainRipple.push(`${file} is high-fanout (${importers.length} dependents)`);
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
    return JSON.stringify({
      tier: 'inquiry',
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
    || description.length > 100; // long descriptions = complex tasks

  const tier: TaskTier = isNewProject
    ? (descriptionIsComplex ? 'complex' : 'standard')
    : (domains.size >= 3 || isTypes || isAuth || files.length > 3)
      ? 'complex' : (domains.size >= 2 || files.length > 1) ? 'standard' : 'trivial';

  const phases = tier === 'complex'
    ? ['RESEARCH', 'IDEATE', 'PLAN', 'EXECUTE', 'OPTIMIZE', 'REVIEW', 'LEARN']
    : tier === 'standard'
      ? ['RESEARCH', 'EXECUTE', 'OPTIMIZE', 'REVIEW', 'LEARN']
      : ['EXECUTE', 'VERIFY', 'LEARN'];

  const instruction = tier === 'complex'
    ? 'ENTER PLAN MODE NOW. Call EnterPlanMode tool immediately. Do NOT start coding without a plan. This task touches 3+ domains and requires RESEARCH → IDEATE → PLAN → EXECUTE → OPTIMIZE → REVIEW → LEARN.'
    : tier === 'standard'
      ? 'Follow phases: RESEARCH → EXECUTE → OPTIMIZE → REVIEW → LEARN. No plan mode needed but do research first.'
      : 'Simple task. EXECUTE → VERIFY → LEARN. Do it directly, then record what you learned.';

  // Protocol Guard side effect: write classification marker so PreToolUse
  // hook lets Edit/Write through this turn. See src/engine/protocol-guard.ts.
  try {
    writeClassificationMarker(brain.rootPath, {
      turnId: `${Date.now()}-${process.pid}`,
      classifiedAt: new Date().toISOString(),
      tier,
      files,
    });
  } catch {
    // Best-effort: never let marker IO break classification.
  }

  // Minimal-mode response by default; verbose=true (or "1") restores the
  // diagnostic fields (reasoning, cross_domain_ripple, files_count) for
  // debugging without paying their token cost on every routine call.
  const verbose = params.verbose === 'true' || params.verbose === '1';
  const base = {
    tier,
    affected_domains: [...domains],
    phases,
    auto_plan_mode: tier === 'complex',
    instruction,
  };
  if (!verbose) {
    return JSON.stringify(base);
  }
  return JSON.stringify({
    ...base,
    files_count: files.length,
    cross_domain_ripple: crossDomainRipple,
    reasoning: tier === 'complex'
      ? `Complex: ${domains.size} domains affected${isTypes ? ', touches shared types' : ''}${isAuth ? ', security-sensitive' : ''}`
      : tier === 'standard' ? `Standard: ${domains.size} domain(s), ${files.length} file(s)` : `Trivial: 1 domain, simple change`,
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

  return JSON.stringify({
    domain_context: {
      affected_domains: [...affectedDomains], files_to_touch: files,
      cross_domain_ripple: ripple, known_pitfalls: knownPitfalls,
      false_positives: fps.map((fp) => `${fp.summary}: ${fp.lesson}`),
    },
    instruction: 'Pass this entire object to every agent prompt in EXECUTE, OPTIMIZE, and REVIEW phases.',
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
  const entry = {
    date,
    summary: redactSecrets(params.summary || 'Untitled FP'),
    domains: ['General'],
    approach: 'Verified manually',
    outcome: 'success' as const,
    lesson: redactSecrets(params.reason || 'Confirmed non-issue'),
    tags: [...(params.tags || '').split(/\s+/).filter((t) => t.startsWith('#')), '#false-positive'],
  };

  addEntry(brain.knowledgeBase, entry);
  saveKnowledgeBase(knowledgebasePath(brain.rootPath), brain.knowledgeBase);

  return JSON.stringify({
    status: 'recorded', summary: entry.summary,
    total_false_positives: getFalsePositives(brain.knowledgeBase).length,
    instruction: 'This will be included in future agent prompts as a DO NOT FLAG item.',
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

export function handleSearchGlobalLearnings(params: Record<string, string>, _brain: BrainCache): string {
  const query = (params.query || '').trim();
  const limit = Math.max(1, Math.min(50, parseInt(params.limit || '10', 10) || 10));
  if (!query) {
    return JSON.stringify({ error: 'query is required', results: [] });
  }

  const matches = searchGlobalLearnings(query, limit);
  return JSON.stringify({
    query,
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

  const entry: SessionSummary = {
    id: `${Date.now()}-agent`,
    date: new Date().toISOString().split('T')[0],
    timestamp: new Date().toISOString(),
    summary: (params.summary || '').slice(0, 500),
    tags: (params.tags || '').split(/\s+/).filter((t) => t.startsWith('#')),
    outcome,
    filesTouched: params.files_touched
      ? params.files_touched.split(',').map((f) => f.trim()).filter(Boolean)
      : undefined,
    domainsTouched: params.domains
      ? params.domains.split(',').map((d) => d.trim()).filter(Boolean)
      : undefined,
  };

  appendSession(brain.rootPath, entry);

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
export function handleSearchSessions(params: Record<string, string>, brain: BrainCache): string {
  const query = params.query || '';
  const limit = Math.max(1, Math.min(50, parseInt(params.limit || '10', 10) || 10));

  if (!query.trim()) {
    return JSON.stringify({ error: 'query is required', results: [] });
  }

  const matches = searchSessions(brain.rootPath, query, limit);
  return JSON.stringify({
    query,
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
