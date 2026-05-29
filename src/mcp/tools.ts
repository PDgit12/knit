/**
 * MCP tool definitions and routing.
 * Handlers are in handlers.ts — this file is just the schema + router.
 *
 * Descriptions are intentionally terse. The first sentence tells the agent
 * what the tool does; the parameter schemas tell it how to call it. Anything
 * longer is duplication and pure context tax.
 */

import type { BrainCache } from './cache.js';
import {
  handleQueryImports, handleQueryDependents, handleQueryExports,
  handleQueryTests, handleFindFanout, handleSearchLearnings,
  handleGetFalsePositives, handleBrainStatus,
  handleClassifyTask, handleBuildContext, handleRecordLearning,
  handleRecordFalsePositive, handleSaveHandoff, handleSetupProject,
  handleLoadSession,
  handleGetTeams, handleDefineTeam, handleStartTeamReview,
  handleGetTeamPrompt, handlePostTeamFindings, handleGetBoardSummary,
  handleSaveSessionSummary, handleSearchSessions, handleGetWorkflow,
  handleSpawnTeamWorktree, handleListTeamWorktrees, handleFinalizeTeamWorktree,
  handleRecordGlobalLearning, handleSearchGlobalLearnings,
  handleReflect, handleGetSuggestions,
  handleInstallAgent, handlePruneSessions,
  handleSetProtocolStrictness, handleGetProtocolStrictness,
  handleListFeatures, handleEnableFeature, handleDisableFeature,
  handleScanIntegrations, handleCompoundingMetrics, handleGetMetricsHistory, handleVerifyClaim,
  handleGetCalibration, handleResetCalibration,
  handleIndexRequirements, handleGenerateTestCases, handleListRequirements, handleDeleteRequirements,
  handleGetFingerprint, handleInferDomains, handleComposeTemplate,
  handleGetLearning, handleConsolidateLearnings,
  handleScanAgentCommands, handleSuggestCommand,
  detectProjectShape,
} from './handlers.js';
import { isToolActive, TOOL_REGISTRY, type ProjectShape } from './features.js';
import { observeAndNudge } from './adherence.js';

/** MCP tool definition.
 *  v0.12.2: property-level `description` is OPTIONAL. The MCP spec allows it
 *  to be omitted, and we drop it for self-documenting field names like
 *  `file_path` / `query` / `limit` to keep the handshake registry lean. */
interface ToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
}

/** All tool definitions exposed by the Knit MCP server.
 *  v0.12.2: descriptions trimmed (moderate option A). Property-level
 *  descriptions removed where the field name is self-documenting; tool-level
 *  descriptions cut to functional purpose + when-to-use. Saves ~6KB at
 *  handshake vs pre-v0.12.2. Non-obvious params keep their description. */
export function getToolDefinitions(): ToolDef[] {
  return [
    // ── Query (read the brain) ───────────────────────────────────
    {
      name: 'knit_query_imports',
      description: '[GRAPH] WHO IMPORTS this file. Blast radius before editing.',
      inputSchema: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] },
    },
    {
      name: 'knit_query_dependents',
      description: '[GRAPH] WHAT THIS FILE IMPORTS (forward deps).',
      inputSchema: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] },
    },
    {
      name: 'knit_query_exports',
      description: '[GRAPH] Exports from a file: functions, classes, types, constants.',
      inputSchema: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] },
    },
    {
      name: 'knit_query_tests',
      description: '[GRAPH] Tests covering a file, or filter="untested" for all untested files.',
      inputSchema: { type: 'object', properties: { file_path: { type: 'string' }, filter: { type: 'string' } } },
    },
    {
      name: 'knit_find_fanout',
      description: '[GRAPH] High-fanout files. Editing these is high-risk.',
      inputSchema: { type: 'object', properties: { min_importers: { type: 'string' } } },
    },
    {
      name: 'knit_search_learnings',
      description: '[MEMORY] Search project learnings. BM25 + graph fusion (pass files=).',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          domains: { type: 'string' },
          files: { type: 'string' },
          limit: { type: 'string' },
        },
      },
    },
    {
      name: 'knit_get_false_positives',
      description: 'List confirmed non-issues to suppress in review prompts.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'knit_brain_status',
      description: 'Brain health: learnings, hit rate, CLAUDE.md size, session count.',
      inputSchema: { type: 'object', properties: {} },
    },

    // ── Update (write to the brain) ──────────────────────────────
    {
      name: 'knit_classify_task',
      description: '[PROTOCOL] BEFORE any Edit/Write. Returns risk_tier, scope_tier, change_kind, auto_plan_mode.',
      inputSchema: { type: 'object', properties: { files_to_touch: { type: 'string', description: 'Comma-separated files, or "unknown".' }, description: { type: 'string' }, verbose: { type: 'string' }, context_budget_remaining: { type: 'string', description: '0–100. <30 downgrades scope.' } }, required: ['files_to_touch'] },
    },
    {
      name: 'knit_build_context',
      description: 'Build Domain Context Object: affected domains, ripple, pitfalls, FPs.',
      inputSchema: { type: 'object', properties: { files_to_touch: { type: 'string' } }, required: ['files_to_touch'] },
    },
    {
      name: 'knit_record_learning',
      description: '[MEMORY-WRITE] Record a non-obvious project insight. Refuses duplicates by substring match on summary.',
      inputSchema: { type: 'object', properties: { summary: { type: 'string' }, domains: { type: 'string' }, approach: { type: 'string' }, outcome: { type: 'string', description: 'success | partial | failure.' }, lesson: { type: 'string' }, tags: { type: 'string' } }, required: ['summary', 'lesson', 'tags'] },
    },
    {
      name: 'knit_record_false_positive',
      description: 'Mark a non-issue. Add #direction tag (e.g. #complex-was-trivial) to tune calibration.',
      inputSchema: { type: 'object', properties: { summary: { type: 'string' }, reason: { type: 'string' }, tags: { type: 'string' } }, required: ['summary', 'reason'] },
    },
    {
      name: 'knit_get_calibration',
      description: 'Read classifier calibration: FP counters, scope/risk adjustments.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'knit_reset_calibration',
      description: 'Wipe classifier calibration to default. Admin tier.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'knit_index_requirements',
      description: 'Ingest a requirements/spec/RFC doc into a BM25-indexed store. Pair with knit_generate_test_cases.',
      inputSchema: { type: 'object', properties: { file_path: { type: 'string', description: 'Absolute path.' }, source_id: { type: 'string' }, label: { type: 'string' }, min_chars: { type: 'string' } }, required: ['file_path'] },
    },
    {
      name: 'knit_generate_test_cases',
      description: 'Query indexed requirements. Returns top-N chunks via BM25+RRF + test-gen template.',
      inputSchema: { type: 'object', properties: { feature: { type: 'string' }, source_id: { type: 'string' }, top_n: { type: 'string' } }, required: ['feature'] },
    },
    {
      name: 'knit_list_requirements',
      description: 'List indexed requirements sources (no chunks). Call before knit_generate_test_cases.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'knit_delete_requirements',
      description: 'Delete an indexed source by id.',
      inputSchema: { type: 'object', properties: { source_id: { type: 'string' } }, required: ['source_id'] },
    },
    {
      name: 'knit_get_fingerprint',
      description: 'Project fingerprint: languages, framework, test/lint/build commands, CI files.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'knit_infer_domains',
      description: 'Rank candidate domains via git co-change + import-graph + test colocation (RRF).',
      inputSchema: { type: 'object', properties: { lookback_days: { type: 'string' } } },
    },
    {
      name: 'knit_compose_template',
      description: 'Preview CLAUDE.md sections from fingerprint + domains. Paste to accept.',
      inputSchema: { type: 'object', properties: { project_name: { type: 'string' } } },
    },
    {
      name: 'knit_save_handoff',
      description: '[END SESSION — UNFINISHED] Save state. failed_attempts is load-bearing.',
      inputSchema: { type: 'object', properties: { goal: { type: 'string' }, current_state: { type: 'string' }, files_in_flight: { type: 'string' }, what_changed: { type: 'string' }, failed_attempts: { type: 'string' }, decisions_made: { type: 'string' }, next_step: { type: 'string' } }, required: ['goal', 'current_state', 'failed_attempts', 'next_step'] },
    },
    {
      name: 'knit_setup_project',
      description: 'Bootstrap domain teams for a non-code project.',
      inputSchema: {
        type: 'object',
        properties: {
          project_type: { type: 'string', description: 'code | research | analysis | writing | design | custom.' },
          description: { type: 'string' },
          domains: { type: 'string' },
          team_roles: { type: 'string' },
        },
        required: ['description'],
      },
    },

    // ── Teams (parallel review board) ────────────────────────────
    {
      name: 'knit_get_teams',
      description: 'List teams configured for this project.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'knit_define_team',
      description: 'Create or update a custom team.',
      inputSchema: { type: 'object', properties: { name: { type: 'string' }, role: { type: 'string' }, focus: { type: 'string' }, agents: { type: 'string' }, file_patterns: { type: 'string' }, checklist: { type: 'string', description: 'Pipe-separated.' } }, required: ['name', 'role', 'focus'] },
    },
    {
      name: 'knit_start_team_review',
      description: 'Start a parallel team review with a shared findings board.',
      inputSchema: { type: 'object', properties: { task_description: { type: 'string' }, teams: { type: 'string', description: 'Comma-separated or "all".' } }, required: ['task_description'] },
    },
    {
      name: 'knit_get_team_prompt',
      description: 'Get a team\'s prompt with other teams\' findings included.',
      inputSchema: { type: 'object', properties: { team_name: { type: 'string' }, files_to_review: { type: 'string' } }, required: ['team_name'] },
    },
    {
      name: 'knit_post_team_findings',
      description: 'Post team findings to the shared board.',
      inputSchema: { type: 'object', properties: { team_name: { type: 'string' }, findings: { type: 'string', description: 'JSON array.' } }, required: ['team_name', 'findings'] },
    },
    {
      name: 'knit_get_board_summary',
      description: 'Cross-team findings, severity-gated.',
      inputSchema: { type: 'object', properties: {} },
    },

    // ── Session memory ───────────────────────────────────────────
    {
      name: 'knit_load_session',
      description: '[PROTOCOL FIRST] Call once at session start. Returns handoff, top learnings, FPs. Opt in via include=patterns,teams,metrics,recent_sessions,full_learnings,all.',
      inputSchema: { type: 'object', properties: { include: { type: 'string' } } },
    },
    {
      name: 'knit_save_session_summary',
      description: '[END SESSION] Record a session summary. Pair with knit_save_handoff if unfinished.',
      inputSchema: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          tags: { type: 'string' },
          outcome: { type: 'string', description: 'shipped | wip | failed | unknown.' },
          files_touched: { type: 'string' },
          domains: { type: 'string' },
        },
        required: ['summary', 'tags', 'outcome'],
      },
    },
    {
      name: 'knit_prune_sessions',
      description: 'Prune sessions older than max_age_days (default 90). Atomic.',
      inputSchema: {
        type: 'object',
        properties: { max_age_days: { type: 'string' } },
      },
    },
    {
      name: 'knit_search_sessions',
      description: '[MEMORY] "Have I done this task before?" — search past SESSION summaries.',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' }, limit: { type: 'string' } },
        required: ['query'],
      },
    },

    // ── Workflow on demand ───────────────────────────────────────
    {
      name: 'knit_get_workflow',
      description: 'Fetch one workflow section. Omit phase to list all.',
      inputSchema: {
        type: 'object',
        properties: { phase: { type: 'string', description: 'overview|tier|phases|research|ideate|plan|execute|optimize|review|tdd|learn|handoff|ship|tools.' } },
      },
    },

    // ── Parallel team worktrees ──────────────────────────────────
    {
      name: 'knit_spawn_team_worktree',
      description: 'Create a git worktree for a team to write in parallel without colliding.',
      inputSchema: {
        type: 'object',
        properties: { team_name: { type: 'string' }, task_description: { type: 'string' } },
        required: ['team_name', 'task_description'],
      },
    },
    {
      name: 'knit_list_team_worktrees',
      description: 'List active team worktrees. include_finalized=true for full history.',
      inputSchema: {
        type: 'object',
        properties: { include_finalized: { type: 'string' } },
      },
    },
    // ── Cross-project learnings (Model C — global pool) ─────────
    {
      name: 'knit_record_global_learning',
      description: '[MEMORY-WRITE] Record a learning that generalizes across projects. Sparingly.',
      inputSchema: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          lesson: { type: 'string' },
          tags: { type: 'string' },
          outcome: { type: 'string' },
        },
        required: ['summary', 'lesson', 'tags'],
      },
    },
    {
      name: 'knit_search_global_learnings',
      description: '[MEMORY] Search learnings across ALL projects on this machine.',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' }, limit: { type: 'string' } },
        required: ['query'],
      },
    },

    // ── Pattern reflection (now backed by Model C, useful with ≥3 entries) ──
    {
      name: 'knit_reflect',
      description: 'Detect patterns across learnings. Needs ≥3 entries.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'knit_get_suggestions',
      description: 'Adaptive warnings from past patterns.',
      inputSchema: { type: 'object', properties: { domains: { type: 'string' } }, required: ['domains'] },
    },

    {
      name: 'knit_install_agent',
      description: 'Install one VoltAgent subagent into .claude/agents/, personalized.',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string' }, refresh: { type: 'string' } },
        required: ['name'],
      },
    },
    {
      name: 'knit_finalize_team_worktree',
      description: 'Merge or discard a team\'s worktree. Surfaces conflicts without destroying it.',
      inputSchema: {
        type: 'object',
        properties: { team_name: { type: 'string' }, action: { type: 'string', description: 'merge | discard.' } },
        required: ['team_name', 'action'],
      },
    },

    // ── Protocol Guard ───────────────────────────────────────────
    {
      name: 'knit_set_protocol_strictness',
      description: 'Set Protocol Guard: off | warn (default) | block.',
      inputSchema: { type: 'object', properties: { level: { type: 'string' } }, required: ['level'] },
    },
    {
      name: 'knit_get_protocol_strictness',
      description: 'Read Protocol Guard strictness.',
      inputSchema: { type: 'object', properties: {} },
    },

    // ── Meta — feature discoverability ───────────────────────────
    {
      name: 'knit_list_features',
      description: 'List active vs hidden Knit tools and why.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'knit_enable_feature',
      description: 'Enable a Tier-2/3 feature flag. Persisted.',
      inputSchema: {
        type: 'object',
        properties: { feature: { type: 'string', description: 'teams | subagents | admin | diagnostics.' } },
        required: ['feature'],
      },
    },
    {
      name: 'knit_disable_feature',
      description: 'Disable a feature flag. Auto-exposed tools stay visible.',
      inputSchema: {
        type: 'object',
        properties: { feature: { type: 'string' } },
        required: ['feature'],
      },
    },
    {
      name: 'knit_scan_integrations',
      description: 'Re-scan host for existing frameworks (Ruflo, gstack, CodeTour).',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'knit_compounding_metrics',
      description: 'Sessions / learnings / reuse-ratio / tokens-saved estimate.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'knit_get_metrics_history',
      description: 'Weekly metrics snapshots + WoW deltas for trend charts.',
      inputSchema: { type: 'object', properties: { limit: { type: 'string' } } },
    },
    {
      name: 'knit_verify_claim',
      description: '[REVIEW] Fact-check one claim before LEARN. Patterns: "A imports B", "X exports Y", "A is tested by B", "X exists".',
      inputSchema: { type: 'object', properties: { claim: { type: 'string' } }, required: ['claim'] },
    },
    {
      name: 'knit_get_learning',
      description: '[MEMORY] Expand ONE learning by id. Hierarchical retrieval — search returns headlines, this fetches details.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
    {
      name: 'knit_consolidate_learnings',
      description: 'Cluster similar learnings (Jaccard tag overlap) and propose pattern entries. Dry-run unless commit=true.',
      inputSchema: {
        type: 'object',
        properties: {
          min_cluster_size: { type: 'string' },
          jaccard_threshold: { type: 'string' },
          commit: { type: 'string' },
        },
      },
    },
    {
      name: 'knit_scan_agent_commands',
      description: '[DISCOVERY] Scan host agent for user-defined slash commands and surface them. Pair with knit_suggest_command.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'knit_suggest_command',
      description: '[WORKFLOW] Given a phase (test/lint/review/ship), return matching agent-native slash commands.',
      inputSchema: {
        type: 'object',
        properties: { phase: { type: 'string' } },
        required: ['phase'],
      },
    },
  ];
}

/** Filter the tool definitions by project shape — used by ListToolsRequestSchema
 *  handlers so hidden Tier-2/3 tools don't appear in the agent's tool list at all.
 *  Falls through to the full registry if no shape is provided, so direct callers
 *  (tests, ad-hoc scripts) still get everything. */
export function getActiveToolDefinitions(shape?: ProjectShape): ToolDef[] {
  const all = getToolDefinitions();
  if (!shape) return all;
  const activeNames = new Set(
    TOOL_REGISTRY.filter((info) => isToolActive(info, shape)).map((info) => info.tool),
  );
  return all.filter((def) => activeNames.has(def.name));
}

/** Convenience: build the shape from a brain and return its filtered tool list.
 *  Server.ts and cli.ts's runMCP both call this in their ListToolsRequestSchema
 *  handlers so the agent never sees tools it can't usefully call. */
export function getActiveToolDefinitionsForBrain(brain: BrainCache): ToolDef[] {
  return getActiveToolDefinitions(detectProjectShape(brain));
}

/** v0.12.1 — exact byte cost of the active tool registry as the MCP server
 *  serializes it. Used by handleBrainStatus to compute per_session_kb honestly
 *  instead of multiplying activeCount by a hardcoded average (pre-v0.12.1 used
 *  280 bytes, which understated real definitions averaging ~370 bytes and
 *  hid an over-budget condition). */
export function estimateActiveToolRegistryBytes(shape: ProjectShape): number {
  const defs = getActiveToolDefinitions(shape);
  return Buffer.byteLength(JSON.stringify(defs), 'utf-8');
}

/** Handler routing table */
const handlers: Record<string, (params: Record<string, string>, brain: BrainCache) => string> = {
  knit_query_imports: handleQueryImports,
  knit_query_dependents: handleQueryDependents,
  knit_query_exports: handleQueryExports,
  knit_query_tests: handleQueryTests,
  knit_find_fanout: handleFindFanout,
  knit_search_learnings: handleSearchLearnings,
  knit_get_false_positives: handleGetFalsePositives,
  knit_brain_status: handleBrainStatus,
  knit_classify_task: handleClassifyTask,
  knit_build_context: handleBuildContext,
  knit_record_learning: handleRecordLearning,
  knit_record_false_positive: handleRecordFalsePositive,
  knit_save_handoff: handleSaveHandoff,
  knit_setup_project: handleSetupProject,
  knit_get_teams: handleGetTeams,
  knit_define_team: handleDefineTeam,
  knit_start_team_review: handleStartTeamReview,
  knit_get_team_prompt: handleGetTeamPrompt,
  knit_post_team_findings: handlePostTeamFindings,
  knit_get_board_summary: handleGetBoardSummary,
  knit_load_session: handleLoadSession,
  knit_save_session_summary: handleSaveSessionSummary,
  knit_search_sessions: handleSearchSessions,
  knit_prune_sessions: handlePruneSessions,
  knit_get_workflow: handleGetWorkflow,
  knit_spawn_team_worktree: handleSpawnTeamWorktree,
  knit_list_team_worktrees: handleListTeamWorktrees,
  knit_finalize_team_worktree: handleFinalizeTeamWorktree,
  knit_record_global_learning: handleRecordGlobalLearning,
  knit_search_global_learnings: handleSearchGlobalLearnings,
  knit_reflect: handleReflect,
  knit_get_suggestions: handleGetSuggestions,
  knit_install_agent: handleInstallAgent,
  knit_set_protocol_strictness: handleSetProtocolStrictness,
  knit_get_protocol_strictness: handleGetProtocolStrictness,
  knit_list_features: handleListFeatures,
  knit_enable_feature: handleEnableFeature,
  knit_disable_feature: handleDisableFeature,
  knit_scan_integrations: handleScanIntegrations,
  knit_compounding_metrics: handleCompoundingMetrics,
  knit_get_metrics_history: handleGetMetricsHistory,
  knit_get_calibration: handleGetCalibration,
  knit_reset_calibration: handleResetCalibration,
  knit_index_requirements: handleIndexRequirements,
  knit_generate_test_cases: handleGenerateTestCases,
  knit_list_requirements: handleListRequirements,
  knit_delete_requirements: handleDeleteRequirements,
  knit_get_fingerprint: handleGetFingerprint,
  knit_infer_domains: handleInferDomains,
  knit_compose_template: handleComposeTemplate,
  knit_verify_claim: handleVerifyClaim,
  knit_get_learning: handleGetLearning,
  knit_consolidate_learnings: handleConsolidateLearnings,
  knit_scan_agent_commands: handleScanAgentCommands,
  knit_suggest_command: handleSuggestCommand,
};

/** Handle a tool call — validate inputs, route to handler */
export function handleToolCall(
  toolName: string,
  params: Record<string, string>,
  brain: BrainCache,
): string {
  // Path validation — prevent directory traversal (including URL-encoded).
  // knit_index_requirements is exempt from the absolute-path block: it
  // explicitly takes a user-supplied path to a spec doc on disk (Jira
  // export, Swagger file, etc.) and there's no project-relative shape
  // that makes sense for it. Traversal-sequence + NUL byte checks still
  // apply to that tool — only the `/` prefix is allowed.
  if (params.file_path) {
    const decoded = decodeURIComponent(params.file_path).replace(/\\/g, '/');
    const allowAbsolute = toolName === 'knit_index_requirements';
    const bad = decoded.includes('..') || decoded.includes('\0') || (!allowAbsolute && (decoded.startsWith('/') || /^[A-Za-z]:\//.test(decoded)));
    if (bad) {
      return JSON.stringify({ status: 'error', error: 'Invalid file path — no traversal or absolute paths allowed' });
    }
    params.file_path = decoded;
  }

  // Sanitize text params to prevent prompt injection
  for (const key of ['summary', 'description', 'lesson', 'reason', 'goal', 'current_state', 'next_step', 'files_in_flight', 'what_changed', 'failed_attempts', 'decisions_made', 'task_description', 'approach', 'tags', 'team_name', 'name', 'role', 'focus', 'file_patterns', 'checklist', 'domains', 'team_roles', 'project_type']) {
    if (params[key]) {
      // eslint-disable-next-line no-control-regex
      params[key] = params[key].slice(0, 5000).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
    }
  }

  const handler = handlers[toolName];
  if (!handler) {
    return JSON.stringify({ status: 'error', error: `Unknown tool: ${toolName}` });
  }

  const result = handler(params, brain);

  // v0.18 — protocol re-surfacing. observeAndNudge MUST run for every call (it
  // maintains the per-session counters) but returns a reminder only on drift /
  // periodic check-ins, throttled. We only parse+re-stringify when a nudge is
  // actually warranted, so the hot path stays free of JSON round-trips.
  let nudge: string | null = null;
  try {
    nudge = observeAndNudge(toolName, brain.rootPath);
  } catch {
    nudge = null; // adherence must never break a tool call
  }
  if (nudge) {
    try {
      const obj = JSON.parse(result);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        obj._knit_protocol = nudge;
        return JSON.stringify(obj);
      }
    } catch {
      // non-object/non-JSON response — pass through unchanged
    }
  }

  return result;
}
