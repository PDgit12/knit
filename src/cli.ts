#!/usr/bin/env node

import { Command } from 'commander';
import gradient from 'gradient-string';
import chalk from 'chalk';
import { setupCommand } from './commands/setup.js';
import { statusCommand } from './commands/status.js';
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
  .description('Engram — the second brain for AI coding agents. MCP server + analytics dashboard.')
  .version('0.1.0')
  .hook('preAction', () => {
    showBanner();
  });

program
  .command('setup')
  .description('Add Engram MCP to your Claude Code settings (one time, ever)')
  .option('--global', 'Add to global ~/.claude/settings.json (recommended)', false)
  .option('--local', 'Add to project .claude/settings.json only', false)
  .action(async (options: Record<string, unknown>) => {
    try {
      await setupCommand(options);
    } catch (error) {
      console.error(chalk.red('  Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Dashboard — session history, learnings, hit rate, knowledge health')
  .argument('[directory]', 'Project directory', '.')
  .action(async (directory: string) => {
    try {
      await statusCommand(directory);
    } catch (error) {
      console.error(chalk.red('  Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('refresh')
  .description('Force rebuild knowledge index and CLAUDE.md')
  .argument('[directory]', 'Project directory', '.')
  .action(async (directory: string) => {
    try {
      await refreshCommand(directory);
    } catch (error) {
      console.error(chalk.red('  Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program.parse();
