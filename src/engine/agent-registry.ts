/**
 * VoltAgent subagent registry.
 *
 * Maps engram's domain roles (core / security / qa) and detected stack
 * (typescript / python / go / rust / etc.) to the curated VoltAgent agents
 * we want to install for that team.
 *
 * Names verified against github.com/VoltAgent/awesome-claude-code-subagents
 * README. The pinned ref controls reproducibility: at release time we freeze
 * to a specific commit SHA; users can override via ENGRAM_AGENT_REGISTRY_REF.
 */

/**
 * Pinned reference into VoltAgent's repo. Frozen at engram v0.4.0 release time.
 * Users can override via ENGRAM_AGENT_REGISTRY_REF env var (use 'main' for latest).
 */
export const VOLTAGENT_PINNED_SHA = '6f804f0cfab22fb62668855aa3d62ee3a1453077';
export const VOLTAGENT_REF = process.env.ENGRAM_AGENT_REGISTRY_REF || VOLTAGENT_PINNED_SHA;
export const VOLTAGENT_RAW_BASE = 'https://raw.githubusercontent.com/VoltAgent/awesome-claude-code-subagents';

/** Single source of truth for which categories each agent lives in. */
const AGENT_CATALOG: Record<string, { category: string }> = {
  // 02 — Language specialists
  'typescript-pro':     { category: '02-language-specialists' },
  'python-pro':         { category: '02-language-specialists' },
  'golang-pro':         { category: '02-language-specialists' },
  'rust-engineer':      { category: '02-language-specialists' },

  // 03 — Infrastructure
  'security-engineer':  { category: '03-infrastructure' },
  'devops-engineer':    { category: '03-infrastructure' },

  // 04 — Quality & Security
  'code-reviewer':      { category: '04-quality-security' },
  'qa-expert':          { category: '04-quality-security' },
  'debugger':           { category: '04-quality-security' },
  'architect-reviewer': { category: '04-quality-security' },

  // 06 — Developer Experience
  'build-engineer':     { category: '06-developer-experience' },
};

/** Language-specific agent picks. Keys map engram's StackInfo.language values. */
const LANG_AGENTS: Record<string, string[]> = {
  typescript: ['typescript-pro'],
  javascript: ['typescript-pro'],
  python:     ['python-pro'],
  go:         ['golang-pro'],
  rust:       ['rust-engineer'],
  // Java + others fall through to no lang-specialist; teams still get code-reviewer etc.
};

/** Engram's per-role bundle of agents that should be installed for a project. */
export function agentsForRole(role: 'core' | 'security' | 'qa', stack: string): string[] {
  const langSpecific = LANG_AGENTS[stack] || [];
  switch (role) {
    case 'core':
      return uniq([...langSpecific, 'code-reviewer', 'architect-reviewer']);
    case 'security':
      return uniq(['security-engineer', ...langSpecific, 'code-reviewer']);
    case 'qa':
      return uniq(['qa-expert', 'debugger', 'build-engineer']);
    default:
      return ['code-reviewer'];
  }
}

/** All agents engram knows how to fetch + personalize. */
export function knownAgents(): string[] {
  return Object.keys(AGENT_CATALOG);
}

/** Returns true if engram has a registry entry for this name. */
export function isKnownAgent(name: string): boolean {
  return name in AGENT_CATALOG;
}

/** VoltAgent category for an agent (e.g. "02-language-specialists"), or null. */
export function categoryOf(name: string): string | null {
  return AGENT_CATALOG[name]?.category || null;
}

/** Raw URL to the agent's source .md in VoltAgent. */
export function rawAgentUrl(name: string, ref: string = VOLTAGENT_REF): string | null {
  const cat = categoryOf(name);
  if (!cat) return null;
  return `${VOLTAGENT_RAW_BASE}/${ref}/categories/${cat}/${name}.md`;
}

/** Agents engram vendors in the npm package — zero network on install. */
export const BUNDLED_CORE_AGENTS = [
  'code-reviewer',
  'security-engineer',
  'qa-expert',
  'typescript-pro',
  'python-pro',
  'golang-pro',
] as const;

export function isBundledCore(name: string): boolean {
  return (BUNDLED_CORE_AGENTS as readonly string[]).includes(name);
}

// ── internals ────────────────────────────────────────────────────

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}
