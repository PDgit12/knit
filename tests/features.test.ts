import { describe, it, expect } from 'vitest';
import {
  TOOL_REGISTRY,
  computeFeatureListing,
  isToolActive,
  isEnableableFeature,
  type ProjectShape,
} from '../src/mcp/features.js';

const emptyShape: ProjectShape = {
  hasAnalyzableCode: false,
  domainCount: 0,
  hasInstalledSubagents: false,
  sessionCount: 0,
  enabledFeatures: new Set(),
};

const allEnabled: ProjectShape = {
  hasAnalyzableCode: true,
  domainCount: 5,
  hasInstalledSubagents: true,
  sessionCount: 50,
  enabledFeatures: new Set(['teams', 'subagents', 'admin', 'diagnostics']),
};

describe('TOOL_REGISTRY', () => {
  it('declares 53 tools (v0.11.2 adds knit_delete_requirements)', () => {
    expect(TOOL_REGISTRY.length).toBe(53);
  });

  it('every tool has a unique name', () => {
    const names = TOOL_REGISTRY.map((t) => t.tool);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every tool name follows the knit_ prefix convention', () => {
    for (const t of TOOL_REGISTRY) {
      expect(t.tool).toMatch(/^knit_/);
    }
  });

  it('every tool has a non-empty rationale', () => {
    for (const t of TOOL_REGISTRY) {
      expect(t.rationale.length).toBeGreaterThan(0);
    }
  });

  it('Tier 1 contains exactly 34 universal tools (v0.12.1 demotes 6 diagnostics)', () => {
    const tier1 = TOOL_REGISTRY.filter((t) => t.tier === 1);
    expect(tier1.length).toBe(34);
  });

  it('Tier 2 contains exactly 16 conditional tools (v0.12.1 adds 6 diagnostics)', () => {
    const tier2 = TOOL_REGISTRY.filter((t) => t.tier === 2);
    expect(tier2.length).toBe(16);
  });

  it('Tier 3 contains exactly 3 admin/setup tools (v0.11 slice 4 adds knit_reset_calibration)', () => {
    const tier3 = TOOL_REGISTRY.filter((t) => t.tier === 3);
    expect(tier3.length).toBe(3);
  });

  it('Tier 2 and 3 tools have an enable_via hint', () => {
    for (const t of TOOL_REGISTRY) {
      if (t.tier === 2 || t.tier === 3) {
        expect(t.enable_via, `${t.tool} (tier ${t.tier}) needs enable_via hint`).toBeDefined();
      }
    }
  });

  it('knowledge graph tools are in Tier 1 (Knit\'s core differentiator)', () => {
    const kg = TOOL_REGISTRY.filter((t) => t.category === 'knowledge-graph');
    // 5 query tools from v0.7 + knit_verify_claim added in v0.9 = 6
    expect(kg.length).toBe(6);
    for (const t of kg) {
      expect(t.tier).toBe(1);
    }
  });

  it('all 9 team-worktree tools are in Tier 2 teams category', () => {
    const teams = TOOL_REGISTRY.filter((t) => t.category === 'teams');
    expect(teams.length).toBe(9);
    for (const t of teams) {
      expect(t.tier).toBe(2);
    }
  });

  it('feature-flag controls are in Tier 1 so hidden tools are always recoverable', () => {
    const enableTool = TOOL_REGISTRY.find((t) => t.tool === 'knit_enable_feature');
    const disableTool = TOOL_REGISTRY.find((t) => t.tool === 'knit_disable_feature');
    expect(enableTool?.tier).toBe(1);
    expect(disableTool?.tier).toBe(1);
  });
});

describe('isToolActive — gating rules', () => {
  it('every Tier 1 tool is active under an empty project shape', () => {
    const tier1 = TOOL_REGISTRY.filter((t) => t.tier === 1);
    for (const t of tier1) {
      expect(isToolActive(t, emptyShape), `Tier 1 tool ${t.tool} should always be active`).toBe(true);
    }
  });

  it('team tools auto-activate when ≥3 domains detected', () => {
    const teamsTool = TOOL_REGISTRY.find((t) => t.tool === 'knit_spawn_team_worktree')!;
    expect(isToolActive(teamsTool, emptyShape)).toBe(false);
    expect(isToolActive(teamsTool, { ...emptyShape, domainCount: 3 })).toBe(true);
    expect(isToolActive(teamsTool, { ...emptyShape, domainCount: 2 })).toBe(false);
  });

  it('team tools also activate via explicit opt-in even on solo-domain projects', () => {
    const teamsTool = TOOL_REGISTRY.find((t) => t.tool === 'knit_spawn_team_worktree')!;
    expect(isToolActive(teamsTool, { ...emptyShape, enabledFeatures: new Set(['teams']) })).toBe(true);
  });

  it('subagent tool activates when .claude/agents/ exists OR explicit opt-in', () => {
    const sub = TOOL_REGISTRY.find((t) => t.tool === 'knit_install_agent')!;
    expect(isToolActive(sub, emptyShape)).toBe(false);
    expect(isToolActive(sub, { ...emptyShape, hasInstalledSubagents: true })).toBe(true);
    expect(isToolActive(sub, { ...emptyShape, enabledFeatures: new Set(['subagents']) })).toBe(true);
  });

  it('Tier 3 admin tools are strictly opt-in', () => {
    const tier3 = TOOL_REGISTRY.filter((t) => t.tier === 3);
    for (const t of tier3) {
      expect(isToolActive(t, emptyShape), `Tier 3 ${t.tool} should default-hidden`).toBe(false);
      expect(isToolActive(t, { ...emptyShape, enabledFeatures: new Set(['admin']) })).toBe(true);
    }
  });
});

describe('computeFeatureListing', () => {
  it('empty project shape exposes 40 tools (34 Tier-1 + 6 Tier-2 diagnostics auto-exposed on first session)', () => {
    const listing = computeFeatureListing(emptyShape);
    expect(listing.active.length).toBe(40);
    expect(listing.available.length).toBe(13);
    expect(listing.totals).toEqual({ active: 40, available: 13, total: 53 });
  });

  it('post-onboarding shape (sessionCount > 1) hides the 6 setup diagnostics by default', () => {
    const postOnboard: ProjectShape = { ...emptyShape, sessionCount: 5 };
    const listing = computeFeatureListing(postOnboard);
    // 34 Tier-1 still active; 6 demoted diagnostics now hidden.
    expect(listing.active.length).toBe(34);
    expect(listing.by_category.diagnostics.available).toBe(6);
  });

  it('diagnostics opt-in re-exposes the 6 setup diagnostics post-onboarding', () => {
    const optIn: ProjectShape = { ...emptyShape, sessionCount: 5, enabledFeatures: new Set(['diagnostics']) };
    const listing = computeFeatureListing(optIn);
    expect(listing.active.length).toBe(40);
    expect(listing.by_category.diagnostics.available).toBe(0);
  });

  it('fully-enabled project shape exposes everything (53)', () => {
    const listing = computeFeatureListing(allEnabled);
    expect(listing.active.length).toBe(53);
    expect(listing.available.length).toBe(0);
  });

  it('≥3 domains exposes all 9 team tools without needing opt-in', () => {
    const listing = computeFeatureListing({ ...emptyShape, domainCount: 3 });
    const teamsActive = listing.active.filter((t) => t.category === 'teams').length;
    expect(teamsActive).toBe(9);
  });

  it('reports available tools with reason + enable_via hint', () => {
    const listing = computeFeatureListing(emptyShape);
    const teamsEntry = listing.available.find((t) => t.name === 'knit_spawn_team_worktree');
    expect(teamsEntry).toBeDefined();
    expect(teamsEntry?.reason.length).toBeGreaterThan(0);
    expect(teamsEntry?.enable_via).toMatch(/teams/);
  });

  it('Tier-1 categories always have zero available (memory, knowledge-graph, workflow, etc.)', () => {
    const listing = computeFeatureListing(emptyShape);
    expect(listing.by_category.memory.available).toBe(0);
    expect(listing.by_category['knowledge-graph'].available).toBe(0);
    expect(listing.by_category.workflow.available).toBe(0);
    expect(listing.by_category['fp-reflection'].available).toBe(0);
    expect(listing.by_category['protocol-config'].available).toBe(0);
    // diagnostics now has 6 Tier-2 members but they auto-expose on first session,
    // so availability is still 0 on the empty (first-session) shape.
    expect(listing.by_category.diagnostics.available).toBe(0);
  });
});

describe('isEnableableFeature', () => {
  it('accepts the four valid flags (v0.12.1 adds diagnostics)', () => {
    expect(isEnableableFeature('teams')).toBe(true);
    expect(isEnableableFeature('subagents')).toBe(true);
    expect(isEnableableFeature('admin')).toBe(true);
    expect(isEnableableFeature('diagnostics')).toBe(true);
  });

  it('rejects unknown flags', () => {
    expect(isEnableableFeature('typos')).toBe(false);
    expect(isEnableableFeature('TEAMS')).toBe(false);
    expect(isEnableableFeature('')).toBe(false);
  });
});
