import { writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { BrainCache } from './cache.js';
import { queryByDomains, getFalsePositives, getKBSummary, recordCacheHit, addEntry, saveKnowledgeBase } from '../engine/knowledgebase.js';
import {
  buildDefaultTeams, generateTeamPrompt, loadCustomTeams, saveCustomTeams,
  startTeamBoard, getTeamBoard, markTeamWorking, postTeamFindings,
  getOtherTeamFindings, getBoardSummary,
} from '../engine/teams.js';
import type { TeamFinding } from '../engine/types.js';

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
    {
      name: 'engram_query_imports',
      description: 'Find which files import a given file. Returns the reverse dependency list — who depends on this file. Use BEFORE editing a file to understand the blast radius.',
      inputSchema: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Relative file path (e.g., src/engine/types.ts)' },
        },
        required: ['file_path'],
      },
    },
    {
      name: 'engram_query_dependents',
      description: 'Find what a given file depends on (its imports). Use to understand what a file needs to work.',
      inputSchema: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Relative file path' },
        },
        required: ['file_path'],
      },
    },
    {
      name: 'engram_query_exports',
      description: 'List what a file exports: functions, classes, interfaces, types, constants. Use to find the right function without reading the whole file.',
      inputSchema: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Relative file path' },
        },
        required: ['file_path'],
      },
    },
    {
      name: 'engram_query_tests',
      description: 'Find test coverage for a file, or list all untested files. Use to know what needs tests before shipping.',
      inputSchema: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Relative file path (optional — omit for untested list)' },
          filter: { type: 'string', description: '"untested" to list all untested files, or omit to query specific file' },
        },
      },
    },
    {
      name: 'engram_find_fanout',
      description: 'Find high-fanout files — files imported by many others. These are the contracts — change them carefully. Editing a high-fanout file affects many dependents.',
      inputSchema: {
        type: 'object',
        properties: {
          min_importers: { type: 'string', description: 'Minimum number of importers to qualify (default: 3)' },
        },
      },
    },
    {
      name: 'engram_search_learnings',
      description: 'Search the project knowledge base for learnings by domain tag. Returns past lessons, approaches that worked, and mistakes to avoid. Use BEFORE starting any task to check if we already solved this.',
      inputSchema: {
        type: 'object',
        properties: {
          domains: { type: 'string', description: 'Comma-separated domain tags to search (e.g., "api,auth,security")' },
        },
        required: ['domains'],
      },
    },
    {
      name: 'engram_get_false_positives',
      description: 'Get known false positives — issues that have been confirmed as non-issues. Include these in review agent prompts to prevent re-reporting.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'engram_brain_status',
      description: 'Get knowledge base health metrics: total learnings, hit rate, cache hits, top domains, session count. Use to understand how well the brain is working.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    // ── Action tools (write operations) ──────────────────────────
    {
      name: 'engram_classify_task',
      description: 'Classify a task by complexity tier (trivial/standard/complex) based on which files will be touched. Returns the tier, affected domains, recommended phases, and cross-domain ripple effects. Call this BEFORE starting any task.',
      inputSchema: {
        type: 'object',
        properties: {
          files_to_touch: { type: 'string', description: 'Comma-separated list of files that will be modified' },
          description: { type: 'string', description: 'Brief description of the task' },
        },
        required: ['files_to_touch'],
      },
    },
    {
      name: 'engram_build_context',
      description: 'Build a Domain Context Object for the current task. Assembles affected domains, files, cross-domain ripple, known pitfalls, and false positives into a single object. Pass this to every agent prompt.',
      inputSchema: {
        type: 'object',
        properties: {
          files_to_touch: { type: 'string', description: 'Comma-separated list of files that will be modified' },
        },
        required: ['files_to_touch'],
      },
    },
    {
      name: 'engram_record_learning',
      description: 'Record a learning from the current task. This is the LEARN phase — call this before saying "done". Every task must record what was learned.',
      inputSchema: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'One-line summary of what was learned' },
          domains: { type: 'string', description: 'Comma-separated domains (e.g., "api,auth")' },
          approach: { type: 'string', description: 'What approach was taken' },
          outcome: { type: 'string', description: 'success, partial, or failure' },
          lesson: { type: 'string', description: 'What to repeat or avoid next time' },
          tags: { type: 'string', description: 'Space-separated tags (e.g., "#api #auth #security")' },
        },
        required: ['summary', 'lesson', 'tags'],
      },
    },
    {
      name: 'engram_record_false_positive',
      description: 'Mark a finding as a confirmed non-issue. Future agent prompts will include this so agents stop re-reporting it.',
      inputSchema: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'What was flagged (e.g., "Missing types for UserSchema")' },
          reason: { type: 'string', description: 'Why it is not a real issue' },
          tags: { type: 'string', description: 'Space-separated domain tags' },
        },
        required: ['summary', 'reason'],
      },
    },
    {
      name: 'engram_save_handoff',
      description: 'Save session state for the next session to pick up. Use when context degrades or before ending a long session. The next session reads this first.',
      inputSchema: {
        type: 'object',
        properties: {
          goal: { type: 'string', description: 'What we are trying to accomplish' },
          current_state: { type: 'string', description: 'Where we are right now' },
          files_in_flight: { type: 'string', description: 'Comma-separated files being modified' },
          what_changed: { type: 'string', description: 'Commits, edits since session start' },
          failed_attempts: { type: 'string', description: 'What was tried and why it failed (MANDATORY)' },
          decisions_made: { type: 'string', description: 'Important choices and reasoning' },
          next_step: { type: 'string', description: 'The ONE most important thing to do next' },
        },
        required: ['goal', 'current_state', 'failed_attempts', 'next_step'],
      },
    },
    // ── Team orchestration tools ─────────────────────────────────
    {
      name: 'engram_get_teams',
      description: 'Get the agent teams configured for this project. Returns team names, roles, focus areas, agents, and review checklists. Custom teams override defaults if .claude/teams.json exists.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'engram_define_team',
      description: 'Create or update a custom agent team. Saved to .claude/teams.json. Use to add specialized teams like "Performance Team" or "Design Team" beyond the defaults.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Team name (e.g., "Performance", "Design", "DevOps")' },
          role: { type: 'string', description: 'Team role (e.g., "Performance Engineering")' },
          focus: { type: 'string', description: 'What this team focuses on' },
          agents: { type: 'string', description: 'Comma-separated agent types (e.g., "performance-optimizer,code-reviewer")' },
          file_patterns: { type: 'string', description: 'Comma-separated file patterns (e.g., "src/api/**,lib/db.*")' },
          checklist: { type: 'string', description: 'Pipe-separated review checklist items' },
        },
        required: ['name', 'role', 'focus'],
      },
    },
    {
      name: 'engram_start_team_review',
      description: 'Start a parallel team review session. Creates a shared board where teams post findings. Call this, then launch each team as a parallel agent with engram_get_team_prompt.',
      inputSchema: {
        type: 'object',
        properties: {
          task_description: { type: 'string', description: 'What the teams are reviewing' },
          teams: { type: 'string', description: 'Comma-separated team names to include (or "all" for all teams)' },
        },
        required: ['task_description'],
      },
    },
    {
      name: 'engram_get_team_prompt',
      description: 'Get the agent prompt for a specific team. This prompt includes the team role, focus, checklist, domain context, AND findings from other teams that have already reported. Use this to launch each team as a parallel agent.',
      inputSchema: {
        type: 'object',
        properties: {
          team_name: { type: 'string', description: 'Which team to generate the prompt for' },
          files_to_review: { type: 'string', description: 'Comma-separated files for this review' },
        },
        required: ['team_name'],
      },
    },
    {
      name: 'engram_post_team_findings',
      description: 'Post a team\'s review findings to the shared board. Other teams can see these findings and react. Call this after each team agent completes.',
      inputSchema: {
        type: 'object',
        properties: {
          team_name: { type: 'string', description: 'Which team is reporting' },
          findings: { type: 'string', description: 'JSON array of findings: [{severity,file,description,recommendation}]' },
        },
        required: ['team_name', 'findings'],
      },
    },
    {
      name: 'engram_get_board_summary',
      description: 'Get the current state of the team review board. Shows total findings by severity, which teams are done, and whether all teams have reported.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
  ];
}

/** Handle a tool call — route to the right engine function */
export function handleToolCall(
  toolName: string,
  params: Record<string, string>,
  brain: BrainCache,
): string {
  // Path validation — prevent directory traversal
  if (params.file_path) {
    const normalized = params.file_path.replace(/\\/g, '/');
    if (normalized.includes('..') || normalized.startsWith('/')) {
      return JSON.stringify({ error: 'Invalid file path — no traversal or absolute paths allowed' });
    }
  }

  switch (toolName) {
    case 'engram_query_imports': {
      const filePath = params.file_path;
      const importers = brain.reverseDeps[filePath] || [];
      return JSON.stringify({
        file: filePath,
        imported_by: importers,
        count: importers.length,
        risk: importers.length >= 5 ? 'HIGH — many dependents, change carefully' :
              importers.length >= 3 ? 'MEDIUM — several dependents' : 'LOW',
      });
    }

    case 'engram_query_dependents': {
      const filePath = params.file_path;
      const deps = brain.knowledge.importGraph[filePath] || [];
      return JSON.stringify({
        file: filePath,
        depends_on: deps,
        count: deps.length,
      });
    }

    case 'engram_query_exports': {
      const filePath = params.file_path;
      const exports = brain.knowledge.exports[filePath] || [];
      return JSON.stringify({
        file: filePath,
        exports: exports.map((e) => ({ name: e.name, kind: e.kind, line: e.line })),
        count: exports.length,
      });
    }

    case 'engram_query_tests': {
      if (params.filter === 'untested') {
        return JSON.stringify({
          untested_files: brain.knowledge.testMap.untested,
          count: brain.knowledge.testMap.untested.length,
        });
      }
      const filePath = params.file_path;
      if (filePath) {
        const tests = brain.knowledge.testMap.tested[filePath] || [];
        return JSON.stringify({
          file: filePath,
          tested_by: tests,
          has_tests: tests.length > 0,
        });
      }
      return JSON.stringify({
        tested_files: Object.keys(brain.knowledge.testMap.tested).length,
        untested_files: brain.knowledge.testMap.untested.length,
        test_files: brain.knowledge.testMap.testFiles.length,
      });
    }

    case 'engram_find_fanout': {
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

    case 'engram_search_learnings': {
      const domainTags = params.domains.split(',').map((d) => `#${d.trim()}`);
      const results = queryByDomains(brain.knowledgeBase, domainTags.map((t) => t.replace('#', '')));

      if (results.length > 0) {
        recordCacheHit(brain.knowledgeBase);
      }

      return JSON.stringify({
        query: domainTags,
        results: results.map((r) => ({
          summary: r.summary,
          lesson: r.lesson,
          outcome: r.outcome,
          date: r.date,
          tags: r.tags,
          access_count: r.accessCount,
        })),
        count: results.length,
      });
    }

    case 'engram_get_false_positives': {
      const fps = getFalsePositives(brain.knowledgeBase);
      return JSON.stringify({
        false_positives: fps.map((fp) => ({
          summary: fp.summary,
          lesson: fp.lesson,
          date: fp.date,
        })),
        count: fps.length,
        instruction: 'Include these in review agent prompts as DO NOT FLAG items.',
      });
    }

    case 'engram_brain_status': {
      const summary = getKBSummary(brain.knowledgeBase);
      return JSON.stringify({
        ...summary,
        knowledge_index: {
          files_indexed: brain.knowledge.summary.totalFiles,
          total_lines: brain.knowledge.summary.totalLines,
          import_edges: Object.keys(brain.knowledge.importGraph).length,
          exports_mapped: Object.keys(brain.knowledge.exports).length,
        },
        cache_age_ms: Date.now() - brain.loadedAt,
      });
    }

    // ── Action tools ──────────────────────────────────────────────

    case 'engram_classify_task': {
      const files = (params.files_to_touch || '').split(',').map((f) => f.trim()).filter(Boolean);
      const domains = new Set<string>();
      const crossDomainRipple: string[] = [];

      // Map files to domains
      for (const file of files) {
        // Check which domain each file belongs to based on knowledge
        const importers = brain.reverseDeps[file] || [];
        if (importers.length >= 3) crossDomainRipple.push(`${file} is high-fanout (${importers.length} dependents)`);

        // Simple domain detection from path
        if (file.includes('api/') || file.includes('auth')) domains.add('API & Security');
        if (file.includes('components/') || file.includes('.tsx')) domains.add('UI');
        if (file.includes('lib/') || file.includes('utils') || file.includes('types')) domains.add('Business Logic');
        if (file.includes('db') || file.includes('email') || file.includes('middleware')) domains.add('Infrastructure');
        if (file.includes('test')) domains.add('QA');
      }

      // Classify tier
      const isTypes = files.some((f) => f.includes('types') || f.includes('schema'));
      const isAuth = files.some((f) => f.includes('auth') || f.includes('security'));
      const tier = (domains.size >= 3 || isTypes || isAuth || files.length > 3)
        ? 'complex'
        : (domains.size >= 2 || files.length > 1)
          ? 'standard'
          : 'trivial';

      const phases = tier === 'complex'
        ? ['RESEARCH', 'IDEATE', 'PLAN', 'EXECUTE', 'OPTIMIZE', 'REVIEW', 'LEARN']
        : tier === 'standard'
          ? ['RESEARCH', 'EXECUTE', 'OPTIMIZE', 'REVIEW', 'LEARN']
          : ['EXECUTE', 'VERIFY', 'LEARN'];

      return JSON.stringify({
        tier,
        affected_domains: [...domains],
        phases,
        files_count: files.length,
        cross_domain_ripple: crossDomainRipple,
        auto_plan_mode: tier === 'complex',
        reasoning: tier === 'complex'
          ? `Complex: ${domains.size} domains affected${isTypes ? ', touches shared types' : ''}${isAuth ? ', security-sensitive' : ''}`
          : tier === 'standard'
            ? `Standard: ${domains.size} domain(s), ${files.length} file(s)`
            : `Trivial: 1 domain, simple change`,
      });
    }

    case 'engram_build_context': {
      const files = (params.files_to_touch || '').split(',').map((f) => f.trim()).filter(Boolean);
      const affectedDomains = new Set<string>();
      const knownPitfalls: string[] = [];
      const ripple: string[] = [];

      for (const file of files) {
        // Detect domains
        if (file.includes('api/') || file.includes('auth')) affectedDomains.add('API & Security');
        if (file.includes('components/') || file.includes('.tsx')) affectedDomains.add('UI');
        if (file.includes('lib/') || file.includes('utils') || file.includes('types')) affectedDomains.add('Business Logic');
        if (file.includes('db') || file.includes('email') || file.includes('middleware')) affectedDomains.add('Infrastructure');
        if (file.includes('test')) affectedDomains.add('QA');

        // Check ripple
        const importers = brain.reverseDeps[file] || [];
        if (importers.length > 0) {
          ripple.push(`${file} is imported by: ${importers.join(', ')}`);
        }
      }

      // Search learnings for affected domains
      const domainTags = [...affectedDomains].map((d) => d.toLowerCase().replace(/[^a-z]/g, ''));
      const learnings = queryByDomains(brain.knowledgeBase, domainTags);
      for (const l of learnings) {
        knownPitfalls.push(`${l.summary}: ${l.lesson}`);
      }

      const fps = getFalsePositives(brain.knowledgeBase);

      return JSON.stringify({
        domain_context: {
          affected_domains: [...affectedDomains],
          files_to_touch: files,
          cross_domain_ripple: ripple,
          known_pitfalls: knownPitfalls,
          false_positives: fps.map((fp) => `${fp.summary}: ${fp.lesson}`),
        },
        instruction: 'Pass this entire object to every agent prompt in EXECUTE, OPTIMIZE, and REVIEW phases.',
      });
    }

    case 'engram_record_learning': {
      const date = new Date().toISOString().split('T')[0];
      const entry = {
        date,
        summary: params.summary || 'Untitled learning',
        domains: (params.domains || 'general').split(',').map((d) => d.trim()),
        approach: params.approach || '',
        outcome: (['success', 'partial', 'failure'].includes(params.outcome) ? params.outcome : 'success') as 'success' | 'partial' | 'failure',
        lesson: params.lesson || '',
        tags: (params.tags || '').split(/\s+/).filter((t) => t.startsWith('#')),
      };

      addEntry(brain.knowledgeBase, entry);

      // Save KB to disk
      const kbPath = join(brain.rootPath, '.claude/knowledgebase.json');
      saveKnowledgeBase(kbPath, brain.knowledgeBase);

      // Also append to markdown learnings file for human readability
      const learningsDir = join(brain.rootPath, '.claude/learnings');
      const mdFiles = existsSync(learningsDir)
        ? readdirSync(learningsDir).filter((f: string) => f.endsWith('.md') && f !== 'sessions.md')
        : [];
      if (mdFiles.length > 0) {
        const mdPath = join(learningsDir, mdFiles[0]);
        const mdEntry = `\n## ${date} ${entry.summary}\n**Domain(s):** ${entry.domains.join(', ')}\n**Approach:** ${entry.approach}\n**Outcome:** ${entry.outcome}\n**Lesson:** ${entry.lesson}\n**Tags:** ${entry.tags.join(' ')}\n`;
        const existing = readFileSync(mdPath, 'utf-8');
        writeFileSync(mdPath, existing + mdEntry, 'utf-8');
      }

      return JSON.stringify({
        status: 'recorded',
        entry: { date, summary: entry.summary, tags: entry.tags },
        kb_total: brain.knowledgeBase.entries.length,
      });
    }

    case 'engram_record_false_positive': {
      const date = new Date().toISOString().split('T')[0];
      const entry = {
        date,
        summary: params.summary || 'Untitled FP',
        domains: ['General'],
        approach: 'Verified manually',
        outcome: 'success' as const,
        lesson: params.reason || 'Confirmed non-issue',
        tags: [...(params.tags || '').split(/\s+/).filter((t) => t.startsWith('#')), '#false-positive'],
      };

      addEntry(brain.knowledgeBase, entry);
      const kbPath = join(brain.rootPath, '.claude/knowledgebase.json');
      saveKnowledgeBase(kbPath, brain.knowledgeBase);

      return JSON.stringify({
        status: 'recorded',
        summary: entry.summary,
        total_false_positives: getFalsePositives(brain.knowledgeBase).length,
        instruction: 'This will be included in future agent prompts as a DO NOT FLAG item.',
      });
    }

    case 'engram_save_handoff': {
      const handoffPath = join(brain.rootPath, 'handoff.md');
      const content = `# Session Handoff

**Goal:** ${params.goal || 'Not specified'}

**Current State:** ${params.current_state || 'Not specified'}

**Files in Flight:** ${params.files_in_flight || 'None'}

**What Changed:** ${params.what_changed || 'Nothing'}

**Failed Attempts:**
${params.failed_attempts || 'None documented'}

**Decisions Made:** ${params.decisions_made || 'None'}

**Next Step:** ${params.next_step || 'Not specified'}

---
*Saved: ${new Date().toISOString()}*
`;

      writeFileSync(handoffPath, content, 'utf-8');

      return JSON.stringify({
        status: 'saved',
        path: 'handoff.md',
        instruction: 'Next session will read handoff.md first. User should run /clear then open a fresh session.',
      });
    }

    // ── Team orchestration tools ─────────────────────────────────

    case 'engram_get_teams': {
      const custom = loadCustomTeams(brain.rootPath);
      if (custom) {
        return JSON.stringify({ source: 'custom', teams: custom, count: custom.length });
      }
      const defaults = buildDefaultTeams(brain.knowledge.summary.highFanoutFiles.length > 0
        ? [
            { name: 'UI', description: 'Frontend', filePatterns: ['components/**', 'app/**/*.tsx'], agents: ['code-reviewer', 'typescript-reviewer'] },
            { name: 'API & Security', description: 'Backend', filePatterns: ['app/api/**', 'src/api/**'], agents: ['security-reviewer', 'code-reviewer'] },
            { name: 'Business Logic', description: 'Core logic', filePatterns: ['lib/**', 'src/lib/**'], agents: ['type-design-analyzer', 'code-reviewer', 'silent-failure-hunter'] },
            { name: 'Infrastructure', description: 'Platform', filePatterns: ['lib/db.*', 'prisma/**'], agents: ['database-reviewer', 'performance-optimizer'] },
            { name: 'Quality Assurance', description: 'Testing', filePatterns: ['tests/**'], agents: ['tdd-guide', 'pr-test-analyzer'] },
          ]
        : [
            { name: 'Core', description: 'Main code', filePatterns: ['src/**'], agents: ['code-reviewer'] },
            { name: 'Quality Assurance', description: 'Testing', filePatterns: ['tests/**'], agents: ['tdd-guide'] },
          ]
      );
      return JSON.stringify({ source: 'default', teams: defaults, count: defaults.length });
    }

    case 'engram_define_team': {
      const existing = loadCustomTeams(brain.rootPath) || buildDefaultTeams([]);
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

    case 'engram_start_team_review': {
      const teamNames = params.teams === 'all' || !params.teams
        ? (loadCustomTeams(brain.rootPath) || buildDefaultTeams([])).map((t) => t.name)
        : params.teams.split(',').map((t) => t.trim());

      const board = startTeamBoard(
        `review-${Date.now()}`,
        params.task_description,
        teamNames,
      );

      return JSON.stringify({
        status: 'started',
        board_id: board.taskId,
        teams: teamNames,
        instruction: `Launch ${teamNames.length} agents IN PARALLEL. For each team, call engram_get_team_prompt with the team name, then spawn an Agent with that prompt. After each agent returns, call engram_post_team_findings with the results. Finally, call engram_get_board_summary to see all findings.`,
      });
    }

    case 'engram_get_team_prompt': {
      const teams = loadCustomTeams(brain.rootPath) || buildDefaultTeams([
        { name: params.team_name, description: '', filePatterns: ['src/**'], agents: ['code-reviewer'] },
      ]);
      const team = teams.find((t) => t.name === params.team_name);
      if (!team) return JSON.stringify({ error: `Team "${params.team_name}" not found` });

      markTeamWorking(params.team_name);

      // Build domain context for this team
      const files = (params.files_to_review || '').split(',').map((f) => f.trim()).filter(Boolean);
      const domainContext: Record<string, unknown> = {
        files_to_review: files.length > 0 ? files : team.filePatterns,
        knowledge_summary: {
          total_files: brain.knowledge.summary.totalFiles,
          high_fanout: brain.knowledge.summary.highFanoutFiles,
          untested: brain.knowledge.summary.untestedFiles,
        },
      };

      const otherFindings = getOtherTeamFindings(params.team_name);
      const prompt = generateTeamPrompt(team, getTeamBoard()?.taskDescription || '', domainContext, otherFindings);

      return JSON.stringify({
        team: team.name,
        prompt,
        agents_to_use: team.agents,
        instruction: 'Spawn an Agent with this prompt. The agent should review the code and return findings.',
      });
    }

    case 'engram_post_team_findings': {
      let findings: TeamFinding[];
      try {
        const raw = JSON.parse(params.findings || '[]');
        findings = raw.map((f: Record<string, string>) => ({
          team: params.team_name,
          severity: f.severity || 'MEDIUM',
          file: f.file || 'unknown',
          description: f.description || '',
          recommendation: f.recommendation || '',
          timestamp: new Date().toISOString(),
        }));
      } catch {
        findings = [{
          team: params.team_name,
          severity: 'LOW',
          file: 'unknown',
          description: params.findings || 'No structured findings',
          recommendation: '',
          timestamp: new Date().toISOString(),
        }];
      }

      postTeamFindings(params.team_name, findings);
      const summary = getBoardSummary();

      return JSON.stringify({
        status: 'posted',
        team: params.team_name,
        findings_count: findings.length,
        board_summary: summary,
        all_done: summary.allDone,
        instruction: summary.allDone
          ? 'All teams have reported. Call engram_get_board_summary for the complete picture.'
          : `${Object.entries(getTeamBoard()?.status || {}).filter(([_, s]) => s !== 'done').map(([t]) => t).join(', ')} still working.`,
      });
    }

    case 'engram_get_board_summary': {
      const board = getTeamBoard();
      if (!board) return JSON.stringify({ error: 'No active review board. Call engram_start_team_review first.' });

      const summary = getBoardSummary();
      const criticals = board.findings.filter((f) => f.severity === 'CRITICAL');
      const highs = board.findings.filter((f) => f.severity === 'HIGH');

      return JSON.stringify({
        task: board.taskDescription,
        ...summary,
        team_status: board.status,
        critical_findings: criticals.map((f) => `[${f.team}] ${f.file}: ${f.description}`),
        high_findings: highs.map((f) => `[${f.team}] ${f.file}: ${f.description}`),
        gate: summary.critical > 0
          ? 'BLOCKED — fix CRITICAL findings before proceeding'
          : summary.high > 0
            ? 'WARNING — HIGH findings should be addressed'
            : 'PASSED — no blocking findings',
      });
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
}
