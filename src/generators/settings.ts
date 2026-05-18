import type { KnitConfig } from '../engine/types.js';
import {
  knowledgebasePath,
  learningsFilePath,
  sessionsLogPath,
  sessionsJsonlPath,
  projectDataDir,
  learningsDir,
  classificationMarkerPath,
  protocolConfigPath,
  sessionMarkerPath,
} from '../engine/paths.js';

/**
 * Generates .claude/settings.local.json hooks. v0.3.1+ emits cross-platform
 * inline Node scripts instead of bash pipelines, so hooks work on Windows
 * (native PowerShell or cmd), macOS, Linux, and WSL identically.
 *
 * Why Node instead of shell: Windows has no jq, grep, find -mmin, tr, awk,
 * sed, or printf with %s out of the box. Rewriting hooks in Node — which is
 * already a hard prerequisite for engram (npm-based install) — sidesteps
 * the cross-platform shell mess entirely.
 *
 * Quoting strategy: outer shell arg uses single quotes, inner JS uses double
 * quotes. Single quotes are preserved literally by bash, zsh, PowerShell, and
 * cmd.exe alike, so the Node `-e 'script'` form is portable.
 *
 * Path embedding: file paths are JSON-stringified after forward-slash
 * conversion, so they're safe to inline in JS source on any OS (Node accepts
 * forward slashes on Windows too).
 *
 * rootPath must be the canonical repo root (not a worktree path) so that
 * embedded paths resolve to the shared brain for all worktrees of this project.
 */
/**
 * Bump this whenever the emitted hook shape changes meaningfully.
 * cache.ts reads `_knitHooks.version` from existing settings.local.json on
 * every brain load; if it's lower than HOOKS_VERSION, the hooks get
 * regenerated via the hybrid-merge path so existing users auto-upgrade
 * without running any CLI command.
 *
 *   v2 — pre-0.5.0 baseline (PreToolUse/PostToolUse/Stop only)
 *   v3 — 0.5.0+: adds SessionStart, UserPromptSubmit, classification gate
 */
export const HOOKS_VERSION = 3;

export function generateSettings(config: KnitConfig, rootPath: string): object {
  return {
    mcpServers: {
      'knit-brain': {
        command: 'npx',
        args: ['-y', 'knit-mcp@latest'],
      },
    },
    hooks: generateHooks(config, rootPath),
    _knitHooks: { version: HOOKS_VERSION, generatedAt: new Date().toISOString() },
  };
}

// ── Hook-building helpers ────────────────────────────────────────

/** Embed a string as a JS string literal: forward-slash paths + JSON-quoted. */
function jsLit(s: string): string {
  return JSON.stringify(s.replace(/\\/g, '/'));
}

/** Compress a multiline JS snippet into a single-line `node -e '...'` shell command. */
function nodeHook(script: string): string {
  const compact = script
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, '').trim())  // strip line comments
    .filter((l) => l.length > 0)
    .join(' ');
  return `node -e '${compact}'`;
}

// ── Reusable JS snippets embedded inside hooks ───────────────────

/** JS helper that resolves the canonical repo root via git, falling back to cwd. */
const REPO_ROOT_JS = `
  const __getRoot = () => {
    try {
      return require("child_process").execSync("git rev-parse --show-toplevel", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch { return process.cwd(); }
  };
`;

/** JS helper that runs a git command in the repo root and returns stdout. */
const GIT_GET_JS = `
  const __git = (cmd, root, fallback) => {
    try {
      return require("child_process").execSync(cmd, { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch { return fallback === undefined ? "" : fallback; }
  };
`;

// ── Main hook generator ──────────────────────────────────────────

function generateHooks(config: KnitConfig, rootPath: string) {
  const KB_PATH = knowledgebasePath(rootPath);
  const LEARN_FILE = learningsFilePath(rootPath, config.name);
  const SESSIONS_MD = sessionsLogPath(rootPath);
  const SESSIONS_JSONL = sessionsJsonlPath(rootPath);
  const LEARN_DIR = learningsDir(rootPath);
  const ENGRAM_DIR = projectDataDir(rootPath);
  const PROTOCOL_CONFIG = protocolConfigPath(rootPath);
  const CLASSIFIED_MARKER = classificationMarkerPath(rootPath);
  const SESSION_MARKER = sessionMarkerPath(rootPath);

  const hooks: Record<string, unknown[]> = {
    SessionStart: [
      // Protocol Guard layer 1: drop a marker that knit_load_session
      // should be the first MCP call. Hook itself is best-effort; it doesn't
      // BLOCK on missing load_session, only the per-turn classification gate blocks.
      {
        _knitOwned: true,
        hooks: [
          {
            type: 'command',
            command: nodeHook(`
              try {
                const fs = require("fs");
                const path = require("path");
                const p = ${jsLit(SESSION_MARKER)};
                fs.mkdirSync(path.dirname(p), { recursive: true });
                fs.writeFileSync(p, new Date().toISOString());
                console.error("[knit] session marker written. Call knit_load_session as your first MCP call.");
              } catch (e) {}
            `),
            timeout: 5,
          },
        ],
      },
    ],
    UserPromptSubmit: [
      // Protocol Guard: each user turn invalidates the previous classification.
      // knit_classify_task must be called fresh per turn before Edit/Write.
      {
        _knitOwned: true,
        hooks: [
          {
            type: 'command',
            command: nodeHook(`
              try {
                const fs = require("fs");
                const p = ${jsLit(CLASSIFIED_MARKER)};
                if (fs.existsSync(p)) fs.rmSync(p, { force: true });
              } catch (e) {}
            `),
            timeout: 5,
          },
        ],
      },
    ],
    PreToolUse: [
      {
        _knitOwned: true,
        matcher: 'Bash',
        hooks: [
          {
            type: 'command',
            command: nodeHook(`
              let d = "";
              process.stdin.on("data", (c) => d += c);
              process.stdin.on("end", () => {
                try {
                  const i = JSON.parse(d);
                  const c = (i.tool_input && i.tool_input.command) || "";
                  if (/^git\\s+(push\\b.*\\s(--force|-f)|reset\\s+--hard|commit.*--no-verify)/.test(c)) {
                    console.log(JSON.stringify({ decision: "block", reason: "Destructive git operation blocked by Engram. Ask the user first." }));
                  }
                } catch (e) {}
              });
            `),
            timeout: 5,
          },
        ],
      },
      // Protocol Guard layer 2: gate Edit/Write/MultiEdit on prior knit_classify_task.
      {
        _knitOwned: true,
        matcher: 'Edit|Write|MultiEdit',
        hooks: [
          {
            type: 'command',
            command: nodeHook(`
              try {
                const fs = require("fs");
                const cfgPath = ${jsLit(PROTOCOL_CONFIG)};
                const markerPath = ${jsLit(CLASSIFIED_MARKER)};
                let level = "warn";
                if (fs.existsSync(cfgPath)) {
                  try {
                    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
                    if (cfg && (cfg.level === "off" || cfg.level === "warn" || cfg.level === "block")) level = cfg.level;
                  } catch (parseErr) {
                    console.error("[knit] protocol-config.json unreadable, defaulting strictness=warn:", parseErr && parseErr.message ? parseErr.message : parseErr);
                  }
                }
                if (level === "off") return;
                const hasMarker = fs.existsSync(markerPath);
                if (hasMarker) return;
                if (level === "block") {
                  console.error("[knit] BLOCKED: call knit_classify_task before Edit/Write. The Protocol Guard prevents implementation without classification.");
                  process.exit(2);
                }
                console.error("[knit] reminder: call knit_classify_task before Edit/Write. Set strictness=block via knit_set_protocol_strictness to make this a hard gate.");
              } catch (hookErr) {
                console.error("[knit] protocol-guard hook crashed, allowing tool through:", hookErr && hookErr.message ? hookErr.message : hookErr);
              }
            `),
            timeout: 5,
          },
        ],
      },
    ],
    PostToolUse: [],
    Stop: [],
  };

  // TypeScript typecheck on edit
  if (config.stack.language === 'typescript' && config.stack.typecheckCommand) {
    hooks.PostToolUse.push({
      _knitOwned: true,
      matcher: 'Write|Edit',
      hooks: [
        {
          type: 'command',
          command: nodeHook(`
            let d = "";
            process.stdin.on("data", (c) => d += c);
            process.stdin.on("end", () => {
              try {
                const i = JSON.parse(d);
                const f = (i.tool_input && i.tool_input.file_path) || (i.tool_response && i.tool_response.filePath) || "";
                if (!/\\.tsx?$/.test(f)) return;
                ${REPO_ROOT_JS}
                require("child_process").execSync("npx tsc --noEmit --pretty false", { cwd: __getRoot(), stdio: "inherit" });
              } catch (e) {}
            });
          `),
          timeout: 30,
          statusMessage: 'Type checking...',
        },
      ],
    });
  }

  // Python syntax check on edit
  if (config.stack.language === 'python') {
    hooks.PostToolUse.push({
      _knitOwned: true,
      matcher: 'Write|Edit',
      hooks: [
        {
          type: 'command',
          command: nodeHook(`
            let d = "";
            process.stdin.on("data", (c) => d += c);
            process.stdin.on("end", () => {
              try {
                const i = JSON.parse(d);
                const f = (i.tool_input && i.tool_input.file_path) || (i.tool_response && i.tool_response.filePath) || "";
                if (!/\\.py$/.test(f)) return;
                ${REPO_ROOT_JS}
                require("child_process").execSync("python3 -m py_compile " + JSON.stringify(f), { cwd: __getRoot(), stdio: "inherit" });
              } catch (e) {}
            });
          `),
          timeout: 15,
          statusMessage: 'Checking Python syntax...',
        },
      ],
    });
  }

  // Go vet on edit
  if (config.stack.language === 'go') {
    hooks.PostToolUse.push({
      _knitOwned: true,
      matcher: 'Write|Edit',
      hooks: [
        {
          type: 'command',
          command: nodeHook(`
            let d = "";
            process.stdin.on("data", (c) => d += c);
            process.stdin.on("end", () => {
              try {
                const i = JSON.parse(d);
                const f = (i.tool_input && i.tool_input.file_path) || (i.tool_response && i.tool_response.filePath) || "";
                if (!/\\.go$/.test(f)) return;
                ${REPO_ROOT_JS}
                require("child_process").execSync("go vet ./...", { cwd: __getRoot(), stdio: "inherit" });
              } catch (e) {}
            });
          `),
          timeout: 30,
          statusMessage: 'Running go vet...',
        },
      ],
    });
  }

  // Rust check on edit
  if (config.stack.language === 'rust') {
    hooks.PostToolUse.push({
      _knitOwned: true,
      matcher: 'Write|Edit',
      hooks: [
        {
          type: 'command',
          command: nodeHook(`
            let d = "";
            process.stdin.on("data", (c) => d += c);
            process.stdin.on("end", () => {
              try {
                const i = JSON.parse(d);
                const f = (i.tool_input && i.tool_input.file_path) || (i.tool_response && i.tool_response.filePath) || "";
                if (!/\\.rs$/.test(f)) return;
                ${REPO_ROOT_JS}
                require("child_process").execSync("cargo check", { cwd: __getRoot(), stdio: "inherit" });
              } catch (e) {}
            });
          `),
          timeout: 60,
          statusMessage: 'Running cargo check...',
        },
      ],
    });
  }

  // Build verification on stop — sequential typecheck/lint/build via Node
  const steps: [string, string][] = [];
  if (config.stack.typecheckCommand) steps.push(['TYPECHECK', config.stack.typecheckCommand]);
  if (config.stack.lintCommand) steps.push(['LINT', config.stack.lintCommand]);
  if (config.stack.buildCommand) steps.push(['BUILD', config.stack.buildCommand]);

  if (steps.length > 0) {
    hooks.Stop.push({
      _knitOwned: true,
      hooks: [
        {
          type: 'command',
          command: nodeHook(`
            ${REPO_ROOT_JS}
            const steps = ${JSON.stringify(steps)};
            for (const [name, cmd] of steps) {
              console.log("--- " + name + " ---");
              try {
                require("child_process").execSync(cmd, { cwd: __getRoot(), stdio: "inherit" });
              } catch (e) { break; }
            }
          `),
          timeout: 120,
          statusMessage: 'Engram: final build verification...',
        },
      ],
    });
  }

  // Session log on stop — narrative human-readable, to sessions.md
  hooks.Stop.push({
    _knitOwned: true,
    hooks: [
      {
        type: 'command',
        command: nodeHook(`
          try {
            const fs = require("fs");
            ${REPO_ROOT_JS}
            ${GIT_GET_JS}
            const dir = ${jsLit(LEARN_DIR)};
            const file = ${jsLit(SESSIONS_MD)};
            fs.mkdirSync(dir, { recursive: true });
            if (!fs.existsSync(file)) fs.writeFileSync(file, "# Session Log\\n");
            const root = __getRoot();
            const branch = __git("git branch --show-current", root);
            const commits = __git("git log --oneline -3", root).split("\\n").filter(Boolean).map((l) => "  - " + l).join("\\n");
            const changed = __git("git diff --stat HEAD", root).split("\\n").filter(Boolean).pop() || "";
            const ts = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
            let out = "\\n## Session " + ts + "\\n- Branch: " + branch + "\\n- Recent commits:\\n" + commits + "\\n";
            if (changed) out += "- Uncommitted: " + changed + "\\n";
            out += "\\n";
            fs.appendFileSync(file, out);
          } catch (e) {}
        `),
        timeout: 10,
        statusMessage: 'Engram: capturing session state...',
      },
    ],
  });

  // Session JSONL tuple on stop — structured searchable session memory
  hooks.Stop.push({
    _knitOwned: true,
    hooks: [
      {
        type: 'command',
        command: nodeHook(`
          try {
            const fs = require("fs");
            ${REPO_ROOT_JS}
            ${GIT_GET_JS}
            const dir = ${jsLit(ENGRAM_DIR)};
            const file = ${jsLit(SESSIONS_JSONL)};
            fs.mkdirSync(dir, { recursive: true });
            const root = __getRoot();
            const branch = __git("git branch --show-current", root, null);
            const filesMod = __git("git diff --name-only HEAD", root).split("\\n").filter(Boolean).length;
            const commits = __git("git log --oneline -3", root).split("\\n").filter(Boolean).map((l) => l.split(" ")[0]).join(" ");
            const now = new Date();
            const entry = {
              id: now.getTime() + "-" + process.pid,
              date: now.toISOString().slice(0, 10),
              timestamp: now.toISOString(),
              branch: branch,
              filesModified: filesMod,
              commits: commits,
            };
            fs.appendFileSync(file, JSON.stringify(entry) + "\\n");
          } catch (e) {}
        `),
        timeout: 10,
        statusMessage: 'Engram: recording session tuple...',
      },
    ],
  });

  // LEARN compliance soft reminder
  hooks.Stop.push({
    _knitOwned: true,
    hooks: [
      {
        type: 'command',
        command: nodeHook(`
          try {
            const fs = require("fs");
            const file = ${jsLit(LEARN_FILE)};
            if (!fs.existsSync(file)) return;
            const ageSec = (Date.now() - fs.statSync(file).mtimeMs) / 1000;
            if (ageSec > 300) {
              console.log("");
              console.log("[Engram] LEARN was not recorded this session. That's fine if nothing reusable surfaced.");
              console.log("         If something did, call knit_record_learning in your next session.");
              console.log("");
            }
          } catch (e) {}
        `),
        timeout: 5,
        statusMessage: 'Engram: checking LEARN compliance...',
      },
    ],
  });

  // KB metrics — update knowledgebase.json with session summary tuple
  hooks.Stop.push({
    _knitOwned: true,
    hooks: [
      {
        type: 'command',
        command: nodeHook(`
          try {
            const fs = require("fs");
            ${REPO_ROOT_JS}
            ${GIT_GET_JS}
            const p = ${jsLit(KB_PATH)};
            if (!fs.existsSync(p)) return;
            const kb = JSON.parse(fs.readFileSync(p, "utf-8"));
            const root = __getRoot();
            const files = __git("git diff --name-only HEAD", root).split("\\n").filter(Boolean).length;
            const branch = __git("git branch --show-current", root, null) || null;
            kb.metrics.totalSessions++;
            kb.metrics.sessions.push({
              date: new Date().toISOString().split("T")[0],
              branch: branch,
              filesModified: files,
              learningsAccessed: 0,
              learningsAdded: 0,
              domainsTouched: [],
            });
            if (kb.metrics.sessions.length > 20) kb.metrics.sessions = kb.metrics.sessions.slice(-20);
            fs.writeFileSync(p, JSON.stringify(kb, null, 2));
          } catch (e) {}
        `),
        timeout: 10,
        statusMessage: 'Engram: updating session metrics...',
      },
    ],
  });

  return hooks;
}

/**
 * Generates .claude/settings.local.json permissions allowlist (separate from hooks).
 * Cross-platform: same allowlist works on all OSes since these are Claude Code
 * permission scopes, not shell commands.
 */
export function generateSettingsLocal(config: KnitConfig): object {
  const allow: string[] = [
    'Bash(git:*)',
    'Bash(gh:*)',
    'Bash(curl:*)',
    'Bash(ls:*)',
    'Bash(mkdir:*)',
    'Bash(cat:*)',
    'Bash(find:*)',
    'Bash(grep:*)',
    'Bash(sort:*)',
    'Bash(diff:*)',
    'Bash(which:*)',
    'Bash(node:*)',
    'WebSearch',
  ];

  if (config.stack.language === 'typescript' || config.stack.language === 'javascript') {
    allow.push('Bash(npm:*)', 'Bash(npm run:*)', 'Bash(npx:*)');
    if (config.packageManager === 'pnpm') allow.push('Bash(pnpm:*)');
    if (config.packageManager === 'yarn') allow.push('Bash(yarn:*)');
    if (config.packageManager === 'bun') allow.push('Bash(bun:*)', 'Bash(bunx:*)');
  }

  if (config.stack.language === 'python') {
    allow.push('Bash(python3:*)', 'Bash(pip:*)', 'Bash(uv:*)', 'Bash(pytest:*)');
  }

  if (config.stack.language === 'go') {
    allow.push('Bash(go:*)');
  }

  if (config.stack.language === 'rust') {
    allow.push('Bash(cargo:*)', 'Bash(rustc:*)');
  }

  return {
    permissions: { allow },
    prefersReducedMotion: false,
  };
}
