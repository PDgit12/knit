#!/usr/bin/env node
/**
 * Release-time helper: refresh dist/agents/core/ from VoltAgent at the
 * pinned SHA in src/engine/agent-registry.ts.
 *
 * Run: node scripts/vendor-agents.mjs
 *
 * Not bundled in the npm package (excluded by .npmignore via the `files:`
 * allowlist in package.json).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const OUT = join(ROOT, 'dist', 'agents', 'core');

// Mirrors src/engine/agent-registry.ts — kept here to avoid importing TS at build time.
const SHA = '6f804f0cfab22fb62668855aa3d62ee3a1453077';
const BASE = 'https://raw.githubusercontent.com/VoltAgent/awesome-claude-code-subagents';
const CORE = {
  'code-reviewer':     '04-quality-security',
  'security-engineer': '03-infrastructure',
  'qa-expert':         '04-quality-security',
  'typescript-pro':    '02-language-specialists',
  'python-pro':        '02-language-specialists',
  'golang-pro':        '02-language-specialists',
};

const attribution = (name, category) => `<!--
  Vendored by engram from:
    https://github.com/VoltAgent/awesome-claude-code-subagents
    @${SHA}/categories/${category}/${name}.md
  License: MIT (see github.com/VoltAgent/awesome-claude-code-subagents/blob/main/LICENSE).
  This file was copied verbatim with this header prepended; the original
  YAML frontmatter and prompt content are unchanged.
-->
`;

async function main() {
  mkdirSync(OUT, { recursive: true });
  let count = 0;
  for (const [name, category] of Object.entries(CORE)) {
    const url = `${BASE}/${SHA}/categories/${category}/${name}.md`;
    process.stdout.write(`  fetching ${name}... `);
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`FAILED (${res.status})`);
      process.exitCode = 1;
      continue;
    }
    const body = await res.text();
    if (body.length < 100) {
      console.error('FAILED (body too short)');
      process.exitCode = 1;
      continue;
    }
    // Inject attribution as a markdown comment right after the frontmatter.
    const fmEnd = body.indexOf('\n---', 3);  // second '---' closes frontmatter
    if (fmEnd < 0) {
      console.error('FAILED (no frontmatter detected)');
      process.exitCode = 1;
      continue;
    }
    const head = body.slice(0, fmEnd + 4);   // include the closing '---\n'
    const tail = body.slice(fmEnd + 4);
    const out = `${head}\n${attribution(name, category)}${tail}`;
    writeFileSync(join(OUT, `${name}.md`), out, 'utf-8');
    console.log(`ok (${body.length} bytes)`);
    count++;
  }
  console.log(`\nWrote ${count}/${Object.keys(CORE).length} agents to ${OUT}`);
}

main().catch((err) => {
  console.error('vendor-agents.mjs failed:', err);
  process.exit(1);
});
