import { printStatusCard, renderStatusBar, getGitBranch } from '../ui/statusBar.js';
import { getActiveTheme } from '../ui/theme.js';
import type { SlashCommand, CommandContext } from './types.js';

export const statusCommand: SlashCommand = {
  name: 'status',
  description: 'Display interactive session diagnostics and status bar',
  category: 'System',
  usage: '/status',
  aliases: ['sb', 'bar'],
  execute: async (_args: string, context: CommandContext) => {
    const totalTokens =
      context.tokenStats.estimatedPromptTokens + context.tokenStats.estimatedCompletionTokens;
    const branch = getGitBranch(context.baseDir);

    printStatusCard({
      mode: context.mode ?? 'build',
      baseDir: context.baseDir,
      strongPoolCount: context.strongPool?.length,
      activeModel: context.pinnedModel ?? context.heavyModel,
      isPinned: Boolean(context.pinnedModel),
      gitBranch: branch ?? undefined,
      totalTokens,
      autoApprove: context.autoApprove,
      themeName: getActiveTheme().name,
      sessionId: context.sessionId,
      subagentName: context.activeSubagent?.id,
    });

    const singleLine = renderStatusBar({
      mode: context.mode ?? 'build',
      baseDir: context.baseDir,
      strongPoolCount: context.strongPool?.length,
      activeModel: context.pinnedModel ?? context.heavyModel,
      isPinned: Boolean(context.pinnedModel),
      gitBranch: branch ?? undefined,
      totalTokens,
      autoApprove: context.autoApprove,
      themeName: getActiveTheme().name,
      sessionId: context.sessionId,
      subagentName: context.activeSubagent?.id,
    });

    console.log(`Live Status Bar Preview:\n  ${singleLine}\n`);
  },
};
