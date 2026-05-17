#!/usr/bin/env node

/**
 * Engram MCP Server — the Second Brain.
 *
 * 27 tools that let AI agents query and update the project knowledge
 * brain mid-session: import graphs, exports, test coverage, learnings,
 * false positives, task classification, session memory, workflow on
 * demand, and team-scoped git worktrees.
 *
 * Configure in ~/.claude.json:
 *   "mcpServers": { "engram-brain": { "command": "npx",
 *                                     "args": ["-y", "@piyushdua/engram-dev@latest"] } }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { getBrain, detectProjectRoot, refreshBrain } from './cache.js';
import { getToolDefinitions, handleToolCall } from './tools.js';

// Cache project root at startup — doesn't change during a session
const ROOT_PATH = detectProjectRoot();

const server = new Server(
  { name: 'engram-brain', version: '0.2.0' },
  { capabilities: { tools: {} } },
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
  process.stderr.write(`Engram MCP server error: ${error}\n`);
  process.exit(1);
});
