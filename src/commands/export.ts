import { existsSync, mkdirSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { engramRoot, globalLearningsPath } from '../engine/paths.js';
import { loadKnowledgeBase } from '../engine/knowledgebase.js';
import { getRecentGlobalLearnings } from '../engine/global-learnings.js';
import type { KBEntry, KnowledgeBase, GlobalLearning } from '../engine/types.js';

/**
 * Export engram's institutional knowledge into a target format.
 *
 * 0.4.1: only `obsidian` is supported. Structure preserved as a switch
 * so future formats (e.g. Notion, plain markdown bundle) plug in cleanly.
 */
export async function exportCommand(
  format: string,
  vaultPath: string,
  options: { filter?: string } = {},
): Promise<void> {
  switch (format) {
    case 'obsidian':
      await exportObsidian(vaultPath, options);
      return;
    default:
      throw new Error(
        `Unsupported export format: "${format}". Supported formats: obsidian`,
      );
  }
}

interface ExportedEntry {
  filename: string;
  subdir: 'learnings' | 'global-learnings';
  summary: string;
  tags: string[];
  projectName: string;
}

async function exportObsidian(
  vaultPath: string,
  options: { filter?: string },
): Promise<void> {
  // Create vault + subdirs
  const learningsSubdir = join(vaultPath, 'learnings');
  const globalLearningsSubdir = join(vaultPath, 'global-learnings');
  mkdirSync(vaultPath, { recursive: true });
  mkdirSync(learningsSubdir, { recursive: true });
  mkdirSync(globalLearningsSubdir, { recursive: true });

  const filter = options.filter;
  const exported: ExportedEntry[] = [];
  const projectEntryCounts = new Map<string, number>();

  // ── Walk per-project learnings ────────────────────────────────
  const projectsDir = join(engramRoot(), 'projects');
  let projectHashes: string[] = [];
  if (existsSync(projectsDir)) {
    try {
      projectHashes = readdirSync(projectsDir).filter((name) => {
        try {
          return statSync(join(projectsDir, name)).isDirectory();
        } catch {
          return false;
        }
      });
    } catch {
      projectHashes = [];
    }
  }

  for (const projectHash of projectHashes) {
    const kbPath = join(projectsDir, projectHash, 'knowledgebase.json');
    if (!existsSync(kbPath)) continue;

    // We don't have a rootPath; loadKnowledgeBase only needs filePath +
    // a fallback projectName for empty/corrupt cases. Use the hash as a
    // last-resort name. The on-disk projectName is preserved when present.
    const kb = loadKnowledgeBase(kbPath, projectHash);
    const projectName = kb.projectName || projectHash;
    const seenFilenames = new Set<string>();

    for (const entry of kb.entries) {
      if (!matchesFilter(entry.tags, filter)) continue;

      const filename = uniqueFilename(seenFilenames, entry.summary);
      const filePath = join(learningsSubdir, filename);
      writeFileSync(filePath, renderProjectLearning(entry, kb, projectName), 'utf-8');

      exported.push({
        filename,
        subdir: 'learnings',
        summary: entry.summary,
        tags: entry.tags,
        projectName,
      });
      projectEntryCounts.set(projectName, (projectEntryCounts.get(projectName) || 0) + 1);
    }
  }

  const perProjectCount = exported.length;

  // ── Walk global learnings ─────────────────────────────────────
  // Read directly via getRecentGlobalLearnings with a large n. If the
  // global file doesn't exist, this is an empty array.
  let globalEntries: GlobalLearning[] = [];
  if (existsSync(globalLearningsPath())) {
    globalEntries = getRecentGlobalLearnings(100_000);
  }

  const seenGlobalFilenames = new Set<string>();
  for (const entry of globalEntries) {
    if (!matchesFilter(entry.tags, filter)) continue;

    const filename = uniqueFilename(seenGlobalFilenames, entry.summary);
    const filePath = join(globalLearningsSubdir, filename);
    writeFileSync(filePath, renderGlobalLearning(entry), 'utf-8');

    exported.push({
      filename,
      subdir: 'global-learnings',
      summary: entry.summary,
      tags: entry.tags,
      projectName: entry.projectName,
    });
  }

  const globalCount = exported.length - perProjectCount;

  // ── Write index ──────────────────────────────────────────────
  writeFileSync(
    join(vaultPath, 'Engram Index.md'),
    renderIndex(exported, perProjectCount, globalCount, projectEntryCounts),
    'utf-8',
  );

  // Friendly summary (skip when running silently in tests — chalk safe either way)
  if (!process.env.ENGRAM_EXPORT_QUIET) {
    console.log(chalk.green('  ✓'), `Exported ${perProjectCount} per-project + ${globalCount} global learnings to ${vaultPath}`);
  }
}

/** True when the entry should be included given the (optional) tag filter. */
function matchesFilter(tags: string[], filter: string | undefined): boolean {
  if (!filter) return true;
  const wanted = filter.toLowerCase();
  return tags.some((t) => t.toLowerCase() === wanted);
}

/**
 * Sanitize a summary string into a filesystem-safe, Obsidian-friendly
 * filename. Lowercase, alphanumeric+dash only, truncated to 60 chars.
 */
function sanitizeFilename(summary: string): string {
  const base = summary
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base.length > 0 ? base : 'entry';
}

/** Ensure filename is unique within a vault subdir. */
function uniqueFilename(seen: Set<string>, summary: string): string {
  const base = sanitizeFilename(summary);
  let candidate = `${base}.md`;
  let i = 2;
  while (seen.has(candidate)) {
    candidate = `${base}-${i}.md`;
    i++;
  }
  seen.add(candidate);
  return candidate;
}

/** Strip a leading `#` from a tag for YAML frontmatter (Obsidian YAML tags don't carry it). */
function stripHash(tag: string): string {
  return tag.startsWith('#') ? tag.slice(1) : tag;
}

/** Ensure a tag has a leading `#` for inline use. */
function withHash(tag: string): string {
  return tag.startsWith('#') ? tag : `#${tag}`;
}

function renderProjectLearning(entry: KBEntry, _kb: KnowledgeBase, projectName: string): string {
  const yamlTags = entry.tags.map(stripHash).join(', ');
  const domains = entry.domains.join(', ');
  const inlineTags = entry.tags.map(withHash).join(' ');

  return `---
date: ${entry.date}
outcome: ${entry.outcome}
domains: [${domains}]
source_project: ${projectName}
tags: [${yamlTags}]
---

# ${entry.summary}

**Approach:** ${entry.approach}

**Lesson:** ${entry.lesson}

<!-- Tag links: [[#auth]] [[#stripe]] for Obsidian graph -->
${inlineTags}
`;
}

function renderGlobalLearning(entry: GlobalLearning): string {
  const yamlTags = entry.tags.map(stripHash).join(', ');
  const inlineTags = entry.tags.map(withHash).join(' ');
  const outcome = entry.outcome ?? 'unknown';

  return `---
date: ${entry.date}
outcome: ${outcome}
source_project: ${entry.projectName}
tags: [${yamlTags}]
---

# ${entry.summary}

**Lesson:** ${entry.lesson}

<!-- Tag links: [[#auth]] [[#stripe]] for Obsidian graph -->
${inlineTags}
`;
}

function renderIndex(
  exported: ExportedEntry[],
  perProjectCount: number,
  globalCount: number,
  projectEntryCounts: Map<string, number>,
): string {
  // Group entries by tag (normalize to leading #)
  const byTag = new Map<string, ExportedEntry[]>();
  for (const e of exported) {
    if (e.tags.length === 0) {
      const k = '#untagged';
      const arr = byTag.get(k) || [];
      arr.push(e);
      byTag.set(k, arr);
      continue;
    }
    for (const t of e.tags) {
      const k = withHash(t);
      const arr = byTag.get(k) || [];
      arr.push(e);
      byTag.set(k, arr);
    }
  }

  // Sort tags by entry count desc, then alpha
  const tagSections = [...byTag.entries()]
    .sort((a, b) => {
      if (b[1].length !== a[1].length) return b[1].length - a[1].length;
      return a[0].localeCompare(b[0]);
    });

  // Group per-project entries by projectName
  const perProjectByName = new Map<string, ExportedEntry[]>();
  for (const e of exported) {
    if (e.subdir !== 'learnings') continue;
    const arr = perProjectByName.get(e.projectName) || [];
    arr.push(e);
    perProjectByName.set(e.projectName, arr);
  }

  let out = `# Engram Knowledge Index

Generated ${new Date().toISOString()}. ${perProjectCount} per-project learnings + ${globalCount} global learnings.

## By tag

`;

  if (tagSections.length === 0) {
    out += `_No entries exported._\n\n`;
  } else {
    for (const [tag, entries] of tagSections) {
      out += `### ${tag} (${entries.length} entries)\n`;
      for (const entry of entries) {
        const linkPath = `${entry.subdir}/${entry.filename.replace(/\.md$/, '')}`;
        out += `- [[${linkPath}]]\n`;
      }
      out += '\n';
    }
  }

  out += `## All projects\n\n`;
  if (perProjectByName.size === 0) {
    out += `_No per-project learnings exported._\n`;
  } else {
    const projects = [...perProjectByName.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [project, entries] of projects) {
      const total = projectEntryCounts.get(project) ?? entries.length;
      const links = entries.map((e) => `[[learnings/${e.filename.replace(/\.md$/, '')}]]`).join(', ');
      out += `- ${project}: ${total} entries — ${links}\n`;
    }
  }

  return out;
}
