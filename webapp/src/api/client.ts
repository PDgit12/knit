// Local-first API client — talks to the knit ui server on 127.0.0.1.
// All endpoints are read-only in v1.0-alpha.

export interface BrainSummary {
  projectCount: number;
  totalLearnings: number;
  globalLearnings: number;
  knitVersion: string;
  knitHome: string;
}

export interface BrainAggregate {
  projectCount: number;
  totalLearnings: number;
  totalSessions: number;
  totalCacheHits: number;
  totalGraphQueries: number;
  totalFpSuppressions: number;
  totalTokensSaved: number;
  totalTokensSpent: number;
  netTokenDelta: number;
  topProjects: Array<{ id: string; name: string; netTokenDelta: number; verdict: string }>;
}

export interface ProjectSummary {
  id: string;
  name: string;
  learningCount: number;
  sessionCount: number;
  lastActive: string | null;
}

export interface LearningEntry {
  id: string;
  date: string;
  summary: string;
  domains: string[];
  approach: string;
  outcome: 'success' | 'partial' | 'failure';
  lesson: string;
  tags: string[];
  accessCount: number;
  lastAccessed: string | null;
}

export interface ProjectLearnings {
  project: { id: string; name: string };
  learnings: LearningEntry[];
}

export interface ProjectMetrics {
  projectId: string;
  projectName: string;
  totalSessions: number;
  totalLearnings: number;
  accessedLearnings: number;
  accessedPct: number;
  cacheHits: number;
  graphQueries: number;
  fpSuppressions: number;
  highScoreHits: number;
  totalRetrievalQueries: number;
  totalClassifications: number;
  planModeTriggers: number;
  classificationsByTier: Record<string, number>;
  domainDistribution: Record<string, number>;
  tokensSpentEstimate: number;
  tokensSavedEstimate: number;
  netTokenDelta: number;
  verdict: 'cold' | 'warming' | 'compounding' | 'strong';
}

export interface GlobalDoctorCheck {
  name: string;
  status: 'ok' | 'warn' | 'error' | 'info';
  detail: string;
}

export interface GlobalDoctorReport {
  knitVersion: string;
  nodeVersion: string;
  knitHome: string;
  checks: GlobalDoctorCheck[];
  summary: { ok: number; warn: number; error: number; info: number };
}

export interface GlobalLearning {
  id: string;
  date: string;
  summary: string;
  lesson: string;
  tags: string[];
  outcome: 'success' | 'partial' | 'failure' | null;
  sourceProjectName: string;
  sourceProjectId: string;
}

export interface VersionInfo {
  knitVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  updateCommand: string | null;
  dashboardApi: string;
  endpoints: string[];
  security: {
    host: string;
    origin: string;
    csp: string;
    auth: string;
  };
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  version: () => get<VersionInfo>('/api/version'),
  brainSummary: () => get<BrainSummary>('/api/brain/summary'),
  brainAggregate: () => get<BrainAggregate>('/api/brain/aggregate'),
  projects: () => get<{ projects: ProjectSummary[] }>('/api/projects'),
  projectLearnings: (id: string) => get<ProjectLearnings>(`/api/projects/${id}/learnings`),
  projectMetrics: (id: string) => get<ProjectMetrics>(`/api/projects/${id}/metrics`),
  globalLearnings: () => get<{ learnings: GlobalLearning[] }>('/api/global/learnings'),
  doctor: () => get<GlobalDoctorReport>('/api/doctor'),
};
