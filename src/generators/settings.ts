import type { KnitConfig } from '../engine/types.js';
import {
  knowledgebasePath,
  learningsFilePath,
  sessionsLogPath,
  sessionsJsonlPath,
  projectDataDir,
  learningsDir,
  classificationMarkerPath,
  claimMarkerPath,
  protocolConfigPath,
  sessionMarkerPath,
  searchMarkerPath,
  turnEditLogPath,
  knowledgePath,
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
 *   v4 — 0.6.0+: rename engram→knit (marker tag and tool names)
 *   v5 — 0.6.3+: shell-quoting fix in nodeHook + rename remaining hook
 *                status messages from Engram→Knit
 *   v6 — 0.6.4+: wrap nodeHook payload in IIFE so `return` early-exits
 *                are legal under Node 22+/25+ (`node -e` is strict about
 *                top-level returns)
 *   v7 — 0.9.0+: v0.9 hook-level enforcement — search-marker clear on
 *                UserPromptSubmit, search-gate in PreToolUse Edit, pre/post
 *                import validation, Stop-hook budget watch
 *   v8 — 0.11.0+: v0.11 Verify Layer — claim-marker clear on UserPromptSubmit,
 *                 Stop-hook claim-verified gate on standard/complex scope
 *                 (warn/block per protocol-config strictness)
 *   v9 — 0.11.0 slice 2: PostToolUse diff-verify + per-file tsc check
 *                 catches SDK quirks at edit time (wrong import paths,
 *                 narrowing failures, async contract mismatches) without
 *                 waiting for the Stop-hook build verification.
 *  v10 — 0.11.0 slice 3: PostToolUse appends to .turn-edits.jsonl;
 *                 UserPromptSubmit clears it; Stop-hook compares the
 *                 touched-file set against the classification marker
 *                 and surfaces scope/risk drift before LEARN.
 */
export const HOOKS_VERSION = 10;

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

/** Compress a multiline JS snippet into a single-line `node -e '...'` shell command.
 *  - Wraps the script in `(() => { … })()` so `return` early-exits work under
 *    Node 22+/25+ where `node -e` is strict about top-level return statements.
 *  - POSIX-safe: any single quote inside the script is escaped via the standard
 *    '\'' close-escape-reopen trick so apostrophes in console.log strings can't
 *    prematurely terminate the outer quote and break the Stop hook at runtime. */
function nodeHook(script: string): string {
  const compact = script
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, '').trim())  // strip line comments
    .filter((l) => l.length > 0)
    .join(' ');
  const wrapped = `(() => { ${compact} })();`;
  const escaped = wrapped.replace(/'/g, `'\\''`);
  return `node -e '${escaped}'`;
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
  const SEARCH_MARKER = searchMarkerPath(rootPath);
  const CLAIM_MARKER = claimMarkerPath(rootPath);
  const TURN_EDIT_LOG = turnEditLogPath(rootPath);
  const CLAUDE_MD = `${rootPath}/CLAUDE.md`;
  // KNOWLEDGE_JSON exists in the import surface for future hook-side use
  // (e.g. cross-checking imports against the indexed graph) but is not yet
  // referenced. Keep the path helper accessible via the import.
  void knowledgePath;

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
                // v0.9 #5: per-turn search marker is also cleared at the turn boundary
                // so the next non-trivial task has to call knit_search_learnings again.
                const sm = ${jsLit(SEARCH_MARKER)};
                if (fs.existsSync(sm)) fs.rmSync(sm, { force: true });
                // v0.11 slice 1: per-turn claim-verified marker — Stop-hook gate
                // requires fresh verify_claim per non-trivial task.
                const cm = ${jsLit(CLAIM_MARKER)};
                if (fs.existsSync(cm)) fs.rmSync(cm, { force: true });
                // v0.11 slice 3: per-turn edit log — the Stop-hook drift detector
                // re-classifies the actual touched set and surfaces scope creep.
                const tl = ${jsLit(TURN_EDIT_LOG)};
                if (fs.existsSync(tl)) fs.rmSync(tl, { force: true });
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
                    console.log(JSON.stringify({ decision: "block", reason: "Destructive git operation blocked by Knit. Ask the user first." }));
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
                const searchMarkerPath = ${jsLit(SEARCH_MARKER)};
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
                // Classification gate (v0.5).
                const hasMarker = fs.existsSync(markerPath);
                if (!hasMarker) {
                  if (level === "block") {
                    console.error("[knit] BLOCKED: call knit_classify_task before Edit/Write. The Protocol Guard prevents implementation without classification.");
                    process.exit(2);
                  }
                  console.error("[knit] reminder: call knit_classify_task before Edit/Write. Set strictness=block via knit_set_protocol_strictness to make this a hard gate.");
                  return;
                }
                // v0.9 #5: search gate. For standard/complex tasks, knit_search_learnings
                // (or knit_search_global_learnings) must run before the Edit lands —
                // otherwise the agent is re-investigating without checking memory.
                try {
                  const marker = JSON.parse(fs.readFileSync(markerPath, "utf-8"));
                  if (marker && (marker.tier === "standard" || marker.tier === "complex")) {
                    if (!fs.existsSync(searchMarkerPath)) {
                      if (level === "block") {
                        console.error("[knit] BLOCKED: " + marker.tier + " task — call knit_search_learnings or knit_search_global_learnings before Edit/Write so memory is checked before re-investigation.");
                        process.exit(2);
                      }
                      console.error("[knit] reminder: " + marker.tier + " task — call knit_search_learnings before Edit/Write. Skipping memory check means re-doing work the project already learned.");
                    }
                  }
                } catch (markerErr) {
                  // Marker exists but JSON unreadable — be lenient.
                }
              } catch (hookErr) {
                console.error("[knit] protocol-guard hook crashed, allowing tool through:", hookErr && hookErr.message ? hookErr.message : hookErr);
              }
            `),
            timeout: 5,
          },
        ],
      },
      // v0.9 #9 — Pre-write content inspection. Reads the proposed Write/Edit
      // content from tool_input, parses local import statements, and reports
      // any relative paths that don't resolve on disk. Warn-level by default
      // (the existing classification gate handles block mode); soft signal,
      // never blocks on its own.
      {
        _knitOwned: true,
        matcher: 'Write|Edit|MultiEdit',
        hooks: [
          {
            type: 'command',
            command: nodeHook(`
              let d = "";
              process.stdin.on("data", (c) => d += c);
              process.stdin.on("end", () => {
                try {
                  const fs = require("fs");
                  const path = require("path");
                  const i = JSON.parse(d);
                  const filePath = (i.tool_input && i.tool_input.file_path) || "";
                  if (!/\\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(filePath)) return;
                  // Pull proposed content from any of the Edit/Write shapes.
                  let content = (i.tool_input && (i.tool_input.content || i.tool_input.new_string)) || "";
                  if (i.tool_input && Array.isArray(i.tool_input.edits)) {
                    content = i.tool_input.edits.map((e) => e && e.new_string ? e.new_string : "").join("\\n");
                  }
                  if (!content) return;
                  const dir = path.dirname(filePath);
                  const re = /^import\\s+(?:[^'"]+?\\s+from\\s+)?['"]([^'"]+)['"]/gm;
                  const unresolved = [];
                  let m;
                  while ((m = re.exec(content)) !== null) {
                    const target = m[1];
                    if (!target.startsWith(".") && !target.startsWith("/")) continue;
                    const candidates = [target, target + ".ts", target + ".tsx", target + ".js", target + ".jsx", target + "/index.ts", target + "/index.tsx", target + "/index.js"];
                    let resolved = false;
                    for (const c of candidates) {
                      const abs = path.resolve(dir, c);
                      if (fs.existsSync(abs)) { resolved = true; break; }
                    }
                    if (!resolved) unresolved.push(target);
                  }
                  if (unresolved.length > 0) {
                    console.error("[knit] heads-up: proposed edit references " + unresolved.length + " unresolved relative import(s): " + unresolved.join(", ") + ". Likely hallucinated paths — verify with knit_query_imports or knit_verify_claim before relying on them.");
                  }
                } catch (e) {}
              });
            `),
            timeout: 5,
          },
        ],
      },
    ],
    PostToolUse: [],
    Stop: [],
  };

  // v0.11 slice 3 — Turn-edit appender. Every Edit/Write/MultiEdit appends
  // its file_path to .turn-edits.jsonl. The Stop hook then reads the whole
  // set and compares against the classification marker to surface drift
  // (e.g., trivial classification but turn actually touched 7 files).
  hooks.PostToolUse.push({
    _knitOwned: true,
    matcher: 'Write|Edit|MultiEdit',
    hooks: [
      {
        type: 'command',
        command: nodeHook(`
          let d = "";
          process.stdin.on("data", (c) => d += c);
          process.stdin.on("end", () => {
            try {
              const fs = require("fs");
              const path = require("path");
              const i = JSON.parse(d);
              const ti = i.tool_input || {};
              const f = ti.file_path || (i.tool_response && i.tool_response.filePath) || "";
              if (!f) return;
              const logPath = ${jsLit(TURN_EDIT_LOG)};
              fs.mkdirSync(path.dirname(logPath), { recursive: true });
              fs.appendFileSync(logPath, JSON.stringify({ file: f, ts: new Date().toISOString() }) + "\\n");
            } catch (e) { try { process.stderr.write('[knit] turn-edit appender hook failed: ' + (e && e.message ? e.message : e) + '\\n'); } catch {} }
          });
        `),
        timeout: 5,
      },
    ],
  });

  // v0.11 slice 2 — Diff verification. After Edit/Write/MultiEdit, re-read
  // the file from disk and verify the intended content actually landed.
  // Catches: silent partial edits, accidental no-ops, encoding corruption,
  // and the rare "tool succeeded but file is unchanged" case. Logs at
  // stderr only — never blocks. Pairs with the post-write import validator
  // (v0.9 #3) and the universal tsc check (slice 2 below) for a complete
  // anti-slop PostToolUse triplet.
  hooks.PostToolUse.push({
    _knitOwned: true,
    matcher: 'Write|Edit|MultiEdit',
    hooks: [
      {
        type: 'command',
        command: nodeHook(`
          let d = "";
          process.stdin.on("data", (c) => d += c);
          process.stdin.on("end", () => {
            try {
              const fs = require("fs");
              const i = JSON.parse(d);
              const toolName = i.tool_name || "";
              const ti = i.tool_input || {};
              const f = ti.file_path || (i.tool_response && i.tool_response.filePath) || "";
              if (!f || !fs.existsSync(f)) return;
              const cur = fs.readFileSync(f, "utf-8");
              if (toolName === "Write") {
                const intended = ti.content || "";
                if (cur === intended) {
                  console.error("[knit] verify: write landed — " + f);
                } else {
                  const lenDelta = cur.length - intended.length;
                  console.error("[knit] verify: write DRIFTED — " + f + " differs by " + lenDelta + " char(s) from intent. Something modified the file after Write.");
                }
              } else if (toolName === "Edit") {
                const newStr = ti.new_string || "";
                const oldStr = ti.old_string || "";
                if (newStr && cur.indexOf(newStr) !== -1) {
                  console.error("[knit] verify: edit landed — " + f);
                } else if (oldStr && cur.indexOf(oldStr) !== -1) {
                  console.error("[knit] verify: edit DRIFTED — " + f + " still contains the old_string. Edit may have silently failed.");
                } else {
                  console.error("[knit] verify: edit ambiguous — " + f + " contains neither new_string nor old_string. Inspect manually.");
                }
              } else if (toolName === "MultiEdit") {
                const edits = Array.isArray(ti.edits) ? ti.edits : [];
                let landed = 0;
                let drifted = 0;
                for (const e of edits) {
                  if (e && e.new_string && cur.indexOf(e.new_string) !== -1) landed++;
                  else drifted++;
                }
                if (drifted === 0) {
                  console.error("[knit] verify: all " + landed + " edits landed — " + f);
                } else {
                  console.error("[knit] verify: " + drifted + " of " + (landed + drifted) + " edits DRIFTED — " + f + ". Some new_string values not found in file post-edit.");
                }
              }
            } catch (e) { try { process.stderr.write('[knit] diff verifier hook failed: ' + (e && e.message ? e.message : e) + '\\n'); } catch {} }
          });
        `),
        timeout: 5,
        statusMessage: 'Knit: verifying edit landed...',
      },
    ],
  });

  // v0.11 slice 2 — Universal post-edit tsc check. The architectural answer
  // to SDK quirks that plan-mode reviewers can't predict (wrong type import
  // paths, undefined-until-loaded narrowing, async contract mismatches).
  // Runs project-wide tsc on every .ts/.tsx Edit/Write so cross-file type
  // errors surface immediately — not at the next Stop or CI run.
  //
  // Universal: detects tsconfig.json at runtime rather than gating on
  // config-time language detection. Catches the case where Knit's setup
  // missed the language or the user is in a fresh project. Falls back to
  // `npx tsc` if local tsc isn't installed.
  hooks.PostToolUse.push({
    _knitOwned: true,
    matcher: 'Write|Edit|MultiEdit',
    hooks: [
      {
        type: 'command',
        command: nodeHook(`
          let d = "";
          process.stdin.on("data", (c) => d += c);
          process.stdin.on("end", () => {
            try {
              const fs = require("fs");
              const path = require("path");
              const cp = require("child_process");
              const i = JSON.parse(d);
              const ti = i.tool_input || {};
              const f = ti.file_path || (i.tool_response && i.tool_response.filePath) || "";
              if (!/\\.(?:ts|tsx|mts|cts)$/.test(f)) return;
              // Walk up to find tsconfig.json (project root).
              let dir = path.dirname(f);
              let projectRoot = null;
              for (let depth = 0; depth < 10; depth++) {
                if (fs.existsSync(path.join(dir, "tsconfig.json"))) { projectRoot = dir; break; }
                const parent = path.dirname(dir);
                if (parent === dir) break;
                dir = parent;
              }
              if (!projectRoot) return;
              // Prefer local tsc; fall back to npx.
              const localTsc = path.join(projectRoot, "node_modules", ".bin", "tsc");
              const tscCmd = fs.existsSync(localTsc) ? JSON.stringify(localTsc) : "npx --no-install tsc";
              let out = "";
              let failed = false;
              try {
                cp.execSync(tscCmd + " --noEmit --pretty false", { cwd: projectRoot, stdio: ["ignore", "pipe", "pipe"], timeout: 15000, encoding: "utf-8" });
              } catch (err) {
                failed = true;
                out = (err && (err.stdout || err.stderr) || "").toString();
              }
              if (!failed) {
                console.error("[knit] tsc check: clean — " + f);
                return;
              }
              // Filter tsc output to errors mentioning the touched file (or its dir).
              const touched = path.basename(f);
              const lines = out.split("\\n").map((s) => s.trim()).filter(Boolean);
              const relevant = lines.filter((l) => l.indexOf(touched) !== -1 || l.indexOf(f) !== -1);
              const errorCount = lines.filter((l) => /error TS\\d+:/.test(l)).length;
              if (relevant.length > 0) {
                console.error("[knit] tsc check: " + relevant.length + " error(s) referencing " + touched + ":");
                for (const l of relevant.slice(0, 6)) console.error("  " + l);
                if (relevant.length > 6) console.error("  ... and " + (relevant.length - 6) + " more");
              } else if (errorCount > 0) {
                console.error("[knit] tsc check: project has " + errorCount + " type error(s) (none in " + touched + " directly — likely a cross-file ripple). Run \`npx tsc --noEmit\` for full output.");
              }
            } catch (e) { try { process.stderr.write('[knit] tsc check hook failed: ' + (e && e.message ? e.message : e) + '\\n'); } catch {} }
          });
        `),
        timeout: 20,
        statusMessage: 'Knit: tsc on edit...',
      },
    ],
  });

  // v0.9 #3 — Post-write import validation. After the file lands on disk,
  // re-parse imports and report any unresolved relative paths. Catches
  // anything that slipped past the pre-write check (#9) — e.g. a MultiEdit
  // that combined snippets in a way the static check missed.
  hooks.PostToolUse.push({
    _knitOwned: true,
    matcher: 'Write|Edit|MultiEdit',
    hooks: [
      {
        type: 'command',
        command: nodeHook(`
          let d = "";
          process.stdin.on("data", (c) => d += c);
          process.stdin.on("end", () => {
            try {
              const fs = require("fs");
              const path = require("path");
              const i = JSON.parse(d);
              const f = (i.tool_input && i.tool_input.file_path) || (i.tool_response && i.tool_response.filePath) || "";
              if (!/\\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(f)) return;
              if (!fs.existsSync(f)) return;
              const content = fs.readFileSync(f, "utf-8");
              const dir = path.dirname(f);
              const re = /^import\\s+(?:[^'"]+?\\s+from\\s+)?['"]([^'"]+)['"]/gm;
              const unresolved = [];
              let m;
              while ((m = re.exec(content)) !== null) {
                const target = m[1];
                if (!target.startsWith(".") && !target.startsWith("/")) continue;
                const candidates = [target, target + ".ts", target + ".tsx", target + ".js", target + ".jsx", target + "/index.ts", target + "/index.tsx", target + "/index.js"];
                let resolved = false;
                for (const c of candidates) {
                  if (fs.existsSync(path.resolve(dir, c))) { resolved = true; break; }
                }
                if (!resolved) unresolved.push(target);
              }
              if (unresolved.length > 0) {
                console.error("[knit] post-write check: " + f + " has " + unresolved.length + " unresolved relative import(s): " + unresolved.join(", ") + ". Run typecheck before relying on this file.");
              }
            } catch (e) {}
          });
        `),
        timeout: 5,
        statusMessage: 'Knit: validating imports...',
      },
    ],
  });

  // Superseded by the universal v0.11 slice 2 tsc-check hook above.
  // The new hook runs the same `tsc --noEmit --pretty false` but:
  //  - detects tsconfig.json at runtime instead of gating on config-time
  //    stack detection (catches projects where Knit setup missed the
  //    language or the user installed Knit into a half-configured tree),
  //  - filters output to errors mentioning the touched file, and
  //  - reports cross-file ripples explicitly so a Clerk-style narrowing
  //    error in a SHARED type surfaces even when the edit was elsewhere.

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
          statusMessage: 'Knit: final build verification...',
        },
      ],
    });
  }

  // v0.11 slice 3 — Stop-hook drift detector. Reads .turn-edits.jsonl and
  // the classification marker; if the touched set is inconsistent with the
  // original classification (more files than declared, or risky files in
  // a low-risk classification), logs scope/risk drift to stderr. Doesn't
  // block — just surfaces the silent scope-creep failure mode.
  hooks.Stop.push({
    _knitOwned: true,
    hooks: [
      {
        type: 'command',
        command: nodeHook(`
          try {
            const fs = require("fs");
            const path = require("path");
            const classifiedPath = ${jsLit(CLASSIFIED_MARKER)};
            const logPath = ${jsLit(TURN_EDIT_LOG)};
            if (!fs.existsSync(classifiedPath) || !fs.existsSync(logPath)) return;
            let marker;
            try {
              marker = JSON.parse(fs.readFileSync(classifiedPath, "utf-8"));
            } catch (e) { return; }
            const originalScope = (marker && (marker.scopeTier || marker.tier)) || "";
            const originalRisk = (marker && marker.riskTier) || "low";
            if (!originalScope) return;
            // Parse turn-edit log → unique file set.
            const seen = new Set();
            const raw = fs.readFileSync(logPath, "utf-8");
            for (const line of raw.split("\\n")) {
              if (!line.trim()) continue;
              try { const e = JSON.parse(line); if (e.file) seen.add(e.file); } catch (e2) {}
            }
            const touched = Array.from(seen);
            const n = touched.length;
            if (n === 0) return;
            // Scope drift: trivial classification but turn touched 3+ files.
            const scopeDrift = (originalScope === "trivial" && n >= 3) ||
                               (originalScope === "standard" && n >= 6);
            // Risk drift: low-risk classification but turn touched risky files.
            const riskyPatterns = /(\\btypes?\\.tsx?|\\bschema\\.|\\bauth\\.|\\bsecurity\\.|migrations?\\/)/i;
            const riskyHit = touched.find((f) => riskyPatterns.test(f));
            const riskDrift = originalRisk === "low" && !!riskyHit;
            if (!scopeDrift && !riskDrift) return;
            console.error("[knit] drift detector — turn touched " + n + " file(s); classification was scope=" + originalScope + ", risk=" + originalRisk);
            if (scopeDrift) {
              console.error("  scope drift: " + n + " files exceeds the " + originalScope + " threshold. Next time, re-classify when scope grows.");
            }
            if (riskDrift) {
              console.error("  risk drift: low-risk classification but touched " + riskyHit + " — high-risk pattern (types/schema/auth/migrations). Should have triggered plan mode.");
            }
            console.error("  touched: " + touched.slice(0, 8).join(", ") + (touched.length > 8 ? " ... and " + (touched.length - 8) + " more" : ""));
          } catch (e) {}
        `),
        timeout: 5,
        statusMessage: 'Knit: drift detector...',
      },
    ],
  });

  // v0.11 slice 1 — Stop-hook claim-verified gate. The REVIEW phase of the
  // protocol requires that standard/complex scope tasks verify ≥1 claim
  // against the knowledge graph before LEARN. The marker is written by
  // knit_verify_claim and cleared on each UserPromptSubmit. Strictness levels:
  //    off    → no-op
  //    warn   → stderr reminder
  //    block  → exit 2 (interrupts the Stop, surfaces the gate strongly)
  // Reads scope_tier off the classification marker (back-compat: falls back
  // to legacy `tier` field if a v0.9.x marker is on disk).
  hooks.Stop.push({
    _knitOwned: true,
    hooks: [
      {
        type: 'command',
        command: nodeHook(`
          try {
            const fs = require("fs");
            const cfgPath = ${jsLit(PROTOCOL_CONFIG)};
            const classifiedPath = ${jsLit(CLASSIFIED_MARKER)};
            const claimPath = ${jsLit(CLAIM_MARKER)};
            let level = "warn";
            if (fs.existsSync(cfgPath)) {
              try {
                const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
                if (cfg && (cfg.level === "off" || cfg.level === "warn" || cfg.level === "block")) level = cfg.level;
              } catch (parseErr) {}
            }
            if (level === "off") return;
            if (!fs.existsSync(classifiedPath)) return;
            let scope;
            try {
              const marker = JSON.parse(fs.readFileSync(classifiedPath, "utf-8"));
              scope = (marker && (marker.scopeTier || marker.tier)) || "";
            } catch (e) { return; }
            if (scope !== "standard" && scope !== "complex") return;
            if (fs.existsSync(claimPath)) return;
            if (level === "block") {
              console.error("[knit] BLOCKED: " + scope + " task ended without verify_claim. The REVIEW gate requires ≥1 knit_verify_claim call before LEARN — verify the agent's claims against the knowledge graph or rerun.");
              process.exit(2);
            }
            console.error("[knit] reminder: " + scope + " task ended without knit_verify_claim. The REVIEW gate is the anti-slop guard — verify the agent's claims against the graph before declaring done. Set strictness=block via knit_set_protocol_strictness to make this hard.");
          } catch (e) {}
        `),
        timeout: 5,
        statusMessage: 'Knit: REVIEW claim-gate...',
      },
    ],
  });

  // v0.9 #4 — Stop hook budget watch. Cheap CLAUDE.md size check that runs
  // at session end. The token-budget guardrail in knit_brain_status is read
  // on demand; this surfaces drift even when the agent doesn't call status.
  // Reads the size from disk and prints a warning if it crosses the 25%
  // over-budget threshold (12.5KB for a 10KB target — generous because we
  // don't want false positives on legitimately large projects).
  hooks.Stop.push({
    _knitOwned: true,
    hooks: [
      {
        type: 'command',
        command: nodeHook(`
          try {
            const fs = require("fs");
            const p = ${jsLit(CLAUDE_MD)};
            if (!fs.existsSync(p)) return;
            const size = fs.statSync(p).size;
            if (size > 12500) {
              console.error("[knit] budget watch: CLAUDE.md is " + Math.round(size/1024*10)/10 + "KB (target 6.5KB; over-budget threshold 12.5KB). Call knit_brain_status to confirm and consider regenerating via knit refresh.");
            }
          } catch (e) {}
        `),
        timeout: 5,
        statusMessage: 'Knit: budget check...',
      },
    ],
  });

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
        statusMessage: 'Knit: capturing session state...',
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
        statusMessage: 'Knit: recording session tuple...',
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
              console.log("[Knit] LEARN was not recorded this session. That's fine if nothing reusable surfaced.");
              console.log("         If something did, call knit_record_learning in your next session.");
              console.log("");
            }
          } catch (e) {}
        `),
        timeout: 5,
        statusMessage: 'Knit: checking LEARN compliance...',
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
        statusMessage: 'Knit: updating session metrics...',
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
