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
const hasSubcommand = args.length > 0 && ['setup', 'status', 'refresh', 'install-agents', 'export', 'doctor', 'ui', '--help', '-h', '--version', '-V'].includes(args[0]);
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
  const { doctorCommand } = await import('./commands/doctor.js');
  const { uiCommand } = await import('./commands/ui.js');

  const ENGRAM_GRADIENT = gradient(['#7c3aed', '#2563eb', '#06b6d4']);

  // v0.12.1 — every CLI catch block routes through this so users see the
  // command that failed + an actionable next step. Raw `error.message`
  // alone (e.g. "Cannot read property X of undefined") leaves users stuck
  // and burns Discord support cycles.
  const reportCliError = (command: string, error: unknown): void => {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`  Error in 'knit ${command}':`), msg);
    console.error(chalk.dim('  Next: run `knit doctor` to diagnose, or file an issue at https://github.com/PDgit12/knit/issues with the message above.'));
  };

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
    .description('The second brain for any MCP-speaking AI coding agent — memory + workflow + analytics dashboard')
    .version(VERSION)
    .hook('preAction', () => {
      console.log(ENGRAM_GRADIENT.multiline(banner));
      console.log();
    });

  program
    .command('setup')
    .description('Register Knit MCP in every detected agent (Claude Code, Cursor, Codex, Cline, Continue, VS Code Copilot)')
    .option('--global', 'Add to global ~/.claude/settings.json (default)', true)
    .option('--local', 'Add to project .claude/settings.json only', false)
    .action(async (options: Record<string, unknown>) => {
      try {
        await setupCommand(options);
      } catch (error) {
        reportCliError('setup', error);
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
        reportCliError('status', error);
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
        reportCliError('refresh', error);
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
        reportCliError('install-agents', error);
        process.exit(1);
      }
    });

  program
    .command('doctor')
    .description('Install health check: version, MCP registration, HOOKS_VERSION drift, knowledgebase, dangling symlinks')
    .argument('[directory]', 'Project directory', '.')
    .action(async (directory: string) => {
      try {
        await doctorCommand(directory);
      } catch (error) {
        reportCliError('doctor', error);
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
        reportCliError('export', error);
        process.exit(1);
      }
    });

  program
    .command('ui')
    .description('Launch the local Knit dashboard in your browser (http://127.0.0.1:7421)')
    .action(async () => {
      try {
        await uiCommand();
      } catch (error) {
        reportCliError('ui', error);
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
  const { buildInstructions } = await import('./mcp/instructions.js');
  const { registerToolsListChangedNotifier } = await import('./mcp/notifier.js');
  const { loadScanResult } = await import('./engine/integration-scanner.js');
  const { prewarmLatestVersion, getCachedLatestVersion, isNewerVersion } = await import('./mcp/update-check.js');

  const ROOT_PATH = detectProjectRoot();
  const PER_PROJECT_INSTRUCTIONS = buildInstructions(loadScanResult(ROOT_PATH));

  // v0.11.3 — pre-warm + nag if stale. The update-check module already
  // pre-warms via getBrain → cache.ts, but firing it explicitly here +
  // re-checking ~250ms later catches more session-starts. The nag goes
  // to stderr (Claude Code captures it; doesn't render in the UI but
  // surfaces in transcripts + the doctor's recent-stderr tail).
  prewarmLatestVersion();
  setTimeout(() => {
    const latest = getCachedLatestVersion();
    if (latest && isNewerVersion(latest, VERSION)) {
      process.stderr.write(
        `[knit] update available: v${VERSION} installed, v${latest} on npm — restart your MCP host to upgrade (clear npx cache if needed: \`rm -rf ~/.npm/_npx/\`). Changelog: https://github.com/PDgit12/knit/blob/main/CHANGELOG.md\n`,
      );
    }
  }, 250);

  const server = new Server(
    { name: 'knit-brain', version: VERSION },
    {
      capabilities: { tools: { listChanged: true } },
      instructions: PER_PROJECT_INSTRUCTIONS,
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
