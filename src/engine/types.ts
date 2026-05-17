/**
 * Core types for Engram — the universal contract.
 * Every domain depends on these. Changes here = Complex tier.
 */

/** Detected project characteristics */
export interface ProjectScan {
  /** Absolute path to project root */
  rootPath: string;
  /** Package manager: npm, yarn, pnpm, bun */
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'bun' | 'unknown';
  /** Detected language/framework */
  stack: StackInfo;
  /** Detected domains from file structure */
  domains: Domain[];
  /** Whether .claude/ already exists */
  hasExistingSetup: boolean;
  /** Whether CLAUDE.md already exists */
  hasExistingClaudeMd: boolean;
  /** Git info */
  git: GitInfo;
}

export interface StackInfo {
  language: 'typescript' | 'javascript' | 'python' | 'go' | 'rust' | 'java' | 'unknown';
  framework: string | null;
  /** Key dependencies detected */
  dependencies: string[];
  /** Test framework if detected */
  testFramework: string | null;
  /** Build command if detected */
  buildCommand: string | null;
  /** Lint command if detected */
  lintCommand: string | null;
  /** Typecheck command if detected */
  typecheckCommand: string | null;
}

export interface Domain {
  name: string;
  description: string;
  /** Glob patterns for files in this domain */
  filePatterns: string[];
  /** Agents recommended for this domain */
  agents: string[];
}

export interface GitInfo {
  isRepo: boolean;
  defaultBranch: string | null;
  hasRemote: boolean;
}

/** Learnings entry format */
export interface LearningEntry {
  date: string;
  summary: string;
  domains: string[];
  approach: string;
  outcome: 'success' | 'partial' | 'failure';
  lesson: string;
  tags: string[];
}

/** Tier classification */
export type TaskTier = 'trivial' | 'standard' | 'complex';

/** Task classification result */
export interface TaskClassification {
  tier: TaskTier;
  domains: string[];
  reasoning: string;
  phases: string[];
}

/** Domain Context Object — passed to every agent prompt */
export interface DomainContext {
  affectedDomains: string[];
  filesToTouch: string[];
  crossDomainRipple: string[];
  knownPitfalls: string[];
  falsePositives: string[];
  toolAvailability: {
    semanticSearch: boolean;
    browserQA: boolean;
    devServer: boolean;
  };
  scoutFindings: string[];
  selectedApproach: string | null;
  approvedPlan: string | null;
}

/** Configuration for generated workflow */
export interface EngramConfig {
  /** Project name */
  name: string;
  /** Package manager */
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'bun' | 'unknown';
  /** Detected or user-specified stack */
  stack: StackInfo;
  /** Domains for this project */
  domains: Domain[];
  /** Which agent to target: claude-code, cursor, codex */
  targetAgent: 'claude-code' | 'cursor' | 'codex';
  /** Token optimization level */
  tokenOptimization: 'minimal' | 'standard' | 'aggressive';
}

/** ── Knowledge Brain ─────────────────────────────────────────── */

/** Complete project knowledge index — Engram's own brain */
export interface ProjectKnowledge {
  generatedAt: string;
  summary: KnowledgeSummary;
  files: FileEntry[];
  /** file → files it imports (relative paths) */
  importGraph: Record<string, string[]>;
  /** file → what it exports */
  exports: Record<string, ExportEntry[]>;
  /** test file mapping */
  testMap: TestMapping;
}

export interface KnowledgeSummary {
  totalFiles: number;
  totalLines: number;
  /** extension → file count */
  languageBreakdown: Record<string, number>;
  entryPoints: string[];
  /** Files imported by 5+ other files */
  highFanoutFiles: string[];
  /** Source files with no matching test */
  untestedFiles: string[];
  /** Top 10 largest files */
  largestFiles: Array<{ path: string; lines: number }>;
}

export interface FileEntry {
  path: string;
  extension: string;
  lines: number;
  sizeBytes: number;
}

export interface ExportEntry {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'const' | 'default' | 'other';
  line: number;
}

export interface TestMapping {
  /** source file → test files that test it */
  tested: Record<string, string[]>;
  /** source files with no test */
  untested: string[];
  /** all test files */
  testFiles: string[];
}

/** ── Agent Teams ─────────────────────────────────────────────── */

/** A team of agents that works on a specific domain */
export interface AgentTeam {
  name: string;
  role: string;
  focus: string;
  agents: string[];
  /** File patterns this team is responsible for */
  filePatterns: string[];
  /** What this team checks during review */
  reviewChecklist: string[];
}

/** Findings from a team's work */
export interface TeamFinding {
  team: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  file: string;
  description: string;
  recommendation: string;
  timestamp: string;
}

/** Shared board where teams post findings for other teams to see */
export interface TeamBoard {
  taskId: string;
  taskDescription: string;
  teams: string[];
  findings: TeamFinding[];
  status: Record<string, 'pending' | 'working' | 'done'>;
  createdAt: string;
}

/** ── Knowledge Base (structured learnings + metrics) ─────────── */

/** Structured knowledge base — replaces flat markdown for retrieval */
export interface KnowledgeBase {
  version: 1;
  projectName: string;
  entries: KBEntry[];
  metrics: KBMetrics;
}

/** A single knowledge entry with access tracking */
export interface KBEntry {
  id: string;
  date: string;
  summary: string;
  domains: string[];
  approach: string;
  outcome: 'success' | 'partial' | 'failure';
  lesson: string;
  tags: string[];
  /** How many times this entry was retrieved in a session */
  accessCount: number;
  /** Last time this entry was accessed */
  lastAccessed: string | null;
}

/** Session and usage metrics */
export interface KBMetrics {
  totalSessions: number;
  totalLearnings: number;
  /** How many times learnings prevented re-investigation (self-reported) */
  cacheHits: number;
  /** Domain tag → how many entries */
  domainDistribution: Record<string, number>;
  /** Session history (last 20) */
  sessions: SessionRecord[];
}

export interface SessionRecord {
  date: string;
  branch: string | null;
  filesModified: number;
  learningsAccessed: number;
  learningsAdded: number;
  /** Domains touched this session */
  domainsTouched: string[];
}

/**
 * Searchable session entity stored in sessions.jsonl.
 *
 * Two write paths:
 *   - Stop hook auto-writes a thin tuple at session end (id, date, branch,
 *     filesModified, commits). outcome defaults to 'unknown'.
 *   - Agent opt-in calls engram_save_session_summary to attach a rich
 *     summary, tags, and outcome — the entries that make engram_search_sessions
 *     useful.
 *
 * Every field except id, date, and outcome is optional so partial tuples
 * from the Stop hook merge cleanly with later agent-supplied detail.
 */
export type SessionOutcome = 'shipped' | 'wip' | 'failed' | 'unknown';

export interface SessionSummary {
  /** Stable per-session id (epoch + pid for hook-written, agent-chosen for opt-in). */
  id: string;
  /** YYYY-MM-DD */
  date: string;
  /** Full ISO timestamp when available. */
  timestamp?: string;
  branch?: string | null;
  /** Files agent reports touching (from engram_save_session_summary). */
  filesTouched?: string[];
  /** Count from Stop hook (git diff --name-only HEAD). */
  filesModified?: number;
  /** Recent commit shas from Stop hook (space-separated string). */
  commits?: string;
  domainsTouched?: string[];
  learningsAdded?: number;
  /** Free text — the main searchable field. */
  summary?: string;
  tags?: string[];
  outcome: SessionOutcome;
}

/** Output of the init command */
export interface InitResult {
  filesCreated: string[];
  filesSkipped: string[];
  warnings: string[];
  config: EngramConfig;
}
