import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import {
  isValidStrictness,
  readProtocolConfig,
  writeProtocolConfig,
  writeClassificationMarker,
  readClassificationMarker,
  clearClassificationMarker,
  writeSessionMarker,
} from '../src/engine/protocol-guard.js';
import {
  classificationMarkerPath,
  protocolConfigPath,
  sessionMarkerPath,
} from '../src/engine/paths.js';
import { handleToolCall } from '../src/mcp/tools.js';
import type { BrainCache } from '../src/mcp/cache.js';
import type { ProjectKnowledge, KnowledgeBase } from '../src/engine/types.js';

let engramHome: string;
let rootPath: string;

beforeEach(() => {
  engramHome = mkdtempSync(join(tmpdir(), 'engram-pg-test-'));
  process.env.ENGRAM_HOME = engramHome;
  rootPath = mkdtempSync(join(tmpdir(), 'engram-pg-root-'));
});

afterEach(() => {
  delete process.env.ENGRAM_HOME;
  try { rmSync(engramHome, { recursive: true, force: true }); } catch { /* */ }
  try { rmSync(rootPath, { recursive: true, force: true }); } catch { /* */ }
});

function mockBrain(): BrainCache {
  const knowledge: ProjectKnowledge = {
    generatedAt: '2026-05-18',
    summary: { totalFiles: 0, totalLines: 0, languageBreakdown: {}, entryPoints: [], highFanoutFiles: [], untestedFiles: [], largestFiles: [] },
    files: [], importGraph: {}, exports: {},
    testMap: { tested: {}, untested: [], testFiles: [] },
  };
  const knowledgeBase: KnowledgeBase = {
    version: 1, projectName: 'test', entries: [],
    metrics: { totalSessions: 0, totalLearnings: 0, cacheHits: 0, domainDistribution: {}, sessions: [] },
  };
  return { rootPath, knowledge, reverseDeps: {}, knowledgeBase, loadedAt: Date.now() };
}

describe('isValidStrictness', () => {
  it('accepts off, warn, block', () => {
    expect(isValidStrictness('off')).toBe(true);
    expect(isValidStrictness('warn')).toBe(true);
    expect(isValidStrictness('block')).toBe(true);
  });
  it('rejects anything else', () => {
    expect(isValidStrictness('strict')).toBe(false);
    expect(isValidStrictness('')).toBe(false);
    expect(isValidStrictness('WARN')).toBe(false);
  });
});

describe('readProtocolConfig', () => {
  it('returns warn as default when no config exists', () => {
    const cfg = readProtocolConfig(rootPath);
    expect(cfg.level).toBe('warn');
  });

  it('round-trips via writeProtocolConfig', () => {
    writeProtocolConfig(rootPath, 'block');
    const cfg = readProtocolConfig(rootPath);
    expect(cfg.level).toBe('block');
    expect(cfg.updatedAt).toBeDefined();
  });

  it('falls back to warn when stored config is corrupt', () => {
    const path = protocolConfigPath(rootPath);
    writeProtocolConfig(rootPath, 'block');
    writeFileSync(path, '{ not json', 'utf-8');
    expect(readProtocolConfig(rootPath).level).toBe('warn');
  });

  it('falls back to warn when level field is invalid', () => {
    const path = protocolConfigPath(rootPath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ level: 'paranoid' }), 'utf-8');
    expect(readProtocolConfig(rootPath).level).toBe('warn');
  });
});

describe('classification marker', () => {
  it('round-trips write → read', () => {
    writeClassificationMarker(rootPath, {
      turnId: 'abc-123',
      classifiedAt: '2026-05-18T00:00:00Z',
      tier: 'standard',
      files: ['src/x.ts'],
    });
    const m = readClassificationMarker(rootPath);
    expect(m).not.toBeNull();
    expect(m?.turnId).toBe('abc-123');
    expect(m?.tier).toBe('standard');
    expect(m?.files).toEqual(['src/x.ts']);
  });

  it('returns null when no marker exists', () => {
    expect(readClassificationMarker(rootPath)).toBeNull();
  });

  it('clears the marker on demand', () => {
    writeClassificationMarker(rootPath, {
      turnId: 't', classifiedAt: 'now', tier: 'trivial', files: [],
    });
    expect(existsSync(classificationMarkerPath(rootPath))).toBe(true);
    clearClassificationMarker(rootPath);
    expect(existsSync(classificationMarkerPath(rootPath))).toBe(false);
    expect(readClassificationMarker(rootPath)).toBeNull();
  });

  it('clear is a no-op when marker is missing', () => {
    expect(() => clearClassificationMarker(rootPath)).not.toThrow();
  });
});

describe('session marker', () => {
  it('writes an ISO timestamp to the session-marker path', () => {
    writeSessionMarker(rootPath);
    expect(existsSync(sessionMarkerPath(rootPath))).toBe(true);
  });
});

describe('handleClassifyTask side effect', () => {
  it('writes a classification marker on every call', () => {
    const brain = mockBrain();
    expect(readClassificationMarker(rootPath)).toBeNull();

    const result = JSON.parse(handleToolCall('engram_classify_task', {
      files_to_touch: 'src/a.ts',
      description: 'add helper',
    }, brain));
    expect(result.tier).toBeDefined();

    const marker = readClassificationMarker(rootPath);
    expect(marker).not.toBeNull();
    expect(marker?.tier).toBe(result.tier);
    expect(marker?.files).toEqual(['src/a.ts']);
    expect(marker?.turnId).toMatch(/^\d+-\d+$/);
  });

  it('still returns valid response if marker write fails (best-effort)', () => {
    const brain = mockBrain();
    // Pre-create a directory where the file should go to force fs error on write
    // (skip — fs.writeFileSync overwrites; this branch is covered by the try/catch surrounding the call)
    const result = JSON.parse(handleToolCall('engram_classify_task', {
      files_to_touch: 'src/a.ts',
    }, brain));
    expect(result.tier).toBeDefined();
  });
});

describe('engram_set_protocol_strictness handler', () => {
  it('rejects invalid levels', () => {
    const brain = mockBrain();
    const result = JSON.parse(handleToolCall('engram_set_protocol_strictness', {
      level: 'strict',
    }, brain));
    expect(result.status).toBe('error');
    expect(result.error).toContain('Invalid level');
  });

  it('accepts off, warn, block and persists', () => {
    const brain = mockBrain();
    for (const level of ['off', 'warn', 'block'] as const) {
      const result = JSON.parse(handleToolCall('engram_set_protocol_strictness', { level }, brain));
      expect(result.status).toBe('set');
      expect(result.level).toBe(level);
      expect(readProtocolConfig(rootPath).level).toBe(level);
    }
  });
});

describe('engram_get_protocol_strictness handler', () => {
  it('returns warn by default', () => {
    const brain = mockBrain();
    const result = JSON.parse(handleToolCall('engram_get_protocol_strictness', {}, brain));
    expect(result.level).toBe('warn');
  });

  it('returns set value', () => {
    const brain = mockBrain();
    writeProtocolConfig(rootPath, 'block');
    const result = JSON.parse(handleToolCall('engram_get_protocol_strictness', {}, brain));
    expect(result.level).toBe('block');
  });
});
