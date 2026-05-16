import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { ProjectKnowledge, KnowledgeBase } from '../engine/types.js';
import { buildKnowledge, buildReverseDependencies } from '../engine/knowledge.js';
import { scanProject } from '../engine/scanner.js';
import { loadKnowledgeBase, saveKnowledgeBase, importFromMarkdown } from '../engine/knowledgebase.js';
import { readLearnings } from '../engine/learnings.js';
import { generateClaudeMd } from '../generators/claude-md.js';
import { generateLearningsContent } from '../generators/learnings.js';

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
 * AUTO-INITIALIZES on first use if .claude/ doesn't exist.
 * This is what makes the MCP the product — no CLI needed.
 */
export function getBrain(rootPath: string): BrainCache {
  if (cache && cache.rootPath === rootPath) {
    return cache;
  }

  // Auto-initialize if this project has never seen engram
  let autoInitialized = false;
  if (!existsSync(join(rootPath, '.claude/knowledge.json'))) {
    autoInitialize(rootPath);
    autoInitialized = true;
  }

  const scan = scanProject(rootPath);
  const knowledge = buildKnowledge(rootPath, scan);
  const reverseDeps = buildReverseDependencies(knowledge.importGraph);

  // Infer project name
  let projectName = basename(rootPath);
  try {
    const pkg = JSON.parse(readFileSync(join(rootPath, 'package.json'), 'utf-8'));
    if (pkg.name) projectName = pkg.name;
  } catch { /* use dirname */ }

  const kbPath = join(rootPath, '.claude/knowledgebase.json');
  const knowledgeBase = loadKnowledgeBase(kbPath, projectName);

  // Save updated knowledge to disk
  writeFileSync(join(rootPath, '.claude/knowledge.json'), JSON.stringify(knowledge, null, 2), 'utf-8');
  saveKnowledgeBase(kbPath, knowledgeBase);

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
 * Auto-initialize a project on first MCP use.
 * Creates .claude/ directory, CLAUDE.md, learnings, and knowledge files.
 * This is what eliminates the need for `engram init`.
 */
function autoInitialize(rootPath: string): void {
  const scan = scanProject(rootPath);
  const knowledge = buildKnowledge(rootPath, scan);

  // Infer project name
  let projectName = basename(rootPath);
  try {
    const pkg = JSON.parse(readFileSync(join(rootPath, 'package.json'), 'utf-8'));
    if (pkg.name) projectName = pkg.name;
  } catch { /* use dirname */ }

  // Build config
  const config = {
    name: projectName,
    packageManager: scan.packageManager,
    stack: scan.stack,
    domains: scan.domains,
    targetAgent: 'claude-code' as const,
    tokenOptimization: 'standard' as const,
  };

  // Create directories
  for (const dir of ['.claude', '.claude/learnings', '.claude/worktrees']) {
    const fullPath = join(rootPath, dir);
    if (!existsSync(fullPath)) mkdirSync(fullPath, { recursive: true });
  }

  // Generate CLAUDE.md (only if it doesn't exist)
  const claudeMdPath = join(rootPath, 'CLAUDE.md');
  if (!existsSync(claudeMdPath)) {
    writeFileSync(claudeMdPath, generateClaudeMd(config, knowledge), 'utf-8');
  }

  // Generate learnings file
  const learningsFileName = projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.md';
  const learningsPath = join(rootPath, '.claude/learnings', learningsFileName);
  if (!existsSync(learningsPath)) {
    writeFileSync(learningsPath, generateLearningsContent(config), 'utf-8');
  }

  // Generate knowledge base
  const kbPath = join(rootPath, '.claude/knowledgebase.json');
  const kb = loadKnowledgeBase(kbPath, projectName);
  const entries = readLearnings(learningsPath);
  importFromMarkdown(kb, entries);
  saveKnowledgeBase(kbPath, kb);

  // Write knowledge index
  writeFileSync(join(rootPath, '.claude/knowledge.json'), JSON.stringify(knowledge, null, 2), 'utf-8');
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
