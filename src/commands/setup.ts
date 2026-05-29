import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { writeFileAtomic } from '../engine/atomic-write.js';
import chalk from 'chalk';
import ora from 'ora';
import { runDoctor } from './doctor.js';
import { detectAllAgents, type AgentStatus } from '../engine/agent-detector.js';
import {
  writeCursorMcp,
  writeClineMcp,
  writeVscodeMcp,
  type WriteResult,
} from '../generators/agent-mcp-writers.js';
import { writeCodexMcp } from '../generators/codex-mcp.js';
import { writeContinueMcp } from '../generators/continue-mcp.js';
import { mergeAgentsMd } from '../generators/agents-md.js';

interface SetupOptions {
  global?: boolean;
  local?: boolean;
}

const MCP_CONFIG = {
  'knit-brain': {
    command: 'npx',
    args: ['-y', 'knit-mcp@latest'],
  },
};

/** Register Knit in every detected MCP-speaking agent other than Claude Code.
 *  Idempotent: writers no-op if Knit is already registered. Skipped agents
 *  (not present on this machine) are silently passed over. */
async function registerInOtherAgents(workspaceRoot: string): Promise<void> {
  const agents = detectAllAgents(workspaceRoot);
  const other = agents.filter((a) => a.agent !== 'claude-code' && a.present);
  if (other.length === 0) return;

  console.log();
  console.log(chalk.bold('  Detected additional MCP-speaking agents'));
  console.log();

  let writeAgentsMdFlag = false;
  for (const status of other) {
    const result = registerOne(status, workspaceRoot);
    const icon = result.error
      ? chalk.red('✗')
      : result.written
        ? chalk.green('✓')
        : chalk.dim('·');
    const verb = result.error
      ? chalk.red(`failed: ${result.error}`)
      : result.written
        ? `registered (${result.path.replace(homedir(), '~')})`
        : result.alreadyRegistered
          ? chalk.dim('already configured')
          : chalk.dim('skipped');
    console.log(`  ${icon} ${status.displayName.padEnd(28)} ${verb}`);

    // Codex CLI documents AGENTS.md; Cline auto-detects it. Write a
    // shared project-rules file when either is present so the agent
    // reads Knit protocol guidance even without hook enforcement.
    if ((status.agent === 'codex' || status.agent === 'cline') && status.present) {
      writeAgentsMdFlag = true;
    }
  }

  if (writeAgentsMdFlag) {
    const agentsMdPath = join(workspaceRoot, 'AGENTS.md');
    try {
      const projectName = basename(workspaceRoot);
      const existing = existsSync(agentsMdPath) ? readFileSync(agentsMdPath, 'utf-8') : '';
      const { content, mode } = mergeAgentsMd(existing, { projectName });
      if (content !== existing) {
        writeFileAtomic(agentsMdPath, content);
        const icon = chalk.green('✓');
        const verb = mode === 'replaced' ? 'updated existing AGENTS.md' : 'wrote AGENTS.md';
        console.log(`  ${icon} AGENTS.md${' '.repeat(20)} ${verb} (${agentsMdPath.replace(homedir(), '~')})`);
      }
    } catch (err) {
      console.log(`  ${chalk.yellow('⚠')} AGENTS.md${' '.repeat(20)} ${chalk.yellow(`skipped: ${(err as Error).message}`)}`);
    }
  }
}

interface AgentRegisterResult extends WriteResult {
  error?: string;
}

function registerOne(status: AgentStatus, workspaceRoot: string): AgentRegisterResult {
  // Each writer receives the user-level config path by default. The
  // workspace-level path is also written for agents where workspace
  // config is the common case (Cursor + Continue + VS Code).
  try {
    if (status.agent === 'cursor') {
      // Prefer workspace config when we have a workspace; fall back to user.
      const path = status.workspaceConfigPath ?? status.configPath;
      return writeCursorMcp(path);
    }
    if (status.agent === 'cline') {
      return writeClineMcp(status.configPath);
    }
    if (status.agent === 'codex') {
      return writeCodexMcp(status.configPath);
    }
    if (status.agent === 'continue') {
      // Continue uses one YAML file per server. Prefer workspace location
      // if the user has a workspace .continue/ already; else user-level.
      const wsDir = join(workspaceRoot, '.continue');
      const path = existsSync(wsDir)
        ? (status.workspaceConfigPath ?? status.configPath)
        : status.configPath;
      return writeContinueMcp(path);
    }
    if (status.agent === 'vscode') {
      // Workspace MCP is the common case for VS Code Agent mode in a repo;
      // fall back to user-level if no .vscode/ exists.
      const wsDir = join(workspaceRoot, '.vscode');
      const path = existsSync(wsDir)
        ? (status.workspaceConfigPath ?? status.configPath)
        : status.configPath;
      return writeVscodeMcp(path);
    }
    return { written: false, alreadyRegistered: false, path: status.configPath };
  } catch (err) {
    return {
      written: false,
      alreadyRegistered: false,
      path: status.configPath,
      error: (err as Error).message,
    };
  }
}

export async function setupCommand(options: SetupOptions): Promise<void> {
  const isGlobal = options.global || !options.local; // default to global

  // Claude Code reads MCP config from ~/.claude.json (NOT ~/.claude/settings.json)
  const settingsPath = isGlobal
    ? join(homedir(), '.claude.json')
    : join(process.cwd(), '.claude', 'settings.json');

  const label = isGlobal ? 'global (~/.claude.json)' : 'local (.claude/settings.json)';

  console.log(`  Adding Knit MCP to ${chalk.cyan(label)}`);
  console.log();

  const spinner = ora({ text: chalk.dim('Configuring...'), spinner: 'dots' }).start();

  // Migrate: clean up old wrong location if it exists
  if (isGlobal) {
    const oldPath = join(homedir(), '.claude', 'settings.json');
    if (existsSync(oldPath)) {
      try {
        const old = JSON.parse(readFileSync(oldPath, 'utf-8'));
        if (old.mcpServers?.['knit-brain']) {
          delete old.mcpServers['knit-brain'];
          if (Object.keys(old.mcpServers).length === 0) delete old.mcpServers;
          writeFileAtomic(oldPath, JSON.stringify(old, null, 2));
        }
      } catch { /* skip if can't read */ }
    }
  }

  // Read or create settings
  let settings: Record<string, unknown> = {};
  const dir = dirname(settingsPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    } catch {
      settings = {};
    }
  }

  // Add MCP server config
  if (!settings.mcpServers) settings.mcpServers = {};
  const mcpServers = settings.mcpServers as Record<string, unknown>;

  if (mcpServers['knit-brain']) {
    spinner.succeed(chalk.dim('Knit MCP already configured'));
    console.log();
    console.log(chalk.bold('  Already set up. Open any project in your MCP-speaking agent — the brain activates automatically.'));
    console.log();
    return;
  }

  mcpServers['knit-brain'] = MCP_CONFIG['knit-brain'];
  writeFileAtomic(settingsPath, JSON.stringify(settings, null, 2));

  spinner.succeed(chalk.dim('Knit MCP configured'));

  // Report
  console.log();
  console.log(chalk.bold('  Setup complete'));
  console.log();
  console.log(`  ${chalk.green('✓')} MCP server added to ${chalk.cyan(label)}`);
  console.log(`  ${chalk.green('✓')} Auto-initializes on first use — no per-project setup needed`);
  console.log();
  // Add Knit instructions to global CLAUDE.md so agent knows to use the tools
  const globalClaudeMd = join(homedir(), '.claude', 'CLAUDE.md');
  const knitInstruction = `\n\n## Knit Brain (MCP)\n\nYou have the Knit MCP server connected. USE IT on every task:\n\n1. **First:** Call \`knit_classify_task\` with files you plan to touch — get tier and phases\n2. **Research:** Call \`knit_build_context\` — get domain context with ripple effects\n3. **During:** Use \`knit_query_imports\`, \`knit_query_exports\`, \`knit_query_tests\` instead of grepping\n4. **End:** Call \`knit_record_learning\` before saying "done" — persist what you learned\n\nFor new projects, call \`knit_brain_status\` first — triggers auto-initialization.\n`;

  if (existsSync(globalClaudeMd)) {
    const existing = readFileSync(globalClaudeMd, 'utf-8');
    // Dedup against both the current "Knit Brain" heading and the legacy "Engram Brain" heading
    // so users upgrading from v0.5.x / v0.6.<3 don't get a duplicate block appended.
    if (!existing.includes('Knit Brain (MCP)') && !existing.includes('Engram Brain (MCP)')) {
      writeFileAtomic(globalClaudeMd, existing + knitInstruction);
      console.log(`  ${chalk.green('✓')} Knit instructions added to ${chalk.cyan('~/.claude/CLAUDE.md')}`);
    }
  } else {
    writeFileAtomic(globalClaudeMd, `# Claude Code Global Instructions${knitInstruction}`);
    console.log(`  ${chalk.green('✓')} Created ${chalk.cyan('~/.claude/CLAUDE.md')} with Knit instructions`);
  }

  // v0.14 — register Knit in every other detected MCP-speaking agent
  // (Cursor, Codex CLI, Cline, Continue, VS Code / GitHub Copilot).
  // Skips agents the user doesn't have installed. Idempotent: each
  // writer no-ops if Knit is already registered.
  await registerInOtherAgents(process.cwd());

  console.log();
  console.log(chalk.bold('  How it works'));
  console.log(`  ${chalk.cyan('1.')} Open ${chalk.bold('any project')} in your MCP-speaking agent (Claude Code, Cursor, Codex, Cline, Continue, Copilot)`);
  console.log(`  ${chalk.cyan('2.')} Agent calls \`knit_classify_task\` → brain auto-initializes`);
  console.log(`  ${chalk.cyan('3.')} Agent gets the tools it needs (up to 55, tier-gated by project shape)`);
  console.log(`  ${chalk.cyan('4.')} Brain compounds with every session — gets smarter over time`);
  console.log();
  console.log(`  ${chalk.bold('Next:')} run ${chalk.cyan('knit')} to open the brain dashboard (http://127.0.0.1:7421).`);
  console.log(chalk.dim('    No further setup required — the host launches the MCP server over stdio.'));
  console.log();

  if (isGlobal) {
    console.log(chalk.dim(`  Config written to: ${settingsPath}`));
  }
  console.log();

  // v0.12 — run doctor as final step. Non-fatal: setup completes even if the
  // user's project is over-budget, but they SEE the verdict immediately and
  // get the concrete fix command. Closes the "diagnostic without action" gap
  // that left v0.11.x users shipping over-budget without ever knowing.
  console.log(chalk.bold('  Install health check'));
  console.log();
  try {
    const report = runDoctor(process.cwd());
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
      console.log(chalk.red(`  ${errors} error(s) — run \`knit doctor\` for full details + fix commands.`));
    } else if (warnings > 0) {
      console.log(chalk.yellow(`  ${warnings} warning(s) — setup complete, but check items above.`));
    } else {
      console.log(chalk.green('  All checks passed — install is healthy.'));
    }
  } catch (err) {
    // Doctor should never throw, but if it does, don't fail setup.
    console.log(chalk.dim(`  (doctor skipped: ${(err as Error).message})`));
  }
  console.log();
}
