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
  'knit-brain': {
    command: 'npx',
    args: ['-y', 'knit-mcp@latest'],
  },
};

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
          writeFileSync(oldPath, JSON.stringify(old, null, 2), 'utf-8');
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
    console.log(chalk.bold('  Already set up. Open any project in Claude Code — the brain activates automatically.'));
    console.log();
    return;
  }

  mcpServers['knit-brain'] = MCP_CONFIG['knit-brain'];
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

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
      writeFileSync(globalClaudeMd, existing + knitInstruction, 'utf-8');
      console.log(`  ${chalk.green('✓')} Knit instructions added to ${chalk.cyan('~/.claude/CLAUDE.md')}`);
    }
  } else {
    const dir = join(homedir(), '.claude');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(globalClaudeMd, `# Claude Code Global Instructions${knitInstruction}`, 'utf-8');
    console.log(`  ${chalk.green('✓')} Created ${chalk.cyan('~/.claude/CLAUDE.md')} with Knit instructions`);
  }

  console.log();
  console.log(chalk.bold('  How it works'));
  console.log(`  ${chalk.cyan('1.')} Open ${chalk.bold('any project')} in Claude Code`);
  console.log(`  ${chalk.cyan('2.')} Agent calls \`knit_classify_task\` → brain auto-initializes`);
  console.log(`  ${chalk.cyan('3.')} Agent gets 35 tools: imports, exports, tests, learnings, teams`);
  console.log(`  ${chalk.cyan('4.')} Brain compounds with every session — gets smarter over time`);
  console.log();
  console.log(chalk.dim('  No CLI needed after this. The MCP server handles everything.'));
  console.log();

  if (isGlobal) {
    console.log(chalk.dim(`  Config written to: ${settingsPath}`));
  }
  console.log();
}
