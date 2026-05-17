import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import type { ProjectKnowledge, KnowledgeBase } from '../engine/types.js';
import { buildKnowledge, buildReverseDependencies } from '../engine/knowledge.js';
import { scanProject } from '../engine/scanner.js';
import { loadKnowledgeBase, saveKnowledgeBase, importFromMarkdown } from '../engine/knowledgebase.js';
import { readLearnings } from '../engine/learnings.js';
import { generateClaudeMd } from '../generators/claude-md.js';
import { generateLearningsContent } from '../generators/learnings.js';
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

  // Save refreshed knowledge index to disk
  writeFileSync(knowledgePath(rootPath), JSON.stringify(knowledge, null, 2), 'utf-8');
  saveKnowledgeBase(knowledgebasePath(rootPath), knowledgeBase);

  cache = {
    rootPath,
    knowledge,
    reverseDeps,
    knowledgeBase,
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

  const config = {
    name: projectName,
    packageManager: scan.packageManager,
    stack: scan.stack,
    domains: scan.domains,
    targetAgent: 'claude-code' as const,
    tokenOptimization: 'standard' as const,
  };

  // Centralized data dirs
  mkdirSync(projectDataDir(rootPath), { recursive: true });
  mkdirSync(learningsDir(rootPath), { recursive: true });

  // Project root CLAUDE.md (Claude Code expects it here)
  const claudeMdPath = join(rootPath, 'CLAUDE.md');
  if (!existsSync(claudeMdPath)) {
    writeFileSync(claudeMdPath, generateClaudeMd(config, knowledge), 'utf-8');
  }

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

function copyIfExists(src: string, dst: string): void {
  if (existsSync(src) && !existsSync(dst)) {
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(src, dst);
  }
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
