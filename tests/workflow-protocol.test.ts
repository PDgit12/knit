import { describe, it, expect } from 'vitest';
import {
  WORKFLOW_SECTIONS,
  getWorkflowSection,
  listWorkflowSections,
} from '../src/generators/workflow-protocol.js';

describe('workflow-protocol', () => {
  it('every WORKFLOW_SECTIONS entry returns non-empty content', () => {
    for (const phase of WORKFLOW_SECTIONS) {
      const content = getWorkflowSection(phase);
      expect(content, `phase: ${phase}`).not.toBeNull();
      expect(content!.length, `phase: ${phase}`).toBeGreaterThan(50);
    }
  });

  it('returns null for unknown phase', () => {
    expect(getWorkflowSection('does-not-exist')).toBeNull();
    expect(getWorkflowSection('')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(getWorkflowSection('RESEARCH')).not.toBeNull();
    expect(getWorkflowSection('Research')).not.toBeNull();
    expect(getWorkflowSection('research')).toBe(getWorkflowSection('RESEARCH'));
  });

  it('trims whitespace from phase input', () => {
    expect(getWorkflowSection('  research  ')).not.toBeNull();
  });

  it('listWorkflowSections returns one entry per WORKFLOW_SECTIONS phase', () => {
    const list = listWorkflowSections();
    expect(list).toHaveLength(WORKFLOW_SECTIONS.length);
    for (const phase of WORKFLOW_SECTIONS) {
      expect(list.find((s) => s.name === phase), `phase: ${phase}`).toBeDefined();
    }
  });

  it('embeds project build commands when provided', () => {
    const content = getWorkflowSection('review', {
      buildCommands: { typecheck: 'npm run tc', lint: 'eslint .' },
    });
    expect(content).toContain('npm run tc');
    expect(content).toContain('eslint .');
  });

  it('omits build-command hints when not provided', () => {
    const content = getWorkflowSection('review');
    // Should still have phase content, just no project-specific block
    expect(content).not.toBeNull();
    expect(content!.length).toBeGreaterThan(50);
    // None of the typical command names should appear without context
    expect(content).not.toContain('npm run tc');
  });

  it('tier section references the four tiers', () => {
    const content = getWorkflowSection('tier')!;
    expect(content).toContain('Inquiry');
    expect(content).toContain('Trivial');
    expect(content).toContain('Standard');
    expect(content).toContain('Complex');
  });

  it('plan section mentions auto plan mode for Complex', () => {
    const content = getWorkflowSection('plan')!;
    expect(content.toLowerCase()).toContain('plan mode');
    expect(content).toContain('Complex');
  });

  it('learn section preserves the quality-gate question', () => {
    const content = getWorkflowSection('learn')!;
    expect(content).toContain('searched for this tag');
  });

  it('tools section lists key engram MCP tools', () => {
    const content = getWorkflowSection('tools')!;
    expect(content).toContain('knit_load_session');
    expect(content).toContain('knit_record_learning');
    expect(content).toContain('knit_search_sessions');
  });

  // F3 (v0.15.0 audit): workflow phases now embed knit_suggest_command hooks
  // so agents check for a user-defined slash command before duplicating it.
  it('EXECUTE phase suggests calling knit_suggest_command for test/lint/ship', () => {
    const content = getWorkflowSection('execute')!;
    expect(content).toContain('knit_suggest_command');
    expect(content).toMatch(/test|lint|ship|qa/);
  });

  it('REVIEW phase suggests calling knit_suggest_command for review', () => {
    const content = getWorkflowSection('review')!;
    expect(content).toContain('knit_suggest_command');
    expect(content).toMatch(/review/);
  });
});
