#!/usr/bin/env node

/**
 * Engram MCP Server — the Second Brain.
 *
 * Exposes 8 tools that let AI agents query the project knowledge
 * brain mid-session. Import graphs, export maps, test coverage,
 * learnings, and false positives — all from in-memory cache.
 *
 * Run: npx engram-mcp
 * Configure in .claude/settings.json:
 *   "mcpServers": { "engram-brain": { "command": "npx", "args": ["engram-mcp"] } }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { getBrain, detectProjectRoot, refreshBrain } from './cache.js';
import { getToolDefinitions, handleToolCall } from './tools.js';

const server = new Server(
  { name: 'engram-brain', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: getToolDefinitions(),
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: params } = request.params;
  const rootPath = detectProjectRoot();

  // Special case: refresh rebuilds the cache
  if (name === 'engram_refresh_index') {
    refreshBrain(rootPath);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ status: 'refreshed', root: rootPath }) }],
    };
  }

  const brain = getBrain(rootPath);
  const result = handleToolCall(name, (params || {}) as Record<string, string>, brain);

  return {
    content: [{ type: 'text' as const, text: result }],
  };
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
