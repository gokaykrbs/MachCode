import chalk from 'chalk';
import {
  saveSession,
  loadSession,
  listSessions,
  type SessionData,
} from '../engine/sessionManager.js';
import { getActiveTheme } from '../ui/theme.js';
import type { SlashCommand, CommandContext } from './types.js';

export const saveCommand: SlashCommand = {
  name: 'save',
  description: 'Save current session snapshot to disk for later resumption',
  category: 'Context & Memory',
  usage: '/save [name]',
  aliases: ['snapshot'],
  execute: async (args: string, context: CommandContext) => {
    const sessionName = args.trim() || undefined;
    const sessionId = context.sessionId || `mc_${Date.now().toString(36)}`;

    const sessionData: SessionData = {
      sessionId,
      name: sessionName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      workspaceDir: context.baseDir,
      mode: context.mode ?? 'build',
      history: context.sessionHistory,
      addedFiles: Array.from(context.addedContextFiles),
      tokenStats: context.tokenStats,
      snapshots: context.fileSnapshots,
    };

    const savedPath = await saveSession(sessionData);
    const theme = getActiveTheme();

    console.log(
      `\n${theme.success('✔ Session saved successfully!')}\n` +
        `  Session ID: ${chalk.white.bold(sessionId)}${sessionName ? ` (${sessionName})` : ''}\n` +
        `  Turns:      ${chalk.yellow(Math.floor(context.sessionHistory.length / 2))}\n` +
        `  Path:       ${chalk.dim(savedPath)}\n` +
        `  Resume:     ${chalk.cyan.bold(`/resume ${sessionId}`)} or ${chalk.cyan.bold(`mach --resume ${sessionId}`)}\n`,
    );
  },
};

export const sessionsCommand: SlashCommand = {
  name: 'sessions',
  description: 'List all recorded session snapshots across this workspace',
  category: 'Context & Memory',
  usage: '/sessions',
  aliases: ['history-list'],
  execute: async (_args: string, context: CommandContext) => {
    const theme = getActiveTheme();
    const sessions = await listSessions(context.baseDir);

    console.log(
      theme.primary('\n══════════════════════════════════════════════════════════════════'),
    );
    console.log(theme.primary('                     RECORDED SESSIONS'));
    console.log(
      theme.primary('══════════════════════════════════════════════════════════════════\n'),
    );

    if (sessions.length === 0) {
      console.log(chalk.gray('  No previous sessions found for this workspace.'));
      console.log(chalk.dim('  Type /save [name] to record a session snapshot anytime.\n'));
      return;
    }

    for (const s of sessions) {
      const isCurrent = s.sessionId === context.sessionId;
      const marker = isCurrent ? chalk.green.bold('▶ CURRENT ') : chalk.gray('•         ');
      const namePart = s.name ? chalk.yellow.bold(`"${s.name}" `) : '';
      const datePart = new Date(s.updatedAt).toLocaleString();
      const tokenPart = `${s.totalTokens.toLocaleString()} tokens`;
      const turnPart = `${s.turnCount} turns`;

      console.log(
        `  ${marker} ${chalk.white.bold(s.sessionId.padEnd(16))} ${namePart}${chalk.dim(`(${turnPart}, ${tokenPart})`)}`,
      );
      console.log(`              ${chalk.dim(`Saved: ${datePart} • Mode: ${s.mode}`)}`);
    }

    console.log(
      chalk.dim(
        '\nTip: Type /resume <sessionId> or /resume latest to restore conversation history.\n',
      ),
    );
  },
};

export const resumeCommand: SlashCommand = {
  name: 'resume',
  description: 'Resume a past session and restore conversation history, context & tokens',
  category: 'Context & Memory',
  usage: '/resume [sessionId|latest]',
  aliases: ['restore', 'load'],
  execute: async (args: string, context: CommandContext) => {
    const target = args.trim() || 'latest';
    const theme = getActiveTheme();

    const loaded = await loadSession(target, context.baseDir);
    if (!loaded) {
      console.log(
        chalk.red(
          `\n✖ Could not find session "${target}". Type /sessions to view available sessions.\n`,
        ),
      );
      return;
    }

    // Restore state into active commandContext
    context.sessionId = loaded.sessionId;
    context.sessionHistory.length = 0;
    context.sessionHistory.push(...loaded.history);

    context.addedContextFiles.clear();
    for (const f of loaded.addedFiles || []) {
      context.addedContextFiles.add(f);
    }

    context.tokenStats.estimatedPromptTokens = loaded.tokenStats?.estimatedPromptTokens ?? 0;
    context.tokenStats.estimatedCompletionTokens =
      loaded.tokenStats?.estimatedCompletionTokens ?? 0;
    context.tokenStats.totalTurns = loaded.tokenStats?.totalTurns ?? 0;

    if (loaded.mode) {
      if (context.setMode) context.setMode(loaded.mode);
      else context.mode = loaded.mode;
    }

    console.log(
      `\n${theme.success('✔ Session Resumed Successfully!')}\n` +
        `  Session ID:  ${chalk.white.bold(loaded.sessionId)}${loaded.name ? ` (${loaded.name})` : ''}\n` +
        `  Turns:       ${chalk.yellow(Math.floor(loaded.history.length / 2))}\n` +
        `  Files Added: ${chalk.cyan(loaded.addedFiles?.length ?? 0)}\n` +
        `  Tokens:      ${chalk.dim((context.tokenStats.estimatedPromptTokens + context.tokenStats.estimatedCompletionTokens).toLocaleString())}\n`,
    );
  },
};
