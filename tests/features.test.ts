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
  enabledFeatures: new Set(['teams', 'subagents', 'admin']),
};

describe('TOOL_REGISTRY', () => {
  it('declares 40 tools (39 from v0.7.2 + knit_compounding_metrics in v0.8.1)', () => {
    expect(TOOL_REGISTRY.length).toBe(40);
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

  it('Tier 1 contains exactly 28 universal tools (27 from v0.7.2 + knit_compounding_metrics in v0.8.1)', () => {
    const tier1 = TOOL_REGISTRY.filter((t) => t.tier === 1);
    expect(tier1.length).toBe(28);
  });

  it('Tier 2 contains exactly 10 conditional tools', () => {
    const tier2 = TOOL_REGISTRY.filter((t) => t.tier === 2);
    expect(tier2.length).toBe(10);
  });

  it('Tier 3 contains exactly 2 admin/setup tools', () => {
    const tier3 = TOOL_REGISTRY.filter((t) => t.tier === 3);
    expect(tier3.length).toBe(2);
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
    expect(kg.length).toBe(5);
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
  it('empty project shape exposes only Tier 1 (28 tools after v0.8.1)', () => {
    const listing = computeFeatureListing(emptyShape);
    expect(listing.active.length).toBe(28);
    expect(listing.available.length).toBe(12);
    expect(listing.totals).toEqual({ active: 28, available: 12, total: 40 });
  });

  it('fully-enabled project shape exposes everything (40)', () => {
    const listing = computeFeatureListing(allEnabled);
    expect(listing.active.length).toBe(40);
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
    expect(listing.by_category.diagnostics.available).toBe(0);
  });
});

describe('isEnableableFeature', () => {
  it('accepts the three valid flags', () => {
    expect(isEnableableFeature('teams')).toBe(true);
    expect(isEnableableFeature('subagents')).toBe(true);
    expect(isEnableableFeature('admin')).toBe(true);
  });

  it('rejects unknown flags', () => {
    expect(isEnableableFeature('typos')).toBe(false);
    expect(isEnableableFeature('TEAMS')).toBe(false);
    expect(isEnableableFeature('')).toBe(false);
  });
});
