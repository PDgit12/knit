import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, rmdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import type { LearningEntry } from './types.js';

// POSIX guarantees O_APPEND writes ≤ PIPE_BUF (~4KB on Linux/macOS) are
// atomic against concurrent O_APPEND writers. A learning with a long
// lesson/approach can exceed PIPE_BUF; for those we acquire an exclusive
// mkdir-based lock around the append so two concurrent MCP processes
// can't interleave bytes mid-entry. The 3500-byte threshold leaves
// headroom for the newline + framing.
const APPEND_ATOMIC_THRESHOLD = 3500;
const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 2000;

const HEADER = `# Project Learnings

> Recursive learning log. Check this BEFORE starting any task.
> Grep by \`#tag\` to find relevant lessons for the domain you're working in.

---
`;

/**
 * Creates a new learnings file at the specified path.
 */
export function createLearningsFile(filePath: string, projectName: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const content = HEADER.replace('Project Learnings', `Project Learnings — ${projectName}`);
  writeFileSync(filePath, content, 'utf-8');
}

/**
 * Appends a learning entry to the learnings file.
 *
 * For payloads ≤ PIPE_BUF, POSIX O_APPEND guarantees concurrent appenders
 * cannot truncate or interleave entry bodies — fast path is appendFileSync.
 *
 * For larger payloads (long lesson/approach text), v0.14.1 audit D2 closes
 * the prior PIPE_BUF race: acquire an exclusive mkdir-based lock first,
 * then append. mkdir is atomic on POSIX so only one process wins the lock.
 * Lock waits up to LOCK_TIMEOUT_MS before falling through to a best-effort
 * append (data loss preferred over indefinite hang).
 */
export function appendLearning(filePath: string, entry: LearningEntry): void {
  if (!existsSync(filePath)) {
    createLearningsFile(filePath, 'Unknown Project');
  }

  const payload = '\n' + formatEntry(entry);
  if (Buffer.byteLength(payload, 'utf-8') <= APPEND_ATOMIC_THRESHOLD) {
    appendFileSync(filePath, payload, 'utf-8');
    return;
  }

  const lockPath = `${filePath}.lock`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let locked = false;
  while (Date.now() < deadline) {
    try {
      mkdirSync(lockPath);
      locked = true;
      break;
    } catch {
      // Lock held by another writer; sleep-spin briefly.
      const wakeAt = Date.now() + LOCK_RETRY_MS;
      while (Date.now() < wakeAt) { /* busy-wait — sync context */ }
    }
  }
  try {
    appendFileSync(filePath, payload, 'utf-8');
  } finally {
    if (locked) {
      try { rmdirSync(lockPath); } catch { /* lock dir gone — ignore */ }
    }
  }
}

/**
 * Reads and parses all learning entries from a file.
 */
export function readLearnings(filePath: string): LearningEntry[] {
  if (!existsSync(filePath)) return [];

  const content = readFileSync(filePath, 'utf-8');
  const entries: LearningEntry[] = [];
  const sections = content.split(/^## /m).slice(1); // Split by ## headers, skip preamble

  // v0.15 (audit D3) — schema-validate on read. Skip empty-shell entries
  // (missing summary or lesson) and rate-limit stderr logging of parse
  // failures so a corrupted file doesn't drown the agent's terminal.
  let parseFailures = 0;
  let emptyShells = 0;
  for (const section of sections) {
    const entry = parseEntry(section);
    if (!entry) {
      parseFailures++;
      continue;
    }
    if (!entry.summary.trim() || !entry.lesson.trim()) {
      emptyShells++;
      continue;
    }
    entries.push(entry);
  }
  if (parseFailures > 0 || emptyShells > 0) {
    process.stderr.write(
      `[knit] readLearnings(${filePath}): skipped ${parseFailures} unparseable, ${emptyShells} empty-shell entries\n`,
    );
  }

  return entries;
}

/**
 * v0.15 (audit D4) — pruneLearningsByAge.
 *
 * Sessions had pruneSessionsByAge since v0.8; learnings did not. Long-lived
 * projects accumulate stale entries forever, hurting the BM25 retrieval
 * signal (rare-but-current insights get drowned out by 100+ old entries
 * matching the same domain).
 *
 * Conservative rules — same as sessions:
 *   - Entry with no parseable date is KEPT (never lose data we can't
 *     confidently classify as stale)
 *   - Entry with #false-positive tag is KEPT regardless of age (calibration
 *     signal is more valuable than retrieval freshness)
 *   - Rewrite is atomic (temp + rename) so an interrupted prune leaves
 *     either the prior or the new file, never a torn one
 */
export function pruneLearningsByAge(
  filePath: string,
  maxAgeDays: number,
): { kept: number; pruned: number } {
  if (!existsSync(filePath)) return { kept: 0, pruned: 0 };

  const content = readFileSync(filePath, 'utf-8');
  const preambleSplit = content.split(/^## /m);
  const preamble = preambleSplit[0];
  const sections = preambleSplit.slice(1);

  const cutoffMs = Date.now() - maxAgeDays * 86400000;
  const keptSections: string[] = [];
  let pruned = 0;

  for (const section of sections) {
    const entry = parseEntry(section);
    if (!entry) {
      keptSections.push(section); // unparseable — keep
      continue;
    }
    if (entry.tags.includes('#false-positive')) {
      keptSections.push(section); // calibration signal — keep
      continue;
    }
    const dateMs = Date.parse(entry.date);
    if (!Number.isFinite(dateMs)) {
      keptSections.push(section); // corrupted date — keep
      continue;
    }
    if (dateMs >= cutoffMs) {
      keptSections.push(section);
    } else {
      pruned++;
    }
  }

  if (pruned === 0) {
    return { kept: keptSections.length, pruned: 0 };
  }

  const body = preamble + keptSections.map((s) => '## ' + s).join('');
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmpPath, body, 'utf-8');
  renameSync(tmpPath, filePath);

  return { kept: keptSections.length, pruned };
}

/**
 * Finds learnings matching specific domain tags.
 */
export function findByTags(filePath: string, tags: string[]): LearningEntry[] {
  const entries = readLearnings(filePath);
  return entries.filter((entry) =>
    tags.some((tag) => entry.tags.includes(tag))
  );
}

/**
 * Finds false positive entries.
 */
export function findFalsePositives(filePath: string): LearningEntry[] {
  return findByTags(filePath, ['#false-positive']);
}

function formatEntry(entry: LearningEntry): string {
  return `## ${entry.date} ${entry.summary}
**Domain(s):** ${entry.domains.join(', ')}
**Approach:** ${entry.approach}
**Outcome:** ${entry.outcome}
**Lesson:** ${entry.lesson}
**Tags:** ${entry.tags.join(' ')}
`;
}

function parseEntry(section: string): LearningEntry | null {
  const lines = section.trim().split('\n');
  if (lines.length === 0) return null;

  // Parse header line: "2026-05-15 task summary"
  const headerMatch = lines[0].match(/^(\d{4}-\d{2}-\d{2})\s+(.+)/);
  if (!headerMatch) return null;

  const date = headerMatch[1];
  const summary = headerMatch[2];

  // Parse metadata lines
  const domains = extractField(lines, 'Domain(s)');
  const approach = extractField(lines, 'Approach');
  const outcomeRaw = extractField(lines, 'Outcome');
  const lesson = extractField(lines, 'Lesson');
  const tagsRaw = extractField(lines, 'Tags');

  const outcome = (['success', 'partial', 'failure'].includes(outcomeRaw)
    ? outcomeRaw
    : 'partial') as LearningEntry['outcome'];

  const tags = tagsRaw
    .split(/\s+/)
    .filter((t) => t.startsWith('#'));

  return {
    date,
    summary,
    domains: domains.split(',').map((d) => d.trim()).filter(Boolean),
    approach,
    outcome,
    lesson,
    tags,
  };
}

function extractField(lines: string[], field: string): string {
  const line = lines.find((l) => l.startsWith(`**${field}:**`));
  if (!line) return '';
  return line.replace(`**${field}:**`, '').trim();
}
