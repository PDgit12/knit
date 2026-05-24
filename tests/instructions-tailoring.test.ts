import { describe, it, expect } from 'vitest';
import { buildInstructions, KNIT_INSTRUCTIONS_BASE } from '../src/mcp/instructions.js';
import type { ScanResult } from '../src/engine/integration-scanner.js';

/**
 * v0.8.1 — per-project instruction tailoring.
 *
 * buildInstructions(scan) returns the universal baseline unchanged when
 * no integrations are detected, and appends short framework-specific
 * addenda otherwise. Tests pin the addendum behavior per framework AND
 * the back-compat invariant that the static KNIT_INSTRUCTIONS export
 * still equals the base string.
 */

function emptyScan(): ScanResult {
  return {
    scannedAt: new Date().toISOString(),
    detected: {
      ruflo: { present: false, via: [] },
      gstack: { present: false, via: [] },
      codetour: { present: false, via: [] },
      conductor: { present: false, via: [] },
      other_mcp_servers: [],
      custom_workflow_sections: [],
    },
    summary: 'No existing workflow frameworks detected.',
  };
}

describe('buildInstructions', () => {
  it('returns the universal baseline when scan is null', () => {
    expect(buildInstructions(null)).toBe(KNIT_INSTRUCTIONS_BASE);
  });

  it('returns the universal baseline when scan detected nothing', () => {
    expect(buildInstructions(emptyScan())).toBe(KNIT_INSTRUCTIONS_BASE);
  });

  it('Ruflo addendum: defers swarm + multi-agent routing to Ruflo', () => {
    const scan = emptyScan();
    scan.detected.ruflo = { present: true, via: ['mcp-server'] };
    const out = buildInstructions(scan);
    expect(out).toContain(KNIT_INSTRUCTIONS_BASE);
    expect(out).toMatch(/Ruflo/);
    expect(out).toMatch(/swarm/i);
    // Knit retains its layer
    expect(out).toMatch(/memory \+ tier-routed/);
  });

  it('gstack addendum: defers routing slash commands to gstack', () => {
    const scan = emptyScan();
    scan.detected.gstack = { present: true, via: ['home-dir'] };
    const out = buildInstructions(scan);
    expect(out).toMatch(/gstack/);
    expect(out).toMatch(/\/plan/);
    expect(out).toMatch(/\/ship/);
  });

  it('CodeTour addendum: surfaces tours over reconstructing explanations', () => {
    const scan = emptyScan();
    scan.detected.codetour = { present: true, via: ['dot-tours-dir'] };
    const out = buildInstructions(scan);
    expect(out).toMatch(/CodeTour/);
    expect(out).toMatch(/tours/);
  });

  it('Custom-workflow-sections addendum names the detected headings', () => {
    const scan = emptyScan();
    scan.detected.custom_workflow_sections = ['Engineering Workflow', 'Methodology'];
    const out = buildInstructions(scan);
    expect(out).toMatch(/Engineering Workflow/);
    expect(out).toMatch(/Methodology/);
  });

  it('combines multiple addenda when several frameworks present', () => {
    const scan = emptyScan();
    scan.detected.ruflo = { present: true, via: ['mcp-server'] };
    scan.detected.codetour = { present: true, via: ['dot-tours-dir'] };
    scan.detected.custom_workflow_sections = ['Engineering Workflow'];
    const out = buildInstructions(scan);
    expect(out).toMatch(/Ruflo/);
    expect(out).toMatch(/CodeTour/);
    expect(out).toMatch(/Engineering Workflow/);
    // General rule footer appears once
    expect((out.match(/General rule:/g) || []).length).toBe(1);
  });

  it('stays under the v0.11.1 budget (~1300 token target ≈ 5.5KB with v0.11 tool surface + all addenda)', () => {
    const scan = emptyScan();
    scan.detected.ruflo = { present: true, via: ['mcp-server'] };
    scan.detected.gstack = { present: true, via: ['home-dir'] };
    scan.detected.codetour = { present: true, via: ['dot-tours-dir'] };
    scan.detected.conductor = { present: true, via: ['home-dir'] };
    scan.detected.custom_workflow_sections = ['Engineering Workflow'];
    const out = buildInstructions(scan);
    expect(out.length).toBeLessThan(5500);
  });
});
