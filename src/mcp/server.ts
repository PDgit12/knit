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
import { getActiveToolDefinitionsForBrain, handleToolCall } from './tools.js';
import { VERSION } from '../version.js';
import { buildInstructions } from './instructions.js';
import { registerToolsListChangedNotifier } from './notifier.js';
import { loadScanResult } from '../engine/integration-scanner.js';

// Cache project root at startup — doesn't change during a session
const ROOT_PATH = detectProjectRoot();

// v0.8.1 — tailor the MCP `instructions` field per-project based on the
// integration scanner's most recent result. Falls through to the universal
// baseline when no scan has run yet (cold first start). The scan refreshes
// at the next autoInitialize, so subsequent sessions pick up the tailored
// version.
// v0.12 — pass ROOT_PATH so buildInstructions can append a one-line budget
// verdict when CLAUDE.md is over the 6.5KB target. Surfaces at handshake,
// before the agent reads any tool description.
const PER_PROJECT_INSTRUCTIONS = buildInstructions(loadScanResult(ROOT_PATH), ROOT_PATH);

const server = new Server(
  { name: 'knit-brain', version: VERSION },
  {
    // Advertising `listChanged: true` tells the MCP client we may emit
    // notifications/tools/list_changed (we do, when knit_enable_feature
    // or knit_disable_feature changes the visible tool surface).
    capabilities: { tools: { listChanged: true } },
    instructions: PER_PROJECT_INSTRUCTIONS,
  },
);

// Bridge: handlers signal "tool surface changed" via notifyToolsListChanged();
// here we plumb that into the actual MCP notification. Best-effort: if the
// SDK's send rejects (client not yet initialized, transport closed, etc.),
// the handler's primary work has already succeeded — we never throw out.
registerToolsListChangedNotifier(() => {
  void server.sendToolListChanged().catch(() => { /* swallow */ });
});

// List available tools — filtered by project shape so hidden Tier-2/3 tools
// don't appear in the agent's tool list. Loading the brain here is safe;
// it's cached after the first call.
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: getActiveToolDefinitionsForBrain(getBrain(ROOT_PATH)),
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
