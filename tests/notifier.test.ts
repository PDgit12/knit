import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  registerToolsListChangedNotifier,
  notifyToolsListChanged,
  __resetNotifierForTests,
} from '../src/mcp/notifier.js';

/**
 * v0.7.1 — tools/list_changed wiring.
 *
 * The notifier module is the bridge between handler logic (which doesn't own
 * the MCP Server instance) and the transport layer (which calls
 * server.sendToolListChanged on the SDK). These tests verify:
 *
 *   1. The notifier fires exactly when enable/disable changes persisted state.
 *   2. Idempotent calls (re-enable when already on, disable when already off)
 *      do NOT fire — otherwise we'd spam the client with no-op tools/list
 *      refetches.
 *   3. Notifier exceptions don't bubble out of handlers — handler primary work
 *      (persistence) is already done by the time the notification is attempted.
 */

let knitHome: string;
let projectRoot: string;
let calls: number;

beforeEach(() => {
  knitHome = mkdtempSync(join(tmpdir(), 'knit-notifier-test-'));
  process.env.KNIT_HOME = knitHome;
  projectRoot = mkdtempSync(join(tmpdir(), 'knit-notifier-project-'));
  calls = 0;
  __resetNotifierForTests();
});

afterEach(() => {
  delete process.env.KNIT_HOME;
  __resetNotifierForTests();
  try { rmSync(knitHome, { recursive: true, force: true }); } catch { /* best-effort */ }
  try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('registerToolsListChangedNotifier / notifyToolsListChanged', () => {
  it('invokes the registered notifier when notifyToolsListChanged() fires', () => {
    registerToolsListChangedNotifier(() => { calls++; });
    notifyToolsListChanged();
    notifyToolsListChanged();
    expect(calls).toBe(2);
  });

  it('no-ops when no notifier registered (e.g. outside MCP transport)', () => {
    // __resetNotifierForTests already cleared the slot in beforeEach.
    expect(() => notifyToolsListChanged()).not.toThrow();
  });

  it('swallows synchronous notifier exceptions — handler primary work must not be torn down', () => {
    registerToolsListChangedNotifier(() => { throw new Error('transport closed'); });
    expect(() => notifyToolsListChanged()).not.toThrow();
  });

  it('swallows async notifier rejections', async () => {
    registerToolsListChangedNotifier(() => Promise.reject(new Error('send failed')));
    expect(() => notifyToolsListChanged()).not.toThrow();
    // Yield to the microtask queue so the swallowed rejection is processed.
    await new Promise((resolve) => setImmediate(resolve));
  });
});

describe('handleEnableFeature / handleDisableFeature fire tools/list_changed on state transitions', () => {
  it('handleEnableFeature fires the notification when the flag flips on', async () => {
    registerToolsListChangedNotifier(() => { calls++; });

    const { handleEnableFeature } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const brain = { rootPath: projectRoot, knowledge: { summary: { totalFiles: 0 } }, config: { domains: [] } } as any;

    expect(calls).toBe(0);
    handleEnableFeature({ feature: 'teams' }, brain);
    expect(calls).toBe(1);
  });

  it('handleEnableFeature does NOT fire when already enabled (no state transition)', async () => {
    registerToolsListChangedNotifier(() => { calls++; });

    const { handleEnableFeature } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const brain = { rootPath: projectRoot, knowledge: { summary: { totalFiles: 0 } }, config: { domains: [] } } as any;

    handleEnableFeature({ feature: 'teams' }, brain);
    expect(calls).toBe(1);

    // Re-enable: persisted state unchanged, notification must NOT fire.
    handleEnableFeature({ feature: 'teams' }, brain);
    expect(calls).toBe(1);
  });

  it('handleDisableFeature fires the notification when the flag flips off', async () => {
    registerToolsListChangedNotifier(() => { calls++; });

    const { handleEnableFeature, handleDisableFeature } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const brain = { rootPath: projectRoot, knowledge: { summary: { totalFiles: 0 } }, config: { domains: [] } } as any;

    handleEnableFeature({ feature: 'teams' }, brain);
    expect(calls).toBe(1);

    handleDisableFeature({ feature: 'teams' }, brain);
    expect(calls).toBe(2);

    // Re-disable: no state change, no notification.
    handleDisableFeature({ feature: 'teams' }, brain);
    expect(calls).toBe(2);
  });

  it('invalid feature name does NOT fire the notification (error path)', async () => {
    registerToolsListChangedNotifier(() => { calls++; });

    const { handleEnableFeature } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const brain = { rootPath: projectRoot, knowledge: { summary: { totalFiles: 0 } }, config: { domains: [] } } as any;

    handleEnableFeature({ feature: 'frobnicate' }, brain);
    expect(calls).toBe(0);
  });
});
