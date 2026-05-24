/**
 * v0.11 slice 5 — Requirements ingestion + retrieval.
 *
 * The enterprise-requirements problem: a 200KB Jira spec + supporting docs
 * + Swagger description exceeds the host agent's per-call context budget
 * (Claude's ~40KB file limit, similar elsewhere). Naive solutions paste
 * the whole doc or aggressively trim — both lose signal.
 *
 * Knit's answer: chunk the doc, BM25-index it once at ingest, then
 * per-query retrieve only the 5-7KB worth of chunks relevant to that
 * specific feature/test-case target. Same primitives as the
 * cross-session retrieval; new application surface.
 *
 * Generic by design — works on any long-form requirements/spec/RFC. The
 * FIS test-case-generation use case is one validating pilot, not the
 * audience.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname } from 'node:path';

import { BM25Index, type BM25Document } from './retrieval/bm25.js';
import { rrfFuse, toRankedResults } from './retrieval/rrf.js';
import { requirementSourcePath, requirementsDir } from './paths.js';

/** One indexed source doc — header + array of chunks. Persisted as JSON. */
export interface RequirementsSource {
  sourceId: string;
  /** Original file path on disk at ingest time (for traceability). */
  sourcePath: string;
  /** Bytes of the original source. */
  sourceBytes: number;
  /** When this source was ingested. */
  indexedAt: string;
  /** Free-text label (e.g. "PAY-1234 Payment Flow Spec"). */
  label?: string;
  chunks: RequirementChunk[];
}

export interface RequirementChunk {
  id: string;
  /** Text content of the chunk. */
  text: string;
  /** Approximate position in source (line offset). */
  startLine: number;
  endLine: number;
}

/** Slugify a path basename into a safe source id. */
export function slugifySourceId(filePath: string): string {
  const base = basename(filePath, extname(filePath));
  return base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80) || 'requirements';
}

/** Chunk a requirements doc on paragraph boundaries (blank line). Drops
 *  chunks shorter than `minChars` (default 50) since they're usually noise
 *  (section markers, page numbers). Tracks line ranges for traceability. */
export function chunkRequirements(content: string, minChars = 50): RequirementChunk[] {
  const lines = content.split('\n');
  const chunks: RequirementChunk[] = [];
  let bufLines: string[] = [];
  let bufStart = 0; // 0 means "not yet started" — set lazily on first non-empty
  let lineNum = 0;
  let id = 0;

  const flush = (endLine: number): void => {
    if (bufLines.length === 0) return;
    const text = bufLines.join('\n').trim();
    if (text.length >= minChars) {
      id += 1;
      chunks.push({ id: `c${id}`, text, startLine: bufStart, endLine });
    }
    bufLines = [];
    bufStart = 0;
  };

  for (const line of lines) {
    lineNum += 1;
    if (line.trim() === '') {
      flush(lineNum - 1);
    } else {
      if (bufLines.length === 0) bufStart = lineNum;
      bufLines.push(line);
    }
  }
  flush(lineNum);
  return chunks;
}

/** Persist an indexed source atomically. */
export function saveSource(rootPath: string, source: RequirementsSource): void {
  const path = requirementSourcePath(rootPath, source.sourceId);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(source), 'utf-8');
  renameSync(tmp, path);
}

export function loadSource(rootPath: string, sourceId: string): RequirementsSource | null {
  const path = requirementSourcePath(rootPath, sourceId);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as RequirementsSource;
  } catch {
    return null;
  }
}

/** List all indexed sources for a project. Returns header info only
 *  (no chunks — for cheap listing). */
export function listSources(rootPath: string): Array<Omit<RequirementsSource, 'chunks'> & { chunkCount: number }> {
  const dir = requirementsDir(rootPath);
  if (!existsSync(dir)) return [];
  const out: Array<Omit<RequirementsSource, 'chunks'> & { chunkCount: number }> = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const s = JSON.parse(readFileSync(`${dir}/${f}`, 'utf-8')) as RequirementsSource;
      out.push({
        sourceId: s.sourceId,
        sourcePath: s.sourcePath,
        sourceBytes: s.sourceBytes,
        indexedAt: s.indexedAt,
        label: s.label,
        chunkCount: Array.isArray(s.chunks) ? s.chunks.length : 0,
      });
    } catch {
      // skip malformed
    }
  }
  return out;
}

/** Build a BM25 index over a single source's chunks. */
export function buildSourceIndex(source: RequirementsSource): BM25Index {
  const docs: BM25Document[] = source.chunks.map((c) => ({
    id: c.id,
    text: c.text,
    metadata: { chunk: c, sourceId: source.sourceId },
  }));
  return new BM25Index(docs);
}

/** Retrieve the top-N chunks across one or more sources for a free-text
 *  query. Uses BM25 per source, then fuses results via RRF so chunks from
 *  the most-relevant source rise to the top without one source flooding. */
export function retrieveTopChunks(
  sources: RequirementsSource[],
  query: string,
  topN: number,
): Array<{ chunk: RequirementChunk; sourceId: string; sourceLabel?: string }> {
  if (sources.length === 0 || !query.trim()) return [];
  const rankings = sources.map((s) => toRankedResults(buildSourceIndex(s).search(query, Math.min(topN * 3, 30))));
  const fused = rrfFuse(rankings, { k: 60 });
  // Map fused ids back to chunks (id is unique per-source, so we look up
  // by walking sources in order).
  const chunkById = new Map<string, { chunk: RequirementChunk; sourceId: string; sourceLabel?: string }>();
  for (const s of sources) {
    for (const c of s.chunks) {
      // Source-id-qualified key so chunks with the same id across sources
      // don't collide.
      chunkById.set(`${s.sourceId}::${c.id}`, { chunk: c, sourceId: s.sourceId, sourceLabel: s.label });
    }
  }
  const seen = new Set<string>();
  const out: Array<{ chunk: RequirementChunk; sourceId: string; sourceLabel?: string }> = [];
  for (const f of fused) {
    // RRF preserves the BM25Document.id which is just the chunk id; we
    // need to find which source it came from. Look up across sources.
    for (const s of sources) {
      const key = `${s.sourceId}::${f.id}`;
      if (chunkById.has(key) && !seen.has(key)) {
        out.push(chunkById.get(key)!);
        seen.add(key);
        break;
      }
    }
    if (out.length >= topN) break;
  }
  return out;
}
