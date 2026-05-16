/**
 * MCP tool definitions and routing.
 * Handlers are in handlers.ts — this file is just the schema + router.
 */

import type { BrainCache } from './cache.js';
import {
  handleQueryImports, handleQueryDependents, handleQueryExports,
  handleQueryTests, handleFindFanout, handleSearchLearnings,
  handleGetFalsePositives, handleBrainStatus,
  handleClassifyTask, handleBuildContext, handleRecordLearning,
  handleRecordFalsePositive, handleSaveHandoff, handleSetupProject,
  handleReflect, handleGetSuggestions,
  handleGetTeams, handleDefineTeam, handleStartTeamReview,
  handleGetTeamPrompt, handlePostTeamFindings, handleGetBoardSummary,
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

/** All tool definitions exposed by the Engram MCP server */
export function getToolDefinitions(): ToolDef[] {
  return [
    // ── Query tools (read the brain) ─────────────────────────────
    {
      name: 'engram_query_imports',
      description: 'Find which files import a given file. Returns the reverse dependency list — who depends on this file. Use BEFORE editing a file to understand the blast radius.',
      inputSchema: { type: 'object', properties: { file_path: { type: 'string', description: 'Relative file path (e.g., src/engine/types.ts)' } }, required: ['file_path'] },
    },
    {
      name: 'engram_query_dependents',
      description: 'Find what a given file depends on (its imports). Use to understand what a file needs to work.',
      inputSchema: { type: 'object', properties: { file_path: { type: 'string', description: 'Relative file path' } }, required: ['file_path'] },
    },
    {
      name: 'engram_query_exports',
      description: 'List what a file exports: functions, classes, interfaces, types, constants. Use to find the right function without reading the whole file.',
      inputSchema: { type: 'object', properties: { file_path: { type: 'string', description: 'Relative file path' } }, required: ['file_path'] },
    },
    {
      name: 'engram_query_tests',
      description: 'Find test coverage for a file, or list all untested files.',
      inputSchema: { type: 'object', properties: { file_path: { type: 'string', description: 'Relative file path (optional)' }, filter: { type: 'string', description: '"untested" to list all untested files' } } },
    },
    {
      name: 'engram_find_fanout',
      description: 'Find high-fanout files — files imported by many others. These are the contracts — change them carefully.',
      inputSchema: { type: 'object', properties: { min_importers: { type: 'string', description: 'Minimum importers to qualify (default: 3)' } } },
    },
    {
      name: 'engram_search_learnings',
      description: 'Search the project knowledge base for learnings by domain tag. Returns past lessons and mistakes to avoid.',
      inputSchema: { type: 'object', properties: { domains: { type: 'string', description: 'Comma-separated domain tags (e.g., "api,auth,security")' } }, required: ['domains'] },
    },
    {
      name: 'engram_get_false_positives',
      description: 'Get known false positives — confirmed non-issues. Include in review agent prompts.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'engram_brain_status',
      description: 'Get knowledge base health metrics: learnings, hit rate, cache hits, top domains.',
      inputSchema: { type: 'object', properties: {} },
    },
    // ── Action tools (update the brain) ──────────────────────────
    {
      name: 'engram_classify_task',
      description: 'CALL THIS FIRST on every task. Classifies complexity (trivial/standard/complex), returns which phases to follow, which domains are affected, and whether to enter plan mode. Also triggers project auto-initialization if not done yet.',
      inputSchema: { type: 'object', properties: { files_to_touch: { type: 'string', description: 'Comma-separated list of files that will be modified (or "unknown" for new projects)' }, description: { type: 'string', description: 'Brief task description' } }, required: ['files_to_touch'] },
    },
    {
      name: 'engram_build_context',
      description: 'Build a Domain Context Object for the current task. Assembles domains, ripple effects, pitfalls, and false positives.',
      inputSchema: { type: 'object', properties: { files_to_touch: { type: 'string', description: 'Comma-separated list of files' } }, required: ['files_to_touch'] },
    },
    {
      name: 'engram_record_learning',
      description: 'CALL THIS LAST — before saying "done" or "complete". Records what was learned so the next session can find it. MANDATORY on every task. No task is complete without calling this.',
      inputSchema: { type: 'object', properties: { summary: { type: 'string', description: 'One-line summary' }, domains: { type: 'string', description: 'Comma-separated domains' }, approach: { type: 'string', description: 'What approach was taken' }, outcome: { type: 'string', description: 'success, partial, or failure' }, lesson: { type: 'string', description: 'What to repeat or avoid' }, tags: { type: 'string', description: 'Space-separated tags (e.g., "#api #auth")' } }, required: ['summary', 'lesson', 'tags'] },
    },
    {
      name: 'engram_record_false_positive',
      description: 'Mark a finding as a confirmed non-issue.',
      inputSchema: { type: 'object', properties: { summary: { type: 'string', description: 'What was flagged' }, reason: { type: 'string', description: 'Why it is not a real issue' }, tags: { type: 'string', description: 'Domain tags' } }, required: ['summary', 'reason'] },
    },
    {
      name: 'engram_save_handoff',
      description: 'Save session state for the next session to pick up.',
      inputSchema: { type: 'object', properties: { goal: { type: 'string', description: 'What we are trying to accomplish' }, current_state: { type: 'string', description: 'Where we are now' }, files_in_flight: { type: 'string', description: 'Files being modified' }, what_changed: { type: 'string', description: 'Commits and edits' }, failed_attempts: { type: 'string', description: 'What was tried and why it failed (MANDATORY)' }, decisions_made: { type: 'string', description: 'Important choices' }, next_step: { type: 'string', description: 'ONE most important thing to do next' } }, required: ['goal', 'current_state', 'failed_attempts', 'next_step'] },
    },
    {
      name: 'engram_setup_project',
      description: 'Describe what this project is about. Generates appropriate teams and domains based on the description. Use for non-code projects (research, analysis, writing) or to override auto-detected teams. Call this when the user first describes their project.',
      inputSchema: {
        type: 'object',
        properties: {
          project_type: { type: 'string', description: 'Type of project: "code", "research", "analysis", "writing", "design", or any custom type' },
          description: { type: 'string', description: 'What the project does and what the user is trying to accomplish' },
          domains: { type: 'string', description: 'Comma-separated domain areas (e.g., "data-collection,analysis,risk,strategy" or "frontend,api,database")' },
          team_roles: { type: 'string', description: 'Comma-separated team roles (e.g., "market-analyst,risk-assessor,portfolio-manager")' },
        },
        required: ['description'],
      },
    },
    // ── Team orchestration tools ─────────────────────────────────
    {
      name: 'engram_get_teams',
      description: 'Get agent teams configured for this project.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'engram_define_team',
      description: 'Create or update a custom agent team.',
      inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Team name' }, role: { type: 'string', description: 'Team role' }, focus: { type: 'string', description: 'What this team focuses on' }, agents: { type: 'string', description: 'Comma-separated agent types' }, file_patterns: { type: 'string', description: 'Comma-separated file patterns' }, checklist: { type: 'string', description: 'Pipe-separated review checklist items' } }, required: ['name', 'role', 'focus'] },
    },
    {
      name: 'engram_start_team_review',
      description: 'Start a parallel team review session with a shared findings board.',
      inputSchema: { type: 'object', properties: { task_description: { type: 'string', description: 'What the teams are reviewing' }, teams: { type: 'string', description: 'Comma-separated team names or "all"' } }, required: ['task_description'] },
    },
    {
      name: 'engram_get_team_prompt',
      description: 'Get the agent prompt for a specific team, including other teams\' findings.',
      inputSchema: { type: 'object', properties: { team_name: { type: 'string', description: 'Which team' }, files_to_review: { type: 'string', description: 'Comma-separated files' } }, required: ['team_name'] },
    },
    {
      name: 'engram_post_team_findings',
      description: 'Post a team\'s review findings to the shared board.',
      inputSchema: { type: 'object', properties: { team_name: { type: 'string', description: 'Which team is reporting' }, findings: { type: 'string', description: 'JSON array of findings' } }, required: ['team_name', 'findings'] },
    },
    {
      name: 'engram_get_board_summary',
      description: 'Get cross-team findings summary with severity gate.',
      inputSchema: { type: 'object', properties: {} },
    },
    // ── Reflection / Soul tools ──────────────────────────────────
    {
      name: 'engram_reflect',
      description: 'Self-reflect on accumulated learnings. Detects patterns: repeated successes, recurring failures, domain co-occurrences, and high-value insights. Zero extra LLM calls — pure pattern analysis over your data. Use periodically to surface what the brain has learned about your workflow.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'engram_get_suggestions',
      description: 'Get adaptive suggestions for the current task based on past patterns. "Based on history, watch out for X." Returns concrete warnings and recommendations derived from past successes and failures in the relevant domains.',
      inputSchema: { type: 'object', properties: { domains: { type: 'string', description: 'Comma-separated domains for this task (e.g., "api,auth,payments")' } }, required: ['domains'] },
    },
  ];
}

/** Handler routing table */
const handlers: Record<string, (params: Record<string, string>, brain: BrainCache) => string> = {
  engram_query_imports: handleQueryImports,
  engram_query_dependents: handleQueryDependents,
  engram_query_exports: handleQueryExports,
  engram_query_tests: handleQueryTests,
  engram_find_fanout: handleFindFanout,
  engram_search_learnings: handleSearchLearnings,
  engram_get_false_positives: handleGetFalsePositives,
  engram_brain_status: handleBrainStatus,
  engram_classify_task: handleClassifyTask,
  engram_build_context: handleBuildContext,
  engram_record_learning: handleRecordLearning,
  engram_record_false_positive: handleRecordFalsePositive,
  engram_save_handoff: handleSaveHandoff,
  engram_setup_project: handleSetupProject,
  engram_get_teams: handleGetTeams,
  engram_define_team: handleDefineTeam,
  engram_start_team_review: handleStartTeamReview,
  engram_get_team_prompt: handleGetTeamPrompt,
  engram_post_team_findings: handlePostTeamFindings,
  engram_get_board_summary: handleGetBoardSummary,
  engram_reflect: handleReflect,
  engram_get_suggestions: handleGetSuggestions,
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
