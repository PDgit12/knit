import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { AgentTeam, TeamFinding, TeamBoard, Domain } from './types.js';

/** Default teams generated from detected domains */
export function buildDefaultTeams(domains: Domain[]): AgentTeam[] {
  return domains.map((domain) => domainToTeam(domain));
}

function domainToTeam(domain: Domain): AgentTeam {
  const teamMap: Record<string, Partial<AgentTeam>> = {
    'UI': {
      role: 'Frontend Engineering',
      focus: 'User interface, components, accessibility, responsive design, state management',
      reviewChecklist: [
        'Components render correctly with all props',
        'Accessibility: keyboard navigation, screen readers, ARIA labels',
        'Responsive: works at 320px, 768px, 1024px, 1440px',
        'Loading and error states handled',
        'No layout shifts from dynamic content',
        'Design system compliance',
      ],
    },
    'API & Security': {
      role: 'Backend & Security Engineering',
      focus: 'API endpoints, authentication, authorization, input validation, rate limiting',
      reviewChecklist: [
        'All endpoints validate input (Zod/Joi/etc)',
        'Authentication required on protected routes',
        'Authorization checks (user can only access own resources)',
        'Rate limiting on auth and submission endpoints',
        'No SQL injection (parameterized queries)',
        'No XSS (sanitized output)',
        'Error responses don\'t leak internal details',
        'CORS configured correctly',
      ],
    },
    'Business Logic': {
      role: 'Core Logic Engineering',
      focus: 'Types, validations, calculations, data transformations, business rules',
      reviewChecklist: [
        'Type contracts are correct and complete',
        'Calculations produce correct results for edge cases',
        'Validation schemas match API expectations',
        'No silent failures in data transformations',
        'Immutable data patterns where applicable',
      ],
    },
    'Infrastructure': {
      role: 'Infrastructure & Platform Engineering',
      focus: 'Database, email, webhooks, middleware, external integrations, deployment',
      reviewChecklist: [
        'Database migrations are safe and reversible',
        'Queries are efficient (no N+1, proper indexes)',
        'External API calls have timeouts and retries',
        'Email/webhook payloads are correct',
        'Environment variables documented',
        'Docker/deployment configs are secure',
      ],
    },
    'Quality Assurance': {
      role: 'QA & Testing',
      focus: 'Test coverage, test quality, build stability, regression detection',
      reviewChecklist: [
        'New code has tests (80%+ coverage target)',
        'Tests are deterministic (no flaky tests)',
        'Edge cases covered (empty, null, large inputs)',
        'Integration tests for critical paths',
        'Build passes in clean environment',
      ],
    },
  };

  const defaults = teamMap[domain.name] || {
    role: `${domain.name} Engineering`,
    focus: domain.description,
    reviewChecklist: ['Code quality review', 'Test coverage', 'Error handling'],
  };

  return {
    name: domain.name,
    role: defaults.role || domain.name,
    focus: defaults.focus || domain.description,
    agents: domain.agents,
    filePatterns: domain.filePatterns,
    reviewChecklist: defaults.reviewChecklist || [],
  };
}

/** Generate a team-specific agent prompt for a given task */
export function generateTeamPrompt(
  team: AgentTeam,
  taskDescription: string,
  domainContext: Record<string, unknown>,
  otherTeamFindings: TeamFinding[],
): string {
  let prompt = `You are the **${team.name} Team** (${team.role}).

**Your focus:** ${team.focus}

**Task:** ${taskDescription}

**Files in your domain:** ${team.filePatterns.join(', ')}

**Your review checklist:**
${team.reviewChecklist.map((item) => `- [ ] ${item}`).join('\n')}

**Domain Context:**
${JSON.stringify(domainContext, null, 2)}
`;

  // Include findings from other teams so this team can react
  if (otherTeamFindings.length > 0) {
    prompt += `\n**Findings from other teams (react to these if they affect your domain):**\n`;
    for (const finding of otherTeamFindings) {
      prompt += `- [${finding.severity}] ${finding.team}: ${finding.description} (${finding.file})\n`;
    }
  }

  prompt += `\n**Report format:** For each finding, provide:
- Severity: CRITICAL / HIGH / MEDIUM / LOW
- File: which file
- Description: what's wrong
- Recommendation: specific fix

Only report findings you've VERIFIED against the actual code. Do not hallucinate issues.`;

  return prompt;
}

// ── Team Board (shared findings) ─────────────────────────────────

const boards = new Map<string, TeamBoard>();
let latestBoardId: string | null = null;

/** Start a new team board for a task */
export function startTeamBoard(taskId: string, taskDescription: string, teams: string[]): TeamBoard {
  const board: TeamBoard = {
    taskId,
    taskDescription,
    teams,
    findings: [],
    status: Object.fromEntries(teams.map((t) => [t, 'pending' as const])),
    createdAt: new Date().toISOString(),
  };
  boards.set(taskId, board);
  latestBoardId = taskId;
  return board;
}

/** Get the active board (latest or by ID) */
export function getTeamBoard(taskId?: string): TeamBoard | null {
  if (taskId) return boards.get(taskId) || null;
  if (latestBoardId) return boards.get(latestBoardId) || null;
  return null;
}

/** Mark a team as working */
export function markTeamWorking(teamName: string, taskId?: string): void {
  const board = getTeamBoard(taskId);
  if (board) board.status[teamName] = 'working';
}

/** Post findings from a team */
export function postTeamFindings(teamName: string, findings: TeamFinding[], taskId?: string): void {
  const board = getTeamBoard(taskId);
  if (!board) return;
  board.findings.push(...findings);
  board.status[teamName] = 'done';
}

/** Get findings from other teams (for cross-team communication) */
export function getOtherTeamFindings(excludeTeam: string, taskId?: string): TeamFinding[] {
  const board = getTeamBoard(taskId);
  if (!board) return [];
  return board.findings.filter((f) => f.team !== excludeTeam);
}

/** Check if all teams are done */
export function allTeamsDone(taskId?: string): boolean {
  const board = getTeamBoard(taskId);
  if (!board) return false;
  return Object.values(board.status).every((s) => s === 'done');
}

/** Get summary of all findings across all teams */
export function getBoardSummary(taskId?: string): {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  byTeam: Record<string, number>;
  allDone: boolean;
} {
  const board = getTeamBoard(taskId);
  if (!board) {
    return { total: 0, critical: 0, high: 0, medium: 0, low: 0, byTeam: {}, allDone: false };
  }

  const findings = board.findings;
  const byTeam: Record<string, number> = {};
  for (const f of findings) {
    byTeam[f.team] = (byTeam[f.team] || 0) + 1;
  }

  return {
    total: findings.length,
    critical: findings.filter((f) => f.severity === 'CRITICAL').length,
    high: findings.filter((f) => f.severity === 'HIGH').length,
    medium: findings.filter((f) => f.severity === 'MEDIUM').length,
    low: findings.filter((f) => f.severity === 'LOW').length,
    byTeam,
    allDone: allTeamsDone(taskId),
  };
}

// ── Custom Teams (user-defined) ──────────────────────────────────

const TEAMS_FILE = '.claude/teams.json';

/** Load custom teams from project config */
export function loadCustomTeams(rootPath: string): AgentTeam[] | null {
  const teamsPath = join(rootPath, TEAMS_FILE);
  if (!existsSync(teamsPath)) return null;

  try {
    return JSON.parse(readFileSync(teamsPath, 'utf-8'));
  } catch {
    return null;
  }
}

/** Save custom teams to project config */
export function saveCustomTeams(rootPath: string, teams: AgentTeam[]): void {
  const teamsPath = join(rootPath, TEAMS_FILE);
  const dir = dirname(teamsPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(teamsPath, JSON.stringify(teams, null, 2), 'utf-8');
}
