import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  categoryOf,
  isBundledCore,
  rawAgentUrl,
  VOLTAGENT_REF,
} from './agent-registry.js';
import { agentsCacheFile } from './paths.js';

/**
 * Fetches VoltAgent subagent definitions, with three tiers of resolution:
 *
 *   1. Bundled core (zero network) — agents shipped in the npm package at
 *      dist/agents/core/*.md. Used when isBundledCore(name) is true.
 *   2. Local cache — ~/.engram/agents/cache/<ref>/<category>/<name>.md.
 *      First fetch lands here; subsequent loads avoid the network.
 *   3. Network — raw.githubusercontent.com at the pinned ref.
 *
 * ENGRAM_OFFLINE=1 disables tier 3 entirely. Useful for air-gapped CI and
 * users who want hard guarantees that engram won't touch the network.
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
  // Tier 1 — bundled core (zero network)
  if (isBundledCore(name)) {
    const bundled = readBundledCore(name, opts.bundledCoreDir);
    if (bundled !== null) return bundled;
    // fall through if bundled file missing (build artifact issue; treat as cacheable)
  }

  const ref = opts.ref || VOLTAGENT_REF;
  const cat = categoryOf(name);
  if (!cat) {
    throw new AgentFetchError(`Unknown agent: "${name}". Not in engram's registry.`);
  }

  // Tier 2 — local cache
  const cachePath = agentsCacheFile(ref, cat, name);
  if (existsSync(cachePath)) {
    return readFileSync(cachePath, 'utf-8');
  }

  // Tier 3 — network (respect ENGRAM_OFFLINE)
  if (process.env.ENGRAM_OFFLINE === '1') {
    throw new AgentFetchError(
      `Agent "${name}" not bundled and not cached, and ENGRAM_OFFLINE=1 is set. ` +
      `Either unset ENGRAM_OFFLINE or run \`engram install-agents\` when online to populate the cache.`,
    );
  }

  const url = rawAgentUrl(name, ref);
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

  // Cache it
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, body, 'utf-8');

  return body;
}

/** Synchronous existence check — useful for warnings without forcing a fetch. */
export function isAgentCachedOrBundled(name: string, opts: FetcherOptions = {}): boolean {
  if (isBundledCore(name)) {
    const bundled = readBundledCore(name, opts.bundledCoreDir);
    if (bundled !== null) return true;
  }
  const ref = opts.ref || VOLTAGENT_REF;
  const cat = categoryOf(name);
  if (!cat) return false;
  return existsSync(agentsCacheFile(ref, cat, name));
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
