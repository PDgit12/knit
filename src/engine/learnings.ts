import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { LearningEntry } from './types.js';

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
 * Appends a learning entry to the learnings file. Atomic via O_APPEND —
 * concurrent appenders cannot truncate or interleave entry bodies because
 * each formatted entry is delivered as a single write() syscall.
 */
export function appendLearning(filePath: string, entry: LearningEntry): void {
  if (!existsSync(filePath)) {
    createLearningsFile(filePath, 'Unknown Project');
  }

  appendFileSync(filePath, '\n' + formatEntry(entry), 'utf-8');
}

/**
 * Reads and parses all learning entries from a file.
 */
export function readLearnings(filePath: string): LearningEntry[] {
  if (!existsSync(filePath)) return [];

  const content = readFileSync(filePath, 'utf-8');
  const entries: LearningEntry[] = [];
  const sections = content.split(/^## /m).slice(1); // Split by ## headers, skip preamble

  for (const section of sections) {
    const entry = parseEntry(section);
    if (entry) entries.push(entry);
  }

  return entries;
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
