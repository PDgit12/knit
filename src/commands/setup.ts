import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import chalk from 'chalk';
import ora from 'ora';

interface SetupOptions {
  global?: boolean;
  local?: boolean;
}

const MCP_CONFIG = {
  'engram-brain': {
    command: 'npx',
    args: ['-y', '@piyushdua/engram-dev@latest'],
  },
};

export async function setupCommand(options: SetupOptions): Promise<void> {
  const isGlobal = options.global || !options.local; // default to global

  const settingsPath = isGlobal
    ? join(homedir(), '.claude', 'settings.json')
    : join(process.cwd(), '.claude', 'settings.json');

  const label = isGlobal ? 'global (~/.claude/settings.json)' : 'local (.claude/settings.json)';

  console.log(`  Adding Engram MCP to ${chalk.cyan(label)}`);
  console.log();

  const spinner = ora({ text: chalk.dim('Configuring...'), spinner: 'dots' }).start();

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

  if (mcpServers['engram-brain']) {
    spinner.succeed(chalk.dim('Engram MCP already configured'));
    console.log();
    console.log(chalk.bold('  Already set up. Open any project in Claude Code — the brain activates automatically.'));
    console.log();
    return;
  }

  mcpServers['engram-brain'] = MCP_CONFIG['engram-brain'];
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

  spinner.succeed(chalk.dim('Engram MCP configured'));

  // Report
  console.log();
  console.log(chalk.bold('  Setup complete'));
  console.log();
  console.log(`  ${chalk.green('✓')} MCP server added to ${chalk.cyan(label)}`);
  console.log(`  ${chalk.green('✓')} Auto-initializes on first use — no per-project setup needed`);
  console.log();
  console.log(chalk.bold('  How it works'));
  console.log(`  ${chalk.cyan('1.')} Open ${chalk.bold('any project')} in Claude Code`);
  console.log(`  ${chalk.cyan('2.')} Engram detects the project, builds the knowledge brain`);
  console.log(`  ${chalk.cyan('3.')} Agent gets 19 tools: imports, exports, tests, learnings, teams`);
  console.log(`  ${chalk.cyan('4.')} Brain compounds with every session — gets smarter over time`);
  console.log();
  console.log(chalk.dim('  No CLI needed after this. The MCP server handles everything.'));
  console.log();

  if (isGlobal) {
    console.log(chalk.dim(`  Config written to: ${settingsPath}`));
  }
  console.log();
}
