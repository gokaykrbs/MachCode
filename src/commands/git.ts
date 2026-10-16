import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';
import type { SlashCommand, CommandContext } from './types.js';

const execFileAsync = promisify(execFile);

/**
 * Runs a git command in the target directory and returns stdout.
 */
async function runGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('git', args, { cwd });
}

export const undoCommand: SlashCommand = {
  name: 'undo',
  description: 'Revert the last file modification made by the AI',
  category: 'Safety & Git',
  usage: '/undo',
  aliases: ['revert'],
  execute: async (_args: string, context: CommandContext) => {
    if (context.fileSnapshots.length === 0) {
      console.log(chalk.yellow('ℹ No AI file modifications in history to undo.'));
      return;
    }

    const lastSnapshot = context.fileSnapshots.pop()!;
    const targetPath = path.resolve(context.baseDir, lastSnapshot.file);

    try {
      if (lastSnapshot.previousContent === '__FILE_DID_NOT_EXIST__') {
        // File was newly created by the AI; remove it to undo
        await fs.rm(targetPath, { force: true });
        console.log(
          chalk.green(`✔ Undone file creation: removed `) + chalk.white.bold(lastSnapshot.file),
        );
      } else {
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, lastSnapshot.previousContent, 'utf-8');
        console.log(
          chalk.green(`✔ Reverted `) +
            chalk.white.bold(lastSnapshot.file) +
            chalk.green(` to state before last AI modification.`),
        );
      }
    } catch (err) {
      console.error(chalk.red(`✖ Failed to revert ${lastSnapshot.file}: ${String(err)}`));
    }
  },
};

export const diffCommand: SlashCommand = {
  name: 'diff',
  description: 'Show terminal diff of uncommitted git changes',
  category: 'Safety & Git',
  usage: '/diff',
  execute: async (_args: string, context: CommandContext) => {
    try {
      const { stdout: statusOut } = await runGit(['status', '--short'], context.baseDir);
      if (!statusOut.trim()) {
        console.log(chalk.gray('\nWorking tree clean (no uncommitted changes).\n'));
        return;
      }

      const { stdout: diffOut } = await runGit(['diff', 'HEAD'], context.baseDir);
      const combined =
        diffOut.trim().length > 0 ? diffOut : (await runGit(['diff'], context.baseDir)).stdout;

      if (!combined.trim()) {
        console.log(chalk.gray('\nUntracked files present, but no tracked diffs:\n') + statusOut);
        return;
      }

      console.log(chalk.cyan.bold('\n--- Uncommitted Git Changes ---\n'));
      const lines = combined.split('\n');
      for (const line of lines) {
        if (line.startsWith('+') && !line.startsWith('+++')) {
          console.log(chalk.green(line));
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          console.log(chalk.red(line));
        } else if (line.startsWith('@@')) {
          console.log(chalk.cyan(line));
        } else if (line.startsWith('diff --git')) {
          console.log(chalk.yellow.bold(line));
        } else {
          console.log(chalk.dim(line));
        }
      }
      console.log('');
    } catch (err) {
      console.log(
        chalk.yellow(`ℹ Git repository not found or git diff unavailable: ${String(err)}`),
      );
    }
  },
};

export const commitCommand: SlashCommand = {
  name: 'commit',
  description: 'Generate conventional commit message and execute git commit',
  category: 'Safety & Git',
  usage: '/commit',
  aliases: ['ci'],
  execute: async (_args: string, context: CommandContext) => {
    try {
      const { stdout: statusOut } = await runGit(['status', '--short'], context.baseDir);
      if (!statusOut.trim()) {
        console.log(chalk.yellow('\nℹ Nothing to commit, working tree is completely clean.\n'));
        return;
      }

      const { stdout: diffOut } = await runGit(['diff'], context.baseDir);
      const diffSummary = (diffOut.slice(0, 1500) || statusOut).trim();

      console.log(chalk.cyan.bold('\n🤖 Generating conventional commit message via AI...'));

      const prompt = `[COMMIT MESSAGE GENERATOR]: Generate a single-line conventional git commit message (e.g. "feat(auth): add login validation" or "fix(ui): correct button styling") for the following git diff and changes. Output ONLY the raw commit message text on a single line, with NO quotes, NO code fences, NO markdown:
${diffSummary}`;

      const runRes = await context.runMachCode(prompt, {
        baseDir: context.baseDir,
        lightModel: context.lightModel,
        heavyModel: context.heavyModel,
        handoffWindowMs: 500,
        apiKey: context.apiKey,
        fetchImpl: context.fetchImpl,
        writeToStdout: false,
      });

      let commitMsg = runRes.raceResult.parseResult.visibleOutput.trim();
      commitMsg = commitMsg
        .replace(/^```[a-z]*\s*/i, '')
        .replace(/```$/g, '')
        .trim();
      const firstLine = commitMsg
        .split('\n')[0]
        .replace(/^["']|["']$/g, '')
        .trim();
      const finalMsg =
        firstLine.length > 5 ? firstLine : `chore: update files in ${context.baseDir}`;

      console.log(chalk.white(`Proposed commit message: `) + chalk.green.bold(`"${finalMsg}"`));

      // Stage and commit
      await runGit(['add', '-A'], context.baseDir);
      const { stdout: commitResult } = await runGit(['commit', '-m', finalMsg], context.baseDir);

      console.log(chalk.green.bold('✔ Successfully committed changes:'));
      console.log(chalk.gray(commitResult.trim()) + '\n');
    } catch (err) {
      console.log(chalk.red(`✖ Failed to execute git commit: ${String(err)}`));
    }
  },
};

export const gitCommands: SlashCommand[] = [undoCommand, diffCommand, commitCommand];
