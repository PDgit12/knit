/**
 * Codex CLI MCP-config writer.
 *
 * Codex uses TOML at ~/.codex/config.toml. Knit's MCP entry is the simplest
 * possible TOML table — `[mcp_servers.knit-brain]` with three string keys
 * and one string-array. A full TOML parser would be 25-30KB of dep weight
 * for a schema we can emit safely in 30 lines.
 *
 * Idempotency strategy: scan the existing file text for the literal heading
 * `[mcp_servers.knit-brain]` (or its `knit` variant). If present, no-op.
 * If absent, append our block at the end of the file. We never modify or
 * remove existing user content — the worst case is that a user manually
 * edited the Knit block to override (e.g., `args = ["-y", "knit-mcp@0.13.0"]`
 * to pin a version); we leave their override alone on re-run.
 *
 * Atomic write via temp + rename, same pattern as the JSON writers.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { KNIT_REGISTRATION_NAME, type WriteResult } from './agent-mcp-writers.js';

/** Build the TOML block we append. Standalone so tests can assert on it. */
export function buildCodexMcpBlock(registrationName: string = KNIT_REGISTRATION_NAME): string {
  // TOML escaping note: command + args values are static literals controlled
  // by Knit, never user-supplied — no escaping concerns here. If we ever
  // accept user-supplied values in this block, switch to TOML-string-quote
  // (escape backslash + double-quote) per the TOML 1.0 spec.
  return [
    '',
    `# Knit MCP — added by 'knit setup'. Safe to edit; re-running setup will not overwrite.`,
    `[mcp_servers.${registrationName}]`,
    `command = "npx"`,
    `args = ["-y", "knit-mcp@latest"]`,
    '',
  ].join('\n');
}

/** Returns true if the file text already declares a Knit MCP server,
 *  matched by either the canonical `knit-brain` name or the bare `knit`
 *  alias. Tolerates whitespace variations in the heading. */
export function codexAlreadyRegistered(tomlText: string): boolean {
  return /^\s*\[mcp_servers\.(?:knit-brain|knit)\]\s*$/m.test(tomlText);
}

export function writeCodexMcp(configPath: string): WriteResult {
  const dir = dirname(configPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  let existing = '';
  if (existsSync(configPath)) {
    try {
      existing = readFileSync(configPath, 'utf-8');
    } catch {
      // Read failure — refuse to write. Same guard as the JSON writer.
      return { written: false, alreadyRegistered: false, path: configPath };
    }
  }

  if (codexAlreadyRegistered(existing)) {
    return { written: false, alreadyRegistered: true, path: configPath };
  }

  // Ensure the existing content ends with a newline before our block.
  const sep = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
  const merged = existing + sep + buildCodexMcpBlock();

  const tmp = `${configPath}.tmp.${process.pid}`;
  writeFileSync(tmp, merged, 'utf-8');
  renameSync(tmp, configPath);
  return { written: true, alreadyRegistered: false, path: configPath };
}
