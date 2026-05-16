/**
 * Reflection Engine — the "soul" of Engram.
 *
 * Derives behavioral patterns from accumulated learnings WITHOUT
 * extra LLM calls. Pure computation over structured data.
 *
 * Concepts (inspired by Claude Soul, token-optimized):
 * - Patterns: recurring themes detected from tag co-occurrence + outcomes
 * - Frameworks: validated approaches that kept succeeding
 * - Anti-patterns: repeated failures in the same domain
 * - Adaptive hints: "based on history, check X before doing Y"
 */

import type { KnowledgeBase, KBEntry } from './types.js';

/** A detected behavioral pattern */
export interface Pattern {
  id: string;
  type: 'success-pattern' | 'failure-pattern' | 'co-occurrence' | 'domain-insight';
  description: string;
  confidence: number; // 0-10, based on repetition count
  evidence: string[]; // summaries of learnings that support this
  domains: string[];
  lastSeen: string;
  occurrences: number;
}

/** Adaptive suggestion based on patterns */
export interface Suggestion {
  trigger: string; // when does this apply
  action: string; // what to do
  reason: string; // why (based on pattern)
  confidence: number;
}

/**
 * Reflect on accumulated learnings and extract patterns.
 * This is the "self-reflection" — but computed, not LLM-generated.
 * Zero extra tokens. Pure data analysis.
 */
export function reflect(kb: KnowledgeBase): Pattern[] {
  const patterns: Pattern[] = [];

  if (kb.entries.length < 3) return patterns; // need minimum data

  // 1. Find success patterns — what approaches keep working?
  const successes = kb.entries.filter((e) => e.outcome === 'success');
  const successTagCounts = countTags(successes);
  for (const [tag, count] of Object.entries(successTagCounts)) {
    if (count >= 3) {
      const relevant = successes.filter((e) => e.tags.includes(tag));
      patterns.push({
        id: `success-${tag}`,
        type: 'success-pattern',
        description: `Consistent success in ${tag} domain (${count} successes)`,
        confidence: Math.min(count * 2, 10),
        evidence: relevant.slice(-3).map((e) => e.summary),
        domains: [tag],
        lastSeen: relevant[relevant.length - 1].date,
        occurrences: count,
      });
    }
  }

  // 2. Find failure patterns — what keeps going wrong?
  const failures = kb.entries.filter((e) => e.outcome === 'failure');
  const failureTagCounts = countTags(failures);
  for (const [tag, count] of Object.entries(failureTagCounts)) {
    if (count >= 2) {
      const relevant = failures.filter((e) => e.tags.includes(tag));
      patterns.push({
        id: `failure-${tag}`,
        type: 'failure-pattern',
        description: `Repeated failures in ${tag} (${count} times). Common lesson: ${relevant[relevant.length - 1].lesson}`,
        confidence: Math.min(count * 3, 10),
        evidence: relevant.map((e) => e.summary),
        domains: [tag],
        lastSeen: relevant[relevant.length - 1].date,
        occurrences: count,
      });
    }
  }

  // 3. Find tag co-occurrences — what domains always appear together?
  const tagPairs = findTagPairs(kb.entries);
  for (const [pair, count] of tagPairs) {
    if (count >= 3) {
      const [tag1, tag2] = pair.split('+');
      patterns.push({
        id: `cooccur-${pair}`,
        type: 'co-occurrence',
        description: `${tag1} and ${tag2} frequently appear together (${count} times) — changes in one likely affect the other`,
        confidence: Math.min(count * 2, 10),
        evidence: [],
        domains: [tag1, tag2],
        lastSeen: kb.entries[kb.entries.length - 1].date,
        occurrences: count,
      });
    }
  }

  // 4. Domain insights — most-accessed learnings reveal what matters
  const accessed = kb.entries.filter((e) => e.accessCount >= 3);
  for (const entry of accessed) {
    patterns.push({
      id: `insight-${entry.id}`,
      type: 'domain-insight',
      description: `High-value insight (accessed ${entry.accessCount}x): ${entry.lesson}`,
      confidence: Math.min(entry.accessCount, 10),
      evidence: [entry.summary],
      domains: entry.tags,
      lastSeen: entry.lastAccessed || entry.date,
      occurrences: entry.accessCount,
    });
  }

  // Sort by confidence descending
  return patterns.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Generate adaptive suggestions for a given task based on patterns.
 * "Based on history, here's what to watch out for."
 */
export function getAdaptiveSuggestions(kb: KnowledgeBase, taskDomains: string[]): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const patterns = reflect(kb);

  for (const pattern of patterns) {
    // Check if this pattern's domains overlap with the task
    const overlap = pattern.domains.some((d) =>
      taskDomains.some((td) => td.toLowerCase().includes(d.replace('#', '').toLowerCase()) ||
        d.replace('#', '').toLowerCase().includes(td.toLowerCase()))
    );

    if (!overlap) continue;

    if (pattern.type === 'failure-pattern') {
      suggestions.push({
        trigger: `Working in ${pattern.domains.join(', ')} domain`,
        action: `Be careful — this area has failed ${pattern.occurrences} times before`,
        reason: pattern.description,
        confidence: pattern.confidence,
      });
    }

    if (pattern.type === 'co-occurrence') {
      suggestions.push({
        trigger: `Touching ${pattern.domains[0]}`,
        action: `Also check ${pattern.domains[1]} — they always change together`,
        reason: `${pattern.occurrences} past changes affected both`,
        confidence: pattern.confidence,
      });
    }

    if (pattern.type === 'domain-insight' && pattern.confidence >= 5) {
      suggestions.push({
        trigger: `Working in ${pattern.domains.join(', ')}`,
        action: pattern.description.replace(/^High-value insight.*: /, ''),
        reason: `Validated ${pattern.occurrences} times across sessions`,
        confidence: pattern.confidence,
      });
    }
  }

  // Deduplicate and limit
  return suggestions.slice(0, 5);
}

// ── Helpers ──────────────────────────────────────────────────────

function countTags(entries: KBEntry[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    for (const tag of entry.tags) {
      counts[tag] = (counts[tag] || 0) + 1;
    }
  }
  return counts;
}

function findTagPairs(entries: KBEntry[]): Array<[string, number]> {
  const pairs: Record<string, number> = {};
  for (const entry of entries) {
    const tags = entry.tags.filter((t) => t.startsWith('#'));
    for (let i = 0; i < tags.length; i++) {
      for (let j = i + 1; j < tags.length; j++) {
        const pair = [tags[i], tags[j]].sort().join('+');
        pairs[pair] = (pairs[pair] || 0) + 1;
      }
    }
  }
  return Object.entries(pairs).sort((a, b) => b[1] - a[1]);
}
