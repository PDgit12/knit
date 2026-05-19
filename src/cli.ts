#!/usr/bin/env node

/**
 * knit — the second brain for Claude Code.
 *
 * Single entry point:
 *   knit setup    → add MCP to Claude settings
 *   knit status   → analytics dashboard
 *   knit refresh  → rebuild knowledge brain
 *   knit (no args, called by Claude Code) → start MCP server
 */

import { Command } from 'commander';
import { VERSION } from './version.js';

const args = process.argv.slice(2);
const hasSubcommand = args.length > 0 && ['setup', 'status', 'refresh', 'install-agents', 'export', '--help', '-h', '--version', '-V'].includes(args[0]);
const isTTY = process.stdin.isTTY;

if (hasSubcommand) {
  // CLI mode — user ran knit setup/status/refresh
  runCLI();
} else if (isTTY) {
  // User ran knit with no args in a terminal → show help
  process.argv.push('--help');
  runCLI();
} else {
  // Not a TTY (Claude Code piping stdio) → start MCP server
  runMCP();
}

async function runCLI() {
  const gradient = (await import('gradient-string')).default;
  const chalk = (await import('chalk')).default;
  const { setupCommand } = await import('./commands/setup.js');
  const { statusCommand } = await import('./commands/status.js');
  const { refreshCommand } = await import('./commands/refresh.js');
  const { installAgentsCommand } = await import('./commands/install-agents.js');
  const { exportCommand } = await import('./commands/export.js');

  const ENGRAM_GRADIENT = gradient(['#7c3aed', '#2563eb', '#06b6d4']);

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
  ║   knit — the second brain           ║
  ║                                       ║
  ╚═══════════════════════════════════════╝`;

  const program = new Command();

  program
    .name('knit')
    .description('The second brain for Claude Code — MCP server + analytics dashboard')
    .version(VERSION)
    .hook('preAction', () => {
      console.log(ENGRAM_GRADIENT.multiline(banner));
      console.log();
    });

  program
    .command('setup')
    .description('Add Knit MCP to your Claude Code settings (one time)')
    .option('--global', 'Add to global ~/.claude/settings.json (default)', true)
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
    .description('Dashboard: sessions, learnings, hit rate, knowledge health')
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
    .description('Force rebuild knowledge brain and CLAUDE.md')
    .argument('[directory]', 'Project directory', '.')
    .action(async (directory: string) => {
      try {
        await refreshCommand(directory);
      } catch (error) {
        console.error(chalk.red('  Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  program
    .command('install-agents')
    .description('Install VoltAgent subagents into <project>/.claude/agents/, personalized with project context')
    .argument('[directory]', 'Project directory', '.')
    .option('--refresh', 'Re-fetch from network even if cached', false)
    .option('--all', 'Install every known agent (not just ones referenced by current domains)', false)
    .action(async (directory: string, options: { refresh?: boolean; all?: boolean }) => {
      try {
        await installAgentsCommand(directory, options);
      } catch (error) {
        console.error(chalk.red('  Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  program
    .command('export')
    .description('Export knit learnings into a target format (e.g. an Obsidian vault)')
    .argument('<format>', 'Export format (currently only: obsidian)')
    .argument('<vault-path>', 'Output directory (Obsidian vault path)')
    .option('--filter <tag>', 'Only export entries tagged with this tag (e.g. #auth)')
    .action(async (format: string, vaultPath: string, options: { filter?: string }) => {
      try {
        await exportCommand(format, vaultPath, options);
      } catch (error) {
        console.error(chalk.red('  Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  program.parse();
}

async function runMCP() {
  // Start the MCP server — this is what Claude Code calls
  const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const { ListToolsRequestSchema, CallToolRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');
  const { getBrain, detectProjectRoot, refreshBrain } = await import('./mcp/cache.js');
  const { getActiveToolDefinitionsForBrain, handleToolCall } = await import('./mcp/tools.js');
  const { KNIT_INSTRUCTIONS } = await import('./mcp/instructions.js');
  const { registerToolsListChangedNotifier } = await import('./mcp/notifier.js');

  const ROOT_PATH = detectProjectRoot();

  const server = new Server(
    { name: 'knit-brain', version: VERSION },
    {
      capabilities: { tools: { listChanged: true } },
      instructions: KNIT_INSTRUCTIONS,
    },
  );

  registerToolsListChangedNotifier(() => {
    void server.sendToolListChanged().catch(() => { /* swallow */ });
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: getActiveToolDefinitionsForBrain(getBrain(ROOT_PATH)),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: params } = request.params;

    try {
      if (name === 'knit_refresh_index') {
        refreshBrain(ROOT_PATH);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ status: 'refreshed', root: ROOT_PATH }) }],
        };
      }

      const brain = getBrain(ROOT_PATH);
      const result = handleToolCall(name, (params || {}) as Record<string, string>, brain);

      return {
        content: [{ type: 'text' as const, text: result }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: `Internal error: ${message}` }) }],
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
