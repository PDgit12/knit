/**
 * Agent-command auto-detection — scans each MCP-speaking agent's
 * filesystem location for user-defined slash commands / custom prompts
 * and surfaces them so the agent can invoke them at the right protocol
 * phase instead of re-describing the work.
 *
 * Hard contract:
 *   - Read-only filesystem operations. Never writes to user agent config.
 *   - Never executes commands. Knit surfaces; the agent invokes via its
 *     own slash-command mechanism.
 *   - Best-effort. Permission errors / parse failures are silenced per
 *     directory (we skip the offender, not the whole scan).
 *   - Cache at ~/.knit/projects/<hash>/agent-commands.json with a 1-hour
 *     TTL. Re-scan on every brain load if stale; cheap (~10ms over a
 *     handful of files).
 *
 * Per-agent locations (matrix from the universality audit):
 *
 *   Claude Code  → .claude/commands/*.md   (+ ~/.claude/commands/*.md)
 *   Cursor       → .cursor/rules/*.mdc
 *   Cline        → .clinerules/*.md|*.txt  (directory at project root)
 *   Codex CLI    → ~/.codex/prompts/*.md   (best-effort; not pinned in fetched docs)
 *   Continue     → ~/.continue/prompts/*.prompt
 *   Copilot/VS   → .github/prompts/*.md    (community convention)
 *
 * Frontmatter convention honored where present:
 *   description: "..."          → used as the command's hint text
 *   knit: skip                  → command excluded from scan results
 *
 * Format-agnostic: we read the first markdown heading or the first
 * non-blank line as a fallback for the description when no frontmatter
 * is present.
 */

import { readFileSync, readdirSync, existsSync, lstatSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join, basename, extname, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { AgentId } from './agent-detector.js';

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_COMMAND_TEXT_BYTES = 4000; // truncate huge prompts before caching

export interface AgentCommand {
  /** Lower-cased slug derived from the file's basename (no extension). */
  name: string;
  /** Absolute path to the source file. */
  sourcePath: string;
  /** Optional one-line description, from frontmatter or first heading. */
  description?: string;
  /** The agent whose command directory this file lived in. */
  agent: AgentId;
  /** Truncated body for display in the dashboard / suggestion responses. */
  commandText: string;
  /** True if the file's frontmatter contained `knit: skip`. */
  knitSkip: boolean;
}

export interface ScanResult {
  scannedAt: string;
  ttlMs: number;
  workspace: string;
  commands: AgentCommand[];
}

// ─── Per-agent directory roots ──────────────────────────────────────────

/** Slash-command directories to scan per agent. Each tuple is
 *  (directory, file-extensions-to-include). User-level and workspace-level
 *  paths are scanned for each agent that supports both. */
function commandRootsFor(agent: AgentId, workspaceRoot: string): Array<{ dir: string; exts: string[] }> {
  switch (agent) {
    case 'claude-code':
      return [
        { dir: join(workspaceRoot, '.claude', 'commands'), exts: ['.md'] },
        { dir: join(homedir(), '.claude', 'commands'), exts: ['.md'] },
      ];
    case 'cursor':
      return [{ dir: join(workspaceRoot, '.cursor', 'rules'), exts: ['.mdc', '.md'] }];
    case 'cline':
      return [{ dir: join(workspaceRoot, '.clinerules'), exts: ['.md', '.txt'] }];
    case 'codex':
      // Best-effort — Codex prompts location not pinned in fetched docs.
      // Try both ~/.codex/prompts/ and workspace .codex/prompts/.
      return [
        { dir: join(homedir(), '.codex', 'prompts'), exts: ['.md', '.prompt'] },
        { dir: join(workspaceRoot, '.codex', 'prompts'), exts: ['.md', '.prompt'] },
      ];
    case 'continue':
      return [
        { dir: join(homedir(), '.continue', 'prompts'), exts: ['.prompt', '.md'] },
        { dir: join(workspaceRoot, '.continue', 'prompts'), exts: ['.prompt', '.md'] },
      ];
    case 'vscode':
      return [{ dir: join(workspaceRoot, '.github', 'prompts'), exts: ['.md', '.prompt.md'] }];
  }
}

/** v0.19 — Claude Code Skills (2026) live at `.claude/skills/<name>/SKILL.md`,
 *  one folder per skill, and are invokable as slash commands. They're a
 *  separate surface from flat `.claude/commands/*.md`, so scan them too — Knit
 *  composes with the user's authored skills the same way it defers to their
 *  slash commands. Workspace + user level, claude-code only for now. */
function skillRootsFor(agent: AgentId, workspaceRoot: string): string[] {
  if (agent !== 'claude-code') return [];
  return [
    join(workspaceRoot, '.claude', 'skills'),
    join(homedir(), '.claude', 'skills'),
  ];
}

/** List `<skillsDir>/<name>/SKILL.md` paths (one nesting level — skills are
 *  folders, not flat files, so listFiles can't see them). */
function listSkillFiles(skillsDir: string): string[] {
  try {
    if (!existsSync(skillsDir)) return [];
    const out: string[] = [];
    for (const name of readdirSync(skillsDir)) {
      // Reject a symlinked skill folder (lstat) before descending — otherwise
      // a `skills/evil -> /etc` symlink would let us read /etc/SKILL.md.
      try {
        const dirStat = lstatSync(join(skillsDir, name));
        if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) continue;
      } catch {
        continue;
      }
      const skillFile = join(skillsDir, name, 'SKILL.md');
      if (isSafeCommandFile(skillFile)) out.push(skillFile);
    }
    return out;
  } catch {
    return [];
  }
}

// ─── Parsing ────────────────────────────────────────────────────────────

interface ParsedCommand {
  description?: string;
  knitSkip: boolean;
  body: string;
}

/** Parse a single command file. Recognizes optional YAML frontmatter
 *  delimited by `---\n` ... `\n---\n`. Looks for `description:` and
 *  `knit: skip` fields. Falls back to the first markdown heading or
 *  first non-blank line for description. */
export function parseCommandFile(text: string): ParsedCommand {
  let description: string | undefined;
  let knitSkip = false;
  let body = text;

  if (text.startsWith('---\n')) {
    const end = text.indexOf('\n---\n', 4);
    if (end !== -1) {
      const frontmatter = text.slice(4, end);
      body = text.slice(end + 5);
      // Trivial line-based parser — sufficient for our two fields.
      for (const line of frontmatter.split('\n')) {
        const m = /^(\w[\w-]*):\s*(.*?)\s*$/.exec(line);
        if (!m) continue;
        const [, key, rawValue] = m;
        // Strip surrounding quotes if present.
        const value = rawValue.replace(/^["'](.*)["']$/, '$1');
        if (key === 'description') description = value;
        if (key === 'knit' && value === 'skip') knitSkip = true;
      }
    }
  }

  if (!description) {
    // Fallback: first markdown heading (# Foo) or first non-blank line.
    for (const line of body.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const headingMatch = /^#+\s+(.+)$/.exec(trimmed);
      description = headingMatch ? headingMatch[1] : trimmed;
      // Cap description length for sane display.
      if (description.length > 200) description = description.slice(0, 197) + '…';
      break;
    }
  }

  // Audit D2 — the description is surfaced into the agent's context via MCP
  // responses, and a hostile repo's command/skill file could pack multi-line
  // pseudo-instructions into it. Collapse to a single clean line (strip control
  // chars + newlines) so it can't masquerade as agent directives. It's meant to
  // be a one-line summary anyway.
  if (description) {
    // eslint-disable-next-line no-control-regex
    description = description.replace(/[\x00-\x1F\x7F]+/g, " ").replace(/\s+/g, " ").trim();
    if (description.length > 200) description = description.slice(0, 197) + "\u2026";
  }

  return { description, knitSkip, body };
}

// ─── Scanning ──────────────────────────────────────────────────────────

/** Hard cap on a command/skill file's on-disk size. These are short prompt
 *  docs; anything larger is malformed or hostile. Audit D2 (v0.19): guard
 *  BEFORE readFileSync so a 500MB SKILL.md in a cloned repo can't OOM the
 *  process, and use lstat so a symlinked SKILL.md → ~/.ssh/id_rsa can't be
 *  read into brain state. */
const MAX_COMMAND_FILE_BYTES = 64 * 1024;

/** Safe to read as a command/skill file? Rejects symlinks (lstat — a symlink
 *  is not isFile()), non-regular files, and oversized files. */
function isSafeCommandFile(path: string): boolean {
  try {
    const st = lstatSync(path);
    return st.isFile() && !st.isSymbolicLink() && st.size <= MAX_COMMAND_FILE_BYTES;
  } catch {
    return false;
  }
}

function listFiles(dir: string, exts: string[]): string[] {
  try {
    if (!existsSync(dir)) return [];
    const entries = readdirSync(dir);
    return entries
      .filter((name) => isSafeCommandFile(join(dir, name)) && exts.some((e) => name.endsWith(e)))
      .map((name) => join(dir, name));
  } catch {
    return [];
  }
}

function scanAgent(agent: AgentId, workspaceRoot: string): AgentCommand[] {
  const out: AgentCommand[] = [];
  for (const { dir, exts } of commandRootsFor(agent, workspaceRoot)) {
    for (const path of listFiles(dir, exts)) {
      try {
        const text = readFileSync(path, 'utf-8');
        const parsed = parseCommandFile(text);
        if (parsed.knitSkip) continue;
        // Derive name from filename, stripping every known extension.
        let name = basename(path);
        for (const e of exts) {
          if (name.endsWith(e)) { name = name.slice(0, -e.length); break; }
        }
        // Some file types stack two extensions (e.g. foo.prompt.md).
        // Strip a second one if it's a known doc extension.
        const second = extname(name);
        if (['.prompt', '.md'].includes(second)) name = name.slice(0, -second.length);
        const commandText = parsed.body.slice(0, MAX_COMMAND_TEXT_BYTES);
        out.push({
          name: name.toLowerCase(),
          sourcePath: path,
          description: parsed.description,
          agent,
          commandText,
          knitSkip: false,
        });
      } catch {
        // Best-effort: skip individual files we can't read/parse.
      }
    }
  }
  // v0.19 — also surface Claude Code Skills (folder-per-skill SKILL.md).
  for (const skillsDir of skillRootsFor(agent, workspaceRoot)) {
    for (const path of listSkillFiles(skillsDir)) {
      try {
        const text = readFileSync(path, 'utf-8');
        const parsed = parseCommandFile(text);
        if (parsed.knitSkip) continue;
        out.push({
          name: basename(dirname(path)).toLowerCase(), // skill = its folder name
          sourcePath: path,
          description: parsed.description,
          agent,
          commandText: parsed.body.slice(0, MAX_COMMAND_TEXT_BYTES),
          knitSkip: false,
        });
      } catch {
        // Best-effort: skip skills we can't read/parse.
      }
    }
  }
  return out;
}

/** Scan all agent command directories. Pass the workspace root (project
 *  cwd) so workspace-level slash-command dirs (.claude/commands/,
 *  .clinerules/, .cursor/rules/, etc.) are included alongside user-level
 *  ones. Read-only; safe to call any time. */
export function scanAllAgentCommands(workspaceRoot: string = process.cwd()): ScanResult {
  const agents: AgentId[] = ['claude-code', 'cursor', 'cline', 'codex', 'continue', 'vscode'];
  const commands: AgentCommand[] = [];
  for (const agent of agents) {
    commands.push(...scanAgent(agent, workspaceRoot));
  }
  return {
    scannedAt: new Date().toISOString(),
    ttlMs: CACHE_TTL_MS,
    workspace: workspaceRoot,
    commands,
  };
}

// ─── Cache (per-project) ───────────────────────────────────────────────

/** Path to the per-project agent-commands cache. Lives alongside the
 *  knowledgebase + sessions so all per-project state co-locates. */
export function agentCommandsCachePath(projectDataDir: string): string {
  return join(projectDataDir, 'agent-commands.json');
}

/** Load the cached scan if it exists AND is younger than the TTL. Returns
 *  null otherwise. Read-only; safe to call any time. */
export function loadCachedScan(projectDataDir: string): ScanResult | null {
  const path = agentCommandsCachePath(projectDataDir);
  try {
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as ScanResult;
    if (!parsed.scannedAt) return null;
    const age = Date.now() - Date.parse(parsed.scannedAt);
    if (!Number.isFinite(age) || age < 0 || age > parsed.ttlMs) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Persist a fresh scan to the cache. Atomic via temp+rename so a
 *  concurrent reader never sees a half-written file. */
export function saveScan(projectDataDir: string, scan: ScanResult): void {
  try {
    if (!existsSync(projectDataDir)) mkdirSync(projectDataDir, { recursive: true });
    const path = agentCommandsCachePath(projectDataDir);
    const tmp = `${path}.tmp.${process.pid}`;
    writeFileSync(tmp, JSON.stringify(scan, null, 2), 'utf-8');
    renameSync(tmp, path);
  } catch {
    // Best-effort: caching is an optimization, not load-bearing.
  }
}

/** Get a fresh-or-cached scan. If cached AND within TTL, return cached.
 *  Otherwise scan, cache, return. */
export function getAgentCommands(workspaceRoot: string, projectDataDir: string): ScanResult {
  const cached = loadCachedScan(projectDataDir);
  if (cached && cached.workspace === workspaceRoot) return cached;
  const fresh = scanAllAgentCommands(workspaceRoot);
  saveScan(projectDataDir, fresh);
  return fresh;
}

// ─── Phase-name → command matcher ───────────────────────────────────────

/** Synonyms for each protocol phase. Used by knit_suggest_command to
 *  fuzz-match a phase name against the user's actual command names. */
const PHASE_SYNONYMS: Record<string, string[]> = {
  test:    ['test', 'tests', 'testing', 'spec'],
  lint:    ['lint', 'linter', 'lint-fix', 'format', 'prettier'],
  review:  ['review', 'code-review', 'pr-review', 'reviewer'],
  ship:    ['ship', 'release', 'publish', 'deploy'],
  build:   ['build', 'compile', 'bundle'],
  typecheck: ['typecheck', 'tsc', 'type-check'],
  audit:   ['audit', 'security', 'security-audit'],
  // The fall-through case: exact-match the phase name itself.
};

/** Suggest user-defined commands matching a given phase. Returns commands
 *  whose `name` matches any synonym for the phase (case-insensitive,
 *  substring). The first hit per agent is enough — slash-command
 *  invocation is single-shot, no need to list every variant. */
export function suggestCommandsForPhase(scan: ScanResult, phase: string): AgentCommand[] {
  const lowerPhase = phase.toLowerCase();
  const synonyms = PHASE_SYNONYMS[lowerPhase] ?? [lowerPhase];
  const matches: AgentCommand[] = [];
  for (const cmd of scan.commands) {
    if (synonyms.some((s) => cmd.name === s || cmd.name.includes(s))) {
      matches.push(cmd);
    }
  }
  return matches;
}

// ─── Convenience for handlers + dashboard ──────────────────────────────

/** Compact summary for UI listings. */
export interface AgentCommandSummary {
  name: string;
  agent: AgentId;
  description?: string;
  sourcePath: string;
}

export function summarize(commands: AgentCommand[]): AgentCommandSummary[] {
  return commands.map(({ name, agent, description, sourcePath }) => ({
    name, agent, description, sourcePath,
  }));
}

/** Re-export dirname so callers can compute the project data dir
 *  without a separate import. Pure helper — same as node:path's dirname. */
export { dirname };
