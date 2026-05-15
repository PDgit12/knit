import type { EngramConfig } from '../engine/types.js';

/**
 * Generates .claude/settings.json with hooks for the detected stack.
 * All hooks use dynamic root detection — no hardcoded absolute paths.
 */
export function generateSettings(config: EngramConfig): object {
  return {
    mcpServers: {
      'engram-brain': {
        command: 'npx',
        args: ['-y', 'engram-mcp'],
      },
    },
    hooks: generateHooks(config),
  };
}

/** Shell snippet that finds project root dynamically */
const ROOT_CMD = 'ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)';

function generateHooks(config: EngramConfig) {
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

  // Session learnings capture on stop (always)
  hooks.Stop.push({
    hooks: [
      {
        type: 'command',
        command: `${ROOT_CMD} && cd "$ROOT" && mkdir -p .claude/learnings && FILE=".claude/learnings/sessions.md" && if [ ! -f "$FILE" ]; then echo '# Session Log' > "$FILE"; fi && echo '' >> "$FILE" && echo "## Session $(date -u '+%Y-%m-%d %H:%M:%S UTC')" >> "$FILE" && BRANCH=$(git branch --show-current 2>/dev/null) && COMMITS=$(git log --oneline -3 2>/dev/null | sed 's/^/  - /') && echo "- Branch: $BRANCH" >> "$FILE" && echo "- Recent commits:" >> "$FILE" && echo "$COMMITS" >> "$FILE" && CHANGED=$(git diff --stat HEAD 2>/dev/null | tail -1) && [ -n "$CHANGED" ] && echo "- Uncommitted: $CHANGED" >> "$FILE" || true && echo '' >> "$FILE"`,
        timeout: 10,
        statusMessage: 'Engram: capturing session state...',
      },
    ],
  });

  // LEARN enforcement — warn if learnings file wasn't updated this session
  const learningsFileName = config.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.md';
  hooks.Stop.push({
    hooks: [
      {
        type: 'command',
        command: `${ROOT_CMD} && cd "$ROOT" && LEARN_FILE=".claude/learnings/${learningsFileName}" && if [ -f "$LEARN_FILE" ]; then MODIFIED=$(find "$LEARN_FILE" -mmin -5 2>/dev/null); if [ -z "$MODIFIED" ]; then echo ""; echo "⚠  LEARN phase did not run — $LEARN_FILE was not updated this session."; echo "   The Engram protocol requires updating learnings after every task."; echo ""; fi; fi`,
        timeout: 5,
        statusMessage: 'Engram: checking LEARN compliance...',
      },
    ],
  });

  // KB metrics — update knowledgebase.json with session data
  hooks.Stop.push({
    hooks: [
      {
        type: 'command',
        command: `${ROOT_CMD} && cd "$ROOT" && node -e "const fs=require('fs'),cp=require('child_process');const p='.claude/knowledgebase.json';if(!fs.existsSync(p))process.exit(0);try{const kb=JSON.parse(fs.readFileSync(p,'utf-8'));const files=parseInt(cp.execSync('git diff --name-only HEAD 2>/dev/null|wc -l').toString().trim())||0;const branch=cp.execSync('git branch --show-current 2>/dev/null').toString().trim()||null;kb.metrics.totalSessions++;kb.metrics.sessions.push({date:new Date().toISOString().split('T')[0],branch,filesModified:files,learningsAccessed:0,learningsAdded:0,domainsTouched:[]});if(kb.metrics.sessions.length>20)kb.metrics.sessions=kb.metrics.sessions.slice(-20);fs.writeFileSync(p,JSON.stringify(kb,null,2))}catch(e){}" 2>/dev/null || true`,
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
