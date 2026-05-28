#!/usr/bin/env node
// Pre-publish leak gate (v0.14.1 audit A2).
//
// Grep every path that ships to npm or that appears in user-visible docs
// for references to maintainer-only artifacts under .claude/. If any match,
// fail the build before npm publish has a chance to ship them.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const ROOTS = ['src', 'webapp/src', 'tests', 'README.md', 'CHANGELOG.md'];
const SCAN_EXTS = new Set(['.ts', '.tsx', '.md', '.js', '.json']);
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);

const PATTERNS = [
  /\.claude\/AUDIT/,
  /\.claude\/V01[0-9]/,
  /\.claude\/MARKETING/,
  /\.claude\/plans/,
  /\.claude\/audits/,
  /\.claude\/handoffs/,
];

const hits = [];

function scan(path) {
  let stat;
  try { stat = statSync(path); } catch { return; }
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path)) {
      if (SKIP_DIRS.has(entry)) continue;
      scan(join(path, entry));
    }
    return;
  }
  if (!SCAN_EXTS.has(extname(path))) return;
  const text = readFileSync(path, 'utf-8');
  text.split('\n').forEach((line, i) => {
    for (const p of PATTERNS) {
      if (p.test(line)) hits.push(`${path}:${i + 1}: ${line.trim()}`);
    }
  });
}

for (const root of ROOTS) scan(root);

if (hits.length) {
  console.error('[knit] LEAK CHECK FAILED — maintainer-only paths referenced in shipped files:');
  for (const h of hits) console.error('  ' + h);
  console.error('\nNothing under .claude/AUDIT*, /V01*, /MARKETING*, /plans/, /audits/, /handoffs/ may');
  console.error('be referenced from src/, webapp/src/, tests/, README.md, or CHANGELOG.md — those files');
  console.error('ship to npm users who do not have your local maintainer artifacts.');
  process.exit(1);
}

console.log('[knit] leak check passed — no maintainer-only path references in shipped files');
