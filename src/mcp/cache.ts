import { execSync } from 'node:child_process';
import { join } from 'node:path';
import type { ProjectKnowledge, KnowledgeBase } from '../engine/types.js';
import { buildKnowledge, buildReverseDependencies } from '../engine/knowledge.js';
import { scanProject } from '../engine/scanner.js';
import { loadKnowledgeBase } from '../engine/knowledgebase.js';

/** Cached project state — loaded once, queried many times */
export interface BrainCache {
  rootPath: string;
  knowledge: ProjectKnowledge;
  reverseDeps: Record<string, string[]>;
  knowledgeBase: KnowledgeBase;
  loadedAt: number;
}

let cache: BrainCache | null = null;

/**
 * Load or return cached brain state.
 * First call builds the full index (~0.5-2s).
 * Subsequent calls return from memory (~0ms).
 */
export function getBrain(rootPath: string): BrainCache {
  if (cache && cache.rootPath === rootPath) {
    return cache;
  }

  const scan = scanProject(rootPath);
  const knowledge = buildKnowledge(rootPath, scan);
  const reverseDeps = buildReverseDependencies(knowledge.importGraph);

  const kbPath = join(rootPath, '.claude/knowledgebase.json');
  const projectName = scan.stack.dependencies?.[0] || 'project';
  const knowledgeBase = loadKnowledgeBase(kbPath, projectName);

  cache = {
    rootPath,
    knowledge,
    reverseDeps,
    knowledgeBase,
    loadedAt: Date.now(),
  };

  return cache;
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
