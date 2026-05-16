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
import {
  buildDefaultTeams, generateTeamPrompt, loadCustomTeams, saveCustomTeams,
  startTeamBoard, getTeamBoard, markTeamWorking, postTeamFindings,
  getOtherTeamFindings, getBoardSummary,
} from '../engine/teams.js';

// ── Shared helpers ───────────────────────────────────────────────

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

// ── Query handlers ───────────────────────────────────────────────

export function handleQueryImports(params: Record<string, string>, brain: BrainCache): string {
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
    return JSON.stringify({ untested_files: brain.knowledge.testMap.untested, count: brain.knowledge.testMap.untested.length });
  }
  if (params.file_path) {
    const tests = brain.knowledge.testMap.tested[params.file_path] || [];
    return JSON.stringify({ file: params.file_path, tested_by: tests, has_tests: tests.length > 0 });
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
  return JSON.stringify({
    query: domains,
    results: results.map((r) => ({
      summary: r.summary, lesson: r.lesson, outcome: r.outcome,
      date: r.date, tags: r.tags, access_count: r.accessCount,
    })),
    count: results.length,
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

// ── Action handlers ──────────────────────────────────────────────

export function handleClassifyTask(params: Record<string, string>, brain: BrainCache): string {
  const files = (params.files_to_touch || '').split(',').map((f) => f.trim()).filter(Boolean);
  const domains = detectDomainsFromFiles(files);
  const crossDomainRipple: string[] = [];

  for (const file of files) {
    const importers = brain.reverseDeps[file] || [];
    if (importers.length >= 3) crossDomainRipple.push(`${file} is high-fanout (${importers.length} dependents)`);
  }

  const isTypes = files.some((f) => f.includes('types') || f.includes('schema'));
  const isAuth = files.some((f) => f.includes('auth') || f.includes('security'));
  const tier = (domains.size >= 3 || isTypes || isAuth || files.length > 3)
    ? 'complex' : (domains.size >= 2 || files.length > 1) ? 'standard' : 'trivial';

  const phases = tier === 'complex'
    ? ['RESEARCH', 'IDEATE', 'PLAN', 'EXECUTE', 'OPTIMIZE', 'REVIEW', 'LEARN']
    : tier === 'standard'
      ? ['RESEARCH', 'EXECUTE', 'OPTIMIZE', 'REVIEW', 'LEARN']
      : ['EXECUTE', 'VERIFY', 'LEARN'];

  return JSON.stringify({
    tier, affected_domains: [...domains], phases, files_count: files.length,
    cross_domain_ripple: crossDomainRipple, auto_plan_mode: tier === 'complex',
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
  const kbPath = join(brain.rootPath, '.claude/knowledgebase.json');
  saveKnowledgeBase(kbPath, brain.knowledgeBase);

  // Also append to markdown learnings file
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

  return JSON.stringify({ status: 'recorded', entry: { date, summary: entry.summary, tags: entry.tags }, kb_total: brain.knowledgeBase.entries.length });
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
  const kbPath = join(brain.rootPath, '.claude/knowledgebase.json');
  saveKnowledgeBase(kbPath, brain.knowledgeBase);

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

// ── Project setup (universal — code and non-code) ────────────────

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
  const kbPath = join(brain.rootPath, '.claude/knowledgebase.json');
  saveKnowledgeBase(kbPath, brain.knowledgeBase);

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

// ── Team handlers ────────────────────────────────────────────────

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

export function handlePostTeamFindings(params: Record<string, string>): string {
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

export function handleGetBoardSummary(): string {
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
