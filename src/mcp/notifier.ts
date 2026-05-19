/**
 * Tools-list-changed notifier — bridges the handler layer (which doesn't
 * own the MCP Server instance) to the transport layer (which does).
 *
 * Why this exists: when `knit_enable_feature("teams")` writes
 * `features.json`, the visible tool surface changes from the client's
 * perspective — Tier-2 team tools that were hidden are now active. The
 * MCP spec lets the server emit a `notifications/tools/list_changed`
 * notification so the client re-fetches `tools/list` without needing a
 * Claude Code restart. The handler logic doesn't have a reference to
 * the Server; this module is the late-bound dispatcher.
 *
 * Usage:
 *   server.ts / cli.ts (transport):
 *     registerToolsListChangedNotifier(() => server.sendToolListChanged());
 *   handlers.ts (logic):
 *     notifyToolsListChanged();   // fire-and-forget
 *
 * Failure mode: best-effort. If no notifier is registered yet (handler
 * called before the Server finished wiring, or running outside an MCP
 * transport like in unit tests), the call no-ops. If the underlying
 * Server.sendToolListChanged() rejects, we swallow it — the handler's
 * primary work (persistence) already succeeded.
 */

export type ToolsListChangedNotifier = () => void | Promise<void>;

let notifierImpl: ToolsListChangedNotifier | null = null;

/** Called by transport code (server.ts, cli.ts) once the Server instance
 *  is constructed. Replaces any previously registered notifier. */
export function registerToolsListChangedNotifier(fn: ToolsListChangedNotifier | null): void {
  notifierImpl = fn;
}

/** Called by handlers after a state change that affects which tools are
 *  active. Fire-and-forget; never throws. */
export function notifyToolsListChanged(): void {
  if (!notifierImpl) return;
  try {
    const result = notifierImpl();
    if (result && typeof (result as Promise<void>).then === 'function') {
      (result as Promise<void>).catch(() => {
        // swallow — async dispatch failed, but handler work is done
      });
    }
  } catch {
    // swallow — never let a notification crash a handler
  }
}

/** Testing helper — clears any registered notifier so a unit test can
 *  install its own spy. Not exported from a barrel; used directly by tests. */
export function __resetNotifierForTests(): void {
  notifierImpl = null;
}
