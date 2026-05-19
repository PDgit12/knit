#!/usr/bin/env node

/**
 * Knit MCP Server — the Second Brain.
 *
 * 32 tools that let AI agents query and update the project knowledge
 * brain mid-session: import graphs, exports, test coverage, per-project
 * learnings, cross-project learnings (Model C), false positives, task
 * classification, session memory, workflow on demand, pattern reflection,
 * team-scoped git worktrees, and personalized VoltAgent subagents.
 *
 * Configure in ~/.claude.json:
 *   "mcpServers": { "knit-brain": { "command": "npx",
 *                                     "args": ["-y", "knit-mcp@latest"] } }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { getBrain, detectProjectRoot, refreshBrain } from './cache.js';
import { getToolDefinitions, handleToolCall } from './tools.js';
import { VERSION } from '../version.js';
import { KNIT_INSTRUCTIONS } from './instructions.js';

// Cache project root at startup — doesn't change during a session
const ROOT_PATH = detectProjectRoot();

const server = new Server(
  { name: 'knit-brain', version: VERSION },
  { capabilities: { tools: {} }, instructions: KNIT_INSTRUCTIONS },
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: getToolDefinitions(),
}));

// Handle tool calls — with error boundary
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: params } = request.params;

  try {
    // Special case: refresh rebuilds the cache
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
    // Never let an exception kill the MCP server process
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: `Internal error: ${message}` }) }],
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  process.stderr.write(`Knit MCP server error: ${error}\n`);
  process.exit(1);
});
