import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * v0.9 — knit_verify_claim handler.
 *
 * The fact-check tool. Agent submits a claim about the codebase ("A imports
 * B", "X exports Y", etc.); handler parses the structure, looks up the
 * relevant graph table, returns verdict: verified | contradicted | unparseable.
 *
 * The architectural fix for "Knit doesn't grade individual model outputs":
 * the verifier exists as a tool and the agent can call it cheaply
 * mid-response.
 */

let knitHome: string;
let projectRoot: string;

beforeEach(() => {
  knitHome = mkdtempSync(join(tmpdir(), 'knit-verify-test-'));
  process.env.KNIT_HOME = knitHome;
  projectRoot = mkdtempSync(join(tmpdir(), 'knit-verify-project-'));
});

afterEach(() => {
  delete process.env.KNIT_HOME;
  try { rmSync(knitHome, { recursive: true, force: true }); } catch { /* best-effort */ }
  try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* best-effort */ }
});

function buildBrainWithGraph() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return {
    rootPath: projectRoot,
    knowledge: {
      generatedAt: new Date().toISOString(),
      summary: {
        totalFiles: 4, totalLines: 100, languageBreakdown: { '.ts': 4 },
        entryPoints: [], highFanoutFiles: [], untestedFiles: [], largestFiles: [],
      },
      files: [],
      importGraph: {
        'src/auth.ts': ['src/types.ts', 'src/utils.ts'],
        'src/api.ts': ['src/auth.ts'],
      },
      exports: {
        'src/auth.ts': [{ name: 'verifyToken', kind: 'function', line: 1 }],
        'src/types.ts': [{ name: 'User', kind: 'interface', line: 1 }, { name: 'Session', kind: 'type', line: 10 }],
      },
      testMap: {
        tested: { 'src/auth.ts': ['tests/auth.test.ts'] },
        untested: ['src/api.ts', 'src/types.ts'],
        testFiles: ['tests/auth.test.ts'],
      },
    },
    reverseDeps: {
      'src/types.ts': ['src/auth.ts'],
      'src/utils.ts': ['src/auth.ts'],
      'src/auth.ts': ['src/api.ts'],
    },
    knowledgeBase: { version: 1, projectName: 'test', entries: [], metrics: { totalSessions: 0, totalLearnings: 0, cacheHits: 0, domainDistribution: {}, sessions: [] } },
    config: { name: 'test', packageManager: 'npm', stack: { language: 'typescript', dependencies: [], buildCommand: '', lintCommand: '', typecheckCommand: '' }, domains: [], targetAgent: 'claude-code', tokenOptimization: 'standard' },
    loadedAt: Date.now(),
    autoInitialized: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('knit_verify_claim', () => {
  it('verifies a true import claim', async () => {
    const { handleVerifyClaim } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    const resp = JSON.parse(handleVerifyClaim({ claim: 'src/auth.ts imports src/types.ts' }, buildBrainWithGraph()));
    expect(resp.verdict).toBe('verified');
    expect(resp.parsed.type).toBe('import');
    expect(resp.evidence).toMatch(/importGraph/);
  });

  it('contradicts a false import claim', async () => {
    const { handleVerifyClaim } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    const resp = JSON.parse(handleVerifyClaim({ claim: 'src/auth.ts imports src/nonexistent.ts' }, buildBrainWithGraph()));
    expect(resp.verdict).toBe('contradicted');
    expect(resp.evidence).toMatch(/not present/);
  });

  it('verifies a true export claim', async () => {
    const { handleVerifyClaim } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    const resp = JSON.parse(handleVerifyClaim({ claim: 'src/types.ts exports User' }, buildBrainWithGraph()));
    expect(resp.verdict).toBe('verified');
    expect(resp.parsed.type).toBe('export');
  });

  it('contradicts a false export claim', async () => {
    const { handleVerifyClaim } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    const resp = JSON.parse(handleVerifyClaim({ claim: 'src/types.ts exports Hallucinated' }, buildBrainWithGraph()));
    expect(resp.verdict).toBe('contradicted');
  });

  it('verifies a true test mapping claim', async () => {
    const { handleVerifyClaim } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    const resp = JSON.parse(handleVerifyClaim({ claim: 'src/auth.ts is tested by tests/auth.test.ts' }, buildBrainWithGraph()));
    expect(resp.verdict).toBe('verified');
    expect(resp.parsed.type).toBe('test');
  });

  it('verifies an "exists" claim against the index', async () => {
    const { handleVerifyClaim } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    const resp = JSON.parse(handleVerifyClaim({ claim: 'src/auth.ts exists' }, buildBrainWithGraph()));
    expect(resp.verdict).toBe('verified');

    const respMissing = JSON.parse(handleVerifyClaim({ claim: 'src/hallucinated.ts exists' }, buildBrainWithGraph()));
    expect(respMissing.verdict).toBe('contradicted');
  });

  it('returns unparseable for free-form claims it can\'t structure', async () => {
    const { handleVerifyClaim } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    const resp = JSON.parse(handleVerifyClaim({ claim: 'this code is well-tested in general' }, buildBrainWithGraph()));
    expect(resp.verdict).toBe('unparseable');
    expect(resp.instruction).toMatch(/Supported patterns/);
  });

  it('errors when claim is empty', async () => {
    const { handleVerifyClaim } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    const resp = JSON.parse(handleVerifyClaim({ claim: '' }, buildBrainWithGraph()));
    expect(resp.verdict).toBe('unparseable');
    expect(resp.error).toMatch(/required/);
  });
});

describe('knit_classify_task — pre-emptive learnings injection (v0.9 #1)', () => {
  it('does NOT pre-emptive-search on trivial tier', async () => {
    const { handleClassifyTask } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    const resp = JSON.parse(handleClassifyTask({
      files_to_touch: 'src/utils.ts',
      description: 'fix typo',
    }, buildBrainWithGraph()));
    expect(resp.tier).toBe('trivial');
    expect(resp.pre_emptive_learnings).toBeUndefined();
  });

  it('does NOT pre-emptive-search on inquiry tier', async () => {
    const { handleClassifyTask } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    const resp = JSON.parse(handleClassifyTask({
      files_to_touch: 'src/utils.ts',
      description: 'what does this function do',
    }, buildBrainWithGraph()));
    expect(resp.tier).toBe('inquiry');
    expect(resp.pre_emptive_learnings).toBeUndefined();
  });

  it('omits pre_emptive_learnings when no matches in the KB', async () => {
    const { handleClassifyTask } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    // KB is empty in this fixture — even if the tier is standard/complex,
    // there's nothing to surface.
    const resp = JSON.parse(handleClassifyTask({
      files_to_touch: 'src/auth.ts,src/api.ts,src/utils.ts,src/types.ts',
      description: 'refactor the auth flow',
    }, buildBrainWithGraph()));
    expect(resp.tier).toBe('complex');
    expect(resp.pre_emptive_learnings).toBeUndefined();
  });
});

describe('knit_build_context — suggested_reads (v0.9 #8)', () => {
  it('returns graph-importer suggestions for files-to-touch', async () => {
    const { handleBuildContext } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    const resp = JSON.parse(handleBuildContext({ files_to_touch: 'src/auth.ts' }, buildBrainWithGraph()));
    expect(resp.domain_context.suggested_reads).toBeDefined();
    const paths = resp.domain_context.suggested_reads.map((s: { path: string }) => s.path);
    // src/api.ts imports src/auth.ts → should appear as a graph-importer.
    expect(paths).toContain('src/api.ts');
  });

  it('returns graph-import suggestions for files-to-touch', async () => {
    const { handleBuildContext } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    const resp = JSON.parse(handleBuildContext({ files_to_touch: 'src/auth.ts' }, buildBrainWithGraph()));
    const paths = resp.domain_context.suggested_reads.map((s: { path: string }) => s.path);
    // src/auth.ts imports src/types.ts and src/utils.ts → both graph-import.
    expect(paths).toContain('src/types.ts');
    expect(paths).toContain('src/utils.ts');
  });

  it('does not include files-to-touch in suggestions (those are already known)', async () => {
    const { handleBuildContext } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    const resp = JSON.parse(handleBuildContext({ files_to_touch: 'src/auth.ts' }, buildBrainWithGraph()));
    const paths = resp.domain_context.suggested_reads.map((s: { path: string }) => s.path);
    expect(paths).not.toContain('src/auth.ts');
  });
});

describe('knit_get_learning — hierarchical retrieval (v0.9 #6)', () => {
  it('returns the full entry by id', async () => {
    const { handleGetLearning, handleRecordLearning } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    const brain = buildBrainWithGraph();
    // Record a learning so we have something to fetch.
    handleRecordLearning({
      summary: 'Auth token rotation',
      lesson: 'Invalidate prior token immediately.',
      tags: '#auth #security',
    }, brain);

    const recorded = brain.knowledgeBase.entries[0];
    const resp = JSON.parse(handleGetLearning({ id: recorded.id }, brain));
    expect(resp.id).toBe(recorded.id);
    expect(resp.summary).toBe('Auth token rotation');
    expect(resp.lesson).toBe('Invalidate prior token immediately.');
  });

  it('errors when id not found', async () => {
    const { handleGetLearning } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    const resp = JSON.parse(handleGetLearning({ id: 'no-such-id' }, buildBrainWithGraph()));
    expect(resp.error).toMatch(/No learning with id/);
  });

  it('errors when id is empty', async () => {
    const { handleGetLearning } = await import('../src/mcp/handlers.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    const resp = JSON.parse(handleGetLearning({ id: '' }, buildBrainWithGraph()));
    expect(resp.error).toMatch(/required/);
  });
});

describe('citation rule in KNIT_INSTRUCTIONS (v0.9 #2)', () => {
  it('instructions string includes the citation rule', async () => {
    const { KNIT_INSTRUCTIONS } = await import('../src/mcp/instructions.js');
    expect(KNIT_INSTRUCTIONS).toMatch(/Citation rule/i);
    expect(KNIT_INSTRUCTIONS).toMatch(/per knit_query_imports/);
    expect(KNIT_INSTRUCTIONS).toMatch(/unverified/);
  });
});

// ── v0.11 slice 1 — claim-verified marker ─────────────────────────
//
// Every knit_verify_claim call writes a per-turn marker that the Stop
// hook reads to enforce the REVIEW gate on standard/complex tasks.
// Cleared on UserPromptSubmit. Best-effort: marker IO failure must
// never break the verification call itself.

describe('handleVerifyClaim writes the claim marker (v0.11)', () => {
  it('writes .claim-verified-current on successful verification', async () => {
    const { handleVerifyClaim } = await import('../src/mcp/handlers.js');
    const { projectDataDir, claimMarkerPath } = await import('../src/engine/paths.js');
    const { existsSync } = await import('node:fs');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    expect(existsSync(claimMarkerPath(projectRoot))).toBe(false);
    handleVerifyClaim({ claim: 'src/auth.ts imports src/types.ts' }, buildBrainWithGraph());
    expect(existsSync(claimMarkerPath(projectRoot))).toBe(true);
  });

  it('writes the marker even on contradicted verdict (the agent still verified)', async () => {
    const { handleVerifyClaim } = await import('../src/mcp/handlers.js');
    const { projectDataDir, claimMarkerPath } = await import('../src/engine/paths.js');
    const { existsSync } = await import('node:fs');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    handleVerifyClaim({ claim: 'src/auth.ts imports src/missing.ts' }, buildBrainWithGraph());
    expect(existsSync(claimMarkerPath(projectRoot))).toBe(true);
  });

  it('does NOT write the marker when claim parameter is missing', async () => {
    const { handleVerifyClaim } = await import('../src/mcp/handlers.js');
    const { projectDataDir, claimMarkerPath } = await import('../src/engine/paths.js');
    const { existsSync } = await import('node:fs');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    handleVerifyClaim({ claim: '' }, buildBrainWithGraph());
    // Empty-claim path returns early before the marker write.
    expect(existsSync(claimMarkerPath(projectRoot))).toBe(false);
  });
});

describe('handleClassifyTask appends verify reminder (v0.11)', () => {
  it('includes the verify_claim reminder on standard scope', async () => {
    const { handleToolCall } = await import('../src/mcp/tools.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    const result = JSON.parse(handleToolCall('knit_classify_task', {
      files_to_touch: 'src/api.ts,tests/api.test.ts',
      description: 'add endpoint',
    }, buildBrainWithGraph()));
    expect(result.scope_tier).toBe('standard');
    expect(result.instruction).toMatch(/knit_verify_claim/);
  });

  it('includes the verify_claim reminder on complex scope', async () => {
    const { handleToolCall } = await import('../src/mcp/tools.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    const result = JSON.parse(handleToolCall('knit_classify_task', {
      files_to_touch: 'src/a.ts,src/b.ts,src/c.ts,src/d.ts',
      description: 'big refactor',
    }, buildBrainWithGraph()));
    expect(result.scope_tier).toBe('complex');
    expect(result.instruction).toMatch(/knit_verify_claim/);
  });

  it('does NOT include the reminder on trivial scope', async () => {
    const { handleToolCall } = await import('../src/mcp/tools.js');
    const { projectDataDir } = await import('../src/engine/paths.js');
    mkdirSync(projectDataDir(projectRoot), { recursive: true });

    const result = JSON.parse(handleToolCall('knit_classify_task', {
      files_to_touch: 'src/utils.ts',
      description: 'tweak helper',
    }, buildBrainWithGraph()));
    expect(result.scope_tier).toBe('trivial');
    expect(result.instruction).not.toMatch(/knit_verify_claim/);
  });
});
