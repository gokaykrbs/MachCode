import fs from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';
import type { SlashCommand, CommandContext } from './types.js';

export const addCommand: SlashCommand = {
  name: 'add',
  description: 'Add file or folder to session context',
  category: 'Context & Memory',
  usage: '/add <path>',
  execute: async (args: string, context: CommandContext) => {
    if (!args || args.trim().length === 0) {
      console.log(chalk.yellow('Usage: /add <file-or-folder-path>'));
      return;
    }

    const targetInput = args.trim();
    const resolvedPath = path.resolve(context.baseDir, targetInput);

    try {
      const stats = await fs.stat(resolvedPath);
      const relPath = path.relative(context.baseDir, resolvedPath).split(path.sep).join('/');

      if (stats.isDirectory()) {
        const entries = await fs.readdir(resolvedPath, { recursive: true });
        let addedCount = 0;
        for (const entry of entries) {
          const entryStr = String(entry);
          const entryFull = path.join(resolvedPath, entryStr);
          try {
            const entryStat = await fs.stat(entryFull);
            if (entryStat.isFile()) {
              const fileRel = path.relative(context.baseDir, entryFull).split(path.sep).join('/');
              context.addedContextFiles.add(fileRel);
              addedCount++;
            }
          } catch {
            // Skip unreadable files
          }
        }
        console.log(
          chalk.green(`✔ Added directory `) +
            chalk.white.bold(relPath) +
            chalk.green(` (${addedCount} file(s)) to session context.`),
        );
      } else {
        context.addedContextFiles.add(relPath);
        console.log(
          chalk.green(`✔ Added `) + chalk.white.bold(relPath) + chalk.green(` to session context.`),
        );
      }
    } catch {
      console.log(chalk.red(`✖ Path not found or inaccessible: ${targetInput}`));
    }
  },
};

export const dropCommand: SlashCommand = {
  name: 'drop',
  description: 'Remove file or folder from session context',
  category: 'Context & Memory',
  usage: '/drop <path>',
  execute: async (args: string, context: CommandContext) => {
    if (!args || args.trim().length === 0) {
      console.log(chalk.yellow('Usage: /drop <path>'));
      return;
    }

    const targetInput = args.trim().split(path.sep).join('/');
    let removed = false;

    if (context.addedContextFiles.has(targetInput)) {
      context.addedContextFiles.delete(targetInput);
      removed = true;
    } else {
      // Check prefix if a folder was specified
      for (const file of Array.from(context.addedContextFiles)) {
        if (
          file === targetInput ||
          file.startsWith(targetInput.endsWith('/') ? targetInput : `${targetInput}/`)
        ) {
          context.addedContextFiles.delete(file);
          removed = true;
        }
      }
    }

    if (removed) {
      console.log(
        chalk.green(`✔ Removed `) +
          chalk.white.bold(targetInput) +
          chalk.green(` from session context.`),
      );
    } else {
      console.log(chalk.yellow(`ℹ Path "${targetInput}" was not in the active session context.`));
    }
  },
};

export const resetCommand: SlashCommand = {
  name: 'reset',
  description: 'Clear entire session history and context',
  category: 'Context & Memory',
  usage: '/reset',
  aliases: ['clear-history', 'wipe'],
  execute: async (_args: string, context: CommandContext) => {
    context.sessionHistory.length = 0;
    context.addedContextFiles.clear();
    context.tokenStats.estimatedPromptTokens = 0;
    context.tokenStats.estimatedCompletionTokens = 0;
    context.tokenStats.totalTurns = 0;
    console.log(
      chalk.green.bold(
        '✔ Session history, active context files, and token usage counters have been reset.',
      ),
    );
  },
};

export const contextCommand: SlashCommand = {
  name: 'context',
  description: 'List currently loaded files and token usage estimate',
  category: 'Context & Memory',
  usage: '/context',
  execute: async (_args: string, context: CommandContext) => {
    console.log(chalk.cyan.bold('\n--- MachCode Active Session Context ---'));
    console.log(`Directory:   ${chalk.white(context.baseDir)}`);
    console.log(`Turns:       ${chalk.white(context.tokenStats.totalTurns)}`);
    console.log(`History:     ${chalk.white(context.sessionHistory.length)} message(s) retained`);

    const totalEstimated =
      context.tokenStats.estimatedPromptTokens + context.tokenStats.estimatedCompletionTokens;
    console.log(
      `Token Est.:  ${chalk.yellow(totalEstimated.toLocaleString())} tokens (~${chalk.yellow(
        context.tokenStats.estimatedPromptTokens.toLocaleString(),
      )} prompt, ~${chalk.yellow(context.tokenStats.estimatedCompletionTokens.toLocaleString())} completion)`,
    );

    console.log(`\n${chalk.cyan.bold('Active Context Files:')}`);
    if (context.addedContextFiles.size === 0) {
      console.log(chalk.gray('  (No explicit files added. Use /add <path> to add files)'));
    } else {
      for (const file of context.addedContextFiles) {
        console.log(`  ${chalk.green('•')} ${chalk.white(file)}`);
      }
    }

    if (context.fileSnapshots.length > 0) {
      console.log(
        `\n${chalk.cyan.bold('Undoable AI File Modifications:')} ${context.fileSnapshots.length} snapshot(s)`,
      );
    }
    console.log('');
  },
};

export const contextCommands: SlashCommand[] = [
  addCommand,
  dropCommand,
  resetCommand,
  contextCommand,
];
