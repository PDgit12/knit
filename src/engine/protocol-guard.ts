/**
 * Protocol Guard — runtime enforcement layer for the engram protocol.
 *
 * Three layers (see plan: /Users/piyushdua/.claude/plans/snappy-sprouting-nova.md):
 *   1. SessionStart hook auto-loads context.
 *   2. PreToolUse hook on Edit/Write blocks when no classification marker exists.
 *   3. CLAUDE.md ships a system-reminder override paragraph.
 *
 * This module is pure I/O — no MCP knowledge, no hook generation. Keeps the
 * unit tests trivial and lets the handler layer compose freely.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  classificationMarkerPath,
  protocolConfigPath,
  sessionMarkerPath,
} from './paths.js';
import type {
  ClassificationMarker,
  ProtocolConfig,
  ProtocolStrictness,
} from './types.js';

const VALID_LEVELS: readonly ProtocolStrictness[] = ['off', 'warn', 'block'];

export function isValidStrictness(level: string): level is ProtocolStrictness {
  return (VALID_LEVELS as readonly string[]).includes(level);
}

export function readProtocolConfig(rootPath: string): ProtocolConfig {
  const path = protocolConfigPath(rootPath);
  if (!existsSync(path)) {
    return { level: 'warn', updatedAt: new Date(0).toISOString() };
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<ProtocolConfig>;
    const level = parsed.level && isValidStrictness(parsed.level) ? parsed.level : 'warn';
    const updatedAt = typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString();
    return { level, updatedAt };
  } catch {
    return { level: 'warn', updatedAt: new Date(0).toISOString() };
  }
}

export function writeProtocolConfig(rootPath: string, level: ProtocolStrictness): ProtocolConfig {
  const path = protocolConfigPath(rootPath);
  mkdirSync(dirname(path), { recursive: true });
  const config: ProtocolConfig = { level, updatedAt: new Date().toISOString() };
  writeFileSync(path, JSON.stringify(config, null, 2), 'utf-8');
  return config;
}

export function writeClassificationMarker(
  rootPath: string,
  marker: ClassificationMarker,
): void {
  const path = classificationMarkerPath(rootPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(marker, null, 2), 'utf-8');
}

export function readClassificationMarker(rootPath: string): ClassificationMarker | null {
  const path = classificationMarkerPath(rootPath);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as ClassificationMarker;
  } catch {
    return null;
  }
}

export function clearClassificationMarker(rootPath: string): void {
  const path = classificationMarkerPath(rootPath);
  if (existsSync(path)) {
    rmSync(path, { force: true });
  }
}

export function writeSessionMarker(rootPath: string): void {
  const path = sessionMarkerPath(rootPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, new Date().toISOString(), 'utf-8');
}
