import type { KnitConfig, Domain, ProjectKnowledge, LearningEntry } from '../engine/types.js';

/**
 * Generate a thin, project-scoped CLAUDE.md.
 *
 * v0.7 trim: protocol depth fetched on demand via knit_get_workflow,
 * tier vocabulary + workflow flow now mostly in MCP server `instructions`.
 * What stays here is the project's own facts — stack, project map, domain
 * architecture, build gates, curated false positives — plus a session-start
 * pointer. Target output: ~6KB on a typical project (was ~16KB pre-trim).
 *
 * Sections (in order):
 *   - project identity (name, stack)
 *   - session startup pointer (single sentence; Protocol Guard config one-line)
 *   - project map (top 5 high-fanout, top 3 untested, top 3 largest, stats)
 *   - domain architecture (auto-detected per project)
 *   - false positives if curated
 *   - build gates
 *   - compact tier table (decision aid, complemented by server instructions)
 *   - one-line workflow pointer
 *
 * Output is wrapped in `<!-- knit:start --> ... <!-- knit:end -->`
 * markers so the auto-init flow in cache.ts can regenerate this section
 * over time without clobbering user-written content elsewhere in CLAUDE.md.
 */

export const KNIT_MARKER_START = '<!-- knit:start -->';
export const KNIT_MARKER_END = '<!-- knit:end -->';
// Legacy v0.5.x markers from before the engram→knit rename. spliceKnitBlock
// recognizes these so users upgrading from v0.5.x get their orphan 16KB
// engram-marked CLAUDE.md block cleanly replaced with the v0.7 lean version
// instead of accumulating both blocks.
export const LEGACY_ENGRAM_MARKER_START = '<!-- engram:start -->';
export const LEGACY_ENGRAM_MARKER_END = '<!-- engram:end -->';

export function generateClaudeMd(
  config: KnitConfig,
  knowledge?: ProjectKnowledge | null,
  falsePositives?: LearningEntry[],
): string {
  const sections = [
    generateHeader(config),
    generateSessionStartup(),
    knowledge ? generateProjectMap(knowledge) : null,
    generateDomainArchitecture(config),
    falsePositives && falsePositives.length > 0 ? generateFalsePositives(falsePositives) : null,
    generateBuildGates(config),
    generateTierVocabulary(),
    generateWorkflowPointer(),
  ];

  const body = sections.filter(Boolean).join('\n\n---\n\n');
  return `${KNIT_MARKER_START}\n\n${body}\n\n${KNIT_MARKER_END}\n`;
}

/** Replace the Knit block inside an existing CLAUDE.md, or append it if no markers exist.
 *  Recognizes both the current `<!-- knit:start -->/<!-- knit:end -->` markers
 *  and the legacy v0.5.x `<!-- engram:start -->/<!-- engram:end -->` markers so
 *  users upgrading from pre-v0.6 don't end up with an orphan block. */
export function spliceKnitBlock(existing: string, newBlock: string): { content: string; mode: 'replaced' | 'appended' | 'sidecar-needed' } {
  // Try current markers first, then legacy.
  const markerPairs: Array<[string, string]> = [
    [KNIT_MARKER_START, KNIT_MARKER_END],
    [LEGACY_ENGRAM_MARKER_START, LEGACY_ENGRAM_MARKER_END],
  ];

  for (const [startMarker, endMarker] of markerPairs) {
    const startIdx = existing.indexOf(startMarker);
    const endIdx = existing.indexOf(endMarker);
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      // Has both markers — replace block, preserve surrounding content.
      // Block is rewritten with the CURRENT (knit) markers regardless of which
      // legacy marker matched; this is how the file converges over time.
      const before = existing.slice(0, startIdx);
      const after = existing.slice(endIdx + endMarker.length);
      return { content: before + newBlock.trimEnd() + after, mode: 'replaced' };
    }
  }

  // Existing file but no markers — user-curated. Caller writes a sidecar instead.
  return { content: existing, mode: 'sidecar-needed' };
}

// ── Sections ─────────────────────────────────────────────────────

function generateHeader(config: KnitConfig): string {
  const stackParts = [
    config.stack.language !== 'unknown' ? config.stack.language : null,
    config.stack.framework,
  ].filter(Boolean);
  const stackDesc = stackParts.length > 0 ? `${stackParts.join(' + ')} project. ` : '';

  return `# ${config.name}

${stackDesc}Knit-powered workflow. The protocol depth is fetched on demand via \`knit_get_workflow({phase})\` — this file holds only project-specific facts.`;
}

function generateSessionStartup(): string {
  return `## Session start

First action: call \`knit_load_session\`. One MCP call returns last sessions, handoff, learnings, false positives. If \`handoff.md\` exists at the repo root, resume that work first.

Protocol Guard runs in \`warn\` mode by default — adjust with \`knit_set_protocol_strictness\`.

## v0.11 tool surface (in addition to query/search/record)

- **\`knit_verify_claim\`** — fact-check one claim against the knowledge graph before LEARN. Stop-hook enforces on standard/complex scope.
- **\`knit_index_requirements\` + \`knit_generate_test_cases\` + \`knit_list_requirements\` + \`knit_delete_requirements\`** — long-form spec / RFC ingestion (200KB doc → relevant 5–7KB chunks per feature query).
- **\`knit_get_fingerprint\` + \`knit_infer_domains\` + \`knit_compose_template\`** — auto-config primitives: detected stack → ranked domains → composed CLAUDE.md sections (preview only; you paste to accept).
- **\`knit_get_calibration\` + tag your false-positives** (e.g. \`#complex-was-trivial\`) — the per-project self-healing classifier tunes thresholds after 3 same-direction FPs.
- **\`knit_brain_status\`** surfaces calibration / requirements / fingerprint state so you can discover all of the above from one health check.`;
}

function generateProjectMap(knowledge: ProjectKnowledge): string {
  const { summary } = knowledge;
  let content = `## Project Map (auto-generated)\n\n`;

  if (summary.entryPoints.length > 0) {
    content += `**Entry points:** \`${summary.entryPoints.join('`, `')}\`\n`;
  }

  // Cap aggressively — full lists belong in knit_query_imports / knit_query_tests,
  // not in CLAUDE.md where they pay per-session token cost.
  if (summary.highFanoutFiles.length > 0) {
    const shown = summary.highFanoutFiles.slice(0, 5);
    content += `**High-fanout (change carefully):** \`${shown.join('`, `')}\``;
    if (summary.highFanoutFiles.length > 5) {
      content += ` (+${summary.highFanoutFiles.length - 5} more — \`knit_find_fanout\`)`;
    }
    content += '\n';
  }

  if (summary.untestedFiles.length > 0) {
    const shown = summary.untestedFiles.slice(0, 3);
    content += `**Untested:** \`${shown.join('`, `')}\``;
    if (summary.untestedFiles.length > 3) {
      content += ` (+${summary.untestedFiles.length - 3} more — \`knit_query_tests({filter:"untested"})\`)`;
    }
    content += '\n';
  }

  if (summary.largestFiles.length > 0) {
    const top3 = summary.largestFiles.slice(0, 3);
    const list = top3.map((f) => `\`${f.path}\` (${f.lines})`).join(', ');
    content += `**Largest:** ${list}\n`;
  }

  content += `\n**Stats:** ${summary.totalFiles} files, ${summary.totalLines.toLocaleString()} lines`;

  const langs = Object.entries(summary.languageBreakdown)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([ext, count]) => `${ext}: ${count}`);
  if (langs.length > 0) content += ` (${langs.join(', ')})`;

  return content;
}

function generateDomainArchitecture(config: KnitConfig): string {
  if (!config.domains || config.domains.length === 0) {
    return `## Domain Architecture\n\nNo domains detected. Use \`knit_setup_project\` to describe your project — Knit will configure domains and review agents.`;
  }

  const rows = config.domains.map((d: Domain) => {
    const patterns = d.filePatterns.slice(0, 3).join(', ');
    const agents = d.agents.join(', ');
    return `### ${d.name}\n**Files:** \`${patterns}\`\n**Concern:** ${d.description}\n**Review agents:** \`${agents}\``;
  }).join('\n\n');

  return `## Domain Architecture\n\n${rows}`;
}

function generateFalsePositives(fps: LearningEntry[]): string {
  const items = fps.slice(0, 10).map((fp) => `- **${fp.summary}** — ${fp.lesson}`).join('\n');
  return `## Known False Positives\n\nReview agents should NOT re-flag these — they're confirmed non-issues from prior sessions:\n\n${items}`;
}

function generateBuildGates(config: KnitConfig): string {
  const gates: string[] = [];
  if (config.stack.typecheckCommand) gates.push(`- \`${config.stack.typecheckCommand}\``);
  if (config.stack.lintCommand) gates.push(`- \`${config.stack.lintCommand}\``);
  if (config.stack.testFramework) {
    const pm = config.packageManager === 'unknown' ? 'npm' : config.packageManager;
    gates.push(`- \`${pm} test\``);
  }
  if (config.stack.buildCommand) gates.push(`- \`${config.stack.buildCommand}\``);

  if (gates.length === 0) {
    return `## Build Gates\n\nNo build gates auto-detected. Add typecheck/lint/test/build commands to your package.json.`;
  }

  return `## Build Gates\n\nAll must pass before commit:\n\n${gates.join('\n')}`;
}

function generateTierVocabulary(): string {
  // Compact table only — the MCP server's `instructions` field carries the
  // full prose. Default-to-under-classifying lives there too.
  return `## Tier vocabulary

| Tier | When |
|------|------|
| **Inquiry** | Read-only ("what", "where", "audit") — just answer. |
| **Trivial** | One-line fix — execute → verify. |
| **Standard** | Single-domain bug fix or feature — research → execute → review. |
| **Complex** | Cross-domain, touches types/auth, high-fanout, or multi-commit arc — full 6 phases + auto plan mode. |`;
}

function generateWorkflowPointer(): string {
  // One line. The phase names live in the MCP server's `instructions` field;
  // listing them again here is duplicate cost.
  return `## Workflow on demand

Fetch any phase via \`knit_get_workflow({phase})\`. Call with no phase to list available sections.`;
}
