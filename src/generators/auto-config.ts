/**
 * v0.12 phase 2 — Template composition for auto-configured CLAUDE.md.
 *
 * Consumes ProjectFingerprint (phase 0) + InferDomainsResult (phase 1) +
 * produces ready-to-paste markdown sections:
 *   - Project Identity (name + detected stack signals)
 *   - Build & Verify (real commands, not generic placeholders)
 *   - Domain Architecture (inferred candidates with file lists)
 *
 * Output is intentionally a STRING (sections concatenated) so it can be
 * spliced into the marker-wrapped CLAUDE.md block by the existing
 * generator. No file IO here — pure transformation.
 */

import type { ProjectFingerprint } from '../engine/types.js';
import type { DomainCandidate } from '../engine/domain-inference.js';

export interface ComposedSections {
  projectIdentity: string;
  buildAndVerify: string;
  domainArchitecture: string;
  /** All sections joined with double-newline; ready for the CLAUDE.md block. */
  combined: string;
}

export function composeAutoConfiguredSections(
  projectName: string,
  fingerprint: ProjectFingerprint,
  domains: DomainCandidate[],
): ComposedSections {
  const projectIdentity = buildProjectIdentity(projectName, fingerprint);
  const buildAndVerify = buildBuildAndVerify(fingerprint);
  const domainArchitecture = buildDomainArchitecture(domains);
  const combined = [projectIdentity, buildAndVerify, domainArchitecture].filter(Boolean).join('\n\n');
  return { projectIdentity, buildAndVerify, domainArchitecture, combined };
}

function buildProjectIdentity(projectName: string, fp: ProjectFingerprint): string {
  // Strip backticks from the heading — embedded backticks in a markdown
  // heading turn fragments into inline code spans and break the heading
  // visually. We just drop them rather than escape so the rendered
  // anchor stays clean.
  const safeName = projectName.replace(/`/g, '');
  const lines = [`## ${safeName}`, ''];
  const stack: string[] = [];
  if (fp.languages.length > 0) stack.push(`**Stack:** ${fp.languages.join(' + ')}`);
  if (fp.framework) stack.push(`**Framework:** ${fp.framework}`);
  if (fp.packageManager) stack.push(`**Package manager:** ${fp.packageManager}`);
  if (fp.ciFiles.length > 0) stack.push(`**CI:** ${fp.ciFiles.length} workflow(s) detected`);
  if (stack.length > 0) {
    lines.push(stack.join(' · '));
  } else {
    lines.push('_(No stack signals detected — fill in manually.)_');
  }
  return lines.join('\n');
}

function buildBuildAndVerify(fp: ProjectFingerprint): string {
  const lines = ['## Build & Verify', ''];
  const cmds: Array<[string, string | null]> = [
    ['Typecheck', fp.typecheckCommand],
    ['Lint', fp.lintCommand],
    ['Test', fp.testRunner],
    ['Build', fp.buildCommand],
  ];
  const real = cmds.filter(([, c]) => c);
  if (real.length === 0) {
    lines.push('_(No build commands detected — fill in for your project.)_');
    return lines.join('\n');
  }
  lines.push('```bash');
  for (const [name, cmd] of real) {
    lines.push(`# ${name}`);
    lines.push(String(cmd));
    lines.push('');
  }
  lines.push('```');
  lines.push('');
  lines.push('All four MUST pass before any commit or PR.');
  return lines.join('\n');
}

function buildDomainArchitecture(domains: DomainCandidate[]): string {
  const lines = ['## Domain Architecture', ''];
  if (domains.length === 0) {
    lines.push('_(No domains inferred yet. Run `knit_infer_domains` after the project has commits + import graph indexed.)_');
    return lines.join('\n');
  }
  lines.push('| Domain | Confidence | Signals | Anchor files |');
  lines.push('|---|---|---|---|');
  for (const d of domains) {
    const signals = d.signals.length > 0 ? d.signals.join(', ') : '—';
    const files = d.files.length > 0
      ? d.files.slice(0, 3).map((f) => `\`${f}\``).join(', ') + (d.files.length > 3 ? `, +${d.files.length - 3} more` : '')
      : '—';
    lines.push(`| **${d.name}** | ${d.confidence.toFixed(2)} | ${signals} | ${files} |`);
  }
  lines.push('');
  lines.push('_Confidence is a normalized RRF score (0–1). Review + edit before treating as canonical._');
  return lines.join('\n');
}
