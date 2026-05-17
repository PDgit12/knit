import { describe, it, expect } from 'vitest';
import {
  agentsForRole,
  knownAgents,
  isKnownAgent,
  categoryOf,
  rawAgentUrl,
  isBundledCore,
  BUNDLED_CORE_AGENTS,
  VOLTAGENT_PINNED_SHA,
} from '../src/engine/agent-registry.js';

describe('agent-registry', () => {
  describe('agentsForRole', () => {
    it('core role for typescript includes typescript-pro + code-reviewer + architect', () => {
      const got = agentsForRole('core', 'typescript');
      expect(got).toContain('typescript-pro');
      expect(got).toContain('code-reviewer');
      expect(got).toContain('architect-reviewer');
    });

    it('core role for javascript also maps to typescript-pro', () => {
      const got = agentsForRole('core', 'javascript');
      expect(got).toContain('typescript-pro');
    });

    it('core role for python includes python-pro', () => {
      expect(agentsForRole('core', 'python')).toContain('python-pro');
    });

    it('core role for go includes golang-pro', () => {
      expect(agentsForRole('core', 'go')).toContain('golang-pro');
    });

    it('core role for rust includes rust-engineer', () => {
      expect(agentsForRole('core', 'rust')).toContain('rust-engineer');
    });

    it('security role always leads with security-engineer', () => {
      expect(agentsForRole('security', 'typescript')[0]).toBe('security-engineer');
      expect(agentsForRole('security', 'python')[0]).toBe('security-engineer');
    });

    it('qa role gives qa-expert + debugger + build-engineer (stack-agnostic)', () => {
      const ts = agentsForRole('qa', 'typescript');
      const py = agentsForRole('qa', 'python');
      expect(ts).toEqual(py);
      expect(ts).toContain('qa-expert');
      expect(ts).toContain('debugger');
      expect(ts).toContain('build-engineer');
    });

    it('unknown stack still returns the role defaults', () => {
      const got = agentsForRole('core', 'cobol');
      expect(got).toContain('code-reviewer');
      expect(got).toContain('architect-reviewer');
    });

    it('returns no duplicates', () => {
      for (const role of ['core', 'security', 'qa'] as const) {
        for (const lang of ['typescript', 'python', 'go', 'rust', 'unknown']) {
          const got = agentsForRole(role, lang);
          expect(new Set(got).size, `dup in ${role}/${lang}: ${got}`).toBe(got.length);
        }
      }
    });
  });

  describe('catalog lookups', () => {
    it('every name returned by agentsForRole is a known agent', () => {
      for (const role of ['core', 'security', 'qa'] as const) {
        for (const lang of ['typescript', 'python', 'go', 'rust', 'java']) {
          for (const name of agentsForRole(role, lang)) {
            expect(isKnownAgent(name), `${role}/${lang} returned unknown agent: ${name}`).toBe(true);
          }
        }
      }
    });

    it('isKnownAgent rejects nonsense', () => {
      expect(isKnownAgent('not-a-real-agent')).toBe(false);
      expect(isKnownAgent('')).toBe(false);
    });

    it('categoryOf returns the right category prefix for known agents', () => {
      expect(categoryOf('typescript-pro')).toMatch(/^02-language-specialists$/);
      expect(categoryOf('security-engineer')).toMatch(/^03-infrastructure$/);
      expect(categoryOf('code-reviewer')).toMatch(/^04-quality-security$/);
      expect(categoryOf('build-engineer')).toMatch(/^06-developer-experience$/);
    });

    it('categoryOf returns null for unknown', () => {
      expect(categoryOf('not-a-real-agent')).toBeNull();
    });

    it('knownAgents lists all registered names', () => {
      const list = knownAgents();
      expect(list).toContain('typescript-pro');
      expect(list).toContain('security-engineer');
      expect(list.length).toBeGreaterThanOrEqual(10);
    });
  });

  describe('rawAgentUrl', () => {
    it('composes the correct VoltAgent URL at the pinned SHA', () => {
      const url = rawAgentUrl('typescript-pro');
      expect(url).toBe(
        `https://raw.githubusercontent.com/VoltAgent/awesome-claude-code-subagents/${VOLTAGENT_PINNED_SHA}/categories/02-language-specialists/typescript-pro.md`,
      );
    });

    it('honors a custom ref', () => {
      expect(rawAgentUrl('typescript-pro', 'main')).toContain('/main/');
    });

    it('returns null for unknown agents', () => {
      expect(rawAgentUrl('not-a-real-agent')).toBeNull();
    });
  });

  describe('bundled core', () => {
    it('contains the most common agents', () => {
      expect(BUNDLED_CORE_AGENTS).toContain('code-reviewer');
      expect(BUNDLED_CORE_AGENTS).toContain('typescript-pro');
      expect(BUNDLED_CORE_AGENTS).toContain('python-pro');
      expect(BUNDLED_CORE_AGENTS).toContain('security-engineer');
    });

    it('isBundledCore agrees with the constant', () => {
      for (const name of BUNDLED_CORE_AGENTS) {
        expect(isBundledCore(name), name).toBe(true);
      }
      expect(isBundledCore('not-bundled')).toBe(false);
    });

    it('every bundled-core agent is in the registry', () => {
      for (const name of BUNDLED_CORE_AGENTS) {
        expect(isKnownAgent(name), name).toBe(true);
      }
    });
  });
});
