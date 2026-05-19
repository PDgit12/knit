import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  scanIntegrations,
  persistScanResult,
  loadScanResult,
} from '../src/engine/integration-scanner.js';

/**
 * v0.7.2 — integration scanner.
 *
 * Detection covers: Ruflo, gstack, CodeTour, Conductor, other MCP servers,
 * and custom workflow sections in the project's CLAUDE.md. Output persists
 * to ~/.knit/projects/<hash>/integrations.json and is surfaced by
 * knit_brain_status. v0.8 will feed this into per-project server-instruction
 * tailoring.
 *
 * These tests run against a sandboxed projectRoot. The home-dir signals
 * (~/.ruflo/, ~/.gstack/, ~/.conductor/, ~/.claude.json) are NOT mocked —
 * the tests just assert the scanner reports an honest result given whatever
 * the current home dir contains. Project-local signals (project CLAUDE.md,
 * .claude-flow/ at project root, .tours/ at project root, package.json
 * dep) ARE under test control.
 */

let knitHome: string;
let projectRoot: string;

beforeEach(() => {
  knitHome = mkdtempSync(join(tmpdir(), 'knit-scanner-test-'));
  process.env.KNIT_HOME = knitHome;
  projectRoot = mkdtempSync(join(tmpdir(), 'knit-scanner-project-'));
});

afterEach(() => {
  delete process.env.KNIT_HOME;
  try { rmSync(knitHome, { recursive: true, force: true }); } catch { /* best-effort */ }
  try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('scanIntegrations — shape + invariants', () => {
  it('returns a ScanResult with all detectors run', () => {
    const result = scanIntegrations(projectRoot);
    expect(result.scannedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.detected.ruflo).toBeDefined();
    expect(result.detected.gstack).toBeDefined();
    expect(result.detected.codetour).toBeDefined();
    expect(result.detected.conductor).toBeDefined();
    expect(Array.isArray(result.detected.other_mcp_servers)).toBe(true);
    expect(Array.isArray(result.detected.custom_workflow_sections)).toBe(true);
    expect(typeof result.summary).toBe('string');
  });

  it('detected.X.present is boolean; via is always an array', () => {
    const result = scanIntegrations(projectRoot);
    for (const key of ['ruflo', 'gstack', 'codetour', 'conductor'] as const) {
      const d = result.detected[key];
      expect(typeof d.present).toBe('boolean');
      expect(Array.isArray(d.via)).toBe(true);
      // Invariant: present <=> via.length > 0
      expect(d.present).toBe(d.via.length > 0);
    }
  });

  it('produces a summary mentioning each detected framework', () => {
    // Force-detect CodeTour via project-local .tours/ dir.
    mkdirSync(join(projectRoot, '.tours'), { recursive: true });
    writeFileSync(join(projectRoot, '.tours', 'onboarding.tour'), '{}', 'utf-8');

    const result = scanIntegrations(projectRoot);
    expect(result.detected.codetour.present).toBe(true);
    expect(result.detected.codetour.via).toContain('dot-tours-dir');
    expect(result.detected.codetour.files).toContain('.tours/onboarding.tour');
    expect(result.summary).toMatch(/CodeTour/);
  });
});

describe('detectRuflo — project-local signals', () => {
  it('detects Ruflo via project .claude-flow/ directory', () => {
    mkdirSync(join(projectRoot, '.claude-flow'), { recursive: true });
    const result = scanIntegrations(projectRoot);
    expect(result.detected.ruflo.present).toBe(true);
    expect(result.detected.ruflo.via).toContain('project-claude-flow-dir');
  });

  it('detects Ruflo via package.json dependency', () => {
    writeFileSync(
      join(projectRoot, 'package.json'),
      JSON.stringify({ name: 'test', dependencies: { ruflo: '^3.0.0' } }),
      'utf-8',
    );
    const result = scanIntegrations(projectRoot);
    expect(result.detected.ruflo.present).toBe(true);
    expect(result.detected.ruflo.via).toContain('npm-dep');
  });

  it('also catches claude-flow as a Ruflo signal (legacy name)', () => {
    writeFileSync(
      join(projectRoot, 'package.json'),
      JSON.stringify({ name: 'test', devDependencies: { 'claude-flow': '^2.0.0' } }),
      'utf-8',
    );
    const result = scanIntegrations(projectRoot);
    expect(result.detected.ruflo.present).toBe(true);
    expect(result.detected.ruflo.via).toContain('npm-dep');
  });
});

describe('detectCodeTour', () => {
  it('returns present=false when no .tours/ directory exists', () => {
    const result = scanIntegrations(projectRoot);
    // Project root is empty mkdtemp dir — no .tours/.
    expect(result.detected.codetour.present).toBe(false);
    expect(result.detected.codetour.via).toEqual([]);
  });

  it('lists .tour files when .tours/ exists', () => {
    mkdirSync(join(projectRoot, '.tours'), { recursive: true });
    writeFileSync(join(projectRoot, '.tours', 'a.tour'), '{}', 'utf-8');
    writeFileSync(join(projectRoot, '.tours', 'b.tour'), '{}', 'utf-8');
    writeFileSync(join(projectRoot, '.tours', 'notes.md'), 'should be ignored', 'utf-8');

    const result = scanIntegrations(projectRoot);
    expect(result.detected.codetour.files).toEqual(expect.arrayContaining(['.tours/a.tour', '.tours/b.tour']));
    expect(result.detected.codetour.files).not.toContain('.tours/notes.md');
  });
});

describe('detectCustomWorkflowSections', () => {
  it('returns [] when CLAUDE.md is missing', () => {
    const result = scanIntegrations(projectRoot);
    expect(result.detected.custom_workflow_sections).toEqual([]);
  });

  it('detects ## Engineering Workflow heading outside the knit block', () => {
    writeFileSync(
      join(projectRoot, 'CLAUDE.md'),
      `# My Project\n\n## Engineering Workflow\n\nWe ship via X.\n\n<!-- knit:start -->\nknit-managed\n<!-- knit:end -->\n`,
      'utf-8',
    );
    const result = scanIntegrations(projectRoot);
    expect(result.detected.custom_workflow_sections).toContain('Engineering Workflow');
  });

  it('strips knit-managed content before scanning (avoids false positives from Knit\'s own headings)', () => {
    writeFileSync(
      join(projectRoot, 'CLAUDE.md'),
      `# My Project\n\n<!-- knit:start -->\n## Workflow on demand\nknit\n<!-- knit:end -->\n`,
      'utf-8',
    );
    const result = scanIntegrations(projectRoot);
    // The "Workflow on demand" heading lives inside knit markers — must NOT fire.
    expect(result.detected.custom_workflow_sections).toEqual([]);
  });

  it('also strips legacy engram markers', () => {
    writeFileSync(
      join(projectRoot, 'CLAUDE.md'),
      `# My Project\n\n<!-- engram:start -->\n## Workflow on demand\nlegacy\n<!-- engram:end -->\n`,
      'utf-8',
    );
    const result = scanIntegrations(projectRoot);
    expect(result.detected.custom_workflow_sections).toEqual([]);
  });

  it('detects multiple workflow-suggesting headings', () => {
    writeFileSync(
      join(projectRoot, 'CLAUDE.md'),
      `# My Project\n\n## Engineering Workflow\n...\n\n## Methodology\n...\n`,
      'utf-8',
    );
    const result = scanIntegrations(projectRoot);
    expect(result.detected.custom_workflow_sections.length).toBeGreaterThanOrEqual(2);
  });
});

describe('persistScanResult + loadScanResult', () => {
  it('round-trips a scan result via atomic write', async () => {
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    const result = scanIntegrations(projectRoot, { knitVersion: '0.7.2' });
    persistScanResult(projectRoot, result);

    const loaded = loadScanResult(projectRoot);
    expect(loaded).not.toBeNull();
    expect(loaded?.scannedAt).toBe(result.scannedAt);
    expect(loaded?.knitVersion).toBe('0.7.2');
    expect(loaded?.detected.ruflo.present).toBe(result.detected.ruflo.present);
  });

  it('loadScanResult returns null when no scan has run yet', () => {
    expect(loadScanResult(projectRoot)).toBeNull();
  });

  it('loadScanResult returns null on malformed JSON (never throws)', async () => {
    const { integrationsConfigPath, projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });
    writeFileSync(integrationsConfigPath(projectRoot), '{ broken json', 'utf-8');

    expect(() => loadScanResult(projectRoot)).not.toThrow();
    expect(loadScanResult(projectRoot)).toBeNull();
  });

  it('atomic write leaves no .tmp- staging files behind', async () => {
    const { projectDataDir, integrationsConfigPath } = await import('../src/engine/paths.js');
    const { readdirSync } = await import('node:fs');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    persistScanResult(projectRoot, scanIntegrations(projectRoot));
    persistScanResult(projectRoot, scanIntegrations(projectRoot));
    persistScanResult(projectRoot, scanIntegrations(projectRoot));

    expect(existsSync(integrationsConfigPath(projectRoot))).toBe(true);
    const stragglers = readdirSync(projectDataDir(projectRoot)).filter((f) => f.includes('.tmp-'));
    expect(stragglers).toEqual([]);
  });
});

describe('knit_scan_integrations handler', () => {
  it('runs the scan, persists, and returns the result', async () => {
    const { handleScanIntegrations } = await import('../src/mcp/handlers.js');
    const { projectDataDir, integrationsConfigPath } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const brain = { rootPath: projectRoot, knowledge: { summary: { totalFiles: 0 } }, config: { domains: [] } } as any;
    const resp = JSON.parse(handleScanIntegrations({}, brain));
    expect(resp.status).toBe('scanned');
    expect(resp.detected).toBeDefined();
    expect(resp.summary).toBeDefined();
    expect(existsSync(integrationsConfigPath(projectRoot))).toBe(true);
  });
});
