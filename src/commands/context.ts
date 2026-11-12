import fs from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';
import type { SlashCommand, CommandContext } from './types.js';
import { fastSearchCode } from '../tools/fastSearch.js';

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

export const cdCommand: SlashCommand = {
  name: 'cd',
  description: 'Change active workspace directory (e.g. /cd D:\\ or /cd ..)',
  category: 'Context & Memory',
  usage: '/cd <path>',
  aliases: ['chdir'],
  execute: async (args: string, context: CommandContext) => {
    if (!args || args.trim().length === 0) {
      console.log(chalk.cyan(`Current workspace directory: ${chalk.white.bold(context.baseDir)}`));
      return;
    }

    let rawTarget = args.trim().replace(/^["']|["']$/g, '');
    if (/^[a-zA-Z]:$/.test(rawTarget)) {
      rawTarget = `${rawTarget}\\`;
    }
    const resolvedPath = path.resolve(context.baseDir, rawTarget);

    try {
      const stats = await fs.stat(resolvedPath);
      if (!stats.isDirectory()) {
        console.log(chalk.red(`✖ Path is not a directory: ${rawTarget}`));
        return;
      }

      context.baseDir = resolvedPath;
      try {
        process.chdir(resolvedPath);
      } catch {
        // Ignore if chdir fails on certain systems
      }
      context.addedContextFiles.clear();

      const dirents = await fs.readdir(resolvedPath);
      console.log(
        '\n' +
          chalk.green.bold('✔ Switched active workspace to: ') +
          chalk.white.bold(resolvedPath) +
          chalk.gray(` (${dirents.length} item(s) found)\n`),
      );
    } catch {
      console.log(chalk.red(`✖ Directory not found or inaccessible: ${rawTarget}`));
    }
  },
};

export const lsCommand: SlashCommand = {
  name: 'ls',
  description: 'List files and directories in current workspace or path (e.g. /ls or /ls D:\\)',
  category: 'Context & Memory',
  usage: '/ls [path]',
  aliases: ['dir', 'list'],
  execute: async (args: string, context: CommandContext) => {
    let rawTarget = args.trim() ? args.trim().replace(/^["']|["']$/g, '') : context.baseDir;
    if (/^[a-zA-Z]:$/.test(rawTarget)) {
      rawTarget = `${rawTarget}\\`;
    }
    const resolvedPath = path.resolve(context.baseDir, rawTarget);

    try {
      const dirents = await fs.readdir(resolvedPath, { withFileTypes: true });
      console.log(
        chalk.cyan.bold(`\n📁 Directory: ${chalk.white(resolvedPath)} (${dirents.length} items)\n`),
      );

      const dirs = dirents
        .filter((d) => d.isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name));
      const files = dirents.filter((d) => d.isFile()).sort((a, b) => a.name.localeCompare(b.name));

      for (const d of dirs) {
        console.log(`  ${chalk.cyan.bold('📁 ' + d.name + '/')}`);
      }
      for (const f of files) {
        console.log(`  ${chalk.white('📄 ' + f.name)}`);
      }
      console.log('');
    } catch (err) {
      console.log(chalk.red(`✖ Failed to list directory "${rawTarget}": ${String(err)}`));
    }
  },
};

export const searchCommand: SlashCommand = {
  name: 'search',
  description: 'Fast multi-file text and regex code search across workspace',
  category: 'Context & Memory',
  usage: '/search <query> [--regex] [--case]',
  aliases: ['grep', 'find'],
  execute: async (args: string, context: CommandContext) => {
    const raw = args.trim();
    if (!raw) {
      console.log(chalk.yellow('Usage: /search <query> [--regex] [--case]'));
      return;
    }

    const isRegex = raw.includes('--regex');
    const isCase = raw.includes('--case');
    const query = raw
      .replace(/--regex/g, '')
      .replace(/--case/g, '')
      .trim();

    if (!query) {
      console.log(chalk.yellow('Usage: /search <query> [--regex] [--case]'));
      return;
    }

    console.log(chalk.cyan(`\n🔍 Searching workspace for "${chalk.white.bold(query)}"...`));
    const result = await fastSearchCode({
      query,
      baseDir: context.baseDir,
      isRegex,
      caseSensitive: isCase,
      contextLinesBefore: 1,
      contextLinesAfter: 1,
      maxMatches: 50,
    });

    if (result.matches.length === 0) {
      console.log(
        chalk.dim(
          `No matches found in ${result.totalFilesSearched} file(s) (${result.durationMs}ms).\n`,
        ),
      );
      return;
    }

    console.log(
      chalk.green(
        `Found ${result.matches.length}${result.truncated ? '+' : ''} matches across ${result.totalFilesSearched} file(s) (${result.durationMs}ms):\n`,
      ),
    );

    for (const match of result.matches.slice(0, 30)) {
      console.log(
        chalk.cyan(`${match.displayPath}`) +
          chalk.gray(`:`) +
          chalk.yellow(`${match.lineNumber}`) +
          chalk.gray(` │ `) +
          match.lineText.trim(),
      );
    }
    if (result.matches.length > 30) {
      console.log(chalk.dim(`\n  ... (+${result.matches.length - 30} more matches omitted)`));
    }
    console.log('');
  },
};

import { saveCommand, sessionsCommand, resumeCommand } from './session.js';

export { saveCommand, sessionsCommand, resumeCommand } from './session.js';

export const contextCommands: SlashCommand[] = [
  addCommand,
  dropCommand,
  resetCommand,
  contextCommand,
  cdCommand,
  lsCommand,
  searchCommand,
  saveCommand,
  sessionsCommand,
  resumeCommand,
];
