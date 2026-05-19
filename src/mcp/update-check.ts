/**
 * Best-effort in-band update notification.
 *
 * Once per process (with a 1-hour TTL), the brain pre-warms `cachedLatest`
 * by hitting npm's dist-tags endpoint. knit_brain_status reads the cached
 * value synchronously and surfaces an `update_available` field when the
 * installed VERSION is older than the registry's `latest` tag.
 *
 * Design constraints:
 *   - Never block the brain load. Pre-warm fires async; the synchronous
 *     read returns null until the response lands. On cold first call,
 *     status reports no update field; the next status call in the same
 *     session sees it.
 *   - Never throw. Air-gapped CI, hostile firewalls, npm registry outages
 *     are all expected; on any failure the cache stays null and no update
 *     field appears in status.
 *   - Cheap. One HTTP GET per session (per hour, ceiling). The response
 *     is tiny (~50 bytes — just the dist-tags JSON).
 *   - No new deps. Uses Node 18+'s global `fetch` + `AbortController`.
 */

const REGISTRY_DIST_TAGS_URL = 'https://registry.npmjs.org/-/package/knit-mcp/dist-tags';
const FETCH_TIMEOUT_MS = 2000;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

let cachedLatest: string | null = null;
let lastCheckedAt = 0;
let inFlight: Promise<void> | null = null;

/** Synchronous read for the cached `latest` tag. Returns null if the check
 *  hasn't completed yet (cold first call) OR if it failed. Callers should
 *  treat null as "no signal — assume current". */
export function getCachedLatestVersion(): string | null {
  // If the cache is stale, kick off a refresh in the background. We still
  // return the prior value (or null) synchronously — the refresh lands on
  // a subsequent call.
  if (Date.now() - lastCheckedAt > CACHE_TTL_MS) {
    prewarmLatestVersion();
  }
  return cachedLatest;
}

/** Fire-and-forget. Idempotent within a TTL window — multiple calls collapse
 *  to a single in-flight check. Called from cache.ts at brain load so the
 *  result is likely ready by the time the agent calls knit_brain_status. */
export function prewarmLatestVersion(): void {
  if (inFlight) return;
  if (Date.now() - lastCheckedAt < CACHE_TTL_MS && cachedLatest !== null) return;
  inFlight = doFetch().finally(() => { inFlight = null; });
}

async function doFetch(): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(REGISTRY_DIST_TAGS_URL, { signal: controller.signal });
    if (!res.ok) return; // swallow non-200; cache stays null
    const data = (await res.json()) as { latest?: string };
    if (typeof data.latest === 'string' && data.latest.length > 0) {
      cachedLatest = data.latest;
      lastCheckedAt = Date.now();
    }
  } catch {
    // Network errors, abort, JSON parse — all best-effort. Leave cache untouched.
  } finally {
    clearTimeout(timeout);
  }
}

/** Returns true if `latest` is a strictly newer version than `current`.
 *  Compares the first three semver components only; prerelease tags
 *  (-alpha.1 etc.) are stripped for the comparison so a stable release
 *  doesn't show as "downgrade" if current was a prerelease of the same. */
export function isNewerVersion(latest: string, current: string): boolean {
  const parse = (v: string): [number, number, number] => {
    const stripped = v.replace(/[-+].*$/, ''); // drop -alpha.1 / +build.X
    const parts = stripped.split('.').map((n) => parseInt(n, 10) || 0);
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  };
  const [a1, a2, a3] = parse(latest);
  const [b1, b2, b3] = parse(current);
  if (a1 !== b1) return a1 > b1;
  if (a2 !== b2) return a2 > b2;
  return a3 > b3;
}

/** Testing helper — directly set the cache without hitting the network. */
export function __setCachedLatestForTests(version: string | null, checkedAtMs: number = Date.now()): void {
  cachedLatest = version;
  lastCheckedAt = checkedAtMs;
  inFlight = null;
}

/** Testing helper — clear the cache entirely. */
export function __resetUpdateCheckForTests(): void {
  cachedLatest = null;
  lastCheckedAt = 0;
  inFlight = null;
}
