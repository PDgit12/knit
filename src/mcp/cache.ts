import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import type { ProjectKnowledge, KnowledgeBase, EngramConfig } from '../engine/types.js';
import { buildKnowledge, buildReverseDependencies } from '../engine/knowledge.js';
import { scanProject } from '../engine/scanner.js';
import { loadKnowledgeBase, saveKnowledgeBase, importFromMarkdown } from '../engine/knowledgebase.js';
import { readLearnings } from '../engine/learnings.js';
import { generateClaudeMd, spliceEngramBlock, ENGRAM_MARKER_START } from '../generators/claude-md.js';
import { installAgentsForProject } from '../engine/install-agents.js';
import { generateLearningsContent } from '../generators/learnings.js';
import { generateSettings } from '../generators/settings.js';
import {
  projectDataDir,
  knowledgePath,
  knowledgebasePath,
  learningsDir,
  learningsFilePath,
  legacyKnowledgePath,
  legacyKnowledgebasePath,
  legacyTeamsPath,
  legacyLearningsDir,
  teamsPath,
  migrationBreadcrumbPath,
  legacyClaudeDir,
} from '../engine/paths.js';

/** Cached project state — loaded once, queried many times */
export interface BrainCache {
  rootPath: string;
  knowledge: ProjectKnowledge;
  reverseDeps: Record<string, string[]>;
  knowledgeBase: KnowledgeBase;
  config: EngramConfig;
  loadedAt: number;
  autoInitialized: boolean;
}

let cache: BrainCache | null = null;

/**
 * Load or return cached brain state.
 * On first call for a project, will either:
 *   - migrate legacy v0.1 data (<project>/.claude/) → ~/.engram/projects/<hash>/
 *   - auto-initialize fresh if no legacy or centralized data exists
 *   - load from centralized if it's already there
 *
 * This is what makes the MCP the product — no CLI needed.
 */
export function getBrain(rootPath: string): BrainCache {
  if (cache && cache.rootPath === rootPath) {
    return cache;
  }

  let autoInitialized = false;
  const haveCentralized = existsSync(knowledgePath(rootPath));
  const haveLegacy = existsSync(legacyKnowledgePath(rootPath));

  if (!haveCentralized) {
    if (haveLegacy) {
      migrateLegacyData(rootPath);
    } else {
      autoInitialize(rootPath);
      autoInitialized = true;
    }
  }

  const scan = scanProject(rootPath);
  const knowledge = buildKnowledge(rootPath, scan);
  const reverseDeps = buildReverseDependencies(knowledge.importGraph);

  const projectName = detectProjectName(rootPath);
  const knowledgeBase = loadKnowledgeBase(knowledgebasePath(rootPath), projectName);

  const config: EngramConfig = {
    name: projectName,
    packageManager: scan.packageManager,
    stack: scan.stack,
    domains: scan.domains,
    targetAgent: 'claude-code',
    tokenOptimization: 'standard',
  };

  // Save refreshed knowledge index to disk
  writeFileSync(knowledgePath(rootPath), JSON.stringify(knowledge, null, 2), 'utf-8');
  saveKnowledgeBase(knowledgebasePath(rootPath), knowledgeBase);

  cache = {
    rootPath,
    knowledge,
    reverseDeps,
    knowledgeBase,
    config,
    loadedAt: Date.now(),
    autoInitialized,
  };

  return cache;
}

/**
 * Auto-initialize a project on first MCP use (no legacy data found).
 * Creates ~/.engram/projects/<hash>/ + project-root CLAUDE.md.
 * This is what eliminates the need for `engram init`.
 */
function autoInitialize(rootPath: string): void {
  const scan = scanProject(rootPath);
  const knowledge = buildKnowledge(rootPath, scan);
  const projectName = detectProjectName(rootPath);

  const config: EngramConfig = {
    name: projectName,
    packageManager: scan.packageManager,
    stack: scan.stack,
    domains: scan.domains,
    targetAgent: 'claude-code',
    tokenOptimization: 'standard',
  };

  // Centralized data dirs
  mkdirSync(projectDataDir(rootPath), { recursive: true });
  mkdirSync(learningsDir(rootPath), { recursive: true });

  // Project root CLAUDE.md — three cases: fresh, has-markers, no-markers (sidecar)
  writeProjectClaudeMd(rootPath, config, knowledge);

  // Per-project hooks at <project>/.claude/settings.local.json — never settings.json,
  // because settings.json gets committed and our hooks embed machine-specific
  // ~/.engram/projects/<hash>/ paths.
  writeEngramHooks(rootPath, config);

  // Per-project subagents at <project>/.claude/agents/engram-*.md (v0.4+).
  // Fire-and-forget: bundled-core agents resolve sync, so they land before
  // the agent makes its next tool call. Network-fetched specialized agents
  // arrive in the background; if a session uses one before it lands, Claude
  // Code falls back to its default and the file is ready by the next session.
  // Pass null for knowledgeBase: on auto-init the project has no learnings
  // yet — subsequent installs via CLI / engram_install_agent will include them.
  installAgentsForProject(rootPath, config, knowledge, null).catch((err) => {
    // Never let an install failure abort autoInit. Log to stderr; agents are
    // best-effort and the rest of engram works without them.
    process.stderr.write(`[engram] agent install background error: ${err?.message ?? err}\n`);
  });

  // Learnings markdown (centralized)
  const learningsPath = learningsFilePath(rootPath, projectName);
  if (!existsSync(learningsPath)) {
    writeFileSync(learningsPath, generateLearningsContent(config), 'utf-8');
  }

  // Knowledgebase JSON (centralized) — import any seed learnings
  const kbPath = knowledgebasePath(rootPath);
  const kb = loadKnowledgeBase(kbPath, projectName);
  const entries = readLearnings(learningsPath);
  importFromMarkdown(kb, entries);
  saveKnowledgeBase(kbPath, kb);

  // Knowledge index (centralized)
  writeFileSync(knowledgePath(rootPath), JSON.stringify(knowledge, null, 2), 'utf-8');
}

/**
 * One-shot migration: v0.1 data lived in <project>/.claude/, v0.2 lives in
 * ~/.engram/projects/<hash>/. When we detect legacy data but no centralized
 * data, copy forward and leave a breadcrumb so the user can find their data.
 */
function migrateLegacyData(rootPath: string): void {
  mkdirSync(projectDataDir(rootPath), { recursive: true });
  mkdirSync(learningsDir(rootPath), { recursive: true });

  copyIfExists(legacyKnowledgePath(rootPath), knowledgePath(rootPath));
  copyIfExists(legacyKnowledgebasePath(rootPath), knowledgebasePath(rootPath));
  copyIfExists(legacyTeamsPath(rootPath), teamsPath(rootPath));

  const legacyLearn = legacyLearningsDir(rootPath);
  if (existsSync(legacyLearn)) {
    for (const file of readdirSync(legacyLearn)) {
      const src = join(legacyLearn, file);
      const dst = join(learningsDir(rootPath), file);
      try {
        if (statSync(src).isFile() && !existsSync(dst)) {
          copyFileSync(src, dst);
        }
      } catch { /* skip unreadable */ }
    }
  }

  // Breadcrumb so the user knows where their data went
  const breadcrumb = migrationBreadcrumbPath(rootPath);
  const newPath = projectDataDir(rootPath);
  if (!existsSync(breadcrumb) && existsSync(legacyClaudeDir(rootPath))) {
    const note = `Engram data migrated to ~/.engram/ on ${new Date().toISOString().split('T')[0]}.

Centralized location for this project:
  ${newPath}

The legacy files in this .claude/ directory are no longer read by engram and
can be deleted at your discretion. Future learnings, knowledge indexes, and
session memory live in the new path.
`;
    try {
      writeFileSync(breadcrumb, note, 'utf-8');
    } catch { /* breadcrumb is best-effort */ }
  }
}

/**
 * Write the project's CLAUDE.md, handling three cases without ever clobbering
 * user-written content:
 *
 *   - No file: write fresh with engram markers.
 *   - Has file + markers: replace only the in-marker block, preserve everything else.
 *   - Has file + no markers: it's user-curated. Write a sidecar at
 *     <project>/.claude/ENGRAM.md instead, and tell the user (in the sidecar)
 *     to add an `@.claude/ENGRAM.md` line if they want engram's section.
 */
function writeProjectClaudeMd(
  rootPath: string,
  config: EngramConfig,
  knowledge: ProjectKnowledge,
): void {
  const claudeMdPath = join(rootPath, 'CLAUDE.md');
  const block = generateClaudeMd(config, knowledge);

  if (!existsSync(claudeMdPath)) {
    writeFileSync(claudeMdPath, block, 'utf-8');
    return;
  }

  const existing = readFileSync(claudeMdPath, 'utf-8');
  if (existing.includes(ENGRAM_MARKER_START)) {
    const { content } = spliceEngramBlock(existing, block);
    writeFileSync(claudeMdPath, content, 'utf-8');
    return;
  }

  // User-curated CLAUDE.md exists with no engram markers — never clobber.
  const sidecarDir = join(rootPath, '.claude');
  const sidecarPath = join(sidecarDir, 'ENGRAM.md');
  mkdirSync(sidecarDir, { recursive: true });
  const sidecar = `<!-- This file is engram's per-project workflow. -->
<!-- Your CLAUDE.md exists without engram markers, so engram wrote here instead of clobbering it. -->
<!-- To include this content in CLAUDE.md, add: @.claude/ENGRAM.md -->

${block}`;
  writeFileSync(sidecarPath, sidecar, 'utf-8');
}

function copyIfExists(src: string, dst: string): void {
  if (existsSync(src) && !existsSync(dst)) {
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(src, dst);
  }
}

/**
 * Write <project>/.claude/settings.local.json with engram hooks.
 *
 * Why settings.local.json (and not settings.json): the hook shell commands
 * embed absolute paths like /Users/alice/.engram/projects/<hash>/... which
 * are machine-specific. settings.json is the conventional shared/committed
 * file; settings.local.json is the per-machine file teams typically gitignore.
 * Writing here keeps engram's machine-specific config out of the team's repo.
 *
 * Three cases:
 *   - Case A — no file: write fresh.
 *   - Case B — file exists with `_engramHooks` marker: overwrite with the
 *     current hook set (idempotent regeneration of an engram-owned file).
 *   - Case C — file exists WITHOUT `_engramHooks` marker: hybrid merge.
 *     The user owns the file. We merge engram's hook entries (tagged
 *     `_engramOwned: true`) into the user's PreToolUse/PostToolUse/Stop
 *     arrays, preserving user entries and any other top-level keys
 *     (mcpServers, permissions, etc.). On subsequent regen we filter out
 *     stale engram-owned entries before appending fresh ones, so user
 *     entries are never disturbed.
 *
 * If the existing file is unreadable / malformed JSON we bail out to avoid
 * damaging the user's config.
 */
function writeEngramHooks(rootPath: string, config: EngramConfig): void {
  const claudeDir = join(rootPath, '.claude');
  const settingsPath = join(claudeDir, 'settings.local.json');
  const fresh = generateSettings(config, rootPath) as {
    mcpServers?: unknown;
    hooks: Record<string, unknown[]>;
    _engramHooks: { version: number; generatedAt: string };
  };

  // Case A — no file: write fresh
  if (!existsSync(settingsPath)) {
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(fresh, null, 2), 'utf-8');
    return;
  }

  let existing: Record<string, unknown>;
  try {
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      // Not a JSON object — bail
      return;
    }
    existing = parsed as Record<string, unknown>;
  } catch {
    // Unreadable / malformed — bail, don't risk damage
    return;
  }

  // Case B — engram-owned file: overwrite
  if ('_engramHooks' in existing) {
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(fresh, null, 2), 'utf-8');
    return;
  }

  // Case C — user-owned file: merge engram hook entries into existing arrays
  const userHooksRaw = existing.hooks;
  let userHooks: Record<string, unknown[]>;
  if (userHooksRaw === undefined) {
    userHooks = {};
  } else if (userHooksRaw && typeof userHooksRaw === 'object' && !Array.isArray(userHooksRaw)) {
    // Validate every event value is an array; bail if any is not (don't risk damage)
    for (const v of Object.values(userHooksRaw as Record<string, unknown>)) {
      if (!Array.isArray(v)) return;
    }
    userHooks = { ...(userHooksRaw as Record<string, unknown[]>) };
  } else {
    // hooks key present but not a plain object — bail
    return;
  }

  for (const event of Object.keys(fresh.hooks)) {
    const userEntries = Array.isArray(userHooks[event]) ? userHooks[event] : [];
    // Strip any stale engram-owned entries from a prior merge
    const preserved = userEntries.filter((entry) => {
      return !(entry && typeof entry === 'object' && (entry as { _engramOwned?: unknown })._engramOwned === true);
    });
    // Append fresh engram entries after user entries
    userHooks[event] = [...preserved, ...fresh.hooks[event]];
  }

  const merged: Record<string, unknown> = {
    ...existing,
    hooks: userHooks,
    _engramHooks: { ...fresh._engramHooks, merged: true },
  };

  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(merged, null, 2), 'utf-8');
}


function detectProjectName(rootPath: string): string {
  let name = basename(rootPath);
  try {
    const pkg = JSON.parse(readFileSync(join(rootPath, 'package.json'), 'utf-8'));
    if (pkg.name) name = pkg.name;
  } catch { /* use dirname */ }
  return name;
}

/**
 * Force rebuild the cache (after file changes).
 */
export function refreshBrain(rootPath: string): BrainCache {
  cache = null;
  return getBrain(rootPath);
}

/**
 * Get the project root — uses git or cwd.
 */
export function detectProjectRoot(): string {
  try {
    return execSync('git rev-parse --show-toplevel 2>/dev/null', { encoding: 'utf-8' }).trim();
  } catch {
    return process.cwd();
  }
}
