import { existsSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { getBrain } from '../mcp/cache.js';
import { installAgentsForProject } from '../engine/install-agents.js';

export interface InstallAgentsOptions {
  refresh?: boolean;
  all?: boolean;
}

export async function installAgentsCommand(
  targetDir: string,
  options: InstallAgentsOptions,
): Promise<void> {
  const rootPath = targetDir === '.' ? process.cwd() : targetDir;

  if (!existsSync(join(rootPath, 'CLAUDE.md'))) {
    console.log(chalk.yellow('  No CLAUDE.md found in this directory.'));
    console.log(chalk.dim('  Open this project in Claude Code with engram MCP first — it auto-initializes on first tool call.'));
    process.exit(1);
  }

  const spinner = ora({ text: chalk.dim('Loading brain…'), spinner: 'dots' }).start();
  const brain = getBrain(rootPath);
  spinner.succeed(chalk.dim(`Brain loaded (${brain.knowledge.summary.totalFiles} files indexed)`));

  const installSpinner = ora({
    text: chalk.dim(options.all ? 'Installing all known agents…' : 'Installing agents for this project…'),
    spinner: 'dots',
  }).start();

  const result = await installAgentsForProject(
    rootPath,
    brain.config,
    brain.knowledge,
    brain.knowledgeBase,
    { refresh: options.refresh, all: options.all },
  );

  installSpinner.succeed(chalk.dim('Install complete'));
  console.log();

  if (result.installed.length > 0) {
    console.log(chalk.bold('  Installed'));
    for (const name of result.installed) {
      console.log(`  ${chalk.green('✓')} engram-${name}.md`);
    }
    console.log();
  }

  if (result.alreadyCurrent.length > 0) {
    console.log(chalk.bold('  Already current'));
    for (const name of result.alreadyCurrent) {
      console.log(`  ${chalk.dim('·')} engram-${name}.md ${chalk.dim('(no change)')}`);
    }
    console.log();
  }

  if (result.skippedUserCurated.length > 0) {
    console.log(chalk.bold('  Skipped (user-curated files; engram won\'t clobber)'));
    for (const name of result.skippedUserCurated) {
      console.log(`  ${chalk.yellow('!')} engram-${name}.md`);
    }
    console.log();
  }

  if (result.failed.length > 0) {
    console.log(chalk.bold(chalk.red('  Failed')));
    for (const f of result.failed) {
      console.log(`  ${chalk.red('✗')} ${f.name} — ${chalk.dim(f.error)}`);
    }
    console.log();
  }

  const total = result.installed.length + result.alreadyCurrent.length;
  console.log(chalk.dim(`  ${total} agent${total === 1 ? '' : 's'} ready in <project>/.claude/agents/`));
  console.log(chalk.dim('  Claude Code will find them automatically when teams dispatch.'));
  console.log();
}
