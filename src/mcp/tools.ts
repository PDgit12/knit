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
  handleListFeatures,
} from './handlers.js';

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
      description: 'Who imports this file? Returns the reverse dependency list — call before editing to know the blast radius.',
      inputSchema: { type: 'object', properties: { file_path: { type: 'string', description: 'Relative file path.' } }, required: ['file_path'] },
    },
    {
      name: 'knit_query_dependents',
      description: 'What does this file import? Returns the file\'s own dependencies.',
      inputSchema: { type: 'object', properties: { file_path: { type: 'string', description: 'Relative file path.' } }, required: ['file_path'] },
    },
    {
      name: 'knit_query_exports',
      description: 'What does this file expose? Functions, classes, interfaces, types, constants.',
      inputSchema: { type: 'object', properties: { file_path: { type: 'string', description: 'Relative file path.' } }, required: ['file_path'] },
    },
    {
      name: 'knit_query_tests',
      description: 'Is this file tested? Or pass filter="untested" to list all untested files.',
      inputSchema: { type: 'object', properties: { file_path: { type: 'string', description: 'Relative file path (optional).' }, filter: { type: 'string', description: '"untested" to list all untested files.' } } },
    },
    {
      name: 'knit_find_fanout',
      description: 'High-fanout files — imported by many others. These are the contracts; change carefully.',
      inputSchema: { type: 'object', properties: { min_importers: { type: 'string', description: 'Minimum importers to qualify (default: 3).' } } },
    },
    {
      name: 'knit_search_learnings',
      description: 'Search past learnings by domain tag. Returns prior lessons and mistakes to avoid.',
      inputSchema: { type: 'object', properties: { domains: { type: 'string', description: 'Comma-separated domain tags.' } }, required: ['domains'] },
    },
    {
      name: 'knit_get_false_positives',
      description: 'Confirmed non-issues. Pass to review agents so they don\'t re-flag them.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'knit_brain_status',
      description: 'Brain health + token-accounting: learnings, hit rate, CLAUDE.md size, session count.',
      inputSchema: { type: 'object', properties: {} },
    },

    // ── Update (write to the brain) ──────────────────────────────
    {
      name: 'knit_classify_task',
      description: 'Call first on every task. Classifies tier (trivial/standard/complex), returns phases + domains + auto plan mode flag. Also triggers project auto-init.',
      inputSchema: { type: 'object', properties: { files_to_touch: { type: 'string', description: 'Comma-separated files, or "unknown" for new projects.' }, description: { type: 'string', description: 'Brief task description.' } }, required: ['files_to_touch'] },
    },
    {
      name: 'knit_build_context',
      description: 'Build a context object for the current task: domains, ripple effects, pitfalls, false positives.',
      inputSchema: { type: 'object', properties: { files_to_touch: { type: 'string', description: 'Comma-separated files.' } }, required: ['files_to_touch'] },
    },
    {
      name: 'knit_record_learning',
      description: 'Record a non-obvious, reusable insight. Quality check first: would session N+1 searching this tag be glad it exists? If no, skip.',
      inputSchema: { type: 'object', properties: { summary: { type: 'string', description: 'One-line summary.' }, domains: { type: 'string', description: 'Comma-separated domains.' }, approach: { type: 'string', description: 'What approach was taken.' }, outcome: { type: 'string', description: 'success | partial | failure.' }, lesson: { type: 'string', description: 'What to repeat or avoid.' }, tags: { type: 'string', description: 'Space-separated tags (e.g. "#api #auth").' } }, required: ['summary', 'lesson', 'tags'] },
    },
    {
      name: 'knit_record_false_positive',
      description: 'Mark a finding as a confirmed non-issue so future review agents stop re-flagging it.',
      inputSchema: { type: 'object', properties: { summary: { type: 'string', description: 'What was flagged.' }, reason: { type: 'string', description: 'Why it\'s not a real issue.' }, tags: { type: 'string', description: 'Domain tags.' } }, required: ['summary', 'reason'] },
    },
    {
      name: 'knit_save_handoff',
      description: 'Save state for the next session when context degrades. failed_attempts is the load-bearing field.',
      inputSchema: { type: 'object', properties: { goal: { type: 'string', description: 'What we\'re trying to accomplish.' }, current_state: { type: 'string', description: 'Where we are now.' }, files_in_flight: { type: 'string', description: 'Files being modified.' }, what_changed: { type: 'string', description: 'Commits and edits.' }, failed_attempts: { type: 'string', description: 'What was tried and why it failed.' }, decisions_made: { type: 'string', description: 'Important choices.' }, next_step: { type: 'string', description: 'ONE most important next thing.' } }, required: ['goal', 'current_state', 'failed_attempts', 'next_step'] },
    },
    {
      name: 'knit_setup_project',
      description: 'Describe a project (especially non-code: research, legal, marketing). Generates domain-specific teams.',
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
      description: 'List agent teams configured for this project.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'knit_define_team',
      description: 'Create or update a custom agent team.',
      inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Team name.' }, role: { type: 'string', description: 'Team role.' }, focus: { type: 'string', description: 'Team focus area.' }, agents: { type: 'string', description: 'Comma-separated agent types.' }, file_patterns: { type: 'string', description: 'Comma-separated globs.' }, checklist: { type: 'string', description: 'Pipe-separated review items.' } }, required: ['name', 'role', 'focus'] },
    },
    {
      name: 'knit_start_team_review',
      description: 'Start a parallel team review with a shared findings board.',
      inputSchema: { type: 'object', properties: { task_description: { type: 'string', description: 'What the teams review.' }, teams: { type: 'string', description: 'Comma-separated team names or "all".' } }, required: ['task_description'] },
    },
    {
      name: 'knit_get_team_prompt',
      description: 'Get the prompt for a team, including other teams\' findings.',
      inputSchema: { type: 'object', properties: { team_name: { type: 'string', description: 'Team name.' }, files_to_review: { type: 'string', description: 'Comma-separated files.' } }, required: ['team_name'] },
    },
    {
      name: 'knit_post_team_findings',
      description: 'Post a team\'s findings to the shared board.',
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
      description: 'Call at session start. Returns last sessions, handoff, top learnings, false positives, teams, project knowledge in one round trip.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'knit_save_session_summary',
      description: 'Opt-in. Record a narrative summary if this session accomplished something a future session would search for. Quality check first.',
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
      description: 'Prune entries older than max_age_days (default 90) from this project\'s sessions.jsonl. Atomic rewrite. Also runs automatically on auto-init.',
      inputSchema: {
        type: 'object',
        properties: {
          max_age_days: { type: 'string', description: 'Maximum age in days (default 90).' },
        },
      },
    },
    {
      name: 'knit_search_sessions',
      description: 'Search past sessions by free text over summary + tags + branch. Check before duplicating prior work.',
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
      description: 'Fetch protocol depth for one phase. Sections: overview, tier, phases, research, ideate, plan, execute, optimize, review, tdd, learn, handoff, ship, tools. Omit phase to list all.',
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
      description: 'Create a git worktree for a team. Multiple agents within the team can work in parallel inside it without colliding with other teams.',
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
      description: 'List active team worktrees. Pass include_finalized=true for full history.',
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
      description: 'Opt-in. Record a learning to the cross-project pool when the insight generalizes beyond this project (e.g., Stripe webhook signature rules). Per-project knit_record_learning stays primary.',
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
      description: 'Search the cross-project learnings pool. Use to check whether a similar lesson has been recorded in any project on this machine.',
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
      description: 'Detect patterns across recorded learnings (per-project + global pool). Returns recurring themes, repeated failures, domain co-occurrences. Needs ≥3 learnings to surface anything meaningful.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'knit_get_suggestions',
      description: 'Adaptive suggestions for the current task based on past patterns in given domains. "Based on history, watch out for X."',
      inputSchema: { type: 'object', properties: { domains: { type: 'string', description: 'Comma-separated domains for this task.' } }, required: ['domains'] },
    },

    {
      name: 'knit_install_agent',
      description: 'Install or refresh one subagent. Writes <project>/.claude/agents/knit-<name>.md, personalized with project context. Use mid-session if a team needs an agent that isn\'t on disk yet.',
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
      description: 'Merge or discard a team\'s worktree. Merge surfaces conflict files without destroying the worktree on failure.',
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
      description: 'Set Protocol Guard strictness for this project. off = no checks. warn = reminder only (default). block = hard-fail Edit/Write without prior knit_classify_task.',
      inputSchema: { type: 'object', properties: { level: { type: 'string', description: 'One of: off | warn | block.' } }, required: ['level'] },
    },
    {
      name: 'knit_get_protocol_strictness',
      description: 'Read current Protocol Guard strictness level for this project.',
      inputSchema: { type: 'object', properties: {} },
    },

    // ── Meta — feature discoverability ───────────────────────────
    {
      name: 'knit_list_features',
      description: 'List which Knit tools are active vs hidden in this project and why. Call when a tool you expect to use isn\'t in the tool list — the response tells you how to enable it.',
      inputSchema: { type: 'object', properties: {} },
    },
  ];
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
