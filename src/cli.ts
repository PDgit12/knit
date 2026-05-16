#!/usr/bin/env node

/**
 * engram-dev — the second brain for Claude Code.
 *
 * Single entry point:
 *   engram-dev setup    → add MCP to Claude settings
 *   engram-dev status   → analytics dashboard
 *   engram-dev refresh  → rebuild knowledge brain
 *   engram-dev (no args, called by Claude Code) → start MCP server
 */

import { Command } from 'commander';

const args = process.argv.slice(2);
const hasSubcommand = args.length > 0 && ['setup', 'status', 'refresh', '--help', '-h', '--version', '-V'].includes(args[0]);

if (hasSubcommand) {
  // CLI mode — user ran engram-dev setup/status/refresh
  runCLI();
} else {
  // MCP mode — Claude Code started this as an MCP server (no args, stdin is pipe)
  runMCP();
}

async function runCLI() {
  const gradient = (await import('gradient-string')).default;
  const chalk = (await import('chalk')).default;
  const { setupCommand } = await import('./commands/setup.js');
  const { statusCommand } = await import('./commands/status.js');
  const { refreshCommand } = await import('./commands/refresh.js');

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
  ║   engram — the second brain           ║
  ║                                       ║
  ╚═══════════════════════════════════════╝`;

  const program = new Command();

  program
    .name('engram-dev')
    .description('The second brain for Claude Code — MCP server + analytics dashboard')
    .version('0.1.0')
    .hook('preAction', () => {
      console.log(ENGRAM_GRADIENT.multiline(banner));
      console.log();
    });

  program
    .command('setup')
    .description('Add Engram MCP to your Claude Code settings (one time)')
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

  program.parse();
}

async function runMCP() {
  // Start the MCP server — this is what Claude Code calls
  const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const { ListToolsRequestSchema, CallToolRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');
  const { getBrain, detectProjectRoot, refreshBrain } = await import('./mcp/cache.js');
  const { getToolDefinitions, handleToolCall } = await import('./mcp/tools.js');

  const ROOT_PATH = detectProjectRoot();

  const server = new Server(
    { name: 'engram-brain', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: getToolDefinitions(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: params } = request.params;

    try {
      if (name === 'engram_refresh_index') {
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
