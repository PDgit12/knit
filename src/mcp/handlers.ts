/**
 * Individual MCP tool handlers — extracted from the giant switch for
 * testability and readability. Each function takes params + brain cache
 * and returns a JSON string response.
 */

import { writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { BrainCache } from './cache.js';
import type { TeamFinding } from '../engine/types.js';
import { scanProject } from '../engine/scanner.js';
import { queryByDomains, getFalsePositives, getKBSummary, recordCacheHit, addEntry, saveKnowledgeBase } from '../engine/knowledgebase.js';
import { statSync } from 'node:fs';
import {
  knowledgebasePath, learningsDir, teamsPath, sessionsLogPath,
} from '../engine/paths.js';
import { appendSession, searchSessions, getRecentSessions, sessionCount } from '../engine/sessions.js';
import type { SessionSummary, SessionOutcome } from '../engine/types.js';
import { getWorkflowSection, listWorkflowSections } from '../generators/workflow-protocol.js';
import { spawnWorktree, listWorktrees, finalizeWorktree } from '../engine/worktrees.js';
import {
  buildDefaultTeams, generateTeamPrompt, loadCustomTeams, saveCustomTeams,
  startTeamBoard, getTeamBoard, markTeamWorking, postTeamFindings,
  getOtherTeamFindings, getBoardSummary,
} from '../engine/teams.js';


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

export function handleBrainStatus(_params: Record<string, string>, brain: BrainCache): string {
  const summary = getKBSummary(brain.knowledgeBase);

  // Token-accounting: is engram paying for itself?
  // CLAUDE.md is the per-session context tax engram imposes.
  // Hit rate is what engram pays back (re-investigations prevented).
  const claudeMdBytes = (() => {
    try { return statSync(join(brain.rootPath, 'CLAUDE.md')).size; }
    catch { return 0; }
  })();
  const totalSessions = sessionCount(brain.rootPath);
  const hitRate = summary.totalEntries > 0
    ? Math.round((summary.accessedEntries / summary.totalEntries) * 100)
    : 0;

  return JSON.stringify({
    ...summary,
    knowledge_index: {
      files_indexed: brain.knowledge.summary.totalFiles,
      total_lines: brain.knowledge.summary.totalLines,
      import_edges: Object.keys(brain.knowledge.importGraph).length,
      exports_mapped: Object.keys(brain.knowledge.exports).length,
    },
    token_accounting: {
      claude_md_bytes: claudeMdBytes,
      claude_md_kb: Math.round(claudeMdBytes / 1024 * 10) / 10,
      session_count: totalSessions,
      learnings_hit_rate_pct: hitRate,
      note: claudeMdBytes > 30000
        ? 'CLAUDE.md is large — consider trimming. Tax exceeds typical savings.'
        : hitRate < 20 && summary.totalEntries > 10
          ? 'Low hit rate — many learnings unused. Consider pruning stale entries.'
          : 'Healthy.',
    },
    cache_age_ms: Date.now() - brain.loadedAt,
    instruction: 'Brain is ready. Next: call engram_classify_task with the files you plan to touch to get your tier and phases.',
  });
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

  const isTypes = files.some((f) => f.includes('types') || f.includes('schema'));
  const isAuth = files.some((f) => f.includes('auth') || f.includes('security'));

  // If files are unknown (new project), classify from description
  const isNewProject = files.length === 0 || rawFiles.includes('unknown');
  const descriptionIsComplex = description.includes('architect') || description.includes('build from scratch')
    || description.includes('new project') || description.includes('system')
    || description.length > 100; // long descriptions = complex tasks

  const tier = isNewProject
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

  return JSON.stringify({
    tier, affected_domains: [...domains], phases, files_count: files.length,
    cross_domain_ripple: crossDomainRipple, auto_plan_mode: tier === 'complex',
    instruction,
    reasoning: tier === 'complex'
      ? `Complex: ${domains.size} domains affected${isTypes ? ', touches shared types' : ''}${isAuth ? ', security-sensitive' : ''}`
      : tier === 'standard' ? `Standard: ${domains.size} domain(s), ${files.length} file(s)` : `Trivial: 1 domain, simple change`,
  });
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
    summary: params.summary || 'Untitled learning',
    domains: (params.domains || 'general').split(',').map((d) => d.trim()),
    approach: params.approach || '',
    outcome: (['success', 'partial', 'failure'].includes(params.outcome) ? params.outcome : 'success') as 'success' | 'partial' | 'failure',
    lesson: params.lesson || '',
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
    summary: params.summary || 'Untitled FP',
    domains: ['General'],
    approach: 'Verified manually',
    outcome: 'success' as const,
    lesson: params.reason || 'Confirmed non-issue',
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
  const content = `# Session Handoff\n\n**Goal:** ${params.goal || 'Not specified'}\n\n**Current State:** ${params.current_state || 'Not specified'}\n\n**Files in Flight:** ${params.files_in_flight || 'None'}\n\n**What Changed:** ${params.what_changed || 'Nothing'}\n\n**Failed Attempts:**\n${params.failed_attempts || 'None documented'}\n\n**Decisions Made:** ${params.decisions_made || 'None'}\n\n**Next Step:** ${params.next_step || 'Not specified'}\n\n---\n*Saved: ${new Date().toISOString()}*\n`;
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
    instruction: `Project configured with ${teams.length} teams. Use engram_start_team_review to run parallel team analysis. Use engram_classify_task to classify tasks before starting.`,
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
    instruction: `Launch ${teamNames.length} agents IN PARALLEL. For each team, call engram_get_team_prompt, then spawn an Agent. After each returns, call engram_post_team_findings. Finally, call engram_get_board_summary.`,
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
  if (!board) return JSON.stringify({ error: 'No active review board. Call engram_start_team_review first.' });

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


// Pattern reflection (engram_reflect / engram_get_suggestions MCP tools) was
// removed in v0.2 — premature with ~1 learning per project. The reflect()
// function is still used internally by handleLoadSession to surface patterns
// in the load-session payload. Re-enable the standalone tools in v0.3 once
// projects accumulate enough learnings (≥10) for patterns to be meaningful.
import { reflect } from '../engine/reflect.js';


export function handleLoadSession(_params: Record<string, string>, brain: BrainCache): string {
  

  const root = brain.rootPath;

  // 1. Last session info
  const sessionsFile = sessionsLogPath(root);
  let lastSession = null;
  if (existsSync(sessionsFile)) {
    const content = readFileSync(sessionsFile, 'utf-8');
    const sessions = content.split(/^## Session/m).slice(1);
    if (sessions.length > 0) {
      const last = sessions[sessions.length - 1].trim();
      lastSession = last.slice(0, 300); // truncate
    }
  }

  // 2. Handoff (in-progress work from last session)
  const handoffPath = join(root, 'handoff.md');
  let handoff = null;
  if (existsSync(handoffPath)) {
    handoff = readFileSync(handoffPath, 'utf-8').slice(0, 2000);
  }

  // 3. Top learnings (most accessed — the ones that actually matter)
  const topLearnings = brain.knowledgeBase.entries
    .filter((e) => e.accessCount > 0)
    .sort((a, b) => b.accessCount - a.accessCount)
    .slice(0, 5)
    .map((e) => ({ summary: e.summary, lesson: e.lesson, tags: e.tags, accessed: e.accessCount }));

  // 4. False positives (agents need these to not re-report)
  const fps = brain.knowledgeBase.entries
    .filter((e) => e.tags.includes('#false-positive'))
    .map((e) => ({ summary: e.summary, lesson: e.lesson }));

  // 5. Custom teams
  const teamsFile = teamsPath(root);
  let teams: string[] = [];
  if (existsSync(teamsFile)) {
    try {
      const t = JSON.parse(readFileSync(teamsFile, 'utf-8'));
      teams = t.map((team: any) => team.name);
    } catch { /* skip */ }
  }

  // 6. Project knowledge summary
  const knowledge = {
    files: brain.knowledge.summary.totalFiles,
    imports: Object.keys(brain.knowledge.importGraph).length,
    high_fanout: brain.knowledge.summary.highFanoutFiles,
    untested: brain.knowledge.summary.untestedFiles.slice(0, 5),
  };

  // 7. Session metrics
  const metrics = {
    total_sessions: brain.knowledgeBase.metrics.totalSessions,
    total_learnings: brain.knowledgeBase.entries.length,
    cache_hits: brain.knowledgeBase.metrics.cacheHits,
  };

  // 7b. Recent session summaries — what made this session feel compounding
  const recentSessions = getRecentSessions(root, 3).map((s) => ({
    date: s.date,
    branch: s.branch ?? null,
    summary: s.summary ?? '',
    tags: s.tags ?? [],
    outcome: s.outcome,
  }));

  // 8. Patterns (from reflection engine)
  const patterns = reflect(brain.knowledgeBase)
    .slice(0, 3)
    .map((p: any) => ({ type: p.type, description: p.description, confidence: p.confidence }));

  return JSON.stringify({
    session_context: {
      last_session: lastSession,
      handoff: handoff,
      has_unfinished_work: handoff !== null,
    },
    intelligence: {
      top_learnings: topLearnings,
      false_positives: fps,
      patterns,
    },
    project: {
      knowledge,
      teams,
      metrics,
      recent_sessions: recentSessions,
    },
    instruction: handoff
      ? 'UNFINISHED WORK DETECTED. Read the handoff above — pick up where the last session left off. Do NOT start fresh.'
      : topLearnings.length > 0
        ? `Session loaded. ${topLearnings.length} key learnings available. ${fps.length} false positives to suppress. Call engram_classify_task to begin.`
        : recentSessions.length > 0
          ? `Session loaded. ${recentSessions.length} recent sessions on file. Call engram_classify_task to begin.`
          : 'Fresh brain — no past learnings yet. Call engram_classify_task to begin your first task.',
  });
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
    instruction: 'Session summary recorded. Future engram_search_sessions calls can find this.',
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
      instruction: 'Call engram_get_workflow with one of the section names to fetch its content.',
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
    instruction: 'Apply this section to the current task. For another phase, call engram_get_workflow again with that phase name.',
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
      instruction: `Worktree ready at ${record.path}. Pass this path to the team's agents. They should cd there and make their changes on branch ${record.branch}. When done, call engram_finalize_team_worktree with action="merge".`,
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
