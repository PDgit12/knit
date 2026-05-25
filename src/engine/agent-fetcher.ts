import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  categoryOf,
  isBundledCore,
  rawAgentUrl,
  VOLTAGENT_REF,
  VOLTAGENT_PINNED_SHA,
} from './agent-registry.js';
import { agentsCacheFile } from './paths.js';

/** Strip the `knit-` (or legacy `engram-`) prefix so internal lookups always use the bare name. */
function bareName(name: string): string {
  return name.replace(/^(knit|engram)-/, '');
}

/**
 * Build the VoltAgent attribution comment, mirroring scripts/vendor-agents.mjs.
 * Embedded into freshly fetched agents (and cached) so redistributed copies
 * carry the upstream notice — MIT requires preserving the source.
 */
function attributionComment(name: string, category: string, ref: string): string {
  return `<!--
  Vendored by engram from:
    https://github.com/VoltAgent/awesome-claude-code-subagents
    @${ref}/categories/${category}/${name}.md
  License: MIT (see github.com/VoltAgent/awesome-claude-code-subagents/blob/main/LICENSE).
  This file was copied verbatim with this header prepended; the original
  YAML frontmatter and prompt content are unchanged.
-->
`;
}

/**
 * Inject the attribution comment after the closing `---` of the YAML
 * frontmatter and before the prompt body. If frontmatter cannot be found,
 * return the body unchanged (we still surface the source via the cache
 * path; clobbering the file would be worse).
 */
function injectAttribution(body: string, name: string, category: string, ref: string): string {
  const fmEnd = body.indexOf('\n---', 3);  // second '---' closes frontmatter
  if (fmEnd < 0) return body;
  const head = body.slice(0, fmEnd + 4);   // include closing '---\n'
  const tail = body.slice(fmEnd + 4);
  return `${head}\n${attributionComment(name, category, ref)}${tail}`;
}

/**
 * Fetches VoltAgent subagent definitions, with three tiers of resolution:
 *
 *   1. Bundled core (zero network) — agents shipped in the npm package at
 *      dist/agents/core/*.md. Used when isBundledCore(name) is true.
 *   2. Local cache — ~/.knit/agents/cache/<ref>/<category>/<name>.md.
 *      First fetch lands here; subsequent loads avoid the network.
 *   3. Network — raw.githubusercontent.com at the pinned ref.
 *
 * KNIT_OFFLINE=1 (legacy ENGRAM_OFFLINE=1) disables tier 3 entirely. Useful for
 * air-gapped CI and users who want hard guarantees that Knit won't touch the network.
 *
 * The fetch function is injectable so tests can stub it without monkeypatching
 * the global fetch.
 */

export type FetchFn = (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export interface FetcherOptions {
  /** Override the network fetch (for tests). Defaults to global fetch. */
  fetchFn?: FetchFn;
  /** Override the ref. Defaults to VOLTAGENT_REF (env or 'main'). */
  ref?: string;
  /** Override the bundled-core lookup dir. Useful for tests. */
  bundledCoreDir?: string;
  /** Force re-fetch from network even if locally cached (tier 2). Bundled-core (tier 1) still wins. */
  refresh?: boolean;
}

export class AgentFetchError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'AgentFetchError';
  }
}

/**
 * Resolve an agent name to its full markdown content. Tries bundled-core,
 * then local cache, then network. Caches successful network fetches.
 */
export async function fetchAgent(name: string, opts: FetcherOptions = {}): Promise<string> {
  const bare = bareName(name);

  // Tier 1 — bundled core (zero network)
  if (isBundledCore(bare)) {
    const bundled = readBundledCore(bare, opts.bundledCoreDir);
    if (bundled !== null) return bundled;
    // fall through if bundled file missing (build artifact issue; treat as cacheable)
  }

  const ref = opts.ref || VOLTAGENT_REF;
  const cat = categoryOf(bare);
  if (!cat) {
    throw new AgentFetchError(`Unknown agent: "${name}". Not in engram's registry.`);
  }

  // Tier 2 — local cache (skip if refresh requested)
  const cachePath = agentsCacheFile(ref, cat, bare);
  if (!opts.refresh && existsSync(cachePath)) {
    return readFileSync(cachePath, 'utf-8');
  }

  // Tier 3 — network (respect KNIT_OFFLINE; legacy ENGRAM_OFFLINE still honored)
  if (process.env.KNIT_OFFLINE === '1' || process.env.ENGRAM_OFFLINE === '1') {
    throw new AgentFetchError(
      `Agent "${name}" not bundled and not cached, and KNIT_OFFLINE=1 is set. ` +
      `Either unset KNIT_OFFLINE (and legacy ENGRAM_OFFLINE) or run \`knit install-agents\` when online to populate the cache.`,
    );
  }

  const url = rawAgentUrl(bare, ref);
  if (!url) {
    throw new AgentFetchError(`Cannot construct URL for agent "${name}".`);
  }

  const fetchFn = opts.fetchFn || defaultFetch;
  let res;
  try {
    res = await fetchFn(url);
  } catch (err) {
    throw new AgentFetchError(`Network error fetching "${name}" from ${url}`, err);
  }

  if (!res.ok) {
    throw new AgentFetchError(`Fetch failed for "${name}" (HTTP ${res.status}) — ${url}`);
  }

  const body = await res.text();
  if (!body || body.length < 20) {
    throw new AgentFetchError(`Fetched body for "${name}" is empty or suspiciously short.`);
  }

  // Inject VoltAgent attribution before caching. MIT requires the source
  // notice be preserved in redistributed substantial portions.
  const refForAttribution = ref === VOLTAGENT_REF ? VOLTAGENT_PINNED_SHA : ref;
  const augmented = injectAttribution(body, bare, cat, refForAttribution);

  // Cache the augmented version so future reads carry the attribution too.
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, augmented, 'utf-8');

  return augmented;
}

/** Synchronous existence check — useful for warnings without forcing a fetch. */
export function isAgentCachedOrBundled(name: string, opts: FetcherOptions = {}): boolean {
  const bare = bareName(name);
  if (isBundledCore(bare)) {
    const bundled = readBundledCore(bare, opts.bundledCoreDir);
    if (bundled !== null) return true;
  }
  const ref = opts.ref || VOLTAGENT_REF;
  const cat = categoryOf(bare);
  if (!cat) return false;
  return existsSync(agentsCacheFile(ref, cat, bare));
}

// ── internals ────────────────────────────────────────────────────

/** Default fetch wraps the global fetch. Available on Node 18+. */
const defaultFetch: FetchFn = (url) => {
  if (typeof globalThis.fetch !== 'function') {
    return Promise.reject(new Error('Global fetch unavailable. Requires Node 18+.'));
  }
  return globalThis.fetch(url);
};

/** Read a bundled core agent. Returns null if the bundle directory is missing. */
function readBundledCore(name: string, customDir?: string): string | null {
  const dir = customDir || bundledCoreDir();
  const file = join(dir, `${name}.md`);
  if (!existsSync(file)) return null;
  try {
    return readFileSync(file, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Resolve dist/agents/core/ relative to this module. Works both for the
 * compiled build (dist/) and tsx source-run (src/) by walking up from this
 * file's location to find dist/agents/core/.
 */
function bundledCoreDir(): string {
  // import.meta.url is the URL of this module file. Walk up to package root,
  // then descend into dist/agents/core. Works in compiled bundles and tsx alike.
  const here = fileURLToPath(import.meta.url);
  let dir = dirname(here);
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'dist', 'agents', 'core');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: relative to cwd (development without build)
  return join(process.cwd(), 'dist', 'agents', 'core');
}
