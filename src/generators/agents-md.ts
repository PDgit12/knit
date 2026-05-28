/**
 * AGENTS.md generator — the cross-agent project-rules convention.
 *
 * `AGENTS.md` at project root is the convention Codex CLI documents as its
 * per-project instructions file, and Cline auto-detects it alongside its
 * own `.clinerules/`. Writing one AGENTS.md gives Knit coverage for both
 * agents with a single file.
 *
 * Output is marker-wrapped (`<!-- knit:start --> ... <!-- knit:end -->`)
 * using the same `spliceKnitBlock` pattern as CLAUDE.md, so re-running
 * setup replaces only the Knit-managed block and never clobbers
 * user-curated content above or below.
 */

import {
  KNIT_MARKER_START,
  KNIT_MARKER_END,
  spliceKnitBlock,
} from './claude-md.js';

export interface AgentsMdInputs {
  /** Project name (typically from package.json or directory basename). */
  projectName: string;
  /** Optional one-line project description. */
  projectDescription?: string;
}

/** Build the Knit-managed body. Kept short — AGENTS.md is read by agents
 *  WITHOUT Claude Code's hook-based protocol enforcement, so the body's
 *  job is to nudge the agent toward the MCP tool surface, not to
 *  duplicate Knit's full workflow protocol (which lives on-demand via
 *  knit_get_workflow). */
export function buildAgentsMdBody(inputs: AgentsMdInputs): string {
  const lines: string[] = [];
  lines.push(`# ${inputs.projectName}`);
  if (inputs.projectDescription) {
    lines.push('');
    lines.push(inputs.projectDescription);
  }
  lines.push('');
  lines.push('## Knit MCP — second brain for this project');
  lines.push('');
  lines.push('Knit is connected via MCP. It provides project-scoped memory,');
  lines.push('a workflow protocol, and a knowledge graph. Use it on every');
  lines.push('non-trivial task — full tool list is exposed at MCP handshake.');
  lines.push('');
  lines.push('### Session start');
  lines.push('1. `knit_load_session` — returns last handoff, top learnings, FPs.');
  lines.push('2. If `has_unfinished_work: true`, resume the handoff instead of starting fresh.');
  lines.push('');
  lines.push('### Before any Edit/Write');
  lines.push('3. `knit_classify_task({files_to_touch, description})` — returns the tier and phases.');
  lines.push('   - `inquiry` → answer directly, no LEARN');
  lines.push('   - `trivial` → proceed, LEARN optional');
  lines.push('   - `standard` → call `knit_search_learnings` first; LEARN at end');
  lines.push('   - `complex` → enter plan mode, search learnings, fact-check claims');
  lines.push('');
  lines.push('### At task end');
  lines.push('4. `knit_record_learning({summary, lesson, domains, tags})` if anything non-obvious surfaced.');
  lines.push('5. If unfinished, `knit_save_handoff(...)`.');
  lines.push('');
  lines.push('### Useful queries (instead of grep)');
  lines.push('- `knit_query_imports({file_path})` — who imports this file (blast radius).');
  lines.push('- `knit_query_dependents({file_path})` — what this file imports (forward deps).');
  lines.push('- `knit_search_learnings({query, files})` — BM25 + import-graph fusion search.');
  lines.push('');
  lines.push('### Why this matters');
  lines.push('Skipping the protocol means re-investigating things the brain already knows,');
  lines.push('which burns tokens. The compounding ROI is visible via `knit_compounding_metrics`.');
  return lines.join('\n');
}

/** Build the full marker-wrapped block. */
export function buildAgentsMdBlock(inputs: AgentsMdInputs): string {
  return `${KNIT_MARKER_START}\n\n${buildAgentsMdBody(inputs)}\n\n${KNIT_MARKER_END}\n`;
}

/** Merge the Knit block into an existing AGENTS.md (or create new).
 *
 *  Three cases:
 *  1. Existing file has Knit markers → replace block, preserve content
 *     above and below. (Delegated to spliceKnitBlock from claude-md.ts.)
 *  2. Existing file is empty → write block fresh, mode = 'appended'.
 *  3. Existing file has content but no markers → the user has a curated
 *     AGENTS.md. We don't clobber it; append our block at the end so the
 *     agent reads both, mode = 'appended'. Differs from CLAUDE.md's
 *     `sidecar-needed` mode because AGENTS.md is a shared convention
 *     across Codex+Cline and there's no clean "sidecar" location like
 *     CLAUDE.md has — appending is the cleanest fallback. */
export function mergeAgentsMd(existing: string, inputs: AgentsMdInputs): { content: string; mode: 'replaced' | 'appended' } {
  const block = buildAgentsMdBlock(inputs);
  const spliced = spliceKnitBlock(existing, block);
  if (spliced.mode === 'replaced') return { content: spliced.content, mode: 'replaced' };

  // sidecar-needed from spliceKnitBlock — for AGENTS.md we treat that
  // as "append safely" because the convention is one shared file, not a
  // sidecar.
  if (existing.length === 0) {
    return { content: block, mode: 'appended' };
  }
  const sep = existing.endsWith('\n') ? '\n' : '\n\n';
  return { content: existing + sep + block, mode: 'appended' };
}
