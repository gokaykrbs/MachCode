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
  description: 'Revert file modifications made by the AI (single file, specific path, or all)',
  category: 'Safety & Git',
  usage: '/undo [file|all]',
  aliases: ['revert'],
  execute: async (args: string, context: CommandContext) => {
    if (context.fileSnapshots.length === 0) {
      console.log(chalk.yellow('ℹ No AI file modifications in history to undo.'));
      return;
    }

    const trimmed = args.trim();

    // Revert all files
    if (trimmed.toLowerCase() === 'all') {
      let count = 0;
      while (context.fileSnapshots.length > 0) {
        const snap = context.fileSnapshots.pop()!;
        const targetPath = path.resolve(context.baseDir, snap.file);
        try {
          if (snap.previousContent === '__FILE_DID_NOT_EXIST__') {
            await fs.rm(targetPath, { force: true });
          } else {
            await fs.mkdir(path.dirname(targetPath), { recursive: true });
            await fs.writeFile(targetPath, snap.previousContent, 'utf-8');
          }
          count++;
        } catch (err) {
          console.error(chalk.red(`✖ Failed to revert ${snap.file}: ${String(err)}`));
        }
      }
      console.log(chalk.green.bold(`✔ Reverted all ${count} modified file(s) in session history.`));
      return;
    }

    // Revert specific file
    if (trimmed.length > 0) {
      const norm = path.normalize(trimmed).toLowerCase();
      const matchIdx = context.fileSnapshots.findIndex(
        (s) => path.normalize(s.file).toLowerCase() === norm,
      );
      if (matchIdx === -1) {
        console.log(chalk.yellow(`ℹ No modification history found for file: ${trimmed}`));
        return;
      }
      const [snap] = context.fileSnapshots.splice(matchIdx, 1);
      const targetPath = path.resolve(context.baseDir, snap.file);
      try {
        if (snap.previousContent === '__FILE_DID_NOT_EXIST__') {
          await fs.rm(targetPath, { force: true });
          console.log(
            chalk.green(`✔ Undone file creation: removed `) + chalk.white.bold(snap.file),
          );
        } else {
          await fs.mkdir(path.dirname(targetPath), { recursive: true });
          await fs.writeFile(targetPath, snap.previousContent, 'utf-8');
          console.log(
            chalk.green(`✔ Reverted `) +
              chalk.white.bold(snap.file) +
              chalk.green(` to state before last AI modification.`),
          );
        }
      } catch (err) {
        console.error(chalk.red(`✖ Failed to revert ${snap.file}: ${String(err)}`));
      }
      return;
    }

    // Revert last modified file
    const lastSnapshot = context.fileSnapshots.pop()!;
    const targetPath = path.resolve(context.baseDir, lastSnapshot.file);

    try {
      if (lastSnapshot.previousContent === '__FILE_DID_NOT_EXIST__') {
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

export const snapshotsCommand: SlashCommand = {
  name: 'snapshots',
  description: 'List in-memory file modification snapshots available to undo',
  category: 'Safety & Git',
  usage: '/snapshots',
  aliases: ['snaps', 'history'],
  execute: async (_args: string, context: CommandContext) => {
    if (context.fileSnapshots.length === 0) {
      console.log(chalk.dim('\nNo file snapshots recorded in this session yet.\n'));
      return;
    }

    console.log(chalk.cyan.bold('\n══ Recorded File Snapshots (Undo History) ══'));
    context.fileSnapshots.forEach((snap, idx) => {
      const num = `#${idx + 1}`.padStart(3, ' ');
      const timeStr = new Date(snap.timestamp).toLocaleTimeString();
      const action =
        snap.previousContent === '__FILE_DID_NOT_EXIST__'
          ? chalk.green('[created]')
          : chalk.yellow('[modified]');
      console.log(
        `  ${chalk.dim(num)} ${action} ${chalk.white.bold(snap.file)} ${chalk.dim(`(${timeStr})`)}`,
      );
    });
    console.log(
      chalk.dim('\nTip: Type /undo to revert last, or /undo <filename>, or /undo all.\n'),
    );
  },
};

export const branchCommand: SlashCommand = {
  name: 'branch',
  description: 'Display current git branch and list repository branches',
  category: 'Safety & Git',
  usage: '/branch [branch-name]',
  aliases: ['branches'],
  execute: async (args: string, context: CommandContext) => {
    const targetBranch = args.trim();
    try {
      if (targetBranch) {
        const { stdout } = await runGit(['checkout', targetBranch], context.baseDir);
        console.log(chalk.green(`✔ Switched branch: `) + stdout.trim());
      } else {
        const { stdout } = await runGit(['branch', '-a'], context.baseDir);
        console.log(chalk.cyan.bold('\nGit Branches:'));
        console.log(stdout.trim() + '\n');
      }
    } catch (err) {
      console.log(chalk.yellow(`ℹ Git branch operation failed: ${String(err)}`));
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

export const approveCommand: SlashCommand = {
  name: 'approve',
  description:
    'Toggle interactive approval before modifying files (Ask Before Write vs Auto-Approve)',
  category: 'Safety & Git',
  usage: '/approve [ask|auto]',
  aliases: ['confirm', 'permissions', 'auto-approve', 'yolo'],
  execute: async (args: string, context: CommandContext) => {
    const sub = args.trim().toLowerCase();

    if (sub === 'ask' || sub === 'on' || sub === 'confirm' || sub === 'prompt') {
      context.autoApprove = false;
      context.permissionManager?.reset();
    } else if (sub === 'auto' || sub === 'off' || sub === 'yolo' || sub === 'yes') {
      context.autoApprove = true;
    } else if (sub === 'status') {
      // Just display current status below
    } else {
      context.autoApprove = !context.autoApprove;
      if (!context.autoApprove) {
        context.permissionManager?.reset();
      }
    }

    if (context.autoApprove) {
      console.log(
        '\n' +
          chalk.yellow.bold('⚡ Approval Mode: AUTO-APPROVE ') +
          chalk.gray('(File edits will be applied automatically without prompting)') +
          '\n' +
          chalk.dim('   Tip: Type /approve ask to re-enable confirmation before writing files.\n'),
      );
    } else {
      console.log(
        '\n' +
          chalk.green.bold('🛡️  Approval Mode: ASK BEFORE WRITE ') +
          chalk.gray(
            '(MachCode will show a diff preview and ask [Y/n/a/d] before modifying any file)',
          ) +
          '\n' +
          chalk.dim('   Tip: Type /approve auto to enable automatic file writes.\n'),
      );
    }
  },
};

export const gitCommands: SlashCommand[] = [
  approveCommand,
  undoCommand,
  snapshotsCommand,
  branchCommand,
  diffCommand,
  commitCommand,
];
