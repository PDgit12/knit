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
  handleScanIntegrations, handleCompoundingMetrics, handleVerifyClaim,
  handleGetLearning, handleConsolidateLearnings,
  detectProjectShape,
} from './handlers.js';
import { isToolActive, TOOL_REGISTRY, type ProjectShape } from './features.js';

/** MCP tool definition */
interface ToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

/** All tool definitions exposed by the Knit MCP server */
export function getToolDefinitions(): ToolDef[] {
  return [
    // ── Query (read the brain) ───────────────────────────────────
    {
      name: 'knit_query_imports',
      description: 'Reverse deps for a file — who imports it.',
      inputSchema: { type: 'object', properties: { file_path: { type: 'string', description: 'Relative file path.' } }, required: ['file_path'] },
    },
    {
      name: 'knit_query_dependents',
      description: 'Forward deps for a file — what it imports.',
      inputSchema: { type: 'object', properties: { file_path: { type: 'string', description: 'Relative file path.' } }, required: ['file_path'] },
    },
    {
      name: 'knit_query_exports',
      description: 'Exports from a file: functions, classes, types, constants.',
      inputSchema: { type: 'object', properties: { file_path: { type: 'string', description: 'Relative file path.' } }, required: ['file_path'] },
    },
    {
      name: 'knit_query_tests',
      description: 'Tests for a file, or list all untested files with filter="untested".',
      inputSchema: { type: 'object', properties: { file_path: { type: 'string', description: 'Relative file path (optional).' }, filter: { type: 'string', description: '"untested" to list all untested files.' } } },
    },
    {
      name: 'knit_find_fanout',
      description: 'High-fanout files — imported by many others.',
      inputSchema: { type: 'object', properties: { min_importers: { type: 'string', description: 'Minimum importers to qualify (default: 3).' } } },
    },
    {
      name: 'knit_search_learnings',
      description: 'BM25 + import-graph hybrid. Pass query="text" for BM25, domains="#tag" filter, files="src/a.ts,src/b.ts" for graph boost on learnings about neighbors. All combinable.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'BM25 free-text query over summary/lesson/approach/tags.' },
          domains: { type: 'string', description: 'Comma-separated tag filter; combines with query when both passed.' },
          files: { type: 'string', description: 'Comma-separated files the agent is editing — enables import-graph traversal boost.' },
          limit: { type: 'string', description: 'Max results (default 10, max 50).' },
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
      description: 'Call first. Returns risk_tier (drives plan mode), scope_tier (drives phases), change_kind, phases, auto_plan_mode, tier. Optional context_budget_remaining (0-100) downgrades gracefully.',
      inputSchema: { type: 'object', properties: { files_to_touch: { type: 'string', description: 'Comma-separated files, or "unknown" for new projects.' }, description: { type: 'string', description: 'Brief task description.' }, verbose: { type: 'string', description: '"true" to include reasoning + cross_domain_ripple + files_count (debug fields).' }, context_budget_remaining: { type: 'string', description: 'Integer 0–100 — percent of host agent context window remaining. <30 triggers scope downgrade + skips OPTIMIZE phase. Defaults to 100.' } }, required: ['files_to_touch'] },
    },
    {
      name: 'knit_build_context',
      description: 'Build the Domain Context Object: affected domains, ripple, pitfalls, false positives.',
      inputSchema: { type: 'object', properties: { files_to_touch: { type: 'string', description: 'Comma-separated files.' } }, required: ['files_to_touch'] },
    },
    {
      name: 'knit_record_learning',
      description: 'Record a non-obvious, reusable insight. Skip if a future search wouldn\'t be glad it exists.',
      inputSchema: { type: 'object', properties: { summary: { type: 'string', description: 'One-line summary.' }, domains: { type: 'string', description: 'Comma-separated domains.' }, approach: { type: 'string', description: 'What approach was taken.' }, outcome: { type: 'string', description: 'success | partial | failure.' }, lesson: { type: 'string', description: 'What to repeat or avoid.' }, tags: { type: 'string', description: 'Space-separated tags (e.g. "#api #auth").' } }, required: ['summary', 'lesson', 'tags'] },
    },
    {
      name: 'knit_record_false_positive',
      description: 'Mark a finding as confirmed non-issue so future reviewers suppress it.',
      inputSchema: { type: 'object', properties: { summary: { type: 'string', description: 'What was flagged.' }, reason: { type: 'string', description: 'Why it\'s not a real issue.' }, tags: { type: 'string', description: 'Domain tags.' } }, required: ['summary', 'reason'] },
    },
    {
      name: 'knit_save_handoff',
      description: 'Save state for the next session. failed_attempts is the load-bearing field.',
      inputSchema: { type: 'object', properties: { goal: { type: 'string', description: 'What we\'re trying to accomplish.' }, current_state: { type: 'string', description: 'Where we are now.' }, files_in_flight: { type: 'string', description: 'Files being modified.' }, what_changed: { type: 'string', description: 'Commits and edits.' }, failed_attempts: { type: 'string', description: 'What was tried and why it failed.' }, decisions_made: { type: 'string', description: 'Important choices.' }, next_step: { type: 'string', description: 'ONE most important next thing.' } }, required: ['goal', 'current_state', 'failed_attempts', 'next_step'] },
    },
    {
      name: 'knit_setup_project',
      description: 'Bootstrap domain teams for a non-code project (research/legal/marketing).',
      inputSchema: {
        type: 'object',
        properties: {
          project_type: { type: 'string', description: 'code | research | analysis | writing | design | custom.' },
          description: { type: 'string', description: 'What the project does.' },
          domains: { type: 'string', description: 'Comma-separated domains.' },
          team_roles: { type: 'string', description: 'Comma-separated team roles.' },
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
      inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Team name.' }, role: { type: 'string', description: 'Team role.' }, focus: { type: 'string', description: 'Team focus area.' }, agents: { type: 'string', description: 'Comma-separated agent types.' }, file_patterns: { type: 'string', description: 'Comma-separated globs.' }, checklist: { type: 'string', description: 'Pipe-separated review items.' } }, required: ['name', 'role', 'focus'] },
    },
    {
      name: 'knit_start_team_review',
      description: 'Start a parallel team review with a shared findings board.',
      inputSchema: { type: 'object', properties: { task_description: { type: 'string', description: 'What the teams review.' }, teams: { type: 'string', description: 'Comma-separated team names or "all".' } }, required: ['task_description'] },
    },
    {
      name: 'knit_get_team_prompt',
      description: 'Get a team\'s prompt with other teams\' findings included.',
      inputSchema: { type: 'object', properties: { team_name: { type: 'string', description: 'Team name.' }, files_to_review: { type: 'string', description: 'Comma-separated files.' } }, required: ['team_name'] },
    },
    {
      name: 'knit_post_team_findings',
      description: 'Post team findings to the shared board.',
      inputSchema: { type: 'object', properties: { team_name: { type: 'string', description: 'Team posting.' }, findings: { type: 'string', description: 'JSON array of findings.' } }, required: ['team_name', 'findings'] },
    },
    {
      name: 'knit_get_board_summary',
      description: 'Cross-team findings, severity-gated.',
      inputSchema: { type: 'object', properties: {} },
    },

    // ── Session memory ───────────────────────────────────────────
    {
      name: 'knit_load_session',
      description: 'Call at session start. Returns handoff, top learnings, false positives by default. Opt in to more via include=patterns,teams,metrics,recent_sessions,full_learnings,full_knowledge,all.',
      inputSchema: { type: 'object', properties: { include: { type: 'string', description: 'Comma-separated optional sections.' } } },
    },
    {
      name: 'knit_save_session_summary',
      description: 'Opt-in. Record a session summary a future search would want to find.',
      inputSchema: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'One-line summary.' },
          tags: { type: 'string', description: 'Space-separated tags like "#auth #refactor".' },
          outcome: { type: 'string', description: 'shipped | wip | failed | unknown.' },
          files_touched: { type: 'string', description: 'Comma-separated files (optional).' },
          domains: { type: 'string', description: 'Comma-separated domains (optional).' },
        },
        required: ['summary', 'tags', 'outcome'],
      },
    },
    {
      name: 'knit_prune_sessions',
      description: 'Prune sessions older than max_age_days (default 90). Atomic rewrite.',
      inputSchema: {
        type: 'object',
        properties: {
          max_age_days: { type: 'string', description: 'Maximum age in days (default 90).' },
        },
      },
    },
    {
      name: 'knit_search_sessions',
      description: 'Search past sessions by free text. "Have I done this before?"',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Free text or tag.' },
          limit: { type: 'string', description: 'Max results (default 10).' },
        },
        required: ['query'],
      },
    },

    // ── Workflow on demand ───────────────────────────────────────
    {
      name: 'knit_get_workflow',
      description: 'Fetch one workflow section: overview, tier, phases, research, ideate, plan, execute, optimize, review, tdd, learn, handoff, ship, tools. Omit phase to list all.',
      inputSchema: {
        type: 'object',
        properties: {
          phase: { type: 'string', description: 'Section name. Omit to list all.' },
        },
      },
    },

    // ── Parallel team worktrees ──────────────────────────────────
    {
      name: 'knit_spawn_team_worktree',
      description: 'Create a git worktree for a team so they can write in parallel without colliding.',
      inputSchema: {
        type: 'object',
        properties: {
          team_name: { type: 'string', description: 'Team display name (e.g., "UI", "API & Security").' },
          task_description: { type: 'string', description: 'What this team is doing.' },
        },
        required: ['team_name', 'task_description'],
      },
    },
    {
      name: 'knit_list_team_worktrees',
      description: 'List active team worktrees. include_finalized=true for full history.',
      inputSchema: {
        type: 'object',
        properties: {
          include_finalized: { type: 'string', description: '"true" for full history (default: active only).' },
        },
      },
    },
    // ── Cross-project learnings (Model C — global pool) ─────────
    {
      name: 'knit_record_global_learning',
      description: 'Opt-in. Record a learning to the cross-project pool when it generalizes beyond this project.',
      inputSchema: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'One-line summary.' },
          lesson: { type: 'string', description: 'Generalizable lesson.' },
          tags: { type: 'string', description: 'Space-separated tags.' },
          outcome: { type: 'string', description: 'success | partial | failure (optional).' },
        },
        required: ['summary', 'lesson', 'tags'],
      },
    },
    {
      name: 'knit_search_global_learnings',
      description: 'Search the cross-project learnings pool across all projects on this machine.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Free text or tag.' },
          limit: { type: 'string', description: 'Max results (default 10).' },
        },
        required: ['query'],
      },
    },

    // ── Pattern reflection (now backed by Model C, useful with ≥3 entries) ──
    {
      name: 'knit_reflect',
      description: 'Detect patterns across learnings. Needs ≥3 entries to surface anything.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'knit_get_suggestions',
      description: 'Adaptive warnings from past patterns. "Based on history, watch out for X."',
      inputSchema: { type: 'object', properties: { domains: { type: 'string', description: 'Comma-separated domains for this task.' } }, required: ['domains'] },
    },

    {
      name: 'knit_install_agent',
      description: 'Install one VoltAgent subagent into .claude/agents/, personalized with project context.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Agent name (e.g., "typescript-pro", "security-engineer").' },
          refresh: { type: 'string', description: '"true" to force re-fetch even if cached.' },
        },
        required: ['name'],
      },
    },
    {
      name: 'knit_finalize_team_worktree',
      description: 'Merge or discard a team\'s worktree. Surfaces conflicts without destroying the worktree.',
      inputSchema: {
        type: 'object',
        properties: {
          team_name: { type: 'string', description: 'Team name or slug.' },
          action: { type: 'string', description: '"merge" or "discard".' },
        },
        required: ['team_name', 'action'],
      },
    },

    // ── Protocol Guard ───────────────────────────────────────────
    {
      name: 'knit_set_protocol_strictness',
      description: 'Set Protocol Guard strictness: off | warn (default) | block.',
      inputSchema: { type: 'object', properties: { level: { type: 'string', description: 'One of: off | warn | block.' } }, required: ['level'] },
    },
    {
      name: 'knit_get_protocol_strictness',
      description: 'Read current Protocol Guard strictness.',
      inputSchema: { type: 'object', properties: {} },
    },

    // ── Meta — feature discoverability ───────────────────────────
    {
      name: 'knit_list_features',
      description: 'List active vs hidden Knit tools and why. Call when a tool you expect isn\'t available.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'knit_enable_feature',
      description: 'Enable a Tier-2/3 feature flag (teams, subagents, admin). Persisted.',
      inputSchema: {
        type: 'object',
        properties: { feature: { type: 'string', description: 'One of: teams, subagents, admin.' } },
        required: ['feature'],
      },
    },
    {
      name: 'knit_disable_feature',
      description: 'Disable a feature flag. Auto-exposed tools stay visible regardless.',
      inputSchema: {
        type: 'object',
        properties: { feature: { type: 'string', description: 'One of: teams, subagents, admin.' } },
        required: ['feature'],
      },
    },
    {
      name: 'knit_scan_integrations',
      description: 'Re-scan host for existing workflow frameworks (Ruflo, gstack, CodeTour). Runs implicitly at autoInit; this is the manual re-trigger.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'knit_compounding_metrics',
      description: 'Sessions / learnings / reuse-ratio / estimated tokens saved. Quantifies how much memory is paying back per-session overhead.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'knit_verify_claim',
      description: 'Fact-check one claim against the knowledge graph. Patterns: "A imports B", "X exports Y", "A is tested by B", "X exists". Verdict: verified | contradicted | unparseable.',
      inputSchema: { type: 'object', properties: { claim: { type: 'string', description: 'One claim about the codebase to verify.' } }, required: ['claim'] },
    },
    {
      name: 'knit_get_learning',
      description: 'Fetch one full learning by id. Pair with knit_search_learnings (default returns headlines) for hierarchical retrieval — expand only what you need.',
      inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Learning id from a prior knit_search_learnings result.' } }, required: ['id'] },
    },
    {
      name: 'knit_consolidate_learnings',
      description: 'Detect clusters of similar learnings (Jaccard tag overlap) and propose a single pattern entry per cluster. Dry-run by default; pass commit=true to persist.',
      inputSchema: {
        type: 'object',
        properties: {
          min_cluster_size: { type: 'string', description: 'Minimum cluster size (default 3, max 20).' },
          jaccard_threshold: { type: 'string', description: 'Min Jaccard tag overlap to cluster (default 0.5).' },
          commit: { type: 'string', description: '"true" to apply; default is dry-run.' },
        },
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
  knit_verify_claim: handleVerifyClaim,
  knit_get_learning: handleGetLearning,
  knit_consolidate_learnings: handleConsolidateLearnings,
};

/** Handle a tool call — validate inputs, route to handler */
export function handleToolCall(
  toolName: string,
  params: Record<string, string>,
  brain: BrainCache,
): string {
  // Path validation — prevent directory traversal (including URL-encoded)
  if (params.file_path) {
    const decoded = decodeURIComponent(params.file_path).replace(/\\/g, '/');
    if (decoded.includes('..') || decoded.startsWith('/') || decoded.includes('\0')) {
      return JSON.stringify({ error: 'Invalid file path — no traversal or absolute paths allowed' });
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
    return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }

  return handler(params, brain);
}
