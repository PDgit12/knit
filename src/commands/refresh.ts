import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { scanProject } from '../engine/scanner.js';
import { buildKnowledge } from '../engine/knowledge.js';
import { findFalsePositives } from '../engine/learnings.js';
import { generateClaudeMd } from '../generators/claude-md.js';
import { knowledgePath, learningsDir, projectDataDir } from '../engine/paths.js';
import type { EngramConfig } from '../engine/types.js';

export async function refreshCommand(targetDir: string): Promise<void> {
  const rootPath = targetDir === '.' ? process.cwd() : targetDir;

  // Verify engram is initialized (either centralized or legacy)
  if (!existsSync(join(rootPath, 'CLAUDE.md')) || !existsSync(projectDataDir(rootPath))) {
    console.log(chalk.red('  No Engram setup found. Open this project in Claude Code with the Engram MCP — it will auto-initialize.'));
    process.exit(1);
  }

  // Re-scan
  const spinner = ora({ text: chalk.dim('Re-scanning project...'), spinner: 'dots' }).start();
  const scan = scanProject(rootPath);
  spinner.succeed(chalk.dim('Project re-scanned'));

  // Rebuild knowledge
  const knowledgeSpinner = ora({ text: chalk.dim('Rebuilding knowledge index...'), spinner: 'dots' }).start();
  const knowledge = buildKnowledge(rootPath, scan);
  knowledgeSpinner.succeed(
    `${chalk.bold('Indexed:')} ${chalk.cyan(String(knowledge.summary.totalFiles))} files  ${chalk.dim('|')}  ` +
    `${chalk.bold('Imports:')} ${chalk.cyan(String(Object.keys(knowledge.importGraph).length))} mapped  ${chalk.dim('|')}  ` +
    `${chalk.bold('Untested:')} ${chalk.cyan(String(knowledge.summary.untestedFiles.length))} flagged`
  );

  // Extract false positives from learnings
  const learnDir = learningsDir(rootPath);
  const learningsFiles = existsSync(learnDir)
    ? readdirSync(learnDir).filter((f) => f.endsWith('.md'))
    : [];
  const falsePositives = learningsFiles.flatMap((f) =>
    findFalsePositives(join(learnDir, f))
  );

  // Infer project name
  let projectName = 'project';
  try {
    const pkg = JSON.parse(readFileSync(join(rootPath, 'package.json'), 'utf-8'));
    if (pkg.name) projectName = pkg.name;
  } catch {
    const parts = rootPath.split('/');
    projectName = parts[parts.length - 1] || 'project';
  }

  // Build config
  const config: EngramConfig = {
    name: projectName,
    packageManager: scan.packageManager,
    stack: scan.stack,
    domains: scan.domains,
    targetAgent: 'claude-code',
    tokenOptimization: 'standard',
  };

  // Regenerate CLAUDE.md
  const genSpinner = ora({ text: chalk.dim('Regenerating CLAUDE.md...'), spinner: 'dots' }).start();
  writeFileSync(join(rootPath, 'CLAUDE.md'), generateClaudeMd(config, knowledge, falsePositives), 'utf-8');
  writeFileSync(knowledgePath(rootPath), JSON.stringify(knowledge, null, 2), 'utf-8');
  genSpinner.succeed(chalk.dim('CLAUDE.md + knowledge.json updated'));

  // Report
  console.log();
  console.log(chalk.bold('  Refresh complete'));

  if (falsePositives.length > 0) {
    console.log(`  ${chalk.green('✓')} ${chalk.dim(`${falsePositives.length} false positives injected into CLAUDE.md`)}`);
  }

  if (knowledge.summary.highFanoutFiles.length > 0) {
    console.log(`  ${chalk.green('✓')} ${chalk.dim(`High-fanout files: ${knowledge.summary.highFanoutFiles.join(', ')}`)}`);
  }

  if (knowledge.summary.untestedFiles.length > 0) {
    console.log(`  ${chalk.yellow('!')} ${chalk.dim(`${knowledge.summary.untestedFiles.length} untested files — see Project Map in CLAUDE.md`)}`);
  }

  console.log();
}
