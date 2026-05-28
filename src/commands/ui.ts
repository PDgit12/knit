/**
 * `knit ui` — launches the local Knit dashboard.
 *
 * v1.0-alpha doorway. The ONLY terminal command the user touches in normal
 * operation: starts a local HTTP server reading ~/.knit/ and opens the
 * default browser. Everything else (setup, status, refresh, install-agents,
 * doctor, export) eventually moves into webapp screens — those CLI commands
 * stay for now as deprecated fallbacks until the webapp has feature parity.
 *
 * Local-first invariants honored:
 *   - Server binds to 127.0.0.1 only (no LAN exposure)
 *   - No auth (your machine, your data)
 *   - No outbound network calls
 *   - Reads ~/.knit/projects/<hash>/* and ~/.knit/global/* directly
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, readdirSync, existsSync, statSync, accessSync, watch, type FSWatcher, constants as fsConstants } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';

import { knitRoot } from '../engine/paths.js';
import { VERSION } from '../version.js';
import { prewarmLatestVersion, getCachedLatestVersion, isNewerVersion } from '../mcp/update-check.js';
import { scanAllAgentCommands } from '../engine/agent-command-scanner.js';
import { detectAllAgents } from '../engine/agent-detector.js';

const HOST = '127.0.0.1';
const DEFAULT_PORT = 7421;

// ─── Local-first security boundary ──────────────────────────────────────
// The dashboard binds to 127.0.0.1, but that alone doesn't stop DNS
// rebinding: a malicious website you visit could resolve `evil.com` to
// 127.0.0.1 and have your browser send requests to the dashboard from a
// non-knit origin. Defense: validate the Host header (only accept
// localhost variants) and reject any Origin/Referer that isn't ours.
// This is the same defense PostgreSQL, Redis, Docker daemon, and the
// React dev server all use.
const ALLOWED_HOST_PREFIXES = ['127.0.0.1', 'localhost', '[::1]', '::1'] as const;

function allowedHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  const host = hostHeader.split(':')[0].toLowerCase();
  // Strip IPv6 brackets if present.
  const normalized = host.startsWith('[') ? host.slice(1, host.lastIndexOf(']')) : host;
  return ALLOWED_HOST_PREFIXES.some((p) => normalized === p || normalized === p.replace(/[[\]]/g, ''));
}

function allowedOrigin(originHeader: string | undefined, port: number): boolean {
  if (!originHeader) return true; // direct nav / curl has no Origin — fine
  try {
    const url = new URL(originHeader);
    if (!ALLOWED_HOST_PREFIXES.some((p) => url.hostname === p.replace(/[[\]]/g, ''))) return false;
    if (url.port && url.port !== String(port)) return false;
    return true;
  } catch {
    return false;
  }
}

interface ProjectSummary {
  id: string;
  name: string;
  learningCount: number;
  sessionCount: number;
  lastActive: string | null;
}

interface BrainSummary {
  projectCount: number;
  totalLearnings: number;
  globalLearnings: number;
  knitVersion: string;
  knitHome: string;
}

interface LearningEntry {
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

interface ProjectMetrics {
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

interface GlobalLearning {
  id: string;
  date: string;
  summary: string;
  lesson: string;
  tags: string[];
  outcome: 'success' | 'partial' | 'failure' | null;
  sourceProjectName: string;
  sourceProjectId: string;
}

interface GlobalDoctorCheck {
  name: string;
  status: 'ok' | 'warn' | 'error' | 'info';
  detail: string;
}

interface DoctorAgentRow {
  agent: string;
  displayName: string;
  present: boolean;
  registered: boolean;
  configPath: string;
  notes?: string;
}

interface GlobalDoctorReport {
  knitVersion: string;
  nodeVersion: string;
  knitHome: string;
  checks: GlobalDoctorCheck[];
  summary: { ok: number; warn: number; error: number; info: number };
  // v0.15 (audit F2) — per-agent rows surface the same data the CLI
  // `knit doctor` shows, so the webapp can render the 6-agent table.
  agents: DoctorAgentRow[];
}

// Token economics constants — kept in sync with src/mcp/handlers.ts
// TOKENS_PER_TIER + the cacheHits/FP/graph multipliers in handleCompoundingMetrics.
const TOKENS_PER_TIER = { inquiry: 200, trivial: 1500, standard: 8000, complex: 25000 } as const;
const TOKENS_PER_CACHE_HIT = 15000;
const TOKENS_PER_FP_SUPPRESSION = 5000;
const TOKENS_PER_GRAPH_QUERY = 3000;

function listProjects(): ProjectSummary[] {
  const root = join(knitRoot(), 'projects');
  if (!existsSync(root)) return [];
  const projects: ProjectSummary[] = [];
  for (const id of readdirSync(root)) {
    const dir = join(root, id);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    const kbPath = join(dir, 'knowledgebase.json');
    const sessPath = join(dir, 'sessions.jsonl');
    let name = id;
    let learningCount = 0;
    let lastActive: string | null = null;
    try {
      if (existsSync(kbPath)) {
        const kb = JSON.parse(readFileSync(kbPath, 'utf-8')) as {
          projectName?: string;
          entries?: { date?: string }[];
        };
        name = kb.projectName || id;
        learningCount = Array.isArray(kb.entries) ? kb.entries.length : 0;
        if (kb.entries && kb.entries.length > 0) {
          const dates = kb.entries
            .map((e) => e.date)
            .filter((d): d is string => typeof d === 'string')
            .sort();
          lastActive = dates.at(-1) ?? null;
        }
      }
    } catch {
      /* unreadable kb — surface project with default counts */
    }
    let sessionCount = 0;
    try {
      if (existsSync(sessPath)) {
        const lines = readFileSync(sessPath, 'utf-8').split('\n').filter(Boolean);
        sessionCount = lines.length;
      }
    } catch {
      /* unreadable sessions */
    }
    projects.push({ id, name, learningCount, sessionCount, lastActive });
  }
  return projects.sort((a, b) => (b.lastActive ?? '').localeCompare(a.lastActive ?? ''));
}

function countGlobalLearnings(): number {
  const path = join(knitRoot(), 'global', 'learnings.jsonl');
  if (!existsSync(path)) return 0;
  try {
    return readFileSync(path, 'utf-8').split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

function brainSummary(): BrainSummary {
  const projects = listProjects();
  return {
    projectCount: projects.length,
    totalLearnings: projects.reduce((sum, p) => sum + p.learningCount, 0),
    globalLearnings: countGlobalLearnings(),
    knitVersion: VERSION,
    knitHome: knitRoot().replace(homedir(), '~'),
  };
}

interface BrainAggregate {
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

function computeBrainAggregate(): BrainAggregate {
  const root = join(knitRoot(), 'projects');
  const totals = {
    projectCount: 0, totalLearnings: 0, totalSessions: 0,
    totalCacheHits: 0, totalGraphQueries: 0, totalFpSuppressions: 0,
    totalTokensSaved: 0, totalTokensSpent: 0,
  };
  const projectDeltas: BrainAggregate['topProjects'] = [];
  if (!existsSync(root)) {
    return { ...totals, netTokenDelta: 0, topProjects: [] };
  }
  for (const id of readdirSync(root)) {
    try { if (!statSync(join(root, id)).isDirectory()) continue; } catch { continue; }
    const m = computeProjectMetrics(id);
    if (!m) continue;
    totals.projectCount++;
    totals.totalLearnings += m.totalLearnings;
    totals.totalSessions += m.totalSessions;
    totals.totalCacheHits += m.cacheHits;
    totals.totalGraphQueries += m.graphQueries;
    totals.totalFpSuppressions += m.fpSuppressions;
    totals.totalTokensSaved += m.tokensSavedEstimate;
    totals.totalTokensSpent += m.tokensSpentEstimate;
    projectDeltas.push({ id, name: m.projectName, netTokenDelta: m.netTokenDelta, verdict: m.verdict });
  }
  projectDeltas.sort((a, b) => b.netTokenDelta - a.netTokenDelta);
  return {
    ...totals,
    netTokenDelta: totals.totalTokensSaved - totals.totalTokensSpent,
    topProjects: projectDeltas.slice(0, 5),
  };
}

function readProjectLearnings(projectId: string): { name: string; entries: LearningEntry[] } | null {
  const kbPath = join(knitRoot(), 'projects', projectId, 'knowledgebase.json');
  if (!existsSync(kbPath)) return null;
  try {
    const kb = JSON.parse(readFileSync(kbPath, 'utf-8')) as {
      projectName?: string;
      entries?: Array<{
        id?: string; date?: string; summary?: string; domains?: string[];
        approach?: string; outcome?: string; lesson?: string; tags?: string[];
        accessCount?: number; lastAccessed?: string | null;
      }>;
    };
    const entries: LearningEntry[] = (kb.entries ?? []).map((e, idx) => ({
      id: e.id ?? `entry-${idx}`,
      date: e.date ?? '',
      summary: e.summary ?? '',
      domains: Array.isArray(e.domains) ? e.domains : [],
      approach: e.approach ?? '',
      outcome: (e.outcome === 'partial' || e.outcome === 'failure') ? e.outcome : 'success',
      lesson: e.lesson ?? '',
      tags: Array.isArray(e.tags) ? e.tags : [],
      accessCount: typeof e.accessCount === 'number' ? e.accessCount : 0,
      lastAccessed: e.lastAccessed ?? null,
    }));
    return { name: kb.projectName ?? projectId, entries };
  } catch {
    return null;
  }
}

function computeProjectMetrics(projectId: string): ProjectMetrics | null {
  const kbPath = join(knitRoot(), 'projects', projectId, 'knowledgebase.json');
  if (!existsSync(kbPath)) return null;
  try {
    const kb = JSON.parse(readFileSync(kbPath, 'utf-8')) as {
      projectName?: string;
      entries?: Array<{ accessCount?: number }>;
      metrics?: {
        totalSessions?: number; totalLearnings?: number; cacheHits?: number;
        domainDistribution?: Record<string, number>; sessions?: unknown[];
        totalRetrievalQueries?: number; highScoreHits?: number;
        graphQueries?: number; fpSuppressions?: number;
        totalClassifications?: number; planModeTriggers?: number;
        classificationsByTier?: { trivial?: number; standard?: number; complex?: number; inquiry?: number };
      };
    };
    const m = kb.metrics ?? {};
    const entries = kb.entries ?? [];
    const accessed = entries.filter((e) => (e.accessCount ?? 0) > 0).length;
    const total = entries.length;
    const totalSessions = m.totalSessions ?? 0;
    const classificationsByTier = m.classificationsByTier ?? {};
    const inquiry = classificationsByTier.inquiry ?? 0;
    const trivial = classificationsByTier.trivial ?? 0;
    const standard = classificationsByTier.standard ?? 0;
    const complex = classificationsByTier.complex ?? 0;
    const tokensSpentEstimate =
      inquiry * TOKENS_PER_TIER.inquiry +
      trivial * TOKENS_PER_TIER.trivial +
      standard * TOKENS_PER_TIER.standard +
      complex * TOKENS_PER_TIER.complex;
    const cacheHits = m.cacheHits ?? 0;
    const fpSuppressions = m.fpSuppressions ?? 0;
    const graphQueries = m.graphQueries ?? 0;
    const tokensSavedEstimate =
      cacheHits * TOKENS_PER_CACHE_HIT +
      fpSuppressions * TOKENS_PER_FP_SUPPRESSION +
      graphQueries * TOKENS_PER_GRAPH_QUERY;
    const reuseRatioPct = totalSessions > 0 ? Math.min(100, Math.round((cacheHits / totalSessions) * 100)) : 0;
    const verdict: ProjectMetrics['verdict'] =
      totalSessions < 3 ? 'cold' :
      reuseRatioPct >= 50 && cacheHits >= 10 ? 'strong' :
      cacheHits >= 5 ? 'compounding' :
      'warming';
    return {
      projectId,
      projectName: kb.projectName ?? projectId,
      totalSessions,
      totalLearnings: total,
      accessedLearnings: accessed,
      accessedPct: total > 0 ? Math.round((accessed / total) * 100) : 0,
      cacheHits,
      graphQueries,
      fpSuppressions,
      highScoreHits: m.highScoreHits ?? 0,
      totalRetrievalQueries: m.totalRetrievalQueries ?? 0,
      totalClassifications: m.totalClassifications ?? 0,
      planModeTriggers: m.planModeTriggers ?? 0,
      classificationsByTier: { inquiry, trivial, standard, complex },
      domainDistribution: m.domainDistribution ?? {},
      tokensSpentEstimate,
      tokensSavedEstimate,
      netTokenDelta: tokensSavedEstimate - tokensSpentEstimate,
      verdict,
    };
  } catch {
    return null;
  }
}

function runGlobalDoctor(): GlobalDoctorReport {
  const checks: GlobalDoctorCheck[] = [];
  const home = knitRoot();

  // 1. ~/.knit exists?
  if (!existsSync(home)) {
    checks.push({
      name: '~/.knit directory',
      status: 'warn',
      detail: `${home} does not exist yet — will be created on first MCP call from any project.`,
    });
  } else {
    checks.push({ name: '~/.knit directory', status: 'ok', detail: home });
    // 2. Is it writable?
    try {
      accessSync(home, fsConstants.W_OK);
      checks.push({ name: '~/.knit writable', status: 'ok', detail: 'Write access confirmed.' });
    } catch {
      checks.push({
        name: '~/.knit writable',
        status: 'error',
        detail: `EACCES on ${home} — fix with: chmod -R u+w "${home}"`,
      });
    }
  }

  // 3. Projects directory contents
  const projectsDir = join(home, 'projects');
  if (existsSync(projectsDir)) {
    try {
      const entries = readdirSync(projectsDir).filter((id) => {
        try { return statSync(join(projectsDir, id)).isDirectory(); } catch { return false; }
      });
      checks.push({
        name: 'Projects',
        status: entries.length > 0 ? 'ok' : 'info',
        detail: `${entries.length} project${entries.length === 1 ? '' : 's'} registered.`,
      });
    } catch (err) {
      checks.push({
        name: 'Projects',
        status: 'error',
        detail: `Could not read ${projectsDir}: ${(err as Error).message}`,
      });
    }
  } else {
    checks.push({
      name: 'Projects',
      status: 'info',
      detail: 'No projects registered yet. Open a repo in Claude Code/Cursor/etc with Knit MCP connected.',
    });
  }

  // 4. Global learnings pool
  const globalLearningsFile = join(home, 'global', 'learnings.jsonl');
  if (existsSync(globalLearningsFile)) {
    try {
      const count = readFileSync(globalLearningsFile, 'utf-8').split('\n').filter(Boolean).length;
      checks.push({
        name: 'Cross-project pool',
        status: 'ok',
        detail: `${count} learning${count === 1 ? '' : 's'} in ~/.knit/global/learnings.jsonl.`,
      });
    } catch (err) {
      checks.push({
        name: 'Cross-project pool',
        status: 'warn',
        detail: `~/.knit/global/learnings.jsonl exists but unreadable: ${(err as Error).message}`,
      });
    }
  } else {
    checks.push({
      name: 'Cross-project pool',
      status: 'info',
      detail: 'No cross-project learnings yet. Use knit_record_global_learning for patterns that generalize.',
    });
  }

  // 5. MCP server registration in ~/.claude.json
  const claudeConfig = join(homedir(), '.claude.json');
  if (existsSync(claudeConfig)) {
    try {
      const config = JSON.parse(readFileSync(claudeConfig, 'utf-8')) as { mcpServers?: Record<string, unknown> };
      const servers = config.mcpServers ?? {};
      const hasKnit = Object.keys(servers).some((k) => k.toLowerCase().includes('knit') || k.toLowerCase().includes('engram'));
      if (hasKnit) {
        checks.push({
          name: 'MCP registration (Claude Code)',
          status: 'ok',
          detail: 'Knit is registered in ~/.claude.json.',
        });
      } else {
        checks.push({
          name: 'MCP registration (Claude Code)',
          status: 'warn',
          detail: 'Knit not found in ~/.claude.json mcpServers. Run `knit setup` to register.',
        });
      }
    } catch (err) {
      checks.push({
        name: 'MCP registration (Claude Code)',
        status: 'warn',
        detail: `~/.claude.json unreadable: ${(err as Error).message}`,
      });
    }
  } else {
    checks.push({
      name: 'MCP registration (Claude Code)',
      status: 'info',
      detail: 'No ~/.claude.json found. If you use Claude Code, run `knit setup` to register.',
    });
  }

  // 6. Update availability — we don't fetch from npm here (no outbound calls per
  // local-first invariant); the MCP server's own update-check writes a marker.
  // Just surface the currently-running version.
  checks.push({
    name: 'Running version',
    status: 'info',
    detail: `Knit v${VERSION} (Node ${process.version}).`,
  });

  const summary = checks.reduce(
    (acc, c) => ({ ...acc, [c.status]: acc[c.status] + 1 }),
    { ok: 0, warn: 0, error: 0, info: 0 },
  );

  // v0.15 (audit F2) — per-agent rows for the webapp.
  const agents: DoctorAgentRow[] = detectAllAgents(process.cwd()).map((a) => ({
    agent: a.agent,
    displayName: a.displayName,
    present: a.present,
    registered: a.registered,
    configPath: a.configPath.replace(homedir(), '~'),
    notes: a.notes,
  }));

  return {
    knitVersion: VERSION,
    nodeVersion: process.version,
    knitHome: home.replace(homedir(), '~'),
    checks,
    summary,
    agents,
  };
}

// ─── Brain graph ────────────────────────────────────────────────────────
// Nodes = learnings (one per KB entry). Edges = pairs with non-trivial
// Jaccard similarity over their tag+domain sets. The threshold (default
// 0.25) keeps the graph from devolving into a complete-graph hairball
// while still surfacing genuine clusters (e.g. five #v0.10 entries get
// strong mutual edges).

interface GraphNode {
  id: string;
  label: string;
  domain: string;          // primary (first) domain for color binding
  tagCount: number;
  accessCount: number;
  date: string;
  size: number;            // visual scale, derived from accessCount
}

interface GraphEdge {
  source: string;
  target: string;
  weight: number;          // 0–1 Jaccard
}

interface BrainGraph {
  projectId: string;
  projectName: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  nodeCount: number;
  edgeCount: number;
  isolatedCount: number;   // nodes with no edges (no shared tags with anyone)
  threshold: number;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersect = 0;
  for (const x of a) if (b.has(x)) intersect++;
  const union = a.size + b.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

function buildBrainGraph(projectId: string, threshold = 0.25): BrainGraph | null {
  const data = readProjectLearnings(projectId);
  if (!data) return null;
  const nodes: GraphNode[] = [];
  const tagSets: Array<{ id: string; set: Set<string> }> = [];
  for (const e of data.entries) {
    const sig = new Set<string>([
      ...e.tags.map((t) => t.toLowerCase()),
      ...e.domains.map((d) => `#${d.toLowerCase()}`),
    ]);
    tagSets.push({ id: e.id, set: sig });
    nodes.push({
      id: e.id,
      label: e.summary,
      domain: e.domains[0] ?? 'general',
      tagCount: sig.size,
      accessCount: e.accessCount,
      date: e.date,
      // Log-scale size so a single 50-access node doesn't dominate a corpus of 1-access nodes.
      size: 6 + Math.min(18, Math.log2((e.accessCount || 0) + 1) * 4),
    });
  }

  const edges: GraphEdge[] = [];
  for (let i = 0; i < tagSets.length; i++) {
    for (let j = i + 1; j < tagSets.length; j++) {
      const w = jaccard(tagSets[i].set, tagSets[j].set);
      if (w >= threshold) {
        edges.push({ source: tagSets[i].id, target: tagSets[j].id, weight: Number(w.toFixed(3)) });
      }
    }
  }

  const connected = new Set<string>();
  for (const e of edges) { connected.add(e.source); connected.add(e.target); }
  const isolatedCount = nodes.filter((n) => !connected.has(n.id)).length;

  return {
    projectId,
    projectName: data.name,
    nodes,
    edges,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    isolatedCount,
    threshold,
  };
}

function readGlobalLearnings(): GlobalLearning[] {
  const path = join(knitRoot(), 'global', 'learnings.jsonl');
  if (!existsSync(path)) return [];
  try {
    const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean);
    const entries: GlobalLearning[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as {
          id?: string; date?: string; summary?: string; lesson?: string;
          tags?: string[]; outcome?: string;
          sourceProjectName?: string; sourceProjectId?: string;
        };
        entries.push({
          id: parsed.id ?? '',
          date: parsed.date ?? '',
          summary: parsed.summary ?? '',
          lesson: parsed.lesson ?? '',
          tags: Array.isArray(parsed.tags) ? parsed.tags : [],
          outcome: (parsed.outcome === 'success' || parsed.outcome === 'partial' || parsed.outcome === 'failure') ? parsed.outcome : null,
          sourceProjectName: parsed.sourceProjectName ?? '(unknown)',
          sourceProjectId: parsed.sourceProjectId ?? '',
        });
      } catch {
        // skip bad line; don't kill the read
      }
    }
    return entries.sort((a, b) => b.date.localeCompare(a.date));
  } catch {
    return [];
  }
}

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  // v0.14 audit fix: apply the same security headers as HTML responses.
  // Origin/Host validation is the primary defense, but adding nosniff +
  // DENY + no-referrer is cheap and closes the defense-in-depth gap if
  // a future regression weakens those primary checks.
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(JSON.stringify(body));
}

function notFound(res: ServerResponse): void {
  jsonResponse(res, 404, { error: 'Not found' });
}

function serveStatic(req: IncomingMessage, res: ServerResponse, webappDist: string): void {
  const urlPath = (req.url || '/').split('?')[0];
  const safePath = urlPath === '/' ? '/index.html' : urlPath;
  // Resolve against webappDist; prevent traversal by re-joining + checking prefix.
  const fullPath = resolve(webappDist, '.' + safePath);
  if (!fullPath.startsWith(resolve(webappDist))) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  // Vite emits hashed asset filenames (index-BSCR26jO.js etc) — those CAN
  // cache aggressively. But index.html references those by name and must
  // ALWAYS be the latest, otherwise the browser keeps loading a stale
  // bundle reference after the user upgrades knit-mcp. no-store on .html
  // is the right call; long cache on hashed assets is safe.
  const ext = fullPath.split('.').pop()?.toLowerCase() ?? '';
  const isHtml = ext === 'html';
  const cacheHeader = isHtml
    ? 'no-store, no-cache, must-revalidate, max-age=0'
    : 'public, max-age=31536000, immutable';

  if (!existsSync(fullPath)) {
    // SPA fallback for client-side routes.
    const indexPath = join(webappDist, 'index.html');
    if (existsSync(indexPath)) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        // Strict CSP — Vite produces a tiny inline boot snippet in index.html
        // but everything else loads from /assets/ (same-origin). Blocking
        // 'unsafe-inline' for scripts would break Vite's hydration boot;
        // 'unsafe-inline' for styles is needed because React inline-style
        // props compile to runtime style strings. No 'unsafe-eval', no
        // external sources — XSS in a learning's text can't escape.
        'Content-Security-Policy': cspHeader(),
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'X-Frame-Options': 'DENY',
      });
      res.end(readFileSync(indexPath));
      return;
    }
    res.writeHead(404); res.end('Not found'); return;
  }
  const mime: Record<string, string> = {
    html: 'text/html; charset=utf-8',
    js: 'text/javascript; charset=utf-8',
    css: 'text/css; charset=utf-8',
    json: 'application/json; charset=utf-8',
    svg: 'image/svg+xml',
    png: 'image/png',
    ico: 'image/x-icon',
  };
  const headers: Record<string, string> = {
    'Content-Type': mime[ext] || 'application/octet-stream',
    'Cache-Control': cacheHeader,
    'X-Content-Type-Options': 'nosniff',
  };
  // CSP applies on the document load; static assets just inherit the
  // policy. Frame-options + referrer-policy belong on every response so
  // they survive a browser-fetched asset.
  if (isHtml) {
    headers['Content-Security-Policy'] = cspHeader();
    headers['X-Frame-Options'] = 'DENY';
    headers['Referrer-Policy'] = 'no-referrer';
  }
  res.writeHead(200, headers);
  res.end(readFileSync(fullPath));
}

function cspHeader(): string {
  // Same-origin only; no external scripts, no inline event handlers, no
  // eval. style-src 'unsafe-inline' is required because the React app
  // uses inline style props throughout (compiled to inline-style strings
  // at runtime). connect-src includes the SSE endpoint pattern.
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
  ].join('; ');
}

function openBrowser(url: string): void {
  // v0.15.0 audit P2-001: execFile with array args — no shell, no quoting
  // surface even if the URL ever gains a user-supplied component.
  const onErr = (err: Error | null): void => {
    if (err) {
      process.stderr.write(`[knit ui] Could not auto-open browser. Open manually: ${url}\n`);
    }
  };
  if (process.platform === 'darwin') {
    execFile('open', [url], onErr);
  } else if (process.platform === 'win32') {
    // Windows `start` is a cmd builtin, not a standalone binary. Use cmd.exe
    // with /c start "" <url> — empty title arg keeps it from being parsed as URL.
    execFile('cmd.exe', ['/c', 'start', '', url], onErr);
  } else {
    execFile('xdg-open', [url], onErr);
  }
}

// ─── Real-time sync via Server-Sent Events ──────────────────────────────
// The dashboard server watches ~/.knit/ for any file change (learnings
// recorded, sessions saved, classifications written) and pushes a
// minimal event over SSE so the React app can refresh affected views
// without polling. This is the "real-time sync with the brain" surface
// — local file watch only, no network.
//
// Event types: 'change' (file written/modified), 'unlink' (file deleted),
// 'hello' (sent immediately on connection so the client knows it's
// connected and the server is alive).

interface SseClient {
  res: ServerResponse;
  id: number;
}

let sseClients: SseClient[] = [];
let sseNextId = 1;
let watcher: FSWatcher | null = null;

function sseSend(client: SseClient, event: string, data: unknown): void {
  try {
    client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    // Client gone — will be cleaned up on next pump.
  }
}

function sseBroadcast(event: string, data: unknown): void {
  for (const client of sseClients) sseSend(client, event, data);
}

function startBrainWatcher(): void {
  if (watcher) return;
  const root = knitRoot();
  if (!existsSync(root)) return;
  try {
    // Recursive watch — works on macOS + Windows; Linux falls back to
    // per-directory watchers via Node's polyfill. Coalesce bursts by
    // debouncing inside a 250ms window (many file events fire when one
    // knowledgebase.json save triggers tmp + rename + accessCount bumps).
    let lastFlush = 0;
    let pending: { kind: string; path: string } | null = null;
    let flushTimer: NodeJS.Timeout | null = null;
    const flush = (): void => {
      if (!pending) return;
      const now = Date.now();
      lastFlush = now;
      sseBroadcast('change', { ...pending, timestamp: new Date().toISOString() });
      pending = null;
    };
    watcher = watch(root, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      // Filter the noisy stuff we don't care about.
      if (filename.endsWith('.tmp') || filename.includes('.tmp.')) return;
      if (filename.startsWith('.')) return; // .classified-current etc.
      pending = { kind: eventType, path: filename };
      const sinceFlush = Date.now() - lastFlush;
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = setTimeout(flush, Math.max(250 - sinceFlush, 50));
    });
    watcher.on('error', (err) => {
      process.stderr.write(`[knit ui] file watcher error: ${err.message}\n`);
      // v0.14 audit fix: reset the global so the next handleSseConnect can
      // restart the watcher. Without this, an error left `watcher` truthy
      // and the `if (watcher) return;` guard at the top of this function
      // silently blocked recovery — the dashboard would lose real-time
      // sync until the user restarted `knit ui`.
      watcher = null;
    });
  } catch (err) {
    process.stderr.write(`[knit ui] could not start file watcher: ${(err as Error).message}\n`);
  }
}

function handleSseConnect(res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    // SSE over HTTP/1.1 — keep the socket open indefinitely.
    'X-Accel-Buffering': 'no',
    // v0.14 audit fix: defense-in-depth security headers on SSE too.
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
  });
  const client: SseClient = { res, id: sseNextId++ };
  sseClients.push(client);
  sseSend(client, 'hello', { connectedAt: new Date().toISOString(), clientId: client.id });

  // Heartbeat every 25s so proxies (and the browser) don't drop the connection.
  const heartbeat = setInterval(() => sseSend(client, 'ping', { t: Date.now() }), 25000);

  const cleanup = (): void => {
    clearInterval(heartbeat);
    sseClients = sseClients.filter((c) => c.id !== client.id);
  };
  res.on('close', cleanup);
  res.on('error', cleanup);

  // Start the watcher on first connection; keep it running for the life
  // of the process. Multiple clients share one watcher.
  startBrainWatcher();
}

export async function uiCommand(): Promise<void> {
  // Locate the built webapp bundle. In dev: <repo>/webapp/dist.
  // In an npm-installed package: <package>/dist/webapp.
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '../../webapp/dist'),    // dev: src/commands/ui.ts -> ../../webapp/dist
    resolve(here, '../webapp/dist'),       // installed: dist/cli.js -> ../webapp/dist (package ships webapp/dist/)
    resolve(here, '../../webapp/dist'),    // dev tsx variant
  ];
  const webappDist = candidates.find((p) => existsSync(join(p, 'index.html')));
  if (!webappDist) {
    process.stderr.write(
      '[knit ui] Webapp bundle not found. Looked in:\n' +
      candidates.map((c) => '  ' + c).join('\n') + '\n' +
      'If you cloned from source, run: cd webapp && npm install && npm run build\n',
    );
    process.exit(1);
  }

  const port = parseInt(process.env.KNIT_UI_PORT || '', 10) || DEFAULT_PORT;

  const server = createServer((req, res) => {
    const url = req.url || '/';

    // Defense-in-depth: reject any request whose Host or Origin doesn't
    // resolve to localhost. Blocks DNS rebinding attacks where a malicious
    // site you visit tries to read the dashboard via your browser. Loopback
    // bind alone isn't enough — same defense pattern as the React dev
    // server, Docker daemon, PostgreSQL etc.
    if (!allowedHost(req.headers.host)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden: invalid host header');
      return;
    }
    if (!allowedOrigin(req.headers.origin as string | undefined, port)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden: cross-origin request blocked');
      return;
    }

    // API surface — local-first, read-only in v1.0-alpha.
    if (url.startsWith('/api/')) {
      try {
        if (url === '/api/events') { handleSseConnect(res); return; }
        if (url === '/api/version') {
          // Best-effort npm registry check. Kicks off async in the
          // background on first call and caches; subsequent calls read
          // the cache without blocking. No outbound call on the hot
          // path of the dashboard request itself.
          prewarmLatestVersion();
          const latest = getCachedLatestVersion();
          const updateAvailable = latest ? isNewerVersion(latest, VERSION) : false;
          return jsonResponse(res, 200, {
            knitVersion: VERSION,
            latestVersion: latest,
            updateAvailable,
            updateCommand: updateAvailable
              ? 'npm install -g knit-mcp@latest && rm -rf ~/.npm/_npx/'
              : null,
            dashboardApi: 'v1',
            endpoints: [
              '/api/version', '/api/brain/summary', '/api/brain/aggregate',
              '/api/projects', '/api/projects/:id/learnings',
              '/api/projects/:id/metrics', '/api/projects/:id/graph',
              '/api/global/learnings',
              '/api/doctor', '/api/commands', '/api/events (SSE)',
            ],
            security: {
              host: 'loopback-only',
              origin: 'localhost-only',
              csp: 'strict-same-origin',
              auth: 'none-by-design',
            },
          });
        }
        if (url === '/api/brain/summary') return jsonResponse(res, 200, brainSummary());
        if (url === '/api/brain/aggregate') return jsonResponse(res, 200, computeBrainAggregate());
        if (url === '/api/projects') return jsonResponse(res, 200, { projects: listProjects() });
        if (url === '/api/global/learnings') return jsonResponse(res, 200, { learnings: readGlobalLearnings() });
        if (url === '/api/doctor') return jsonResponse(res, 200, runGlobalDoctor());
        if (url === '/api/commands') return jsonResponse(res, 200, scanAllAgentCommands(process.cwd()));

        // /api/projects/:id/learnings and /api/projects/:id/metrics
        // Path is split on '/' and validated against the project hash format.
        const projectMatch = url.match(/^\/api\/projects\/([a-f0-9]+)\/(learnings|metrics|graph)(?:\?.*)?\/?$/);
        if (projectMatch) {
          const [, id, kind] = projectMatch;
          if (kind === 'learnings') {
            const data = readProjectLearnings(id);
            if (!data) return jsonResponse(res, 404, { error: 'Project not found' });
            return jsonResponse(res, 200, { project: { id, name: data.name }, learnings: data.entries });
          }
          if (kind === 'metrics') {
            const metrics = computeProjectMetrics(id);
            if (!metrics) return jsonResponse(res, 404, { error: 'Project not found' });
            return jsonResponse(res, 200, metrics);
          }
          if (kind === 'graph') {
            // Optional ?threshold= override (0.0 - 1.0).
            const thrMatch = url.match(/[?&]threshold=([0-9.]+)/);
            const threshold = thrMatch ? Math.max(0, Math.min(1, parseFloat(thrMatch[1]))) : 0.25;
            const graph = buildBrainGraph(id, threshold);
            if (!graph) return jsonResponse(res, 404, { error: 'Project not found' });
            return jsonResponse(res, 200, graph);
          }
        }
        return notFound(res);
      } catch (err) {
        return jsonResponse(res, 500, {
          error: 'Server error reading brain',
          detail: (err as Error).message,
        });
      }
    }
    // Static files (the React bundle) — SPA fallback to index.html.
    serveStatic(req, res, webappDist);
  });

  server.listen(port, HOST, () => {
    const url = `http://${HOST}:${port}/`;
    process.stdout.write(
      `\nKnit Dashboard — http://${HOST}:${port}\n` +
      `Reading from: ${knitRoot()}\n` +
      `Press Ctrl-C to stop.\n\n`,
    );
    openBrowser(url);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      process.stderr.write(
        `[knit ui] Port ${port} already in use. Set KNIT_UI_PORT=<port> to override.\n`,
      );
      process.exit(1);
    }
    process.stderr.write(`[knit ui] Server error: ${err.message}\n`);
    process.exit(1);
  });
}
