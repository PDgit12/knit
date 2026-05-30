import { describe, it, expect, beforeEach } from 'vitest';
import {
  classifyHost,
  getActiveHost,
  setActiveHost,
  resetActiveHost,
  hostOrchestrationDirective,
  hostContract,
  UNKNOWN_HOST,
  type ClientInfo,
} from '../src/mcp/host.js';

describe('classifyHost — confirmed strings only', () => {
  it('maps claude-code to a hook host with dynamic workflows', () => {
    const p = classifyHost({ name: 'claude-code', version: '1.0.0' });
    expect(p.id).toBe('claude-code');
    expect(p.tier).toBe('hook');
    expect(p.autoMechanism).toBe('dynamic-workflows');
    expect(p.slashSurface).toBe(false);
  });

  it('maps cursor to a hook host with parallel agents', () => {
    const p = classifyHost({ name: 'cursor' });
    expect(p.id).toBe('cursor');
    expect(p.tier).toBe('hook');
    expect(p.autoMechanism).toBe('cursor-parallel-agents');
  });

  it('resolves a cursor variant suffix via substring match', () => {
    expect(classifyHost({ name: 'cursor-vscode (via bridge)' }).id).toBe('cursor');
  });

  it('maps codex-mcp-client to a hook host with subagents', () => {
    const p = classifyHost({ name: 'codex-mcp-client' });
    expect(p.id).toBe('codex');
    expect(p.tier).toBe('hook');
    expect(p.autoMechanism).toBe('codex-subagents');
  });

  it('classifies codex_vscode as codex, NOT vscode (codex checked first)', () => {
    expect(classifyHost({ name: 'codex_vscode' }).id).toBe('codex');
  });

  it('maps Visual Studio Code to suggest-only WITH a slash surface (ambiguous: Copilot/Cline/Continue)', () => {
    const p = classifyHost({ name: 'Visual Studio Code' });
    expect(p.id).toBe('vscode');
    expect(p.tier).toBe('suggest');
    expect(p.autoMechanism).toBeNull();
    expect(p.slashSurface).toBe(true);
  });

  it('falls back to UNKNOWN_HOST (suggest-only) for unconfirmed names', () => {
    for (const name of ['cline', 'claude-dev', 'continue', 'some-future-agent']) {
      const p = classifyHost({ name });
      expect(p.id).toBe('unknown');
      expect(p.tier).toBe('suggest');
      expect(p.autoMechanism).toBeNull();
    }
  });

  it('falls back to UNKNOWN_HOST for missing/empty clientInfo', () => {
    for (const ci of [undefined, null, {}, { name: '' }, { name: '   ' }] as (ClientInfo | undefined | null)[]) {
      expect(classifyHost(ci)).toEqual(UNKNOWN_HOST);
    }
  });

  it('never claims a native mechanism on a suggest host', () => {
    for (const name of ['Visual Studio Code', 'unknown-thing']) {
      const p = classifyHost({ name });
      if (p.tier === 'suggest') expect(p.autoMechanism).toBeNull();
    }
  });
});

describe('active-host singleton', () => {
  beforeEach(() => resetActiveHost());

  it('defaults to UNKNOWN_HOST before the handshake lands', () => {
    expect(getActiveHost()).toEqual(UNKNOWN_HOST);
  });

  it('stashes and returns the detected host', () => {
    setActiveHost(classifyHost({ name: 'cursor' }));
    expect(getActiveHost().id).toBe('cursor');
  });

  it('resets to the fallback', () => {
    setActiveHost(classifyHost({ name: 'claude-code' }));
    resetActiveHost();
    expect(getActiveHost()).toEqual(UNKNOWN_HOST);
  });
});

describe('hostOrchestrationDirective — composes with the native primitive, carries domains', () => {
  const domains = ['API & Security', 'UI'];

  it('claude-code → dynamic workflow', () => {
    const d = hostOrchestrationDirective(classifyHost({ name: 'claude-code' }), domains);
    expect(d).toMatch(/dynamic workflow/i);
    expect(d).toContain('API & Security');
  });

  it('cursor → parallel worktree agents', () => {
    expect(hostOrchestrationDirective(classifyHost({ name: 'cursor' }), domains)).toMatch(/parallel worktree agents/i);
  });

  it('codex → subagents', () => {
    expect(hostOrchestrationDirective(classifyHost({ name: 'codex-mcp-client' }), domains)).toMatch(/subagents/i);
  });

  it('vscode → agent mode + /mcp.knit.* slash commands (suggest)', () => {
    const d = hostOrchestrationDirective(classifyHost({ name: 'Visual Studio Code' }), domains);
    expect(d).toMatch(/agent mode/i);
    expect(d).toMatch(/\/mcp\.knit\.\*/);
  });

  it('unknown → Knit’s own primitive, explicitly suggest-not-force', () => {
    const d = hostOrchestrationDirective(UNKNOWN_HOST, domains);
    expect(d).toMatch(/knit_spawn_team_worktree/);
    expect(d).toMatch(/suggests, never forces/i);
  });
});

describe('hostContract — the load_session contract', () => {
  it('a hook host reports auto mode + its native orchestration', () => {
    const c = hostContract(classifyHost({ name: 'cursor' }));
    expect(c.id).toBe('cursor');
    expect(c.mode).toMatch(/auto/i);
    expect(c.native_orchestration).toBe('cursor-parallel-agents');
  });

  it('a suggest host reports suggest-only + no native orchestration', () => {
    const c = hostContract(classifyHost({ name: 'Visual Studio Code' }));
    expect(c.mode).toMatch(/suggest-only/i);
    expect(c.native_orchestration).toBeNull();
    expect(c.slash_commands).toBe(true);
    expect(c.compose).toMatch(/knit_spawn_team_worktree/);
  });
});
