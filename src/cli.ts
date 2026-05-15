#!/usr/bin/env node

import { Command } from 'commander';
import gradient from 'gradient-string';
import chalk from 'chalk';
import { initCommand } from './commands/init.js';
import { refreshCommand } from './commands/refresh.js';

const ENGRAM_GRADIENT = gradient(['#7c3aed', '#2563eb', '#06b6d4']);

function showBanner(): void {
  const banner = `
  ╔═══════════════════════════════════════╗
  ║                                       ║
  ║   ███████╗███╗   ██╗ ██████╗         ║
  ║   ██╔════╝████╗  ██║██╔════╝         ║
  ║   █████╗  ██╔██╗ ██║██║  ███╗        ║
  ║   ██╔══╝  ██║╚██╗██║██║   ██║        ║
  ║   ███████╗██║ ╚████║╚██████╔╝        ║
  ║   ╚══════╝╚═╝  ╚═══╝ ╚═════╝         ║
  ║                                       ║
  ║   engram — memory for AI agents       ║
  ║                                       ║
  ╚═══════════════════════════════════════╝`;

  console.log(ENGRAM_GRADIENT.multiline(banner));
  console.log();
}

const program = new Command();

program
  .name('engram')
  .description('Agent memory & workflow intelligence — compounding project intelligence for AI coding agents')
  .version('0.1.0')
  .hook('preAction', (thisCommand) => {
    if (thisCommand.args[0] !== 'help') {
      showBanner();
    }
  });

program
  .command('init')
  .description('Initialize Engram workflow in a project')
  .argument('[directory]', 'Target project directory', '.')
  .option('--agent <type>', 'Target agent: claude-code, cursor, codex', 'claude-code')
  .option('--force', 'Overwrite existing files', false)
  .option('--name <name>', 'Project name (auto-detected if not specified)')
  .action(async (directory: string, options: Record<string, unknown>) => {
    try {
      await initCommand(directory, options);
    } catch (error) {
      console.error(chalk.red('  Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('refresh')
  .description('Re-scan project, rebuild knowledge index, update CLAUDE.md')
  .argument('[directory]', 'Target project directory', '.')
  .action(async (directory: string) => {
    try {
      await refreshCommand(directory);
    } catch (error) {
      console.error(chalk.red('  Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Show workflow health and learnings summary')
  .action(() => {
    console.log(chalk.dim('  Coming in v0.2 — learnings count, domain coverage, token savings'));
  });

program
  .command('learn')
  .description('Manually add a learning entry')
  .action(() => {
    console.log(chalk.dim('  Coming in v0.2 — interactive learning entry creation'));
  });

program.parse();
