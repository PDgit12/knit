import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { loadKnowledgeBase, getKBSummary, getTopEntries, getStaleEntries } from '../engine/knowledgebase.js';
import { readLearnings } from '../engine/learnings.js';
import { knowledgePath, knowledgebasePath, learningsDir } from '../engine/paths.js';

export async function statusCommand(targetDir: string): Promise<void> {
  const rootPath = targetDir === '.' ? process.cwd() : targetDir;
  const kbPath = knowledgebasePath(rootPath);
  const knowledgeIndexPath = knowledgePath(rootPath);

  if (!existsSync(kbPath) && !existsSync(knowledgeIndexPath)) {
    console.log(chalk.yellow('  No Knit data found. The brain will auto-initialize when you open this project in any MCP-speaking agent.'));
    console.log();
    return;
  }

  // ── Knowledge Index ────────────────────────────────────────────
  if (existsSync(knowledgeIndexPath)) {
    try {
      const knowledge = JSON.parse(readFileSync(knowledgeIndexPath, 'utf-8'));
      const s = knowledge.summary;

      console.log(chalk.bold('  Knowledge Index'));
      console.log();
      console.log(`  ${chalk.cyan('Files:')}        ${s.totalFiles} indexed (${s.totalLines.toLocaleString()} lines)`);
      console.log(`  ${chalk.cyan('Imports:')}      ${Object.keys(knowledge.importGraph || {}).length} edges mapped`);
      console.log(`  ${chalk.cyan('Exports:')}      ${Object.keys(knowledge.exports || {}).length} files with exports`);
      console.log(`  ${chalk.cyan('Untested:')}     ${(s.untestedFiles || []).length} files`);
      console.log(`  ${chalk.cyan('High-fanout:')}  ${(s.highFanoutFiles || []).length} files`);

      if (s.largestFiles && s.largestFiles.length > 0) {
        console.log();
        console.log(chalk.bold('  Largest Files'));
        console.log();
        for (const f of s.largestFiles.slice(0, 5)) {
          const bar = '█'.repeat(Math.min(Math.round(f.lines / 20), 30));
          console.log(`  ${chalk.dim(f.path.padEnd(40))} ${chalk.cyan(bar)} ${f.lines}`);
        }
      }

      if (s.languageBreakdown) {
        console.log();
        console.log(chalk.bold('  Language Breakdown'));
        console.log();
        for (const [ext, count] of Object.entries(s.languageBreakdown).sort((a, b) => (b[1] as number) - (a[1] as number))) {
          const bar = '█'.repeat(Math.min(count as number, 30));
          console.log(`  ${chalk.dim(String(ext).padEnd(10))} ${chalk.cyan(bar)} ${count}`);
        }
      }
    } catch { /* skip if corrupt */ }
  }

  // ── Knowledge Base ─────────────────────────────────────────────
  if (existsSync(kbPath)) {
    const kb = loadKnowledgeBase(kbPath, 'project');
    const summary = getKBSummary(kb);

    console.log();
    console.log(chalk.bold('  Knowledge Base'));
    console.log();
    console.log(`  ${chalk.cyan('Learnings:')}      ${summary.totalEntries} total`);
    console.log(`  ${chalk.green('Accessed:')}       ${summary.accessedEntries} (${summary.hitRate}% hit rate)`);
    console.log(`  ${chalk.dim('Never used:')}     ${summary.neverAccessed}`);
    console.log(`  ${chalk.yellow('False positives:')} ${summary.falsePositives}`);

    const stale = getStaleEntries(kb);
    if (stale.length > 0) {
      console.log(`  ${chalk.red('Stale (30d+):')}    ${stale.length} — candidates for cleanup`);
    }

    // Session history
    console.log();
    console.log(chalk.bold('  Session History'));
    console.log();
    console.log(`  ${chalk.cyan('Total sessions:')}  ${summary.totalSessions}`);
    console.log(`  ${chalk.green('Cache hits:')}      ${summary.cacheHits} (learnings prevented re-investigation)`);
    if (summary.avgFilesPerSession > 0) {
      console.log(`  ${chalk.dim('Avg files/session:')} ${summary.avgFilesPerSession}`);
    }

    // Session table
    if (kb.metrics.sessions.length > 0) {
      console.log();
      console.log(chalk.bold('  Recent Sessions'));
      console.log();
      console.log(`  ${chalk.dim('Date'.padEnd(12))} ${chalk.dim('Branch'.padEnd(20))} ${chalk.dim('Files'.padEnd(8))} ${chalk.dim('Learnings')}`);
      console.log(`  ${chalk.dim('─'.repeat(55))}`);
      for (const session of kb.metrics.sessions.slice(-10).reverse()) {
        console.log(`  ${chalk.dim(session.date.padEnd(12))} ${(session.branch || 'unknown').padEnd(20)} ${String(session.filesModified).padEnd(8)} +${session.learningsAdded}`);
      }
    }

    // Top learnings
    const top = getTopEntries(kb, 5);
    if (top.length > 0) {
      console.log();
      console.log(chalk.bold('  Most Valuable Learnings'));
      console.log();
      for (const entry of top) {
        const badge = entry.accessCount > 0 ? chalk.green(`${entry.accessCount}x`) : chalk.dim('0x');
        console.log(`  ${badge} ${chalk.dim(entry.date)} ${entry.summary}`);
      }
    }

    // Domain distribution
    if (summary.topDomains.length > 0) {
      console.log();
      console.log(chalk.bold('  Domain Distribution'));
      console.log();
      for (const [domain, count] of summary.topDomains) {
        const bar = '█'.repeat(Math.min(count, 20));
        console.log(`  ${chalk.cyan(domain.padEnd(20))} ${bar} ${count}`);
      }
    }

    // Impact summary
    if (summary.cacheHits > 0 || summary.accessedEntries > 0) {
      console.log();
      console.log(chalk.bold('  Impact'));
      console.log();
      if (summary.cacheHits > 0) console.log(`  ${chalk.green('✓')} ${summary.cacheHits} re-investigations prevented by learnings`);
      if (summary.accessedEntries > 0) console.log(`  ${chalk.green('✓')} ${summary.accessedEntries} learnings actively used`);
      if (summary.falsePositives > 0) console.log(`  ${chalk.green('✓')} ${summary.falsePositives} false positives suppressing noise`);
      if (summary.neverAccessed > 0) console.log(`  ${chalk.yellow('!')} ${summary.neverAccessed} learnings never accessed — review for cleanup`);
    }
  }

  // ── Learnings files ────────────────────────────────────────────
  const learnDir = learningsDir(rootPath);
  if (existsSync(learnDir)) {
    const files = readdirSync(learnDir).filter((f) => f.endsWith('.md') && f !== 'sessions.md');
    if (files.length > 0) {
      console.log();
      console.log(chalk.bold('  Learnings Files'));
      console.log();
      for (const file of files) {
        const entries = readLearnings(join(learnDir, file));
        console.log(`  ${chalk.dim(file.padEnd(30))} ${entries.length} entries`);
      }
    }

    // Session log
    const sessionsPath = join(learnDir, 'sessions.md');
    if (existsSync(sessionsPath)) {
      const content = readFileSync(sessionsPath, 'utf-8');
      const sessionCount = (content.match(/^## Session/gm) || []).length;
      console.log(`  ${chalk.dim('sessions.md'.padEnd(30))} ${sessionCount} sessions logged`);
    }
  }

  console.log();
}
