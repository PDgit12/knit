/**
 * Per-agent presence detector.
 *
 * Scans the user's filesystem for each MCP-speaking agent's config location.
 * `knit setup` (and `/api/doctor`) use the result to decide which generators
 * to invoke, and to report per-agent registration status.
 *
 * Per-agent config locations (researched against each agent's published docs):
 *
 *   Claude Code   → ~/.claude.json (mcpServers)
 *   Cursor        → ~/.cursor/mcp.json (mcpServers) + .cursor/mcp.json (workspace)
 *   Codex CLI     → ~/.codex/config.toml ([mcp_servers.*])
 *   Cline         → ~/.cline/mcp.json (mcpServers) + .clinerules/ directory marks Cline use
 *   Continue      → ~/.continue/ exists (directory marks install)
 *   VS Code / Copilot → user-profile mcp.json OR .vscode/mcp.json (uses `servers` key)
 *
 * Each detector returns:
 *   - present: did we find evidence the agent is installed on this machine?
 *   - registered: is knit already in its MCP config?
 *   - path: the canonical config-file path we would write to
 *
 * Read-only. No side effects. All filesystem checks are best-effort —
 * a permission error is treated as "not detected" rather than throwing.
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';

export type AgentId =
  | 'claude-code'
  | 'cursor'
  | 'codex'
  | 'cline'
  | 'continue'
  | 'vscode';

export interface AgentStatus {
  agent: AgentId;
  displayName: string;
  present: boolean;
  registered: boolean;
  configPath: string;
  workspaceConfigPath?: string;
  notes?: string;
}

/** Safe-read JSON file. Returns null on any IO/parse failure. */
function readJsonSafe(path: string): unknown {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

/** Does a directory exist at this path? Best-effort. */
function dirExists(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Does a regular file exist at this path? Best-effort. */
function fileExists(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

// ─── Claude Code ────────────────────────────────────────────────────────

export function detectClaudeCode(): AgentStatus {
  const configPath = join(homedir(), '.claude.json');
  const present = fileExists(configPath) || dirExists(join(homedir(), '.claude'));
  const config = readJsonSafe(configPath) as { mcpServers?: Record<string, unknown> } | null;
  const registered = !!(config?.mcpServers && (config.mcpServers['knit-brain'] || config.mcpServers['knit']));
  return {
    agent: 'claude-code',
    displayName: 'Claude Code',
    present,
    registered,
    configPath,
  };
}

// ─── Cursor ─────────────────────────────────────────────────────────────

export function detectCursor(workspaceRoot: string = process.cwd()): AgentStatus {
  const userConfig = join(homedir(), '.cursor', 'mcp.json');
  const workspaceConfig = join(workspaceRoot, '.cursor', 'mcp.json');
  // Cursor is detected by either an existing config, OR the platform-specific
  // app data directory. Conservative: only flag "present" if the user has
  // already touched a Cursor MCP config OR has the home dir.
  const cursorHomeDir = dirExists(join(homedir(), '.cursor'));
  const present = cursorHomeDir || fileExists(userConfig) || fileExists(workspaceConfig);
  const userJson = readJsonSafe(userConfig) as { mcpServers?: Record<string, unknown> } | null;
  const wsJson = readJsonSafe(workspaceConfig) as { mcpServers?: Record<string, unknown> } | null;
  const registered =
    !!(userJson?.mcpServers && (userJson.mcpServers['knit-brain'] || userJson.mcpServers['knit'])) ||
    !!(wsJson?.mcpServers && (wsJson.mcpServers['knit-brain'] || wsJson.mcpServers['knit']));
  return {
    agent: 'cursor',
    displayName: 'Cursor',
    present,
    registered,
    configPath: userConfig,
    workspaceConfigPath: workspaceConfig,
  };
}

// ─── Codex CLI ──────────────────────────────────────────────────────────

export function detectCodex(): AgentStatus {
  const configPath = join(homedir(), '.codex', 'config.toml');
  const codexHomeDir = dirExists(join(homedir(), '.codex'));
  const present = codexHomeDir || fileExists(configPath);
  // TOML parse for "registered" check is deferred to the Codex generator
  // (will live in src/generators/codex-mcp.ts). For detection purposes a
  // substring scan is enough — false positives ("knit" in a comment) get
  // caught by the generator's idempotent write.
  let registered = false;
  try {
    if (existsSync(configPath)) {
      const text = readFileSync(configPath, 'utf-8');
      registered = /\[mcp_servers\.(knit|knit-brain)\]/.test(text);
    }
  } catch {
    // best-effort
  }
  return {
    agent: 'codex',
    displayName: 'Codex CLI',
    present,
    registered,
    configPath,
  };
}

// ─── Cline ──────────────────────────────────────────────────────────────

export function detectCline(workspaceRoot: string = process.cwd()): AgentStatus {
  const userConfig = join(homedir(), '.cline', 'mcp.json');
  const clineHomeDir = dirExists(join(homedir(), '.cline'));
  const workspaceRules = dirExists(join(workspaceRoot, '.clinerules'));
  // Cline is also commonly used as a VS Code extension where MCP config
  // lives in VS Code workspace state — we can't easily inspect that.
  // Treat any of: home dir, CLI config file, or workspace .clinerules/ as evidence.
  const present = clineHomeDir || fileExists(userConfig) || workspaceRules;
  const config = readJsonSafe(userConfig) as { mcpServers?: Record<string, unknown> } | null;
  const registered = !!(config?.mcpServers && (config.mcpServers['knit-brain'] || config.mcpServers['knit']));
  return {
    agent: 'cline',
    displayName: 'Cline',
    present,
    registered,
    configPath: userConfig,
    notes: workspaceRules ? 'Workspace has .clinerules/' : undefined,
  };
}

// ─── Continue ───────────────────────────────────────────────────────────

export function detectContinue(workspaceRoot: string = process.cwd()): AgentStatus {
  // Continue uses .continue/mcpServers/<name>.yaml (per audit §Universality).
  // The user-level dir at ~/.continue/ marks install presence.
  const continueHomeDir = dirExists(join(homedir(), '.continue'));
  const workspaceMcpDir = join(workspaceRoot, '.continue', 'mcpServers');
  const userMcpDir = join(homedir(), '.continue', 'mcpServers');
  const knitYamlWs = fileExists(join(workspaceMcpDir, 'knit.yaml')) || fileExists(join(workspaceMcpDir, 'knit-brain.yaml'));
  const knitYamlUser = fileExists(join(userMcpDir, 'knit.yaml')) || fileExists(join(userMcpDir, 'knit-brain.yaml'));
  return {
    agent: 'continue',
    displayName: 'Continue',
    present: continueHomeDir,
    registered: knitYamlWs || knitYamlUser,
    configPath: join(userMcpDir, 'knit.yaml'),
    workspaceConfigPath: join(workspaceMcpDir, 'knit.yaml'),
  };
}

// ─── VS Code / GitHub Copilot ───────────────────────────────────────────

function vscodeUserMcpPath(): string {
  // VS Code stores the user-level MCP config in the user-profile data dir,
  // accessible via the "MCP: Open User Configuration" command. On disk:
  //   macOS:   ~/Library/Application Support/Code/User/mcp.json
  //   Linux:   ~/.config/Code/User/mcp.json
  //   Windows: %APPDATA%\Code\User\mcp.json
  if (platform() === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Code', 'User', 'mcp.json');
  }
  if (platform() === 'win32') {
    const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
    return join(appData, 'Code', 'User', 'mcp.json');
  }
  return join(homedir(), '.config', 'Code', 'User', 'mcp.json');
}

export function detectVscode(workspaceRoot: string = process.cwd()): AgentStatus {
  const userConfig = vscodeUserMcpPath();
  const workspaceConfig = join(workspaceRoot, '.vscode', 'mcp.json');
  // VS Code is present if EITHER its user data dir exists OR the workspace
  // .vscode/ dir exists (common in repos using VS Code). We don't try to
  // detect Copilot specifically — Copilot Agent mode reads the same config.
  const vscodeUserDir = dirExists(join(userConfig, '..'));
  const workspaceVscodeDir = dirExists(join(workspaceRoot, '.vscode'));
  const present = vscodeUserDir || workspaceVscodeDir || fileExists(userConfig) || fileExists(workspaceConfig);
  // Note: VS Code uses `servers` (NOT `mcpServers`) as the top-level key.
  const userJson = readJsonSafe(userConfig) as { servers?: Record<string, unknown> } | null;
  const wsJson = readJsonSafe(workspaceConfig) as { servers?: Record<string, unknown> } | null;
  const registered =
    !!(userJson?.servers && (userJson.servers['knit-brain'] || userJson.servers['knit'])) ||
    !!(wsJson?.servers && (wsJson.servers['knit-brain'] || wsJson.servers['knit']));
  return {
    agent: 'vscode',
    displayName: 'VS Code / GitHub Copilot',
    present,
    registered,
    configPath: userConfig,
    workspaceConfigPath: workspaceConfig,
  };
}

// ─── Aggregate ──────────────────────────────────────────────────────────

export function detectAllAgents(workspaceRoot: string = process.cwd()): AgentStatus[] {
  return [
    detectClaudeCode(),
    detectCursor(workspaceRoot),
    detectCodex(),
    detectCline(workspaceRoot),
    detectContinue(workspaceRoot),
    detectVscode(workspaceRoot),
  ];
}
