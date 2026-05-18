import type { KnitConfig, KBEntry, ProjectKnowledge } from '../engine/types.js';

/**
 * Compose a personalized agent .md from VoltAgent's base + Knit's
 * project-specific context block.
 *
 * The base file is left untouched. We append a fenced block:
 *
 *     <!-- knit:context:start -->
 *     ## Project context (knit-managed; do not edit by hand)
 *     ...stack, high-fanout files, learnings, false positives...
 *     <!-- knit:context:end -->
 *
 * If the file already contains a knit:context (or legacy engram:context)
 * block (regeneration), the existing block is replaced. Everything outside
 * the markers is preserved.
 *
 * Goal: VoltAgent provides the role expertise; Knit provides the project
 * knowledge. The agent gets both without us forking VoltAgent's prompts.
 */

export const KNIT_AGENT_MARKER_START = '<!-- knit:context:start -->';
export const KNIT_AGENT_MARKER_END = '<!-- knit:context:end -->';
// Legacy v0.5.x markers — still recognized so existing personalized agent
// files regenerate cleanly without leaving duplicate blocks.
export const LEGACY_ENGRAM_AGENT_MARKER_START = '<!-- engram:context:start -->';
export const LEGACY_ENGRAM_AGENT_MARKER_END = '<!-- engram:context:end -->';
// Back-compat aliases for external imports (e.g. install-agents.ts).
export const ENGRAM_AGENT_MARKER_START = KNIT_AGENT_MARKER_START;
export const ENGRAM_AGENT_MARKER_END = KNIT_AGENT_MARKER_END;

export interface PersonalizationInputs {
  config: KnitConfig;
  knowledge?: ProjectKnowledge | null;
  /** Top relevant learnings, already filtered to this agent's likely interests. */
  relevantLearnings?: KBEntry[];
  /** False positives the agent should NOT re-flag. */
  falsePositives?: KBEntry[];
}

/**
 * Take a fetched agent .md and produce the personalized version for this project.
 * Append Knit's context block, or replace an existing knit (or legacy engram) block.
 */
export function personalizeAgent(baseMd: string, inputs: PersonalizationInputs): string {
  const block = buildContextBlock(inputs);

  // Try current marker first, then legacy engram marker so v0.5.x personalized
  // agents regenerate cleanly without leaving an orphan block.
  const candidates: Array<[string, string]> = [
    [KNIT_AGENT_MARKER_START, KNIT_AGENT_MARKER_END],
    [LEGACY_ENGRAM_AGENT_MARKER_START, LEGACY_ENGRAM_AGENT_MARKER_END],
  ];

  for (const [startMarker, endMarker] of candidates) {
    const startIdx = baseMd.indexOf(startMarker);
    const endIdx = baseMd.indexOf(endMarker);
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      const before = baseMd.slice(0, startIdx);
      const after = baseMd.slice(endIdx + endMarker.length);
      return `${before.trimEnd()}\n\n${block}\n${after.trimStart() ? '\n' + after.trimStart() : ''}`;
    }
  }

  // No existing block — append at end with a separator
  return `${baseMd.trimEnd()}\n\n${block}\n`;
}

/** Build the knit-context block. Compact: the agent already has its own prompt. */
export function buildContextBlock(inputs: PersonalizationInputs): string {
  const { config, knowledge, relevantLearnings, falsePositives } = inputs;
  const lines: string[] = [];

  lines.push(KNIT_AGENT_MARKER_START);
  lines.push('');
  lines.push('## Project context (knit-managed; do not edit by hand)');
  lines.push('');

  // Identity
  const stack = [config.stack.language, config.stack.framework].filter(Boolean).join(' + ');
  lines.push(`**Project:** ${config.name}`);
  if (stack) lines.push(`**Stack:** ${stack}`);
  if (config.stack.testFramework) lines.push(`**Tests:** ${config.stack.testFramework}`);
  lines.push('');

  // High-fanout files — the contracts the agent should treat carefully
  if (knowledge && knowledge.summary.highFanoutFiles.length > 0) {
    const top = knowledge.summary.highFanoutFiles.slice(0, 10);
    lines.push(`**High-fanout files (change carefully):**`);
    for (const f of top) lines.push(`- \`${f}\``);
    lines.push('');
  }

  // Untested source files (relevant for qa/code-reviewer agents)
  if (knowledge && knowledge.summary.untestedFiles.length > 0) {
    const top = knowledge.summary.untestedFiles.slice(0, 5);
    lines.push(`**Untested source files (sample):**`);
    for (const f of top) lines.push(`- \`${f}\``);
    if (knowledge.summary.untestedFiles.length > 5) {
      lines.push(`- (+${knowledge.summary.untestedFiles.length - 5} more)`);
    }
    lines.push('');
  }

  // Relevant learnings — past insights the agent should know about
  if (relevantLearnings && relevantLearnings.length > 0) {
    lines.push(`**Recent relevant learnings:**`);
    for (const l of relevantLearnings.slice(0, 5)) {
      lines.push(`- ${l.summary} — ${l.lesson}`);
    }
    lines.push('');
  }

  // False positives — explicit "do not flag these" list
  if (falsePositives && falsePositives.length > 0) {
    lines.push(`**Known false positives — DO NOT flag these:**`);
    for (const fp of falsePositives.slice(0, 5)) {
      lines.push(`- ${fp.summary} (${fp.lesson})`);
    }
    lines.push('');
  }

  lines.push('## Knit MCP tools you can call');
  lines.push('');
  lines.push('You have access to Knit\'s MCP. Call these when you need depth:');
  lines.push('- `knit_query_dependents(file_path)` — what depends on a file');
  lines.push('- `knit_get_false_positives()` — full FP list, not just what\'s above');
  lines.push('- `knit_search_learnings(domains)` — search past lessons by tag');
  lines.push('- `knit_search_sessions(query)` — has a past session touched this area?');
  lines.push('');
  lines.push(KNIT_AGENT_MARKER_END);

  return lines.join('\n');
}

/**
 * Filter the knowledge base for learnings relevant to an agent role.
 * Heuristic: match by tag prefix (e.g., `security-engineer` matches `#security`).
 */
export function selectRelevantLearnings(allLearnings: KBEntry[], agentName: string, limit = 5): KBEntry[] {
  const interests = inferInterestTags(agentName);
  const scored = allLearnings.map((entry) => {
    let score = 0;
    for (const tag of entry.tags) {
      const tagLower = tag.toLowerCase();
      for (const interest of interests) {
        if (tagLower.includes(interest)) score += 1;
      }
    }
    // Recent learnings win ties
    return { entry, score, date: entry.date };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || (b.date > a.date ? 1 : -1))
    .slice(0, limit)
    .map((s) => s.entry);
}

/** Map an agent name to the tag fragments it cares about. */
function inferInterestTags(agentName: string): string[] {
  // Strip "knit-" or legacy "engram-" prefix if present, then split kebab-case for partial matches
  const base = agentName.replace(/^(knit|engram)-/, '');
  const parts = base.split('-');
  return [base, ...parts].map((s) => s.toLowerCase());
}
