import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import chalk from 'chalk';
import { loadKnowledgeBase, getKBSummary, getTopEntries, getStaleEntries } from '../engine/knowledgebase.js';
import { readLearnings } from '../engine/learnings.js';

export async function dashCommand(targetDir: string): Promise<void> {
  const rootPath = targetDir === '.' ? process.cwd() : targetDir;
  const kbPath = join(rootPath, '.claude/knowledgebase.json');
  const knowledgePath = join(rootPath, '.claude/knowledge.json');

  console.log(chalk.bold('  Engram Dashboard'));
  console.log(chalk.dim('  Type a command or /help for options. Ctrl+C to exit.'));
  console.log();

  // Show initial overview
  showOverview(rootPath, kbPath, knowledgePath);

  // Interactive prompt
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan('  engram > '),
  });

  rl.prompt();

  rl.on('line', (line) => {
    const cmd = line.trim().toLowerCase();

    switch (cmd) {
      case '/help':
      case 'help':
        showHelp();
        break;
      case '/sessions':
      case 'sessions':
        showSessions(kbPath);
        break;
      case '/learnings':
      case 'learnings':
        showLearnings(rootPath);
        break;
      case '/health':
      case 'health':
        showHealth(kbPath, knowledgePath);
        break;
      case '/brain':
      case 'brain':
        showBrain(knowledgePath);
        break;
      case '/teams':
      case 'teams':
        showTeams(rootPath);
        break;
      case '/stale':
      case 'stale':
        showStale(kbPath);
        break;
      case '/top':
      case 'top':
        showTop(kbPath);
        break;
      case '/exit':
      case 'exit':
      case 'q':
        rl.close();
        return;
      default:
        if (cmd) console.log(chalk.dim(`  Unknown command: ${cmd}. Type /help for options.`));
    }

    console.log();
    rl.prompt();
  });

  rl.on('close', () => {
    console.log(chalk.dim('\n  Goodbye.'));
    process.exit(0);
  });
}

function showHelp() {
  console.log();
  console.log(chalk.bold('  Commands'));
  console.log();
  console.log(`  ${chalk.cyan('/sessions')}   Session history — dates, branches, files modified`);
  console.log(`  ${chalk.cyan('/learnings')}  All learnings with domains and outcomes`);
  console.log(`  ${chalk.cyan('/health')}     Knowledge base health — hit rate, cache hits, stale entries`);
  console.log(`  ${chalk.cyan('/brain')}      Knowledge index — files, imports, exports, untested`);
  console.log(`  ${chalk.cyan('/teams')}      Custom teams configured for this project`);
  console.log(`  ${chalk.cyan('/top')}        Most valuable learnings (by access count)`);
  console.log(`  ${chalk.cyan('/stale')}      Stale learnings (never accessed, 30+ days old)`);
  console.log(`  ${chalk.cyan('/exit')}       Exit dashboard`);
}

function showOverview(_rootPath: string, kbPath: string, knowledgePath: string) {
  const hasKB = existsSync(kbPath);
  const hasKnowledge = existsSync(knowledgePath);

  if (!hasKB && !hasKnowledge) {
    console.log(chalk.yellow('  No Engram data found in this project.'));
    console.log(chalk.dim('  Open this project in Claude Code — the brain will initialize automatically.'));
    return;
  }

  if (hasKnowledge) {
    try {
      const k = JSON.parse(readFileSync(knowledgePath, 'utf-8'));
      const s = k.summary;
      console.log(`  ${chalk.cyan('Files:')} ${s.totalFiles}  ${chalk.cyan('Lines:')} ${s.totalLines?.toLocaleString() || 0}  ${chalk.cyan('Imports:')} ${Object.keys(k.importGraph || {}).length}  ${chalk.cyan('Untested:')} ${(s.untestedFiles || []).length}`);
    } catch { /* skip */ }
  }

  if (hasKB) {
    const kb = loadKnowledgeBase(kbPath, 'project');
    const summary = getKBSummary(kb);
    console.log(`  ${chalk.green('Learnings:')} ${summary.totalEntries}  ${chalk.green('Hit rate:')} ${summary.hitRate}%  ${chalk.green('Sessions:')} ${summary.totalSessions}  ${chalk.green('Cache hits:')} ${summary.cacheHits}`);
  }

  console.log();
}

function showSessions(kbPath: string) {
  if (!existsSync(kbPath)) { console.log(chalk.dim('  No data yet.')); return; }
  const kb = loadKnowledgeBase(kbPath, 'project');

  if (kb.metrics.sessions.length === 0) {
    console.log(chalk.dim('  No sessions recorded yet. Use Claude Code with this project.'));
    return;
  }

  console.log();
  console.log(chalk.bold('  Sessions'));
  console.log(`  ${chalk.dim('Date'.padEnd(12))} ${chalk.dim('Branch'.padEnd(22))} ${chalk.dim('Files'.padEnd(8))} ${chalk.dim('Learnings')}`);
  console.log(`  ${chalk.dim('-'.repeat(55))}`);

  for (const s of kb.metrics.sessions.slice(-15).reverse()) {
    console.log(`  ${s.date.padEnd(12)} ${(s.branch || '-').padEnd(22)} ${String(s.filesModified).padEnd(8)} +${s.learningsAdded}`);
  }
}

function showLearnings(rootPath: string) {
  const learningsDir = join(rootPath, '.claude/learnings');
  if (!existsSync(learningsDir)) { console.log(chalk.dim('  No learnings yet.')); return; }

  const files = readdirSync(learningsDir).filter((f) => f.endsWith('.md') && f !== 'sessions.md');

  console.log();
  console.log(chalk.bold('  Learnings'));
  console.log();

  for (const file of files) {
    const entries = readLearnings(join(learningsDir, file));
    for (const entry of entries.slice(-10)) {
      const icon = entry.outcome === 'success' ? chalk.green('✓') : entry.outcome === 'failure' ? chalk.red('✗') : chalk.yellow('~');
      console.log(`  ${icon} ${chalk.dim(entry.date)} ${entry.summary}`);
      if (entry.tags.length > 0) console.log(`    ${chalk.dim(entry.tags.join(' '))}`);
    }
  }
}

function showHealth(kbPath: string, knowledgePath: string) {
  console.log();
  console.log(chalk.bold('  Brain Health'));
  console.log();

  if (existsSync(kbPath)) {
    const kb = loadKnowledgeBase(kbPath, 'project');
    const summary = getKBSummary(kb);
    console.log(`  ${chalk.cyan('Learnings:')}       ${summary.totalEntries}`);
    console.log(`  ${chalk.green('Accessed:')}        ${summary.accessedEntries} (${summary.hitRate}% hit rate)`);
    console.log(`  ${chalk.dim('Never used:')}      ${summary.neverAccessed}`);
    console.log(`  ${chalk.yellow('False positives:')} ${summary.falsePositives}`);
    console.log(`  ${chalk.cyan('Sessions:')}        ${summary.totalSessions}`);
    console.log(`  ${chalk.green('Cache hits:')}      ${summary.cacheHits}`);

    const stale = getStaleEntries(kb);
    if (stale.length > 0) console.log(`  ${chalk.red('Stale (30d+):')}    ${stale.length}`);
  }

  if (existsSync(knowledgePath)) {
    try {
      const k = JSON.parse(readFileSync(knowledgePath, 'utf-8'));
      console.log();
      console.log(`  ${chalk.cyan('Files indexed:')}   ${k.summary.totalFiles}`);
      console.log(`  ${chalk.cyan('Import edges:')}    ${Object.keys(k.importGraph || {}).length}`);
      console.log(`  ${chalk.cyan('Exports mapped:')}  ${Object.keys(k.exports || {}).length}`);
    } catch { /* skip */ }
  }
}

function showBrain(knowledgePath: string) {
  if (!existsSync(knowledgePath)) { console.log(chalk.dim('  No knowledge index yet.')); return; }

  try {
    const k = JSON.parse(readFileSync(knowledgePath, 'utf-8'));
    console.log();
    console.log(chalk.bold('  Knowledge Brain'));
    console.log();

    if (k.summary.highFanoutFiles?.length > 0) {
      console.log(chalk.bold('  High-fanout files (risky to change):'));
      for (const f of k.summary.highFanoutFiles) console.log(`    ${chalk.red('!')} ${f}`);
      console.log();
    }

    if (k.summary.untestedFiles?.length > 0) {
      console.log(chalk.bold(`  Untested files (${k.summary.untestedFiles.length}):`));
      for (const f of k.summary.untestedFiles.slice(0, 10)) console.log(`    ${chalk.yellow('-')} ${f}`);
      if (k.summary.untestedFiles.length > 10) console.log(chalk.dim(`    ... +${k.summary.untestedFiles.length - 10} more`));
      console.log();
    }

    if (k.summary.largestFiles?.length > 0) {
      console.log(chalk.bold('  Largest files:'));
      for (const f of k.summary.largestFiles.slice(0, 5)) {
        const bar = '█'.repeat(Math.min(Math.round(f.lines / 30), 20));
        console.log(`    ${chalk.dim(f.path.padEnd(40))} ${chalk.cyan(bar)} ${f.lines}`);
      }
    }
  } catch { /* skip */ }
}

function showTeams(rootPath: string) {
  const teamsPath = join(rootPath, '.claude/teams.json');
  if (!existsSync(teamsPath)) {
    console.log(chalk.dim('  No custom teams. Teams are auto-generated from project structure.'));
    return;
  }

  try {
    const teams = JSON.parse(readFileSync(teamsPath, 'utf-8'));
    console.log();
    console.log(chalk.bold(`  Teams (${teams.length})`));
    console.log();
    for (const t of teams) {
      console.log(`  ${chalk.cyan('●')} ${chalk.bold(t.name)} — ${t.role}`);
      console.log(`    ${chalk.dim(t.focus)}`);
      if (t.agents) console.log(`    ${chalk.dim('Agents: ' + t.agents.join(', '))}`);
    }
  } catch { /* skip */ }
}

function showStale(kbPath: string) {
  if (!existsSync(kbPath)) { console.log(chalk.dim('  No data yet.')); return; }
  const kb = loadKnowledgeBase(kbPath, 'project');
  const stale = getStaleEntries(kb);

  if (stale.length === 0) {
    console.log(chalk.green('  No stale learnings. All entries are either recent or accessed.'));
    return;
  }

  console.log();
  console.log(chalk.bold(`  Stale Learnings (${stale.length} — never accessed, 30+ days old)`));
  console.log();
  for (const entry of stale) {
    console.log(`  ${chalk.red('✗')} ${chalk.dim(entry.date)} ${entry.summary}`);
  }
  console.log();
  console.log(chalk.dim('  Consider removing these — they never helped.'));
}

function showTop(kbPath: string) {
  if (!existsSync(kbPath)) { console.log(chalk.dim('  No data yet.')); return; }
  const kb = loadKnowledgeBase(kbPath, 'project');
  const top = getTopEntries(kb, 10);

  if (top.length === 0) {
    console.log(chalk.dim('  No learnings accessed yet.'));
    return;
  }

  console.log();
  console.log(chalk.bold('  Most Valuable Learnings'));
  console.log();
  for (const entry of top) {
    const bar = '█'.repeat(Math.min(entry.accessCount, 15));
    console.log(`  ${chalk.green(bar)} ${entry.accessCount}x  ${entry.summary}`);
    console.log(`    ${chalk.dim(entry.lesson.slice(0, 80))}`);
  }
}
