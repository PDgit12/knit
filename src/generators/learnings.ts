import type { KnitConfig } from '../engine/types.js';

/**
 * Generates the initial learnings file for a project.
 */
export function generateLearningsContent(config: KnitConfig): string {
  const date = new Date().toISOString().split('T')[0];

  return `# Project Learnings — ${config.name}

> Recursive learning log. Check this BEFORE starting any task.
> Grep by \`#tag\` to find relevant lessons for the domain you're working in.

---

## ${date} Project initialized with Engram workflow
**Domain(s):** All — workflow infrastructure
**Approach:** Auto-detected stack (${config.stack.language}${config.stack.framework ? ' + ' + config.stack.framework : ''}), generated ${config.domains.length} domains, wired hooks for ${config.targetAgent}.
**Outcome:** Success — workflow infrastructure in place
**Lesson:** This learnings file is the institutional memory. Every task should append an entry. Every session should check relevant tags before starting work. The LEARN phase is a hard exit gate — no task completes without updating this file.
**Tags:** #workflow #all #bootstrap
`;
}
