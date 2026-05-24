/**
 * v0.12 phase 1 — Domain inference.
 *
 * Three signals fuse into ranked domain candidates:
 *   1. Git co-change clustering — files modified together over the last
 *      N days indicate cohesion; cluster them into proposed domains.
 *   2. Import-graph centrality — top-level src/ subdirs ranked by how
 *      many internal files reference them; high centrality = domain head.
 *   3. Test colocation — `tests/<name>/` mirroring `src/<name>/` confirms
 *      `<name>` is a domain boundary.
 *
 * Fused via Reciprocal Rank Fusion (reuses retrieval/rrf.ts) so a domain
 * with strong centrality + weak co-change still ranks high if it shows up
 * in either signal.
 *
 * Output: ranked candidate domains with confidence scores. Used by v0.12
 * phase 2 (template composition) to fill in the Domain Architecture
 * block in CLAUDE.md.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

import { rrfFuse, toRankedResults } from './retrieval/rrf.js';

export interface DomainCandidate {
  /** Inferred domain name (top-level src subdir basename, or cluster name). */
  name: string;
  /** Confidence 0–1 (RRF score, normalized). */
  confidence: number;
  /** File paths anchoring this candidate. */
  files: string[];
  /** Which signals contributed (for transparency). */
  signals: Array<'co-change' | 'centrality' | 'test-colocation'>;
}

export interface InferDomainsResult {
  candidates: DomainCandidate[];
  /** Total signal contribution: 0 = no signals fired (cold project). */
  signalCoverage: { coChange: boolean; centrality: boolean; testColocation: boolean };
  /** Diagnostic note explaining why some candidates ranked higher. */
  note: string;
}

const DEFAULT_LOOKBACK_DAYS = 90;

/** v0.12 phase 1 — main entry. */
export function inferDomains(
  rootPath: string,
  importGraph: Record<string, string[]>,
  testMap: { tested: Record<string, string[]>; testFiles: string[] },
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
): InferDomainsResult {
  const coChangeRanking = computeCoChangeRanking(rootPath, lookbackDays);
  const centralityRanking = computeCentralityRanking(importGraph);
  const colocationRanking = computeTestColocationRanking(rootPath, testMap);

  const signalCoverage = {
    coChange: coChangeRanking.length > 0,
    centrality: centralityRanking.length > 0,
    testColocation: colocationRanking.length > 0,
  };

  // Skip RRF when no signals (cold project) — return empty.
  if (!signalCoverage.coChange && !signalCoverage.centrality && !signalCoverage.testColocation) {
    return {
      candidates: [],
      signalCoverage,
      note: 'No signals available. Empty repo, no git history, or no top-level src/ structure. Once the project has commits + imports, re-run.',
    };
  }

  // Fuse via RRF. Each ranking is a list of {id: domainName, score: 1/(k+rank)}.
  const rankings = [coChangeRanking, centralityRanking, colocationRanking].filter((r) => r.length > 0);
  const fused = rrfFuse(rankings.map((r) => toRankedResults(r.map((id, idx) => ({ id, score: r.length - idx })))), { k: 60 });

  // Look up which signals each candidate appeared in (for transparency).
  const inCoChange = new Set(coChangeRanking);
  const inCentrality = new Set(centralityRanking);
  const inColocation = new Set(colocationRanking);

  const maxScore = fused[0]?.score ?? 1;
  const candidates: DomainCandidate[] = fused.slice(0, 8).map((f) => {
    const signals: Array<'co-change' | 'centrality' | 'test-colocation'> = [];
    if (inCoChange.has(f.id)) signals.push('co-change');
    if (inCentrality.has(f.id)) signals.push('centrality');
    if (inColocation.has(f.id)) signals.push('test-colocation');
    const files = listFilesInDomain(rootPath, f.id).slice(0, 8);
    return {
      name: f.id,
      confidence: maxScore > 0 ? Math.round((f.score / maxScore) * 100) / 100 : 0,
      files,
      signals,
    };
  });

  return {
    candidates,
    signalCoverage,
    note: `Inferred ${candidates.length} domain(s) from ${rankings.length} active signal(s). Top candidate by confidence rules; review + edit before accepting into CLAUDE.md.`,
  };
}

/** Git co-change clustering — files modified together over the last N
 *  days. Returns ranked top-level dirs by total co-change activity. */
function computeCoChangeRanking(rootPath: string, days: number): string[] {
  let output: string;
  try {
    output = execSync(
      `git -C ${shellQuote(rootPath)} log --since="${days} days ago" --name-only --pretty=format:"--commit--"`,
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 },
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      process.stderr.write('[knit] git co-change exec failed: ' + String(err) + '\n');
    }
    return [];
  }
  const commits = output.split('--commit--').filter((c) => c.trim());
  if (commits.length < 3) return []; // need a minimum of history before signal is meaningful
  // Count top-level src dir touches per commit; cluster by frequent co-occurrence.
  const dirTouchCount = new Map<string, number>();
  for (const commit of commits) {
    const files = commit.split('\n').map((l) => l.trim()).filter(Boolean);
    const dirs = new Set<string>();
    for (const f of files) {
      const top = topLevelSrcDir(f);
      if (top) dirs.add(top);
    }
    for (const d of dirs) {
      dirTouchCount.set(d, (dirTouchCount.get(d) ?? 0) + 1);
    }
  }
  // Sort by frequency descending — most-touched dirs are likely domain heads.
  return [...dirTouchCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([d]) => d);
}

/** Import-graph centrality — top-level src/ subdirs by inbound edge count.
 *  Simple variant of PageRank: count how many files import INTO each dir. */
function computeCentralityRanking(importGraph: Record<string, string[]>): string[] {
  const inboundByDir = new Map<string, number>();
  for (const importers of Object.values(importGraph)) {
    for (const target of importers) {
      const top = topLevelSrcDir(target);
      if (!top) continue;
      inboundByDir.set(top, (inboundByDir.get(top) ?? 0) + 1);
    }
  }
  return [...inboundByDir.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([d]) => d);
}

/** Test colocation — domains with a corresponding tests/<dir>/ are
 *  confirmed boundaries. Returns the matched dir names. */
function computeTestColocationRanking(
  rootPath: string,
  testMap: { tested: Record<string, string[]>; testFiles: string[] },
): string[] {
  const srcDirs = listTopLevelSrcDirs(rootPath);
  const matches: string[] = [];
  for (const dir of srcDirs) {
    // Heuristic: there's a tests/<dir> sibling, OR test files under
    // tests/ that reference <dir>/.
    const testsDir = join(rootPath, 'tests', dir);
    if (existsSync(testsDir)) {
      matches.push(dir);
      continue;
    }
    const hasTestsReferencingDir = testMap.testFiles.some((tf) => tf.includes(`/${dir}/`) || tf.startsWith(`${dir}/`));
    if (hasTestsReferencingDir) matches.push(dir);
  }
  return matches;
}

/** Extract the top-level src subdir name from a path. */
function topLevelSrcDir(filePath: string): string | null {
  // Normalize separators.
  const p = filePath.replace(/\\/g, '/');
  // Common patterns: src/<dir>/, packages/<name>/src/<dir>/, app/<dir>/
  let m = /^src\/([^/]+)\//.exec(p);
  if (m) return m[1];
  m = /^app\/([^/]+)\//.exec(p);
  if (m) return m[1];
  m = /^packages\/[^/]+\/src\/([^/]+)\//.exec(p);
  if (m) return m[1];
  return null;
}

/** List top-level src/* subdirs (used by test colocation signal). */
function listTopLevelSrcDirs(rootPath: string): string[] {
  const srcDir = join(rootPath, 'src');
  if (!existsSync(srcDir)) return [];
  try {
    return readdirSync(srcDir).filter((name) => {
      try {
        return statSync(join(srcDir, name)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

/** List files inside a candidate domain (best-effort, capped). */
function listFilesInDomain(rootPath: string, domainName: string): string[] {
  const out: string[] = [];
  // Walk both src/<name>/ and tests/<name>/ if present.
  for (const base of ['src', 'app']) {
    const dir = join(rootPath, base, domainName);
    if (!existsSync(dir)) continue;
    walkShallow(dir, base + '/' + domainName, out, 32);
  }
  return out;
}

function walkShallow(dir: string, prefix: string, out: string[], cap: number): void {
  if (out.length >= cap) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    if (out.length >= cap) return;
    const full = join(dir, e);
    let isDir = false;
    try { isDir = statSync(full).isDirectory(); } catch { continue; }
    if (isDir) walkShallow(full, `${prefix}/${e}`, out, cap);
    else out.push(`${prefix}/${e}`);
  }
}

/** Shell-quote a path for inline command interpolation. */
function shellQuote(s: string): string {
  return `"${s.replace(/"/g, '\\"')}"`;
}
