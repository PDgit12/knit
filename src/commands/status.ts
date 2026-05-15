import { existsSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { loadKnowledgeBase, getKBSummary } from '../engine/knowledgebase.js';

export async function statusCommand(targetDir: string): Promise<void> {
  const rootPath = targetDir === '.' ? process.cwd() : targetDir;
  const kbPath = join(rootPath, '.claude/knowledgebase.json');

  if (!existsSync(kbPath)) {
    console.log(chalk.red('  No knowledge base found. Run `engram init` first.'));
    process.exit(1);
  }

  const kb = loadKnowledgeBase(kbPath, 'project');
  const summary = getKBSummary(kb);

  console.log();
  console.log(chalk.bold('  Knowledge Base Health'));
  console.log();

  // Core metrics
  console.log(`  ${chalk.cyan('Learnings:')}     ${summary.totalEntries} total`);
  console.log(`  ${chalk.green('Accessed:')}      ${summary.accessedEntries} (${summary.hitRate}% hit rate)`);
  console.log(`  ${chalk.dim('Never used:')}    ${summary.neverAccessed}`);
  console.log(`  ${chalk.yellow('False positives:')} ${summary.falsePositives}`);
  if (summary.staleEntries > 0) {
    console.log(`  ${chalk.red('Stale (30d+):')}   ${summary.staleEntries} — candidates for archiving`);
  }

  // Session metrics
  console.log();
  console.log(chalk.bold('  Session Metrics'));
  console.log();
  console.log(`  ${chalk.cyan('Total sessions:')}  ${summary.totalSessions}`);
  console.log(`  ${chalk.green('Cache hits:')}      ${summary.cacheHits} (learnings prevented re-investigation)`);
  if (summary.avgFilesPerSession > 0) {
    console.log(`  ${chalk.dim('Avg files/session:')} ${summary.avgFilesPerSession}`);
  }

  // Domain distribution
  if (summary.topDomains.length > 0) {
    console.log();
    console.log(chalk.bold('  Top Domains'));
    console.log();
    for (const [domain, count] of summary.topDomains) {
      const bar = '█'.repeat(Math.min(count, 20));
      console.log(`  ${chalk.cyan(domain.padEnd(20))} ${bar} ${count}`);
    }
  }

  // Token savings estimate (honest — based on actual data)
  if (summary.cacheHits > 0 || summary.accessedEntries > 0) {
    console.log();
    console.log(chalk.bold('  Impact'));
    console.log();
    if (summary.cacheHits > 0) {
      console.log(`  ${chalk.green('✓')} ${summary.cacheHits} times the agent skipped re-investigation because a learning existed`);
    }
    if (summary.accessedEntries > 0) {
      console.log(`  ${chalk.green('✓')} ${summary.accessedEntries} learnings are actively being used`);
    }
    if (summary.falsePositives > 0) {
      console.log(`  ${chalk.green('✓')} ${summary.falsePositives} false positives prevent agents from wasting time`);
    }
    if (summary.neverAccessed > 0) {
      console.log(`  ${chalk.yellow('!')} ${summary.neverAccessed} learnings were never accessed — consider reviewing`);
    }
  }

  console.log();
}
