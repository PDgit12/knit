/**
 * Tool tier + category registry. The locked v0.7 design (see V0.7-PLAN.md)
 * classifies every Knit tool into one of three tiers:
 *
 *   - Tier 1: universal — always exposed.
 *   - Tier 2: project-specific — auto-exposed when the project shape matches
 *     (e.g., team-worktree tools only when ≥3 domains detected).
 *   - Tier 3: admin / one-time — hidden by default, reachable via opt-in.
 *
 * This module is the registry. The gating logic that decides which Tier-2
 * tools to actually expose lives in step 4 of the build order — until then
 * everything resolves to "active" so users see no regression from the
 * exposure surface they have today.
 */

export type ToolTier = 1 | 2 | 3;

export type ToolCategory =
  | 'memory'
  | 'knowledge-graph'
  | 'workflow'
  | 'fp-reflection'
  | 'protocol-config'
  | 'diagnostics'
  | 'teams'
  | 'subagents'
  | 'admin';

export interface FeatureInfo {
  tool: string;
  tier: ToolTier;
  category: ToolCategory;
  /** Why this tool is in this tier; surfaced when the tool is hidden so the agent can tell the user how to enable it. */
  rationale: string;
  /** Human-readable enable hint for hidden Tier-2/3 tools. Empty for Tier 1. */
  enable_via?: string;
}

export const TOOL_REGISTRY: readonly FeatureInfo[] = [
  // ── Tier 1 — Memory + retrieval (8) ─────────────────────────────
  { tool: 'knit_load_session', tier: 1, category: 'memory', rationale: 'Session-start primer; universal' },
  { tool: 'knit_search_learnings', tier: 1, category: 'memory', rationale: 'Project-local learnings lookup; universal' },
  { tool: 'knit_search_global_learnings', tier: 1, category: 'memory', rationale: 'Cross-project learnings pool; seeded by default' },
  { tool: 'knit_search_sessions', tier: 1, category: 'memory', rationale: '"Have I done this before?" — universal' },
  { tool: 'knit_record_learning', tier: 1, category: 'memory', rationale: 'LEARN step persistence; universal' },
  { tool: 'knit_record_global_learning', tier: 1, category: 'memory', rationale: 'Cross-project memory write; useful from day one' },
  { tool: 'knit_save_session_summary', tier: 1, category: 'memory', rationale: 'Session-end persistence; universal' },
  { tool: 'knit_save_handoff', tier: 1, category: 'memory', rationale: 'Context-degradation handoff; universal' },

  // ── Tier 1 — Knowledge graph (5) ────────────────────────────────
  { tool: 'knit_query_imports', tier: 1, category: 'knowledge-graph', rationale: 'Core differentiator; returns empty honestly on docs-only projects' },
  { tool: 'knit_query_exports', tier: 1, category: 'knowledge-graph', rationale: 'Core differentiator; same honest-empty behavior' },
  { tool: 'knit_query_dependents', tier: 1, category: 'knowledge-graph', rationale: 'Core differentiator' },
  { tool: 'knit_query_tests', tier: 1, category: 'knowledge-graph', rationale: 'Core differentiator' },
  { tool: 'knit_find_fanout', tier: 1, category: 'knowledge-graph', rationale: 'Core differentiator' },

  // ── Tier 1 — Workflow + classification (4) ──────────────────────
  { tool: 'knit_classify_task', tier: 1, category: 'workflow', rationale: 'Tier router; called before any non-trivial task' },
  { tool: 'knit_build_context', tier: 1, category: 'workflow', rationale: 'Domain Context Object builder' },
  { tool: 'knit_get_workflow', tier: 1, category: 'workflow', rationale: 'On-demand phase depth fetcher' },
  { tool: 'knit_get_suggestions', tier: 1, category: 'workflow', rationale: 'Adaptive warnings from past patterns' },

  // ── Tier 1 — False positives + reflection (3) ───────────────────
  { tool: 'knit_record_false_positive', tier: 1, category: 'fp-reflection', rationale: 'Universal — reviewer agents flag FPs on any project. v0.11 slice 4: direction tags feed the self-healing classifier.' },
  { tool: 'knit_get_calibration', tier: 1, category: 'fp-reflection', rationale: 'Per-project classifier calibration state. Pair with compounding_metrics for the self-healing view.' },
  { tool: 'knit_reset_calibration', tier: 3, category: 'admin', rationale: 'Wipe classifier calibration. Admin because it discards accumulated tuning.', enable_via: 'knit_enable_feature("admin")' },
  { tool: 'knit_index_requirements', tier: 1, category: 'memory', rationale: 'Ingest long-form requirements/specs into a BM25-indexed per-project store. Enables the 200KB-doc → relevant-chunks-only retrieval pattern.' },
  { tool: 'knit_generate_test_cases', tier: 1, category: 'memory', rationale: 'Query indexed requirements; returns top-N relevant chunks + test-generation template. Companion to knit_index_requirements.' },
  { tool: 'knit_list_requirements', tier: 1, category: 'memory', rationale: 'List indexed requirements sources (header info only). Cheap discovery tool.' },
  { tool: 'knit_get_fingerprint', tier: 1, category: 'diagnostics', rationale: 'v0.12 — project fingerprint (lang/framework/test/lint/build/CI). Foundation for auto-config and per-project template generation.' },
  { tool: 'knit_infer_domains', tier: 1, category: 'diagnostics', rationale: 'v0.12 phase 1 — ranks candidate domains via RRF fusion of git co-change + import-graph centrality + test colocation. Feeds template composition.' },
  { tool: 'knit_get_false_positives', tier: 1, category: 'fp-reflection', rationale: 'Universal' },
  { tool: 'knit_reflect', tier: 1, category: 'fp-reflection', rationale: 'Returns "not enough data" on sparse projects; always available' },

  // ── Tier 1 — Protocol Guard config (2) ──────────────────────────
  { tool: 'knit_set_protocol_strictness', tier: 1, category: 'protocol-config', rationale: 'Universal — every install ships Protocol Guard' },
  { tool: 'knit_get_protocol_strictness', tier: 1, category: 'protocol-config', rationale: 'Universal' },

  // ── Tier 1 — Diagnostics + meta (5) ─────────────────────────────
  { tool: 'knit_brain_status', tier: 1, category: 'diagnostics', rationale: 'Health + token-accounting; universal' },
  { tool: 'knit_list_features', tier: 1, category: 'diagnostics', rationale: 'The discoverability escape hatch itself' },
  { tool: 'knit_enable_feature', tier: 1, category: 'diagnostics', rationale: 'Flip on a Tier-2/3 feature flag — must always be reachable so hidden tools are recoverable' },
  { tool: 'knit_disable_feature', tier: 1, category: 'diagnostics', rationale: 'Flip off a previously-enabled feature flag' },
  { tool: 'knit_scan_integrations', tier: 1, category: 'diagnostics', rationale: 'Re-detect existing user workflow frameworks (Ruflo, gstack, CodeTour, custom CLAUDE.md) so Knit can integrate rather than overlap' },
  { tool: 'knit_compounding_metrics', tier: 1, category: 'diagnostics', rationale: 'Quantifies "Knit gets cheaper over time" — sessions, learnings, reuse ratio, estimated tokens saved. Companion to knit_brain_status budget surface.' },
  { tool: 'knit_get_metrics_history', tier: 1, category: 'diagnostics', rationale: 'Weekly snapshots + week-over-week deltas. Pure read of metrics-history.jsonl; companion to knit_compounding_metrics for trend charts.' },
  { tool: 'knit_verify_claim', tier: 1, category: 'knowledge-graph', rationale: 'On-demand fact-check against the knowledge graph. Companion to knit_query_* — those tools answer "what?"; this one answers "is the agent\'s claim about it true?"' },
  { tool: 'knit_get_learning', tier: 1, category: 'memory', rationale: 'Hierarchical-retrieval companion: fetch one full learning by id after knit_search_learnings returned a headline. Saves tokens on the upfront list, pays per-detail.' },
  { tool: 'knit_consolidate_learnings', tier: 1, category: 'memory', rationale: 'Cluster similar learnings via tag-Jaccard, propose a single pattern entry, optionally commit. Keeps the working set lean as the KB grows.' },

  // ── Tier 2 — Team worktrees (9) ─────────────────────────────────
  { tool: 'knit_spawn_team_worktree', tier: 2, category: 'teams', rationale: 'Multi-domain parallel write orchestration', enable_via: 'knit_enable_feature("teams") or auto-exposed when ≥3 domains detected' },
  { tool: 'knit_finalize_team_worktree', tier: 2, category: 'teams', rationale: 'Merge/discard a team worktree', enable_via: 'knit_enable_feature("teams")' },
  { tool: 'knit_list_team_worktrees', tier: 2, category: 'teams', rationale: 'Active team worktree registry', enable_via: 'knit_enable_feature("teams")' },
  { tool: 'knit_define_team', tier: 2, category: 'teams', rationale: 'Custom team definition', enable_via: 'knit_enable_feature("teams")' },
  { tool: 'knit_get_teams', tier: 2, category: 'teams', rationale: 'List configured teams', enable_via: 'knit_enable_feature("teams")' },
  { tool: 'knit_get_team_prompt', tier: 2, category: 'teams', rationale: 'Team-specific agent prompt', enable_via: 'knit_enable_feature("teams")' },
  { tool: 'knit_start_team_review', tier: 2, category: 'teams', rationale: 'Begin a multi-team review', enable_via: 'knit_enable_feature("teams")' },
  { tool: 'knit_post_team_findings', tier: 2, category: 'teams', rationale: 'Submit team findings to shared board', enable_via: 'knit_enable_feature("teams")' },
  { tool: 'knit_get_board_summary', tier: 2, category: 'teams', rationale: 'Roll up team findings', enable_via: 'knit_enable_feature("teams")' },

  // ── Tier 2 — Subagents (1) ──────────────────────────────────────
  { tool: 'knit_install_agent', tier: 2, category: 'subagents', rationale: 'VoltAgent subagent installer', enable_via: 'Auto-exposed when .claude/agents/ exists or knit_enable_feature("subagents")' },

  // ── Tier 3 — Admin (1) ──────────────────────────────────────────
  { tool: 'knit_prune_sessions', tier: 3, category: 'admin', rationale: 'Manual session pruning; auto-prune handles this normally', enable_via: 'knit_enable_feature("admin")' },

  // ── Tier 3 — One-time setup (1) ─────────────────────────────────
  { tool: 'knit_setup_project', tier: 3, category: 'admin', rationale: 'Initial bootstrap only; hidden after first run', enable_via: 'knit_enable_feature("admin") or pass through auto-init' },
];

/** Project-shape signals used by future step-4 gating logic. Kept here so the
 *  tier-gating contract lives next to the registry it gates. */
export interface ProjectShape {
  /** Project has analyzable source code (TS, JS, Py, Go, Rust, etc with ≥10 files). */
  hasAnalyzableCode: boolean;
  /** Number of detected domains. */
  domainCount: number;
  /** User has .claude/agents/ populated OR has called knit_install_agent. */
  hasInstalledSubagents: boolean;
  /** Number of sessions accumulated. */
  sessionCount: number;
  /** Per-feature opt-ins the user has flipped on. */
  enabledFeatures: Set<'teams' | 'subagents' | 'admin'>;
}

export interface FeatureListing {
  active: Array<{ name: string; tier: ToolTier; category: ToolCategory }>;
  available: Array<{ name: string; tier: ToolTier; category: ToolCategory; reason: string; enable_via?: string }>;
  totals: { active: number; available: number; total: number };
  by_category: Record<ToolCategory, { active: number; available: number }>;
}

/** Decide whether a tool should be active given the current project shape.
 *  Tier 1 is always active. Tier 2 gates on the relevant project signal OR
 *  an explicit opt-in. Tier 3 is admin-only — strictly opt-in. */
export function isToolActive(info: FeatureInfo, shape: ProjectShape): boolean {
  if (info.tier === 1) return true;
  if (info.tier === 3) return shape.enabledFeatures.has('admin');

  // Tier 2 — auto-expose by category-specific signal OR explicit opt-in.
  if (info.category === 'teams') {
    return shape.domainCount >= 3 || shape.enabledFeatures.has('teams');
  }
  if (info.category === 'subagents') {
    return shape.hasInstalledSubagents || shape.enabledFeatures.has('subagents');
  }
  // Any new Tier-2 category added without an explicit rule defaults to hidden
  // so the agent surface stays narrow until someone codes the detection.
  return false;
}

/** Compute the active/available split for a given project shape. */
export function computeFeatureListing(shape: ProjectShape): FeatureListing {
  const active: FeatureListing['active'] = [];
  const available: FeatureListing['available'] = [];
  const by_category: FeatureListing['by_category'] = {
    memory: { active: 0, available: 0 },
    'knowledge-graph': { active: 0, available: 0 },
    workflow: { active: 0, available: 0 },
    'fp-reflection': { active: 0, available: 0 },
    'protocol-config': { active: 0, available: 0 },
    diagnostics: { active: 0, available: 0 },
    teams: { active: 0, available: 0 },
    subagents: { active: 0, available: 0 },
    admin: { active: 0, available: 0 },
  };

  for (const info of TOOL_REGISTRY) {
    if (isToolActive(info, shape)) {
      active.push({ name: info.tool, tier: info.tier, category: info.category });
      by_category[info.category].active++;
    } else {
      available.push({
        name: info.tool,
        tier: info.tier,
        category: info.category,
        reason: info.rationale,
        enable_via: info.enable_via,
      });
      by_category[info.category].available++;
    }
  }

  return {
    active,
    available,
    totals: { active: active.length, available: available.length, total: TOOL_REGISTRY.length },
    by_category,
  };
}

/** Valid feature-flag names users can flip on via knit_enable_feature. */
export type EnableableFeature = 'teams' | 'subagents' | 'admin';

export function isEnableableFeature(name: string): name is EnableableFeature {
  return name === 'teams' || name === 'subagents' || name === 'admin';
}
