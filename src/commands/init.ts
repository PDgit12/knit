import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { scanProject } from '../engine/scanner.js';
import { buildKnowledge } from '../engine/knowledge.js';
import { findFalsePositives } from '../engine/learnings.js';
import { generateClaudeMd } from '../generators/claude-md.js';
import { generateSettings, generateSettingsLocal } from '../generators/settings.js';
import { generateLearningsContent } from '../generators/learnings.js';
import type { EngramConfig, InitResult, ProjectKnowledge } from '../engine/types.js';

interface InitOptions {
  agent?: string;
  force?: boolean;
  name?: string;
}

export async function initCommand(targetDir: string, options: InitOptions): Promise<InitResult> {
  const rootPath = targetDir === '.' ? process.cwd() : targetDir;

  // ── Phase 1: Scan ──────────────────────────────────────────────
  const spinner = ora({
    text: chalk.dim('Scanning project structure...'),
    spinner: 'dots',
  }).start();

  const scan = scanProject(rootPath);

  const stackLabel = [
    scan.stack.language !== 'unknown' ? scan.stack.language : null,
    scan.stack.framework,
  ].filter(Boolean).join(' + ') || 'unknown stack';

  spinner.succeed(
    `${chalk.bold('Stack:')} ${chalk.cyan(stackLabel)}  ${chalk.dim('|')}  ` +
    `${chalk.bold('PM:')} ${chalk.cyan(scan.packageManager)}  ${chalk.dim('|')}  ` +
    `${chalk.bold('Domains:')} ${chalk.cyan(String(scan.domains.length))}`
  );

  // ── Existing setup warning ─────────────────────────────────────
  if ((scan.hasExistingClaudeMd || scan.hasExistingSetup) && !options.force) {
    console.log();
    console.log(chalk.yellow('  ⚠  Existing setup detected:'));
    if (scan.hasExistingClaudeMd) console.log(chalk.yellow('     • CLAUDE.md already exists'));
    if (scan.hasExistingSetup) console.log(chalk.yellow('     • .claude/ directory already exists'));
    console.log(chalk.dim('     Use --force to overwrite'));
    console.log();
  }

  // ── Phase 2: Build config ──────────────────────────────────────
  const config: EngramConfig = {
    name: options.name || inferProjectName(rootPath),
    packageManager: scan.packageManager,
    stack: scan.stack,
    domains: scan.domains,
    targetAgent: (options.agent as EngramConfig['targetAgent']) || 'claude-code',
    tokenOptimization: 'standard',
  };

  const result: InitResult = {
    filesCreated: [],
    filesSkipped: [],
    warnings: [],
    config,
  };

  // ── Phase 2b: Build knowledge ───────────────────────────────────
  const knowledgeSpinner = ora({
    text: chalk.dim('Building project knowledge...'),
    spinner: 'dots',
  }).start();

  let knowledge: ProjectKnowledge | null = null;
  try {
    knowledge = buildKnowledge(rootPath, scan);
    knowledgeSpinner.succeed(
      `${chalk.bold('Indexed:')} ${chalk.cyan(String(knowledge.summary.totalFiles))} files  ${chalk.dim('|')}  ` +
      `${chalk.bold('Imports:')} ${chalk.cyan(String(Object.keys(knowledge.importGraph).length))} mapped  ${chalk.dim('|')}  ` +
      `${chalk.bold('Untested:')} ${chalk.cyan(String(knowledge.summary.untestedFiles.length))} flagged`
    );
  } catch {
    knowledgeSpinner.warn(chalk.dim('Knowledge scan skipped (could not read project files)'));
  }

  // Check for existing false positives in learnings
  const learningsDir = join(rootPath, '.claude', 'learnings');
  const learningsFiles = existsSync(learningsDir)
    ? readdirSync(learningsDir).filter((f) => f.endsWith('.md'))
    : [];
  const falsePositives = learningsFiles.flatMap((f) =>
    findFalsePositives(join(learningsDir, f))
  );

  // ── Phase 3: Generate ──────────────────────────────────────────
  const genSpinner = ora({
    text: chalk.dim('Generating workflow files...'),
    spinner: 'dots',
  }).start();

  // Create directories
  for (const dir of ['.claude', '.claude/learnings', '.claude/worktrees']) {
    const fullPath = join(rootPath, dir);
    if (!existsSync(fullPath)) mkdirSync(fullPath, { recursive: true });
  }

  // Generate each file
  writeOrSkip(join(rootPath, 'CLAUDE.md'), generateClaudeMd(config, knowledge, falsePositives), options.force, result, 'CLAUDE.md');

  // Write knowledge index
  if (knowledge) {
    writeOrSkip(join(rootPath, '.claude/knowledge.json'), JSON.stringify(knowledge, null, 2), options.force, result, '.claude/knowledge.json');
  }
  writeOrSkip(join(rootPath, '.claude/settings.json'), JSON.stringify(generateSettings(config), null, 2), options.force, result, '.claude/settings.json');
  writeOrSkip(join(rootPath, '.claude/settings.local.json'), JSON.stringify(generateSettingsLocal(config), null, 2), options.force, result, '.claude/settings.local.json');

  const learningsFileName = config.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.md';
  writeOrSkip(join(rootPath, '.claude/learnings', learningsFileName), generateLearningsContent(config), options.force, result, `.claude/learnings/${learningsFileName}`);

  genSpinner.succeed(chalk.dim('Workflow files generated'));

  // ── Phase 4: Report ────────────────────────────────────────────
  console.log();

  // File tree
  if (result.filesCreated.length > 0) {
    console.log(chalk.green.bold('  Created:'));
    for (let i = 0; i < result.filesCreated.length; i++) {
      const isLast = i === result.filesCreated.length - 1;
      const prefix = isLast ? '  └─' : '  ├─';
      console.log(chalk.green(`  ${prefix} ${result.filesCreated[i]}`));
    }
  }

  if (result.filesSkipped.length > 0) {
    console.log(chalk.dim('  Skipped:'));
    for (const f of result.filesSkipped) {
      console.log(chalk.dim(`     ${f}`));
    }
  }

  // Domain summary
  console.log();
  console.log(chalk.bold('  Domains'));
  for (const domain of config.domains) {
    console.log(`  ${chalk.cyan('●')} ${chalk.bold(domain.name)} ${chalk.dim('—')} ${chalk.dim(domain.description)}`);
  }

  // What you get
  console.log();
  console.log(chalk.bold('  What\'s wired up'));
  console.log(`  ${chalk.green('✓')} ${chalk.dim('6-phase orchestration protocol (RESEARCH → IDEATE → PLAN → EXECUTE → OPTIMIZE → REVIEW)')}`);
  console.log(`  ${chalk.green('✓')} ${chalk.dim('Tiered task routing (trivial / standard / complex)')}`);
  console.log(`  ${chalk.green('✓')} ${chalk.dim('Institutional memory with tagged learnings')}`);
  console.log(`  ${chalk.green('✓')} ${chalk.dim('False positive suppression for agents')}`);
  console.log(`  ${chalk.green('✓')} ${chalk.dim('LEARN exit gate — no task completes without updating memory')}`);
  console.log(`  ${chalk.green('✓')} ${chalk.dim('Destructive git operation blocking')}`);
  if (config.stack.typecheckCommand) {
    console.log(`  ${chalk.green('✓')} ${chalk.dim('Auto typecheck on file edits')}`);
  }
  console.log(`  ${chalk.green('✓')} ${chalk.dim('Build verification on session end')}`);
  console.log(`  ${chalk.green('✓')} ${chalk.dim('Session handoff protocol for context recovery')}`);

  // Next steps
  console.log();
  console.log(chalk.bold('  Next steps'));
  console.log(`  ${chalk.cyan('1.')} Review ${chalk.bold('CLAUDE.md')} — customize domain descriptions for your project`);
  console.log(`  ${chalk.cyan('2.')} Open a ${chalk.bold(config.targetAgent)} session in this directory`);
  console.log(`  ${chalk.cyan('3.')} The workflow activates automatically — try a task and watch it classify`);
  console.log();

  // Warnings
  if (!scan.git.isRepo) {
    result.warnings.push('No git repo detected');
    console.log(chalk.yellow(`  ⚠  No git repository. Run ${chalk.bold('git init')} for full workflow support.`));
    console.log();
  }

  // Knowledge summary
  if (knowledge) {
    const { summary } = knowledge;
    const parts = [
      `${summary.totalFiles} files indexed`,
      `${Object.keys(knowledge.importGraph).length} import edges`,
      summary.highFanoutFiles.length > 0 ? `${summary.highFanoutFiles.length} high-fanout files` : null,
      summary.untestedFiles.length > 0 ? `${summary.untestedFiles.length} untested files flagged` : null,
    ].filter(Boolean);
    console.log(chalk.dim(`  Knowledge brain: ${parts.join(', ')}`));
  }
  console.log();

  return result;
}

function writeOrSkip(
  filePath: string,
  content: string,
  force: boolean | undefined,
  result: InitResult,
  label: string,
): void {
  if (!existsSync(filePath) || force) {
    writeFileSync(filePath, content, 'utf-8');
    result.filesCreated.push(label);
  } else {
    result.filesSkipped.push(label);
  }
}

function inferProjectName(rootPath: string): string {
  try {
    const pkgContent = readFileSync(join(rootPath, 'package.json'), 'utf-8');
    const pkg = JSON.parse(pkgContent);
    if (pkg.name) return pkg.name;
  } catch {
    // Fall through
  }

  const parts = rootPath.split('/');
  return parts[parts.length - 1] || 'project';
}
