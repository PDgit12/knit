/**
 * Continue MCP-config writer.
 *
 * Continue is the only one of the 6 agents that uses a directory-per-server
 * pattern: `.continue/mcpServers/<server>.yaml` — one YAML file per MCP
 * server, no shared top-level config. (See docs.continue.dev for the
 * mcpServers folder convention.)
 *
 * Our schema is 4 fields: `name`, `command`, `args`, `type`. Pure static
 * literals controlled by Knit — no user input. Hand-rolled YAML emit
 * avoids a 50KB js-yaml dep.
 */

import { writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { KNIT_REGISTRATION_NAME, type WriteResult } from './agent-mcp-writers.js';

/** YAML for our 4-field schema. Standalone for testing.
 *  All values are static, so no quoting/escaping concerns. */
export function buildContinueYaml(registrationName: string = KNIT_REGISTRATION_NAME): string {
  return [
    `# Knit MCP — added by 'knit setup'. Safe to edit; re-running setup will not overwrite.`,
    `name: ${registrationName}`,
    `command: npx`,
    `args:`,
    `  - -y`,
    `  - knit-mcp@latest`,
    `type: stdio`,
    '',
  ].join('\n');
}

/** Writes .continue/mcpServers/knit-brain.yaml at the given config path.
 *  The caller decides workspace vs user scope by which path it passes
 *  (.continue/mcpServers/ in workspace root, or ~/.continue/mcpServers/). */
export function writeContinueMcp(configPath: string): WriteResult {
  const dir = dirname(configPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  if (existsSync(configPath)) {
    // Continue scopes registration to one file per server, so file-exists
    // alone means "registered." We deliberately don't try to re-validate
    // the user's overrides — if they edited the file (e.g. pinned a
    // version), respect that.
    return { written: false, alreadyRegistered: true, path: configPath };
  }

  const tmp = `${configPath}.tmp.${process.pid}`;
  writeFileSync(tmp, buildContinueYaml(), 'utf-8');
  renameSync(tmp, configPath);
  return { written: true, alreadyRegistered: false, path: configPath };
}
