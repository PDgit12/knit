import { describe, it, expect } from 'vitest';
import { TOOL_REGISTRY, computeFeatureListing, type ProjectShape } from '../src/mcp/features.js';

const emptyShape: ProjectShape = {
  hasAnalyzableCode: false,
  domainCount: 0,
  hasInstalledSubagents: false,
  sessionCount: 0,
  enabledFeatures: new Set(),
};

describe('TOOL_REGISTRY', () => {
  it('declares 36 tools (35 existing + knit_list_features)', () => {
    expect(TOOL_REGISTRY.length).toBe(36);
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

  it('Tier 1 contains exactly 24 universal tools', () => {
    const tier1 = TOOL_REGISTRY.filter((t) => t.tier === 1);
    expect(tier1.length).toBe(24);
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
});

describe('computeFeatureListing (step 3 placeholder behavior)', () => {
  it('returns all tools as active until step 4 plugs in real gating', () => {
    const listing = computeFeatureListing(emptyShape);
    expect(listing.active.length).toBe(36);
    expect(listing.available.length).toBe(0);
    expect(listing.totals).toEqual({ active: 36, available: 0, total: 36 });
  });

  it('breaks the count down per-category', () => {
    const listing = computeFeatureListing(emptyShape);
    expect(listing.by_category.memory.active).toBe(8);
    expect(listing.by_category['knowledge-graph'].active).toBe(5);
    expect(listing.by_category.workflow.active).toBe(4);
    expect(listing.by_category['fp-reflection'].active).toBe(3);
    expect(listing.by_category['protocol-config'].active).toBe(2);
    expect(listing.by_category.diagnostics.active).toBe(2);
    expect(listing.by_category.teams.active).toBe(9);
    expect(listing.by_category.subagents.active).toBe(1);
    expect(listing.by_category.admin.active).toBe(2);
  });

  it('placeholder behavior does not depend on project shape', () => {
    // Until step 4, the listing should be identical regardless of shape.
    const a = computeFeatureListing(emptyShape);
    const b = computeFeatureListing({
      hasAnalyzableCode: true,
      domainCount: 5,
      hasInstalledSubagents: true,
      sessionCount: 50,
      enabledFeatures: new Set(['teams', 'subagents', 'admin']),
    });
    expect(a.totals).toEqual(b.totals);
  });
});
