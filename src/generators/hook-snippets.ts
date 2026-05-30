/**
 * v0.22 — shared hook substrate, factored out of settings.ts so the per-host
 * writers (cursor.ts / codex.ts / copilot.ts) reuse ONE portable Node payload
 * compiler and ONE set of brain-side snippet bodies. Only the host manifest
 * (event names, file location, how the host passes input) differs per host —
 * the Knit-side logic embedded in each hook is identical.
 *
 * IMPORTANT honesty boundary: the BODIES here are host-input-INDEPENDENT — they
 * read Knit's brain via paths embedded at generate time, so they behave the same
 * on any host. What is NOT verifiable from this machine is each non-Claude host's
 * hook INPUT contract (which JSON field carries the edited file / tool name) and
 * its event names. Those live in the per-host writers and are marked unverified.
 */
import {
  classificationMarkerPath,
  searchMarkerPath,
  claimMarkerPath,
  turnEditLogPath,
  sessionMarkerPath,
} from '../engine/paths.js';

/** Embed a string as a JS string literal: forward-slash paths + JSON-quoted. */
export function jsLit(s: string): string {
  return JSON.stringify(s.replace(/\\/g, '/'));
}

/**
 * Compress a multiline JS snippet into a single-line `node -e '...'` command.
 * Wraps in `(() => { … })()` so `return` early-exits are legal under Node 22+/25+,
 * and POSIX-escapes single quotes so apostrophes in strings can't break the outer
 * quote. Identical to the original settings.ts implementation (output-preserving).
 */
export function nodeHook(script: string): string {
  const compact = script
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, '').trim())
    .filter((l) => l.length > 0)
    .join(' ');
  const wrapped = `(() => { ${compact} })();`;
  const escaped = wrapped.replace(/'/g, `'\\''`);
  return `node -e '${escaped}'`;
}

/** JS helper: resolve the canonical repo root via git, falling back to cwd. */
export const REPO_ROOT_JS = `
  const __getRoot = () => {
    try {
      return require("child_process").execSync("git rev-parse --show-toplevel", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch { return process.cwd(); }
  };
`;

/** JS helper: run a git command in the repo root and return stdout. */
export const GIT_GET_JS = `
  const __git = (cmd, root, fallback) => {
    try {
      return require("child_process").execSync(cmd, { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch { return fallback === undefined ? "" : fallback; }
  };
`;

/** The per-project marker paths a hook body reads/writes, resolved at generate time. */
export interface HookPaths {
  sessionMarker: string;
  classifiedMarker: string;
  searchMarker: string;
  claimMarker: string;
  turnEditLog: string;
}

export function hookPaths(rootPath: string): HookPaths {
  return {
    sessionMarker: sessionMarkerPath(rootPath),
    classifiedMarker: classificationMarkerPath(rootPath),
    searchMarker: searchMarkerPath(rootPath),
    claimMarker: claimMarkerPath(rootPath),
    turnEditLog: turnEditLogPath(rootPath),
  };
}

// ── Brain-side snippet bodies (host-input-independent) ──────────────────────

/** T1 — session start: drop the session marker + remind to call load_session. */
export function sessionStartBody(p: HookPaths): string {
  return `
    try {
      const fs = require("fs");
      const path = require("path");
      const m = ${jsLit(p.sessionMarker)};
      fs.mkdirSync(path.dirname(m), { recursive: true });
      fs.writeFileSync(m, new Date().toISOString());
      console.error("[knit] session marker written. Call knit_load_session as your first MCP call.");
    } catch (e) {}
  `;
}

/** Turn boundary — invalidate the per-turn protocol markers so the next task
 *  must re-classify / re-search / re-verify. Host-input-independent. */
export function turnResetBody(p: HookPaths): string {
  return `
    try {
      const fs = require("fs");
      for (const f of [${jsLit(p.classifiedMarker)}, ${jsLit(p.searchMarker)}, ${jsLit(p.claimMarker)}, ${jsLit(p.turnEditLog)}]) {
        if (fs.existsSync(f)) fs.rmSync(f, { force: true });
      }
    } catch (e) {}
  `;
}

/**
 * T2 — pre-edit reminder (SOFT). Reads the classification marker and reminds the
 * agent to classify first. Deliberately a reminder, never a hard block: on the
 * non-Claude hosts there is no reliable pre-edit BLOCK mechanism (Cursor has no
 * beforeFileEdit; Codex/Copilot block semantics are unverified), so faking one
 * would be dishonest. The hard pre-edit gate stays Claude-only (settings.ts).
 */
export function preEditReminderBody(p: HookPaths): string {
  return `
    try {
      const fs = require("fs");
      if (!fs.existsSync(${jsLit(p.classifiedMarker)})) {
        console.error("[knit] reminder: call knit_classify_task before editing — so the task is tiered and the verify/LEARN gates run.");
      }
    } catch (e) {}
  `;
}

/** T4 — stop: LEARN reminder when a task was classified but no claim was verified.
 *  Reads markers only — host-input-independent. */
export function stopLearnReminderBody(p: HookPaths): string {
  return `
    try {
      const fs = require("fs");
      const classified = fs.existsSync(${jsLit(p.classifiedMarker)});
      if (!classified) return;
      if (!fs.existsSync(${jsLit(p.claimMarker)})) {
        console.error("[knit] before LEARN: verify >=1 codebase claim with knit_verify_claim, then knit_record_learning if something non-obvious surfaced.");
      }
    } catch (e) {}
  `;
}
