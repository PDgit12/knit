/**
 * Integration scanner — detects existing user workflow frameworks installed
 * alongside Knit so per-project instruction tailoring (v0.8) can defer to
 * them rather than duplicate them.
 *
 * Knit's positioning is "connective tissue, not another framework." When a
 * user already has Ruflo for swarms, or gstack for slash commands, or
 * CodeTour for guided walkthroughs, Knit should integrate — not compete.
 * v0.7.2 ships the detection layer; v0.8 will read this and tailor the
 * server-level `instructions` field per-project.
 *
 * Scope: detection only. Never modifies anything outside
 * ~/.knit/projects/<hash>/integrations.json. Best-effort throughout — a
 * missing tool, malformed config, or permission denied silently means "not
 * detected" rather than throwing.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { homedir as osHomedir } from 'node:os';
import { join } from 'node:path';
import { integrationsConfigPath, projectDataDir } from './paths.js';
import { KNIT_MARKER_START, KNIT_MARKER_END, LEGACY_ENGRAM_MARKER_START, LEGACY_ENGRAM_MARKER_END } from '../generators/claude-md.js';

// Indirected through a function so tests can plausibly mock home dir in the future.
const homedir = (): string => osHomedir();

export interface IntegrationDetection {
  /** Whether the framework was detected anywhere. */
  present: boolean;
  /** Specific signals that fired. Empty when present=false. */
  via: string[];
}

export interface ScanResult {
  scannedAt: string;
  /** Knit version that ran this scan (for forward-compat). */
  knitVersion?: string;
  detected: {
    ruflo: IntegrationDetection;
    gstack: IntegrationDetection;
    codetour: IntegrationDetection & { files?: string[] };
    conductor: IntegrationDetection;
    other_mcp_servers: string[];
    custom_workflow_sections: string[];
  };
  /** Human-readable one-liner agents/users can surface verbatim. */
  summary: string;
}

/** Run all detections against the given project root and the user's home dir.
 *  Returns the structured result. Does NOT persist — caller decides when to
 *  write via persistScanResult. */
export function scanIntegrations(rootPath: string, opts?: { knitVersion?: string }): ScanResult {
  const home = homedir();
  void projectDataDir; // re-exported below for tests; touch here to keep TS happy

  const ruflo = detectRuflo(rootPath, home);
  const gstack = detectGstack(rootPath, home);
  const codetour = detectCodeTour(rootPath);
  const conductor = detectConductor(home);
  const otherMcp = detectOtherMcpServers(home);
  const customWorkflowSections = detectCustomWorkflowSections(rootPath);

  const summary = buildSummary({ ruflo, gstack, codetour, conductor, otherMcp, customWorkflowSections });

  return {
    scannedAt: new Date().toISOString(),
    knitVersion: opts?.knitVersion,
    detected: {
      ruflo,
      gstack,
      codetour,
      conductor,
      other_mcp_servers: otherMcp,
      custom_workflow_sections: customWorkflowSections,
    },
    summary,
  };
}

/** Persist a scan result atomically (temp + rename) to integrations.json.
 *  Best-effort: caller should still treat missing file as "not yet scanned." */
export function persistScanResult(rootPath: string, result: ScanResult): void {
  const path = integrationsConfigPath(rootPath);
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(tmpPath, JSON.stringify(result, null, 2), 'utf-8');
    renameSync(tmpPath, path);
  } catch (err) {
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}

/** Read the most recent scan result. Returns null if no scan has run yet
 *  OR if the file is unreadable / malformed. Never throws. */
export function loadScanResult(rootPath: string): ScanResult | null {
  const path = integrationsConfigPath(rootPath);
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8')) as ScanResult;
    if (typeof data?.scannedAt !== 'string' || !data?.detected) return null;
    return data;
  } catch {
    return null;
  }
}

// ── Individual detectors ──────────────────────────────────────────────

function safeExists(p: string): boolean {
  try { return existsSync(p); } catch { return false; }
}

function safeIsDir(p: string): boolean {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

function readClaudeConfigSafely(home: string): Record<string, unknown> | null {
  const claudeJson = join(home, '.claude.json');
  if (!safeExists(claudeJson)) return null;
  try {
    return JSON.parse(readFileSync(claudeJson, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function detectRuflo(rootPath: string, home: string): IntegrationDetection {
  const via: string[] = [];

  // 1. Home directory: ~/.ruflo/ or ~/.claude-flow/
  if (safeExists(join(home, '.ruflo')) && safeIsDir(join(home, '.ruflo'))) via.push('home-dir');
  if (safeExists(join(home, '.claude-flow')) && safeIsDir(join(home, '.claude-flow'))) via.push('claude-flow-dir');

  // 2. Project-local artifacts: ruflo writes a .claude-flow/ dir at project root
  if (safeExists(join(rootPath, '.claude-flow')) && safeIsDir(join(rootPath, '.claude-flow'))) via.push('project-claude-flow-dir');

  // 3. Registered as an MCP server in ~/.claude.json
  const claudeConfig = readClaudeConfigSafely(home);
  const mcpServers = (claudeConfig?.mcpServers as Record<string, unknown> | undefined) ?? {};
  if ('ruflo' in mcpServers || 'claude-flow' in mcpServers) via.push('mcp-server');

  // 4. As a dev dep in the project (some users install via npm)
  try {
    const pkgPath = join(rootPath, 'package.json');
    if (safeExists(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, Record<string, string> | undefined>;
      const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      if (deps.ruflo || deps['claude-flow']) via.push('npm-dep');
    }
  } catch { /* best-effort */ }

  return { present: via.length > 0, via };
}

function detectGstack(rootPath: string, home: string): IntegrationDetection {
  const via: string[] = [];

  // 1. ~/.gstack/ home directory (typical install)
  if (safeExists(join(home, '.gstack')) && safeIsDir(join(home, '.gstack'))) via.push('home-dir');

  // 2. gstack skills installed under ~/.claude/skills/
  const skillsDir = join(home, '.claude', 'skills');
  if (safeExists(skillsDir) && safeIsDir(skillsDir)) {
    try {
      const skills = readdirSync(skillsDir);
      // gstack skills are prefixed with 'gstack-' or live in a 'gstack' subdir
      if (skills.some((s) => s === 'gstack' || s.startsWith('gstack-'))) {
        via.push('skills-dir');
      }
    } catch { /* best-effort */ }
  }

  // 3. Project-local .gstack/ (rare but supported)
  if (safeExists(join(rootPath, '.gstack')) && safeIsDir(join(rootPath, '.gstack'))) via.push('project-dir');

  return { present: via.length > 0, via };
}

function detectCodeTour(rootPath: string): IntegrationDetection & { files?: string[] } {
  const via: string[] = [];
  const files: string[] = [];

  // CodeTour stores .tour files in .tours/ at project root by convention.
  const toursDir = join(rootPath, '.tours');
  if (safeExists(toursDir) && safeIsDir(toursDir)) {
    via.push('dot-tours-dir');
    try {
      for (const f of readdirSync(toursDir)) {
        if (f.endsWith('.tour')) files.push(`.tours/${f}`);
      }
    } catch { /* best-effort */ }
  }

  return { present: via.length > 0, via, ...(files.length > 0 ? { files } : {}) };
}

function detectConductor(home: string): IntegrationDetection {
  const via: string[] = [];
  if (safeExists(join(home, '.conductor')) && safeIsDir(join(home, '.conductor'))) via.push('home-dir');
  return { present: via.length > 0, via };
}

/** List MCP servers in ~/.claude.json that aren't Knit. Used to surface
 *  "other tools are also installed" — Knit can integrate around them. */
function detectOtherMcpServers(home: string): string[] {
  const config = readClaudeConfigSafely(home);
  const mcpServers = (config?.mcpServers as Record<string, unknown> | undefined) ?? {};
  const names = Object.keys(mcpServers).filter((n) => n !== 'knit-brain' && n !== 'engram-brain');
  return names.sort();
}

/** Heuristic: look for common workflow-section headings in CLAUDE.md that
 *  live OUTSIDE the Knit-managed block. These signal a user has their own
 *  workflow doc that Knit should defer to. */
function detectCustomWorkflowSections(rootPath: string): string[] {
  const claudeMd = join(rootPath, 'CLAUDE.md');
  if (!safeExists(claudeMd)) return [];
  let content: string;
  try {
    content = readFileSync(claudeMd, 'utf-8');
  } catch {
    return [];
  }

  // Strip the Knit-managed block (current + legacy markers) so we only scan
  // user-curated content. This avoids false-positives from Knit's own
  // "Workflow on demand" header etc.
  for (const [startMarker, endMarker] of [
    [KNIT_MARKER_START, KNIT_MARKER_END],
    [LEGACY_ENGRAM_MARKER_START, LEGACY_ENGRAM_MARKER_END],
  ]) {
    const startIdx = content.indexOf(startMarker);
    const endIdx = content.indexOf(endMarker);
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      content = content.slice(0, startIdx) + content.slice(endIdx + endMarker.length);
    }
  }

  // Headings that strongly suggest a custom workflow doc.
  const patterns = [
    /^##\s+(?:Engineering|Development|Dev)\s+Workflow\b/im,
    /^##\s+Workflow\s*$/im,
    /^##\s+Process\b/im,
    /^##\s+Methodology\b/im,
    /^##\s+How\s+we\s+ship\b/im,
  ];

  const found: string[] = [];
  for (const re of patterns) {
    const match = content.match(re);
    if (match) found.push(match[0].replace(/^##\s+/, '').trim());
  }
  return found;
}

function buildSummary(parts: {
  ruflo: IntegrationDetection;
  gstack: IntegrationDetection;
  codetour: IntegrationDetection;
  conductor: IntegrationDetection;
  otherMcp: string[];
  customWorkflowSections: string[];
}): string {
  const labels: string[] = [];
  if (parts.ruflo.present) labels.push(`Ruflo (${parts.ruflo.via.join(', ')})`);
  if (parts.gstack.present) labels.push(`gstack (${parts.gstack.via.join(', ')})`);
  if (parts.codetour.present) labels.push(`CodeTour (${parts.codetour.via.join(', ')})`);
  if (parts.conductor.present) labels.push(`Conductor (${parts.conductor.via.join(', ')})`);
  if (parts.otherMcp.length > 0) labels.push(`other MCP servers: ${parts.otherMcp.join(', ')}`);
  if (parts.customWorkflowSections.length > 0) labels.push(`custom workflow sections in CLAUDE.md (${parts.customWorkflowSections.join('; ')})`);

  if (labels.length === 0) {
    return 'No existing workflow frameworks detected. Knit operates in full-protocol mode.';
  }
  return `Detected: ${labels.join('; ')}. Knit composes with these — its server instructions point agents at each framework's routing primitives where they fit, while Knit stays the brain underneath (memory + classification + protocol).`;
}

/** Silence the unused-import warnings when projectDataDir isn't directly used.
 *  Re-exported so tests can construct the path without re-importing from paths.ts. */
export { projectDataDir };
