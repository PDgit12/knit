import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fetchAgent, AgentFetchError } from './agent-fetcher.js';
import { knownAgents } from './agent-registry.js';
import {
  personalizeAgent,
  selectRelevantLearnings,
  KNIT_AGENT_MARKER_START,
  LEGACY_ENGRAM_AGENT_MARKER_START,
} from '../generators/agent-md.js';
import { projectAgentFile, projectAgentsDir } from './paths.js';
import type { KnitConfig, KBEntry, KnowledgeBase, ProjectKnowledge } from './types.js';

/**
 * Install VoltAgent subagents into a project. Each agent is fetched (bundled,
 * cached, or network), personalized with project context, and written to
 * <project>/.claude/agents/knit-<name>.md so Claude Code's Agent tool finds them.
 *
 * Never clobbers user-curated agents. A file at the target path without the
 * Knit marker (or legacy engram marker) is left alone; Knit only owns
 * files it has tagged.
 */

export interface InstallOptions {
  /** Force re-fetch from network even if cached. */
  refresh?: boolean;
  /** Install all known agents, not just ones the project's teams reference. */
  all?: boolean;
  /** Names to install; overrides the project-driven selection if given. */
  only?: string[];
}

export interface InstallResult {
  installed: string[];
  alreadyCurrent: string[];
  skippedUserCurated: string[];
  failed: { name: string; error: string }[];
}

export async function installAgentsForProject(
  rootPath: string,
  config: KnitConfig,
  knowledge: ProjectKnowledge | null,
  knowledgeBase: KnowledgeBase | null,
  opts: InstallOptions = {},
): Promise<InstallResult> {
  const targets = opts.only
    ? opts.only
    : opts.all
      ? knownAgents()
      : agentsNeededByProject(config);

  const result: InstallResult = {
    installed: [],
    alreadyCurrent: [],
    skippedUserCurated: [],
    failed: [],
  };

  mkdirSync(projectAgentsDir(rootPath), { recursive: true });

  const fps = knowledgeBase ? knowledgeBase.entries.filter((e) => e.tags.includes('#false-positive')) : [];

  for (const name of targets) {
    const outFile = projectAgentFile(rootPath, name);

    // Refuse to clobber a user-curated file (no Knit-managed marker).
    // Legacy engram marker is also recognized so v0.5.x personalized agents
    // get regenerated without being treated as user-curated.
    if (existsSync(outFile) && !opts.refresh) {
      try {
        const existing = readFileSync(outFile, 'utf-8');
        const isKnitManaged =
          existing.includes(KNIT_AGENT_MARKER_START) ||
          existing.includes(LEGACY_ENGRAM_AGENT_MARKER_START);
        if (!isKnitManaged) {
          result.skippedUserCurated.push(name);
          continue;
        }
      } catch {
        // Unreadable — be conservative; treat as user-curated
        result.skippedUserCurated.push(name);
        continue;
      }
    }

    try {
      const baseMd = await fetchAgent(name, opts.refresh ? { ref: undefined, refresh: true } : {});
      const relevant: KBEntry[] = knowledgeBase
        ? selectRelevantLearnings(knowledgeBase.entries, name)
        : [];
      const personalized = personalizeAgent(baseMd, {
        config,
        knowledge,
        relevantLearnings: relevant,
        falsePositives: fps,
      });

      // Idempotency: if the file already matches what we'd write, skip
      if (existsSync(outFile)) {
        try {
          const existing = readFileSync(outFile, 'utf-8');
          if (existing.trim() === personalized.trim()) {
            result.alreadyCurrent.push(name);
            continue;
          }
        } catch { /* fall through to write */ }
      }

      writeFileSync(outFile, personalized, 'utf-8');
      result.installed.push(name);
    } catch (err) {
      const msg = err instanceof AgentFetchError ? err.message : String(err);
      result.failed.push({ name, error: msg });
    }
  }

  return result;
}

/** Names of agents referenced by any domain in this project's config. */
function agentsNeededByProject(config: KnitConfig): string[] {
  const names = new Set<string>();
  for (const domain of config.domains) {
    for (const agent of domain.agents) names.add(agent);
  }
  return Array.from(names);
}
