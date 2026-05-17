import type { EngramConfig } from '../engine/types.js';
import {
  knowledgebasePath,
  learningsFilePath,
  sessionsLogPath,
  sessionsJsonlPath,
  projectDataDir,
  learningsDir,
} from '../engine/paths.js';

/**
 * Generates .claude/settings.json with hooks for the detected stack.
 * Engram data paths are resolved at generation time and embedded into the
 * shell commands — keeps hooks fast, no runtime hash computation needed.
 *
 * rootPath must be the canonical repo root (not a worktree path) so that
 * embedded paths resolve to the shared brain for all worktrees of this project.
 */
export function generateSettings(config: EngramConfig, rootPath: string): object {
  return {
    mcpServers: {
      'engram-brain': {
        command: 'npx',
        args: ['-y', '@piyushdua/engram-dev@latest'],
      },
    },
    hooks: generateHooks(config, rootPath),
    // Tag so engram can recognize a file it wrote (vs a user-curated settings.json)
    _engramHooks: { version: 1, generatedAt: new Date().toISOString() },
  };
}

/** Shell snippet that finds project root dynamically (works inside worktrees too). */
const ROOT_CMD = 'ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)';

/** Wrap a command to fail-soft (never block the agent). */
function softCommand(cmd: string): string {
  return `${cmd} 2>/dev/null || true`;
}

function generateHooks(config: EngramConfig, rootPath: string) {
  // Centralized engram paths, resolved once at generation time
  const KB_PATH = knowledgebasePath(rootPath);
  const LEARN_FILE = learningsFilePath(rootPath, config.name);
  const SESSIONS_MD = sessionsLogPath(rootPath);
  const SESSIONS_JSONL = sessionsJsonlPath(rootPath);
  const LEARN_DIR = learningsDir(rootPath);
  const ENGRAM_DIR = projectDataDir(rootPath);

  const hooks: Record<string, unknown[]> = {
    PreToolUse: [
      {
        matcher: 'Bash',
        hooks: [
          {
            type: 'command',
            command: `jq -r '.tool_input.command // empty' | grep -qE '^git\\s+(push\\b.*\\s(--force|-f)|reset\\s+--hard|commit.*--no-verify)' && echo '{"decision":"block","reason":"Destructive git operation blocked by Engram. Ask the user first."}' || true`,
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
      matcher: 'Write|Edit',
      hooks: [
        {
          type: 'command',
          command: `jq -r '.tool_input.file_path // .tool_response.filePath // empty' | { read -r f; case "$f" in *.ts|*.tsx) ${ROOT_CMD} && cd "$ROOT" && npx tsc --noEmit --pretty false 2>&1 | head -10 ;; esac; } 2>/dev/null || true`,
          timeout: 30,
          statusMessage: 'Type checking...',
        },
      ],
    });
  }

  // Python lint on edit
  if (config.stack.language === 'python') {
    hooks.PostToolUse.push({
      matcher: 'Write|Edit',
      hooks: [
        {
          type: 'command',
          command: `jq -r '.tool_input.file_path // .tool_response.filePath // empty' | { read -r f; case "$f" in *.py) ${ROOT_CMD} && cd "$ROOT" && python3 -m py_compile "$f" 2>&1 ;; esac; } 2>/dev/null || true`,
          timeout: 15,
          statusMessage: 'Checking Python syntax...',
        },
      ],
    });
  }

  // Go vet on edit
  if (config.stack.language === 'go') {
    hooks.PostToolUse.push({
      matcher: 'Write|Edit',
      hooks: [
        {
          type: 'command',
          command: `jq -r '.tool_input.file_path // .tool_response.filePath // empty' | { read -r f; case "$f" in *.go) ${ROOT_CMD} && cd "$ROOT" && go vet ./... 2>&1 | head -10 ;; esac; } 2>/dev/null || true`,
          timeout: 30,
          statusMessage: 'Running go vet...',
        },
      ],
    });
  }

  // Rust check on edit
  if (config.stack.language === 'rust') {
    hooks.PostToolUse.push({
      matcher: 'Write|Edit',
      hooks: [
        {
          type: 'command',
          command: `jq -r '.tool_input.file_path // .tool_response.filePath // empty' | { read -r f; case "$f" in *.rs) ${ROOT_CMD} && cd "$ROOT" && cargo check 2>&1 | head -10 ;; esac; } 2>/dev/null || true`,
          timeout: 60,
          statusMessage: 'Running cargo check...',
        },
      ],
    });
  }

  // Build verification on stop
  const stopCommands: string[] = [];
  if (config.stack.typecheckCommand) stopCommands.push(`echo '--- TYPECHECK ---' && ${config.stack.typecheckCommand} 2>&1 | tail -3`);
  if (config.stack.lintCommand) stopCommands.push(`echo '--- LINT ---' && ${config.stack.lintCommand} 2>&1 | tail -3`);
  if (config.stack.buildCommand) stopCommands.push(`echo '--- BUILD ---' && ${config.stack.buildCommand} 2>&1 | tail -5`);

  if (stopCommands.length > 0) {
    hooks.Stop.push({
      hooks: [
        {
          type: 'command',
          command: `${ROOT_CMD} && cd "$ROOT" && ${stopCommands.join(' && ')} || true`,
          timeout: 120,
          statusMessage: 'Engram: final build verification...',
        },
      ],
    });
  }

  // Session learnings log on stop — narrative human-readable log (legacy format)
  hooks.Stop.push({
    hooks: [
      {
        type: 'command',
        command: softCommand(
          `${ROOT_CMD} && mkdir -p "${LEARN_DIR}" && FILE="${SESSIONS_MD}" && if [ ! -f "$FILE" ]; then echo '# Session Log' > "$FILE"; fi && echo '' >> "$FILE" && echo "## Session $(date -u '+%Y-%m-%d %H:%M:%S UTC')" >> "$FILE" && BRANCH=$(cd "$ROOT" && git branch --show-current 2>/dev/null) && COMMITS=$(cd "$ROOT" && git log --oneline -3 2>/dev/null | sed 's/^/  - /') && echo "- Branch: $BRANCH" >> "$FILE" && echo "- Recent commits:" >> "$FILE" && echo "$COMMITS" >> "$FILE" && CHANGED=$(cd "$ROOT" && git diff --stat HEAD 2>/dev/null | tail -1) && [ -n "$CHANGED" ] && echo "- Uncommitted: $CHANGED" >> "$FILE" && echo '' >> "$FILE"`,
        ),
        timeout: 10,
        statusMessage: 'Engram: capturing session state...',
      },
    ],
  });

  // Session JSONL tuple on stop — structured searchable session memory (C4 consumes this)
  hooks.Stop.push({
    hooks: [
      {
        type: 'command',
        command: softCommand(
          `${ROOT_CMD} && mkdir -p "${ENGRAM_DIR}" && BRANCH=$(cd "$ROOT" && git branch --show-current 2>/dev/null | tr -d '"\\\\') && FILES=$(cd "$ROOT" && git diff --name-only HEAD 2>/dev/null | wc -l | tr -d ' ') && COMMITS=$(cd "$ROOT" && git log --oneline -3 2>/dev/null | awk '{print $1}' | head -3 | tr '\\n' ' ' | sed 's/ *$//') && DATE=$(date -u '+%Y-%m-%d') && TS=$(date -u '+%Y-%m-%dT%H:%M:%SZ') && printf '{"id":"%s","date":"%s","timestamp":"%s","branch":"%s","filesModified":%s,"commits":"%s"}\\n' "$(date +%s)-$$" "$DATE" "$TS" "$BRANCH" "$FILES" "$COMMITS" >> "${SESSIONS_JSONL}"`,
        ),
        timeout: 10,
        statusMessage: 'Engram: recording session tuple...',
      },
    ],
  });

  // LEARN compliance — warn if learnings file wasn't updated this session
  hooks.Stop.push({
    hooks: [
      {
        type: 'command',
        command: softCommand(
          `if [ -f "${LEARN_FILE}" ]; then MODIFIED=$(find "${LEARN_FILE}" -mmin -5 2>/dev/null); if [ -z "$MODIFIED" ]; then echo ""; echo "ℹ  LEARN was not recorded this session. That's fine if nothing reusable surfaced."; echo "   If something did, call engram_record_learning in your next session."; echo ""; fi; fi`,
        ),
        timeout: 5,
        statusMessage: 'Engram: checking LEARN compliance...',
      },
    ],
  });

  // KB metrics — update knowledgebase.json with session summary tuple (legacy SessionRecord shape)
  hooks.Stop.push({
    hooks: [
      {
        type: 'command',
        command: softCommand(
          `${ROOT_CMD} && cd "$ROOT" && node -e "const fs=require('fs'),cp=require('child_process');const p='${KB_PATH}';if(!fs.existsSync(p))process.exit(0);try{const kb=JSON.parse(fs.readFileSync(p,'utf-8'));const files=parseInt(cp.execSync('git diff --name-only HEAD 2>/dev/null|wc -l').toString().trim())||0;const branch=cp.execSync('git branch --show-current 2>/dev/null').toString().trim()||null;kb.metrics.totalSessions++;kb.metrics.sessions.push({date:new Date().toISOString().split('T')[0],branch,filesModified:files,learningsAccessed:0,learningsAdded:0,domainsTouched:[]});if(kb.metrics.sessions.length>20)kb.metrics.sessions=kb.metrics.sessions.slice(-20);fs.writeFileSync(p,JSON.stringify(kb,null,2))}catch(e){}"`,
        ),
        timeout: 10,
        statusMessage: 'Engram: updating session metrics...',
      },
    ],
  });

  return hooks;
}

/**
 * Generates .claude/settings.local.json with common permissions.
 */
export function generateSettingsLocal(config: EngramConfig): object {
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
    'WebSearch',
  ];

  // Language-specific permissions
  if (config.stack.language === 'typescript' || config.stack.language === 'javascript') {
    allow.push('Bash(npm:*)', 'Bash(npm run:*)', 'Bash(npx:*)', 'Bash(node:*)');
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
