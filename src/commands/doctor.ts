/**
 * v0.11.2 — `knit doctor` install health check.
 *
 * One command to answer: is my Knit install OK?
 *
 * Reports installed version, Node version, current HOOKS_VERSION (the
 * code-level constant), per-project hook version (from
 * settings.local.json), MCP registration state in ~/.claude.json,
 * knowledgebase health, and broken-symlink detection.
 *
 * Exit code: 0 on healthy, 1 on any error-level finding. Warnings do
 * not fail the exit so users can run `knit doctor` in CI and still
 * pass on a fresh project (no settings.local.json yet is a warning,
 * not an error).
 */

import { existsSync, lstatSync, readFileSync, statSync, accessSync, constants as fsConstants } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HOOKS_VERSION } from '../generators/settings.js';
import { knowledgebasePath, projectDataDir, projectAgentsDir } from '../engine/paths.js';
import { VERSION } from '../version.js';
import { CLAUDE_MD_BUDGET_BYTES } from '../mcp/instructions.js';
import { detectAllAgents } from '../engine/agent-detector.js';
import { scanProject } from '../engine/scanner.js';
import { sessionCount } from '../engine/sessions.js';
import { loadEnabledFeatures } from '../mcp/handlers.js';
import { summarizeActiveTools, type ProjectShape } from '../mcp/features.js';

export type DoctorStatus = 'ok' | 'warn' | 'error' | 'info';

export interface DoctorCheck {
  name: string;
  status: DoctorStatus;
  detail: string;
}

export interface DoctorReport {
  version: string;
  nodeVersion: string;
  hooksVersion: number;
  rootPath: string;
  checks: DoctorCheck[];
}

/** Run the doctor and return a structured report. Pure: no IO outside
 *  read-only checks; no process.exit. Caller renders + decides exit. */
export function runDoctor(rootPath: string): DoctorReport {
  const checks: DoctorCheck[] = [];

  // ── MCP registration per agent (v0.14 — covers all 6 MCP-speaking agents) ──
  // The original v0.13 doctor only checked ~/.claude.json. Now we surface
  // a row per agent so users with Cursor / Codex / Cline / Continue / VS
  // Code can see which ones are wired up at a glance.
  const agents = detectAllAgents(rootPath);
  for (const a of agents) {
    const name = `MCP — ${a.displayName}`;
    if (!a.present) {
      checks.push({
        name,
        status: 'info',
        detail: 'not detected on this machine',
      });
      continue;
    }
    if (a.registered) {
      checks.push({
        name,
        status: 'ok',
        detail: `knit-brain present in ${a.configPath.replace(homedir(), '~')}`,
      });
    } else {
      checks.push({
        name,
        status: 'warn',
        detail: `detected but not registered — run \`knit setup\` to add Knit to ${a.configPath.replace(homedir(), '~')}`,
      });
    }
  }

  // ── Project data dir ──
  // v0.12.1 — explicitly probe write access. Pre-v0.12.1 we only checked
  // existence; a read-only ~/.knit (shared homes, network mounts, restored
  // backups with wrong perms) would pass doctor green, then the very first
  // MCP call would fail with an opaque EACCES. Surface the real state up
  // front so the user can chmod before opening Claude Code.
  const dataDir = projectDataDir(rootPath);
  if (existsSync(dataDir)) {
    try {
      accessSync(dataDir, fsConstants.W_OK);
      checks.push({ name: 'Project data dir', status: 'ok', detail: dataDir });
    } catch (err) {
      checks.push({
        name: 'Project data dir',
        status: 'error',
        detail: `${dataDir} exists but is not writable (${(err as NodeJS.ErrnoException).code ?? 'EACCES'}) — fix with: chmod -R u+w "${dataDir}"`,
      });
    }
  } else {
    // Probe the nearest existing ancestor's write permission so we know
    // whether the data dir can actually be created on first MCP call.
    let probeDir = dataDir;
    while (probeDir && !existsSync(probeDir)) {
      const parent = join(probeDir, '..');
      if (parent === probeDir) break;
      probeDir = parent;
    }
    try {
      if (probeDir) accessSync(probeDir, fsConstants.W_OK);
      checks.push({
        name: 'Project data dir',
        status: 'info',
        detail: `${dataDir} — will be created on first MCP call`,
      });
    } catch (err) {
      checks.push({
        name: 'Project data dir',
        status: 'error',
        detail: `cannot create ${dataDir} — parent ${probeDir} is not writable (${(err as NodeJS.ErrnoException).code ?? 'EACCES'}). Fix with: chmod u+w "${probeDir}"`,
      });
    }
  }

  // ── HOOKS_VERSION in settings.local.json ──
  const settingsPath = join(rootPath, '.claude', 'settings.local.json');
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as { _knitHooks?: { version?: number } };
      const projectHV = settings._knitHooks?.version ?? 0;
      if (projectHV === HOOKS_VERSION) {
        checks.push({
          name: 'Hooks version',
          status: 'ok',
          detail: `project at HOOKS_VERSION ${HOOKS_VERSION} (current)`,
        });
      } else if (projectHV < HOOKS_VERSION) {
        checks.push({
          name: 'Hooks version',
          status: 'warn',
          detail: `project at ${projectHV}, current ${HOOKS_VERSION} — will auto-upgrade on next MCP call`,
        });
      } else {
        checks.push({
          name: 'Hooks version',
          status: 'warn',
          detail: `project at ${projectHV}, code at ${HOOKS_VERSION} — possible stale install (npm i -g knit-mcp@latest)`,
        });
      }
    } catch (err) {
      checks.push({
        name: 'Hooks version',
        status: 'warn',
        detail: `settings.local.json unreadable: ${(err as Error).message}`,
      });
    }
  } else {
    checks.push({
      name: 'Hooks version',
      status: 'info',
      detail: 'no settings.local.json yet — created on first MCP call',
    });
  }

  // ── Knowledge base ──
  const kbPath = knowledgebasePath(rootPath);
  if (existsSync(kbPath)) {
    try {
      const kb = JSON.parse(readFileSync(kbPath, 'utf-8')) as { entries?: unknown[]; version?: number };
      const entries = Array.isArray(kb.entries) ? kb.entries.length : 0;
      checks.push({
        name: 'Knowledge base',
        status: 'ok',
        detail: `${entries} learning(s), schema v${kb.version ?? '?'}`,
      });
    } catch (err) {
      checks.push({
        name: 'Knowledge base',
        status: 'error',
        detail: `unreadable: ${(err as Error).message} — knit will refuse to overwrite, manual repair needed`,
      });
    }
  } else {
    checks.push({ name: 'Knowledge base', status: 'info', detail: 'no learnings yet (fresh project)' });
  }

  // ── Broken symlinks — common after team-worktree-style workflows ──
  for (const f of ['node_modules', '.knit', 'dist']) {
    const p = join(rootPath, f);
    try {
      const lst = lstatSync(p);
      if (lst.isSymbolicLink()) {
        try {
          statSync(p); // throws ENOENT if target doesn't exist
        } catch {
          checks.push({
            name: `Symlink ${f}`,
            status: 'error',
            detail: `${p} is a dangling symlink — delete it (rm ${p}) and reinstall`,
          });
        }
      }
    } catch {
      // missing entry — fine, no symlink to check
    }
  }

  // ── Token budget (v0.12) — CLAUDE.md size vs 6.5KB target ──
  // The structural enforcement: doctor exits non-zero if CLAUDE.md is
  // over 25% past target. Bridges "diagnostic only" (brain_status) →
  // "blocks setup completion" (exit 1).
  const claudeMdPath = join(rootPath, 'CLAUDE.md');
  if (existsSync(claudeMdPath)) {
    try {
      const bytes = statSync(claudeMdPath).size;
      const kb = Math.round(bytes / 1024 * 10) / 10;
      const targetKb = Math.round(CLAUDE_MD_BUDGET_BYTES / 1024 * 10) / 10;
      if (bytes <= CLAUDE_MD_BUDGET_BYTES) {
        checks.push({
          name: 'Token budget',
          status: 'ok',
          detail: `CLAUDE.md ${kb}KB / ${targetKb}KB target — healthy`,
        });
      } else if (bytes <= CLAUDE_MD_BUDGET_BYTES * 1.25) {
        checks.push({
          name: 'Token budget',
          status: 'warn',
          detail: `CLAUDE.md ${kb}KB / ${targetKb}KB target — over budget, within 25% slack. Run \`knit refresh\` or trim the file.`,
        });
      } else {
        checks.push({
          name: 'Token budget',
          status: 'error',
          detail: `CLAUDE.md ${kb}KB / ${targetKb}KB target — over budget by >25%. Trim CLAUDE.md (move long-form release notes / marketing prose to a sidecar file outside the Knit-managed block) or run \`knit refresh\` to regenerate.`,
        });
      }
    } catch (err) {
      checks.push({
        name: 'Token budget',
        status: 'warn',
        detail: `CLAUDE.md unreadable: ${(err as Error).message}`,
      });
    }
  } else {
    checks.push({
      name: 'Token budget',
      status: 'info',
      detail: 'no CLAUDE.md yet — created on first MCP call',
    });
  }

  // ── Webapp bundle (v0.19) — can `knit ui` actually launch? ──
  // "knit ui does nothing" is almost always a stale install missing
  // webapp/dist, not a code bug. Surface whether the bundle resolves from
  // THIS binary's location so the user can tell a broken install from a
  // missed terminal line. Mirrors the candidate resolution in ui.ts.
  {
    const uiHere = dirname(fileURLToPath(import.meta.url));
    const webappCandidates = [
      resolve(uiHere, '../../webapp/dist'), // dev: src/commands/ -> ../../webapp/dist
      resolve(uiHere, '../webapp/dist'),    // installed: dist/ -> ../webapp/dist
    ];
    const found = webappCandidates.find((p) => existsSync(join(p, 'index.html')));
    if (found) {
      checks.push({
        name: 'Webapp bundle',
        status: 'ok',
        detail: '`knit ui` will serve http://127.0.0.1:7421 (set KNIT_UI_PORT to change). If the browser does not auto-open, visit that URL.',
      });
    } else {
      checks.push({
        name: 'Webapp bundle',
        status: 'error',
        detail: `webapp/dist not found near ${uiHere} — \`knit ui\` cannot launch. Fix: reinstall with \`npm i -g knit-mcp@latest\` (clear stale npx cache: rm -rf ~/.npm/_npx), or from source run \`cd webapp && npm install && npm run build\`.`,
      });
    }
  }

  // ── Active tools (v0.17) — live, reasoned count ──
  // The count varies with project shape (domain count, subagents present,
  // first-vs-later session), which is exactly why users saw 37/43/45 across
  // machines and assumed something was broken. Surface the live number WITH
  // the reason so it's self-explanatory. All inputs are read-only.
  try {
    const scan = scanProject(rootPath);
    const shape: ProjectShape = {
      // hasAnalyzableCode is NOT read by isToolActive/summarizeActiveTools, so
      // it never moves the count — kept here only to satisfy ProjectShape.
      // domainCount is the count-driving signal and matches detectProjectShape
      // (both resolve to scan.domains.length) so doctor agrees with
      // knit_list_features at steady state.
      hasAnalyzableCode: scan.domains.length > 0,
      domainCount: scan.domains.length,
      hasInstalledSubagents: existsSync(projectAgentsDir(rootPath)),
      sessionCount: sessionCount(rootPath),
      enabledFeatures: loadEnabledFeatures(rootPath),
    };
    checks.push({ name: 'Active tools', status: 'info', detail: summarizeActiveTools(shape) });
  } catch (err) {
    checks.push({
      name: 'Active tools',
      status: 'warn',
      detail: `could not compute active tool count: ${(err as Error).message}`,
    });
  }

  // ── Node version sanity check ──
  const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
  if (Number.isFinite(nodeMajor) && nodeMajor < 18) {
    checks.push({
      name: 'Node version',
      status: 'error',
      detail: `Node ${process.version} — Knit requires Node 18+. Upgrade your runtime.`,
    });
  } else {
    checks.push({
      name: 'Node version',
      status: 'ok',
      detail: process.version,
    });
  }

  return {
    version: VERSION,
    nodeVersion: process.version,
    hooksVersion: HOOKS_VERSION,
    rootPath,
    checks,
  };
}

/** CLI entry point — renders the report + sets exit code. */
export async function doctorCommand(directory: string): Promise<void> {
  const chalk = (await import('chalk')).default;
  const root = resolve(directory);
  const report = runDoctor(root);

  console.log(chalk.bold(`Knit doctor — install health for ${root}`));
  console.log();
  console.log(`  ${chalk.dim('Version:').padEnd(24)} ${report.version}`);
  console.log(`  ${chalk.dim('Node:').padEnd(24)} ${report.nodeVersion}`);
  console.log(`  ${chalk.dim('HOOKS_VERSION (code):').padEnd(24)} ${report.hooksVersion}`);
  console.log();

  for (const c of report.checks) {
    const icon =
      c.status === 'ok' ? chalk.green('✓')
      : c.status === 'warn' ? chalk.yellow('⚠')
      : c.status === 'error' ? chalk.red('✗')
      : chalk.gray('·');
    console.log(`  ${icon} ${c.name.padEnd(22)} ${chalk.dim(c.detail)}`);
  }

  const errors = report.checks.filter((c) => c.status === 'error').length;
  const warnings = report.checks.filter((c) => c.status === 'warn').length;
  console.log();
  if (errors > 0) {
    console.log(chalk.red(`  ${errors} error(s) — install is broken. See above.`));
    process.exit(1);
  } else if (warnings > 0) {
    console.log(chalk.yellow(`  ${warnings} warning(s) — install is OK but check items above.`));
  } else {
    console.log(chalk.green('  All checks passed — install is healthy.'));
  }
}
