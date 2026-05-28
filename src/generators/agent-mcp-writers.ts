/**
 * Per-agent MCP-config writers.
 *
 * One function per MCP-speaking agent, each idempotent: re-running on an
 * already-registered config is a no-op that returns `{ written: false,
 * alreadyRegistered: true }`. New registration returns
 * `{ written: true, alreadyRegistered: false }`.
 *
 * Schema differences (verified against each agent's published MCP docs):
 *
 *   Claude Code / Cursor / Cline      → mcpServers.<name> = { command, args, env? }
 *   VS Code / GitHub Copilot          → servers.<name>    = { command, args, env? }
 *                                       (unique top-level key)
 *   Codex CLI                         → TOML [mcp_servers.<name>] — see codex-mcp.ts
 *   Continue                          → YAML per-server file — see continue-mcp.ts
 *
 * All writers mkdir-parents and use atomic temp+rename to avoid clobbering
 * a user's existing config on partial writes.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

/** Canonical Knit MCP command, identical across every agent. */
const KNIT_MCP_COMMAND = {
  command: 'npx',
  args: ['-y', 'knit-mcp@latest'],
};

/** Registration name. Kept stable across agents so detection + soft-gates
 *  can identify Knit regardless of which agent is invoking it. */
export const KNIT_REGISTRATION_NAME = 'knit-brain';

export interface WriteResult {
  written: boolean;
  alreadyRegistered: boolean;
  path: string;
}

/** Atomic JSON write. Reads existing config if present, merges Knit entry,
 *  writes to temp + renames. Preserves all unrelated keys (mcpServers
 *  entries the user already had, top-level fields like permissions, etc.). */
function atomicMergeJson(
  path: string,
  topKey: 'mcpServers' | 'servers',
  registrationName: string,
  entry: object,
): WriteResult {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  let existing: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      existing = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
    } catch {
      // Corrupted JSON — DO NOT overwrite. Surface to the caller as
      // "already registered" so setup doesn't silently destroy user data.
      // Better UX: caller can re-attempt after `knit doctor` flags the
      // corruption.
      return { written: false, alreadyRegistered: false, path };
    }
  }

  if (!existing[topKey] || typeof existing[topKey] !== 'object') {
    existing[topKey] = {};
  }
  const servers = existing[topKey] as Record<string, unknown>;

  if (servers[registrationName]) {
    return { written: false, alreadyRegistered: true, path };
  }

  servers[registrationName] = entry;

  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
  renameSync(tmp, path);
  return { written: true, alreadyRegistered: false, path };
}

// ─── Cursor ─────────────────────────────────────────────────────────────

/** Cursor uses `mcpServers` at the top level, same shape as Claude Code.
 *  Project-level path is `<workspace>/.cursor/mcp.json`; user-level is
 *  `~/.cursor/mcp.json`. Caller picks which based on their setup intent. */
export function writeCursorMcp(configPath: string): WriteResult {
  return atomicMergeJson(configPath, 'mcpServers', KNIT_REGISTRATION_NAME, {
    type: 'stdio',
    ...KNIT_MCP_COMMAND,
  });
}

// ─── Cline ──────────────────────────────────────────────────────────────

/** Cline uses `mcpServers` at the top level, same JSON shape as Claude
 *  Code. The CLI config lives at `~/.cline/mcp.json`. IDE-extension users
 *  have config stored in VS Code workspace state which we can't reliably
 *  inspect — for those users `knit setup` will only register the CLI
 *  config; the IDE extension will need a manual add via Cline's UI. */
export function writeClineMcp(configPath: string): WriteResult {
  return atomicMergeJson(configPath, 'mcpServers', KNIT_REGISTRATION_NAME, KNIT_MCP_COMMAND);
}

// ─── VS Code / GitHub Copilot ───────────────────────────────────────────

/** VS Code's Agent mode uses `servers` (NOT `mcpServers`) as the top-level
 *  key — see code.visualstudio.com/docs/copilot/customization/mcp-servers.
 *  The per-server entry also carries `type: "stdio"` (or `"http"` for remote
 *  servers). Knit is stdio. */
export function writeVscodeMcp(configPath: string): WriteResult {
  return atomicMergeJson(configPath, 'servers', KNIT_REGISTRATION_NAME, {
    type: 'stdio',
    ...KNIT_MCP_COMMAND,
  });
}
