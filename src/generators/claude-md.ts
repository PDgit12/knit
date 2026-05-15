import type { EngramConfig, Domain, ProjectKnowledge, LearningEntry } from '../engine/types.js';

/**
 * Generates a complete CLAUDE.md with the full Engram Orchestration Protocol.
 * This is the core product output — the quality here determines whether
 * the tool is worth using. Every section maps to a proven workflow pattern
 * extracted from real production use.
 */
export function generateClaudeMd(
  config: EngramConfig,
  knowledge?: ProjectKnowledge | null,
  falsePositives?: LearningEntry[],
): string {
  const learningsFile = `.claude/learnings/${config.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`;

  const sections = [
    generateHeader(config),
    generateBuildVerify(config),
    generateSessionStartup(config, learningsFile),
    knowledge ? generateProjectMap(knowledge) : null,
    knowledge ? generateKnowledgeUsage() : null,
    generateDomainArchitecture(config, knowledge),
    falsePositives && falsePositives.length > 0 ? generateFalsePositivesSection(falsePositives) : null,
    generateOrchestrationProtocol(config),
    generatePhaseDetails(config),
    generateLearnPhase(learningsFile),
    generateToolRouting(),
    generateEffortScaling(),
    generateSlashCommands(),
    generateHandoffProtocol(),
    generateGitRules(),
    generatePhaseStatus(),
  ];

  return sections.filter(Boolean).join('\n\n---\n\n');
}

function generateHeader(config: EngramConfig): string {
  const stackParts = [
    config.stack.language !== 'unknown' ? config.stack.language : null,
    config.stack.framework,
  ].filter(Boolean);
  const stackDesc = stackParts.length > 0 ? stackParts.join(' + ') + ' project. ' : '';

  return `# ${config.name}

${stackDesc}Workflow powered by [Engram](https://github.com/piyushdua/engram) — the Engram Orchestration Protocol.`;
}

function generateBuildVerify(config: EngramConfig): string {
  const commands: string[] = [];

  if (config.stack.typecheckCommand) commands.push(`${config.stack.typecheckCommand}   # zero errors required`);
  if (config.stack.lintCommand) commands.push(`${config.stack.lintCommand}        # zero errors required`);
  if (config.stack.buildCommand) commands.push(`${config.stack.buildCommand}       # clean compilation`);

  if (commands.length === 0) return '';

  return `## Build & Verify

\`\`\`bash
${commands.join('\n')}
\`\`\`

All checks MUST pass before any commit or PR. The Stop hook runs these automatically at session end.`;
}

// ── Domain Architecture ──────────────────────────────────────────

function generateDomainArchitecture(config: EngramConfig, knowledge?: ProjectKnowledge | null): string {
  const domainBoxes = config.domains
    .map((d) => `   │ ${d.name.padEnd(10)} │`)
    .join('\n');

  let content = `## Domain Architecture

Every file in this project belongs to exactly one domain. Domains are the unit of orchestration — all agent work is organized by domain.

\`\`\`
┌─────────────────────────────────────────────┐
│            MAIN ORCHESTRATOR                │
│  (classifies tasks, routes, synthesizes)    │
└──────┬────────┬────────┬────────┬─────┬─────┘
       │        │        │        │     │
       ▼        ▼        ▼        ▼     ▼
${domainBoxes}
\`\`\`

`;

  for (const domain of config.domains) {
    content += `### ${domain.name}\n`;
    content += `**Files:** \`${domain.filePatterns.join('`, `')}\`\n`;
    content += `**Head concern:** ${domain.description}\n`;
    content += `**Review agents:** \`${domain.agents.join('`, `')}\`\n`;

    // Enrich with knowledge if available
    if (knowledge) {
      const domainKnowledge = summarizeDomainKnowledge(domain, knowledge);
      if (domainKnowledge) content += domainKnowledge;
    }

    content += '\n';
  }

  content += generateCrossDomainRules(config.domains);
  return content;
}

/** Summarize knowledge for a specific domain based on file pattern matching */
function summarizeDomainKnowledge(domain: Domain, knowledge: ProjectKnowledge): string {
  // Find files matching this domain's patterns
  const domainFiles = knowledge.files
    .filter((f) => domain.filePatterns.some((pattern) => matchesGlob(f.path, pattern)))
    .map((f) => f.path);

  if (domainFiles.length === 0) return '';

  let summary = '';

  // Key exports in this domain
  const domainExports: Array<{ name: string; file: string }> = [];
  for (const file of domainFiles) {
    const exports = knowledge.exports[file];
    if (exports) {
      for (const exp of exports.slice(0, 3)) { // top 3 per file
        domainExports.push({ name: exp.name, file });
      }
    }
  }
  if (domainExports.length > 0) {
    const exportList = domainExports
      .slice(0, 6) // max 6 total
      .map((e) => `\`${e.name}\` (${e.file})`)
      .join(', ');
    summary += `**Key exports:** ${exportList}\n`;
  }

  // Test coverage for this domain
  const tested = domainFiles.filter((f) => knowledge.testMap.tested[f]);
  const total = domainFiles.filter((f) => !knowledge.testMap.testFiles.includes(f));
  if (total.length > 0) {
    summary += `**Test coverage:** ${tested.length}/${total.length} files tested\n`;
  }

  return summary;
}

/** Simple glob matching — supports ** and * patterns */
function matchesGlob(filePath: string, pattern: string): boolean {
  const regex = pattern
    .replace(/\*\*/g, '@@DOUBLESTAR@@')
    .replace(/\*/g, '[^/]*')
    .replace(/@@DOUBLESTAR@@/g, '.*');
  return new RegExp(`^${regex}`).test(filePath);
}

function generateCrossDomainRules(domains: Domain[]): string {
  if (domains.length < 2) return '';

  return `### Cross-Domain Communication Rules

When a change in one domain affects another, the Orchestrator MUST notify the affected domain heads:

| Change in | Notify | Why |
|-----------|--------|-----|
| Shared types / contracts | ALL domains | Types are the universal contract |
| Validation schemas | API + UI + Logic | API consumes schemas, UI renders errors |
| Database schema | API + Infra + QA | Queries, migrations, need tests |
| API endpoints | API + QA | Needs validation, auth check, tests |
| UI components | UI + QA | Visual regression, accessibility |

**Rule:** If a change touches shared types or contracts, it automatically escalates to Complex tier.
`;
}

// ── Orchestration Protocol (COMPLETE) ────────────────────────────

// ── Project Map (from knowledge brain) ──────────────────────────

// ── Session Startup (what to do first in every new session) ─────

function generateSessionStartup(_config: EngramConfig, learningsFile: string): string {
  return `## Session Startup (every new session — no exceptions)

When opening a new session or chat in this project, do these in order:

1. **Read this CLAUDE.md** — you're doing it now. This is the source of truth.
2. **Load learnings:** Read \`${learningsFile}\` — check for lessons, AVOID entries, and \`#false-positive\` tags relevant to your task.
3. **Check for handoff:** If \`handoff.md\` exists in the project root, read it FIRST — a previous session saved context for you.
4. **Check branch state:** \`git branch --show-current && git log --oneline -5\` — verify where you are.
5. **State readiness:** Before starting any task, say:
   > **Session loaded.** Learnings: [count] entries. Handoff: [exists/none]. Branch: [name].

This ensures every session starts with full context, not cold.`;
}

// ── Project Map (from knowledge brain) ──────────────────────────

function generateProjectMap(knowledge: ProjectKnowledge): string {
  const { summary } = knowledge;

  let content = `## Project Map (auto-generated by \`engram scan\`)

`;

  if (summary.entryPoints.length > 0) {
    content += `**Entry points:** \`${summary.entryPoints.join('`, `')}\`\n`;
  }

  if (summary.highFanoutFiles.length > 0) {
    content += `**High-fanout files (change carefully):** \`${summary.highFanoutFiles.join('`, `')}\`\n`;
  }

  if (summary.untestedFiles.length > 0) {
    const shown = summary.untestedFiles.slice(0, 10);
    content += `**Untested source files:** \`${shown.join('`, `')}\``;
    if (summary.untestedFiles.length > 10) {
      content += ` (+${summary.untestedFiles.length - 10} more)`;
    }
    content += '\n';
  }

  if (summary.largestFiles.length > 0) {
    const top3 = summary.largestFiles.slice(0, 3);
    const largestList = top3.map((f) => `\`${f.path}\` (${f.lines} lines)`).join(', ');
    content += `**Largest files:** ${largestList}\n`;
  }

  content += `\n**Stats:** ${summary.totalFiles} files, ${summary.totalLines.toLocaleString()} lines`;

  const langParts = Object.entries(summary.languageBreakdown)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([ext, count]) => `${ext}: ${count}`);
  if (langParts.length > 0) {
    content += ` (${langParts.join(', ')})`;
  }

  content += `\n\nFull inventory: \`.claude/knowledge.json\``;

  return content;
}

// ── Known False Positives ────────────────────────────────────────

// ── Knowledge Brain Usage ────────────────────────────────────────

function generateKnowledgeUsage(): string {
  return `## Using the Knowledge Brain

Engram maintains a project knowledge index at \`.claude/knowledge.json\`. This is your project's brain — built from static analysis, zero external dependencies.

**What it contains:**
- **Import graph** — which files depend on which. Know the ripple effect before you edit.
- **Export map** — what each file exposes. Find the function you need without grepping.
- **Test mapping** — which source files have tests and which don't.
- **High-fanout files** — files imported by many others. Change these carefully.
- **Entry points** — where execution starts.

**When to read it:**
- Before editing a file → check \`importGraph\` to see what depends on it
- Before writing tests → check \`testMap.untested\` to find what needs coverage
- When classifying task complexity → high-fanout file changes = Complex tier

**When to refresh it:**
- After creating or deleting files → run \`engram refresh\` to rebuild
- After major refactoring → run \`engram refresh\`
- The Project Map section above shows the latest summary

You do NOT need to read knowledge.json for every task. The Project Map above has the highlights. Read the full file only when you need the import graph or export details.`;
}

// ── Known False Positives ────────────────────────────────────────

function generateFalsePositivesSection(falsePositives: LearningEntry[]): string {
  let content = `## Known False Positives (auto-extracted from learnings)

Do NOT flag these in reviews — they have been confirmed as non-issues:

`;

  for (const fp of falsePositives) {
    content += `- **${fp.summary}** — ${fp.lesson} (${fp.date})\n`;
  }

  return content;
}

// ── Orchestration Protocol (COMPLETE) ────────────────────────────

function generateOrchestrationProtocol(_config: EngramConfig): string {
  return `## Engram Orchestration Protocol — v1.0

> This protocol is the core of your workflow. Follow it, don't rewrite it. Add learnings to \`.claude/learnings/\`, not to this section. The only allowed modifications are: updating Phase Status, Domain Architecture file lists, and coverage gaps.

### Pre-flight (runs BEFORE every task — no exceptions)

Before classifying or starting any work, execute these checks. The Orchestrator adapts to what's actually available.

**Step 1 — Load institutional knowledge:**
\`\`\`
grep learnings: .claude/learnings/*.md for domain tags matching the task
grep false positives: filter for #false-positive entries → feed into all agent prompts
\`\`\`
If AVOID entries exist for this domain → state them before proceeding.
If a past approach worked for similar work → reuse it.

**Step 2 — Detect tool availability (adapt, don't assume):**

| Tool | Check | If unavailable |
|------|-------|----------------|
| Semantic search | Is a code search MCP available? | Fall back to Grep + Read |
| Browser QA | Is Playwright or a browse skill available? | Skip browser verification |
| Dev server | \`curl -s localhost:3000\` | Don't attempt browser QA |

**Step 3 — State availability:** Before classification, say:
> **Tools:** semantic search ✓/✗ | browser QA ✓/✗ | dev server ✓/✗

This prevents the workflow from calling tools that aren't there.

---

### Task Classification

Classify BEFORE doing anything. State the classification out loud.

**Trivial** (1 domain, obvious fix — skip to EXECUTE):
- Typo, single config change, version bump, lint fix, missing import
- Phases: EXECUTE → VERIFY → LEARN
- Agents: 0 (Orchestrator handles directly)

**Standard** (1-2 domains — RESEARCH then EXECUTE):
- Bug fix, single-file feature, style change, test addition
- Phases: RESEARCH → EXECUTE → OPTIMIZE → REVIEW → LEARN

**Complex** (3+ domains or architectural — MANDATORY full protocol):
- New feature/endpoint, schema change, business logic change, security-sensitive code
- Phases: ALL 6 — RESEARCH → IDEATE → PLAN → EXECUTE → OPTIMIZE → REVIEW
- **IMMEDIATE ACTION:** Enter plan mode as the VERY FIRST action after stating classification. Do not present text plans outside plan mode. Do not ask "want me to go?" — just enter.

**Auto-detection rules (the Orchestrator classifies, not the user):**
- Touches shared types or validation schemas → Complex (universal contract change)
- Touches pricing, billing, or financial logic → Complex (money = Complex)
- New file created → at minimum Standard
- Touches auth or security code → Complex
- Touches 3+ files → Complex
- User says "plan" or requests a structured approach → Force Complex regardless

### The 6-Phase Protocol

\`\`\`
RESEARCH → IDEATE → PLAN → EXECUTE → OPTIMIZE → REVIEW
    ↑                                              |
    └──────────────── LEARN ←──────────────────────┘
\`\`\`

Every phase has a quality gate. Gate fails = STOP and fix before proceeding.

**Phase routing by tier:**
\`\`\`
TRIVIAL:    EXECUTE ──→ VERIFY ──→ LEARN
STANDARD:   RESEARCH ──→ EXECUTE ──→ OPTIMIZE ──→ REVIEW ──→ LEARN
COMPLEX:    RESEARCH ──→ IDEATE ──→ PLAN ──→ EXECUTE ──→ OPTIMIZE ──→ REVIEW ──→ LEARN
\`\`\`

### Domain Context Object

Built during RESEARCH, passed to EVERY agent prompt in subsequent phases. This is the glue that makes domain heads "persist" — through accumulated context, not stateful processes.

\`\`\`
DOMAIN CONTEXT:
  Affected domains: [list]
  Files to touch: [list]
  Cross-domain ripple: [which domains get notified per communication rules]
  Known pitfalls: [from learnings grep]
  False positives to suppress: [from #false-positive entries]
  Tool availability: semantic search ✓/✗ | browser QA ✓/✗ | dev server ✓/✗
  Scout findings: [complexity scores + what could break, from RESEARCH]
  Selected approach: [from IDEATE, if run]
  Approved plan: [from PLAN, if run]
\`\`\`

Every agent call in EXECUTE, OPTIMIZE, and REVIEW receives this object. This is how cross-phase continuity works within a stateless agent architecture.`;
}

// ── Phase Details (COMPLETE) ─────────────────────────────────────

function generatePhaseDetails(config: EngramConfig): string {
  const domainTable = config.domains
    .map((d) => `| ${d.name} | \`code-explorer\` | ${d.description} |`)
    .join('\n');

  const reviewTable = config.domains
    .map((d) => `| ${d.name} Head | \`${d.agents.join('`, `')}\` | ${d.description} |`)
    .join('\n');

  return `## Phase Details

### Phase 1: RESEARCH \`[Standard + Complex]\`

**Purpose:** Understand requirements, gather context, check learnings, build confidence.

**For Standard tasks (lightweight — Orchestrator reads directly):**
1. Read the affected files directly (no scouts)
2. Check cross-domain communication rules — will this ripple?
3. If semantic search available → query for understanding
4. If unavailable → Grep + Read the affected domain files

**For Complex tasks (parallel scouts):**
1. Spawn exploration agents per affected domain — **all in parallel, in background**
   - Each scout reads domain files, checks what could break
   - Each scout returns findings + complexity assessment
2. Check cross-domain communication rules
3. Query semantic search for broader context if available

**Domain scout assignments (Complex only):**

| Domain | Scout Agent | Focus |
|--------|-----------|-------|
${domainTable}

**Gate:** Can I name all affected files and domains? **YES → proceed | NO → read more or ask user**

---

### Phase 2: IDEATE \`[Complex only]\`

**Purpose:** Generate and evaluate solution options before committing to one.

1. **Parallel analysis:** Launch domain heads for affected domains — **all in parallel**
   - Each head proposes approach for their domain
   - Each head identifies risks and trade-offs
2. **Synthesize:** Orchestrator combines domain proposals
3. **Present options:** At least 2 approaches when complexity warrants it

**Gate:** User selects approach before proceeding. For Standard tasks, Orchestrator picks the obvious approach and states it — user can override.

---

### Phase 3: PLAN \`[Complex only — auto plan mode]\`

**Purpose:** Detailed implementation plan with file-level specificity.

Auto-enter plan mode. RESEARCH and IDEATE happen INSIDE plan mode, not before it.

1. **Domain plans:** Each affected domain head produces:
   - Exact files to create/modify/delete
   - Function-level changes
   - Dependencies on other domains
2. **Cross-domain sync:** Orchestrator identifies conflicts and ordering
3. **Execution order:** Which domain goes first, what must be sequential vs parallel

**Gate:** User says "go", "approved", "looks good", or "do it." No implicit approval.

**After plan approval → auto-transition to EXECUTE:** Once approved, exit plan mode and begin immediately. Do not pause to ask "should I start coding now?" — approval means go.

---

### Phase 4: EXECUTE

**Purpose:** Write the code following the approved plan (Complex) or research context (Standard/Trivial).

**Execution rules:**
- Strictly follow approved plan — no scope creep
- Include the Domain Context Object in every agent prompt
- Cross-domain changes follow the communication rules

**For new features (TDD when applicable):**
1. Write failing tests first
2. Implement minimum code to pass
3. Refactor for clarity
4. Verify coverage

**For bug fixes:**
1. Reproduce → write failing test → fix → verify

**Milestone check-ins:** Every 5 file edits, pause and verify build/typecheck still passes.

---

### Phase 5: OPTIMIZE \`[Standard + Complex]\`

**Purpose:** Parallel domain review of ALL changes before committing. Every code change gets reviewed. No exceptions.

Launch ALL affected domain heads in parallel. Each head runs its review agents. Include the Domain Context Object + false positives in every agent prompt.

| Domain Head | Review Agents | Focus |
|-------------|--------------|-------|
${reviewTable}

**Scaling rule for Standard tasks:** Only spawn agents for the 1-2 affected domains, not all.

**Agent Learning Loop (false positive prevention):**
Before spawning any review agent, the Orchestrator MUST:
1. Pull \`#false-positive\` entries from the Domain Context Object
2. Include them in the agent's prompt as "DO NOT flag these — they are confirmed non-issues"
3. Include instruction: "VERIFY your findings against actual code before reporting"
4. After receiving agent results, VERIFY findings against actual code before acting
5. If a new false positive is found, add it to learnings with \`#false-positive\` tag

This is how agents "learn" across sessions — through accumulated knowledge fed via the Domain Context Object.

**Each domain head reports findings by severity:**
- **CRITICAL** — blocks commit, must fix now
- **HIGH** — should fix before merge
- **MEDIUM** — consider fixing
- **LOW** — optional improvement

**Gate:** Zero CRITICAL findings. All HIGH findings acknowledged (fixed or explicitly deferred with reason).

---

### Phase 6: REVIEW \`[Standard + Complex]\`

**Purpose:** Final quality gate and ship readiness.

**Layer 1 — Code gates (always, automated):**
1. All build/typecheck/lint checks must pass
2. All tests must pass
3. **Gate:** All pass? → Layer 2 | Fail → fix, re-run

**Layer 2 — Browser verification (adaptive):**
Only when browser QA tools are available AND task touches UI or API:
- Navigate the app, verify it loads
- For form changes: test the flow end-to-end
- Take screenshots as proof

If browser tools unavailable → note "browser verification skipped" and continue.

**Layer 3 — Ship readiness (Complex + PR only):**
- Compare what was done against the plan — anything missed?
- Regression check: did existing functionality break?
- Confidence signal: "Ready to ship" only when ALL layers pass`;
}

// ── LEARN Phase (the most important part) ────────────────────────

function generateLearnPhase(learningsFile: string): string {
  return `## LEARN Phase — MANDATORY, NEVER SKIP

**A task is NOT complete until LEARN runs.** This is not optional, not aspirational, not "when I remember." It is a hard exit gate. The Orchestrator MUST NOT report task completion until every applicable checklist item has been executed.

**Enforcement rule:** If the Orchestrator is about to say "done", "complete", "finished", "ready", or any completion signal — STOP. Check: did LEARN run? If not, run it NOW before saying anything to the user. No task exits without LEARN. No exceptions. Not even for Trivial tasks.

**Post-flight checklist (run every applicable item, state which were updated):**

1. **Learnings (ALWAYS — every task, every tier):**
   - [ ] Append entry to \`${learningsFile}\` with task outcome + domain tags
   - [ ] If mistake or false positive occurred → add AVOID entry with \`#false-positive\` tag

2. **Project state (when applicable):**
   - [ ] If PR merged or phase completed → update CLAUDE.md Phase Status
   - [ ] If file created or deleted → update CLAUDE.md Domain Architecture file lists
   - [ ] If test added → update coverage gaps

**The Orchestrator must end every task with:**
\`\`\`
LEARN complete:
  ✅ Learnings updated: [entry title]
  ✅ CLAUDE.md: [what changed, or "no changes needed"]
  ✅ Memory: [what changed, or "no changes needed"]
\`\`\`

This is the last thing the user sees after every task. Not the code change, not the test result — the LEARN summary. This proves the system updated itself.

**Why this matters:** Without LEARN, the next session starts cold. With LEARN, the next session has full context. Every skipped LEARN is institutional knowledge lost.

**Learnings entry format:**
\`\`\`markdown
## [date] [task-summary]
**Domain(s):** which domains were involved
**Approach:** what was done
**Outcome:** success / partial / failure
**Lesson:** what to repeat or avoid next time
**Tags:** #domain-tag #topic-tag
\`\`\`

**Recursive loop:** lessons from task N inform the approach for task N+1. Over time, the learnings file becomes the institutional knowledge base for this project.

**Update triggers:**

| What | When |
|------|------|
| \`.claude/learnings/\` | After EVERY completed task — success, partial, or failure |
| \`.claude/learnings/\` (AVOID) | After EVERY mistake or unexpected behavior |
| CLAUDE.md Phase Status | After any PR merge, branch create, or blocker change |
| CLAUDE.md Domain files | After any file created or deleted |`;
}

// ── Tool Routing ─────────────────────────────────────────────────

function generateToolRouting(): string {
  return `## Tool Routing

The Orchestrator routes to the right tool with automatic fallback. Pre-flight detects availability; this table handles routing.

| Question type | Primary (if available) | Fallback |
|--------------|----------------------|----------|
| Semantic understanding ("how does X work?") | Semantic search / code indexing | Explore agent → Grep + Read |
| Literal search ("find all uses of X") | Grep (always available) | — |
| Visual verification ("does the form render?") | Browser automation | Read component code, note "visual deferred" |
| Code review ("is this secure?") | Review agents (always available) | — |
| Systematic QA ("test everything") | Browser QA tool | Run test suite + agent review |
| Framework API behavior | Documentation lookup (Context7 or docs) | Web search |

**Routing is automatic, not manual.** Pre-flight detects what's available. Each phase uses this table. If primary is unavailable, fall back seamlessly — don't break, don't ask, just note it and continue.`;
}

// ── Effort Scaling (honest, measurable) ──────────────────────────

function generateEffortScaling(): string {
  return `## Effort Scaling

The workflow scales effort with complexity. Do not run Complex-tier overhead on Trivial tasks.

| Tier | Max files touched | Agents spawned | Phases |
|------|------------------|----------------|--------|
| Trivial | 1-2 | 0 | EXECUTE → VERIFY → LEARN |
| Standard | 3-8 | 1-3 | 5 phases |
| Complex | Unlimited | 5-15 parallel | All 6 phases |

**What saves effort (proven, not estimated):**
- **Learnings file** prevents re-investigation of solved problems
- **False positives** in CLAUDE.md prevent agents from re-reporting known non-issues
- **Project Map** tells agents which files matter BEFORE they grep everything
- **Tier routing** skips unnecessary phases for simple tasks
- **Parallel execution** — N agents in 1 round trip, not N sequential
- **Domain Context Object** gives agents targeted scope instead of full codebase

**Effort waste to avoid:**
- Don't spawn scouts for trivial tasks (read the file yourself)
- Don't run full domain review for a single-file change
- Don't re-investigate problems already solved in learnings
- Don't run browser QA for non-UI changes

**Session tracking:** The Stop hook logs files modified, branch state, and commits to \`.claude/learnings/sessions.md\`. Review this file to see actual session patterns over time.`;
}

// ── Slash Commands ───────────────────────────────────────────────

function generateSlashCommands(): string {
  return `## Slash Command Routing

When the user's request matches a pattern below, invoke the relevant skill:

### Core Development
| User says | Action |
|-----------|--------|
| "plan this", "how should we build" | Enter plan mode, run full protocol |
| "ship", "create PR" | Ship workflow: test → review → commit → push → PR |
| "review", "check my code" | Code review with domain-appropriate agents |
| "debug", "investigate", "why broken" | Root cause investigation with evidence |
| "build failed", "fix errors" | Build error resolution |

### Quality & Testing
| User says | Action |
|-----------|--------|
| "QA", "test the site" | Systematic QA testing |
| "check in browser" | Browser navigation + screenshot |
| "security audit" | Security review across all domains |
| "health check" | Code quality dashboard |

### Context & Memory
| User says | Action |
|-----------|--------|
| "save progress" | Capture context for session recovery |
| "resume", "where was I" | Load saved context and continue |
| "what did we learn" | Review learnings file |`;
}

// ── Handoff Protocol ─────────────────────────────────────────────

function generateHandoffProtocol(): string {
  return `## Session Handoff Protocol

When context degrades (circular debugging, repeated failures, post-compaction confusion):

1. Detect degradation with **evidence** — never assume
2. Write \`handoff.md\`:
   - **Goal:** What we're trying to accomplish
   - **Current State:** Where we are right now
   - **Files in Flight:** What's been modified
   - **What Changed:** Commits, edits since session start
   - **Failed Attempts** (mandatory): What was tried and why it failed
   - **Decisions Made:** Important choices and their reasoning
   - **ONE Next Step:** The single most important thing to do next
3. User starts fresh session
4. Fresh session reads \`handoff.md\` first
5. Archive to \`.claude/handoffs/\`

**Never auto-handoff. Try compacting context first. Failed Attempts is the critical section — it prevents the next session from repeating the same mistakes.**

When user says "continue" / "pick up" / "resume" → read \`handoff.md\` first.`;
}

// ── Git Rules ────────────────────────────────────────────────────

function generateGitRules(): string {
  return `## Git & Commits

- Conventional commits: \`feat:\`, \`fix:\`, \`refactor:\`, \`docs:\`, \`test:\`, \`chore:\`, \`perf:\`
- Branches: \`feature/<descriptive-name>\`, squash merge to main
- Pre-merge: all build checks must pass
- No destructive git operations without explicit user consent`;
}

// ── Phase Status ─────────────────────────────────────────────────

function generatePhaseStatus(): string {
  return `## Phase Status
- **Setup**: ✅ Generated by Engram
- **Active development**: 🚀 In progress`;
}
