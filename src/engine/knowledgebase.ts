import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { KnowledgeBase, KBEntry, SessionRecord, LearningEntry } from './types.js';

/**
 * Creates a new empty knowledge base.
 */
export function createKnowledgeBase(projectName: string): KnowledgeBase {
  return {
    version: 1,
    projectName,
    entries: [],
    metrics: {
      totalSessions: 0,
      totalLearnings: 0,
      cacheHits: 0,
      domainDistribution: {},
      sessions: [],
    },
  };
}

/**
 * Loads knowledge base from disk, or creates a new one.
 */
export function loadKnowledgeBase(filePath: string, projectName: string): KnowledgeBase {
  if (!existsSync(filePath)) {
    return createKnowledgeBase(projectName);
  }

  try {
    // Size guard — prevent OOM on corrupted/bloated files
    const stat = statSync(filePath);
    if (stat.size > 10 * 1024 * 1024) {
      return createKnowledgeBase(projectName);
    }

    const raw = readFileSync(filePath, 'utf-8');
    const kb = JSON.parse(raw) as KnowledgeBase;

    // Structural validation — don't trust the cast
    if (kb.version !== 1) return createKnowledgeBase(projectName);
    if (!Array.isArray(kb.entries)) return createKnowledgeBase(projectName);
    if (!kb.metrics || typeof kb.metrics.totalSessions !== 'number') return createKnowledgeBase(projectName);

    return kb;
  } catch {
    return createKnowledgeBase(projectName);
  }
}

/**
 * Saves knowledge base to disk.
 */
export function saveKnowledgeBase(filePath: string, kb: KnowledgeBase): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, JSON.stringify(kb, null, 2), 'utf-8');
}

/**
 * Adds a learning entry to the knowledge base.
 */
export function addEntry(kb: KnowledgeBase, entry: LearningEntry): KBEntry {
  const kbEntry: KBEntry = {
    id: randomUUID(),
    ...entry,
    accessCount: 0,
    lastAccessed: null,
  };

  kb.entries.push(kbEntry);
  kb.metrics.totalLearnings = kb.entries.length;

  // Update domain distribution
  for (const tag of entry.tags) {
    kb.metrics.domainDistribution[tag] = (kb.metrics.domainDistribution[tag] || 0) + 1;
  }

  return kbEntry;
}

/**
 * Import learnings from a markdown file into the knowledge base.
 * Skips entries that already exist (by date + summary match).
 */
export function importFromMarkdown(kb: KnowledgeBase, entries: LearningEntry[]): number {
  let imported = 0;
  for (const entry of entries) {
    const exists = kb.entries.some(
      (e) => e.date === entry.date && e.summary === entry.summary
    );
    if (!exists) {
      addEntry(kb, entry);
      imported++;
    }
  }
  return imported;
}

/**
 * Query the knowledge base for entries relevant to given domain tags.
 * Returns entries sorted by relevance (access count + recency).
 * Marks returned entries as accessed (increments accessCount).
 */
export function queryByDomains(kb: KnowledgeBase, domains: string[]): KBEntry[] {
  const now = new Date().toISOString();
  const domainTags = domains.map((d) => `#${d.toLowerCase()}`);

  const matches = kb.entries.filter((entry) =>
    domainTags.some((tag) => entry.tags.some((t) => t.toLowerCase() === tag))
  );

  // Mark as accessed
  for (const match of matches) {
    match.accessCount++;
    match.lastAccessed = now;
  }

  // Sort: most accessed first, then most recent
  return matches.sort((a, b) => {
    if (b.accessCount !== a.accessCount) return b.accessCount - a.accessCount;
    return b.date.localeCompare(a.date);
  });
}

/**
 * Get false positives from the knowledge base.
 */
export function getFalsePositives(kb: KnowledgeBase): KBEntry[] {
  return kb.entries.filter((e) => e.tags.includes('#false-positive'));
}

/**
 * Get the top N most valuable entries (by access count).
 * These are the learnings that actually save tokens — they get used repeatedly.
 */
export function getTopEntries(kb: KnowledgeBase, limit: number = 10): KBEntry[] {
  return [...kb.entries]
    .sort((a, b) => {
      if (b.accessCount !== a.accessCount) return b.accessCount - a.accessCount;
      return b.date.localeCompare(a.date);
    })
    .slice(0, limit);
}

/**
 * Get entries that have never been accessed — candidates for archiving.
 */
export function getStaleEntries(kb: KnowledgeBase, olderThanDays: number = 30): KBEntry[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - olderThanDays);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  return kb.entries.filter(
    (e) => e.accessCount === 0 && e.date < cutoffStr
  );
}

/**
 * Record a session in the metrics.
 */
export function recordSession(kb: KnowledgeBase, session: SessionRecord): void {
  kb.metrics.totalSessions++;
  kb.metrics.sessions.push(session);

  // Keep only last 20 sessions
  if (kb.metrics.sessions.length > 20) {
    kb.metrics.sessions = kb.metrics.sessions.slice(-20);
  }
}

/**
 * Record a cache hit (a learning prevented re-investigation).
 */
export function recordCacheHit(kb: KnowledgeBase): void {
  kb.metrics.cacheHits++;
}

/**
 * Generate a summary of knowledge base health for display.
 */
export function getKBSummary(kb: KnowledgeBase): KBSummary {
  const totalEntries = kb.entries.length;
  const accessedEntries = kb.entries.filter((e) => e.accessCount > 0).length;
  const falsePositives = kb.entries.filter((e) => e.tags.includes('#false-positive')).length;
  const staleEntries = getStaleEntries(kb).length;

  // Top domains by entry count
  const domainCounts = Object.entries(kb.metrics.domainDistribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // Average files modified per session
  const recentSessions = kb.metrics.sessions.slice(-10);
  const avgFiles = recentSessions.length > 0
    ? Math.round(recentSessions.reduce((s, r) => s + r.filesModified, 0) / recentSessions.length)
    : 0;

  return {
    totalEntries,
    accessedEntries,
    neverAccessed: totalEntries - accessedEntries,
    falsePositives,
    staleEntries,
    totalSessions: kb.metrics.totalSessions,
    cacheHits: kb.metrics.cacheHits,
    topDomains: domainCounts,
    avgFilesPerSession: avgFiles,
    hitRate: totalEntries > 0 ? Math.round((accessedEntries / totalEntries) * 100) : 0,
  };
}

export interface KBSummary {
  totalEntries: number;
  accessedEntries: number;
  neverAccessed: number;
  falsePositives: number;
  staleEntries: number;
  totalSessions: number;
  cacheHits: number;
  topDomains: Array<[string, number]>;
  avgFilesPerSession: number;
  /** Percentage of entries that have been accessed at least once */
  hitRate: number;
}

/**
 * Generate the CLAUDE.md section that shows only relevant learnings,
 * not the entire history. This is the token-saving mechanism.
 */
export function generateSmartLearningsSection(kb: KnowledgeBase, maxEntries: number = 15): string {
  if (kb.entries.length === 0) return '';

  const falsePositives = getFalsePositives(kb);
  const topEntries = getTopEntries(kb, maxEntries - falsePositives.length);

  // Deduplicate (false positives might also be top entries)
  const seen = new Set<string>();
  const allRelevant: KBEntry[] = [];

  for (const fp of falsePositives) {
    if (!seen.has(fp.id)) {
      seen.add(fp.id);
      allRelevant.push(fp);
    }
  }
  for (const entry of topEntries) {
    if (!seen.has(entry.id)) {
      seen.add(entry.id);
      allRelevant.push(entry);
    }
  }

  let content = `## Active Learnings (${allRelevant.length} of ${kb.entries.length} — most relevant only)

> Full knowledge base: \`.claude/knowledgebase.json\` (${kb.entries.length} entries, ${kb.metrics.cacheHits} cache hits)
> Stale entries (never accessed, 30+ days old): ${getStaleEntries(kb).length}

`;

  if (falsePositives.length > 0) {
    content += `### Known False Positives — DO NOT flag these\n\n`;
    for (const fp of falsePositives) {
      content += `- **${fp.summary}** — ${fp.lesson} (${fp.date})\n`;
    }
    content += '\n';
  }

  const nonFP = allRelevant.filter((e) => !e.tags.includes('#false-positive'));
  if (nonFP.length > 0) {
    content += `### Top Learnings (by usage)\n\n`;
    for (const entry of nonFP) {
      const accessLabel = entry.accessCount > 0 ? ` [accessed ${entry.accessCount}x]` : '';
      content += `- **${entry.summary}** — ${entry.lesson}${accessLabel} (${entry.date})\n`;
    }
  }

  return content;
}
