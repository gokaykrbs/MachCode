import chalk from 'chalk';
import { getActiveTheme } from '../ui/theme.js';
import { getAllSubagents, getSubagent } from '../subagents/registry.js';
import type { SlashCommand, CommandContext } from './types.js';

export const agentCommand: SlashCommand = {
  name: 'agent',
  description: 'View or switch specialized NVIDIA NIM subagents (@architect, @coder, etc.)',
  category: 'Subagents',
  usage: '/agent [subagent-name|reset|list]',
  aliases: ['agents', 'subagent', 'subagents'],
  execute: async (args: string, context: CommandContext) => {
    const raw = args.trim().toLowerCase();
    const theme = getActiveTheme();

    if (!raw || raw === 'list') {
      console.log(
        theme.primary('\n══════════════════════════════════════════════════════════════════'),
      );
      console.log(theme.primary('             NVIDIA NIM EXCLUSIVE SUBAGENTS'));
      console.log(
        theme.primary('══════════════════════════════════════════════════════════════════\n'),
      );

      if (context.activeSubagent) {
        console.log(
          `  ${chalk.green.bold('Active Subagent:')} ${chalk.white.bold(context.activeSubagent.name)} (${chalk.cyan(context.activeSubagent.mention)})`,
        );
        console.log(`  ${chalk.dim(context.activeSubagent.description)}\n`);
      } else {
        console.log(
          `  ${chalk.yellow.bold('Active Subagent:')} ${chalk.white.bold('Default Coordinator')} ${chalk.dim('(General Parallel Multi-Model Agent)')}\n`,
        );
      }

      const all = getAllSubagents();
      for (const a of all) {
        const isActive = context.activeSubagent?.id === a.id;
        const prefix = isActive ? chalk.green('★ ') : chalk.gray('• ');
        const mention = chalk.cyan.bold(a.mention.padEnd(12));
        const modeBadge =
          a.defaultMode === 'plan' ? chalk.magenta('[PLAN]') : chalk.blue('[BUILD]');

        console.log(`  ${prefix}${mention} ${modeBadge} ${chalk.white.bold(a.name)}`);
        console.log(`    ${chalk.dim(a.description)}`);
        console.log(
          `    ${chalk.gray('Preferred NIM Models:')} ${chalk.yellow(a.preferredModelPatterns.slice(0, 3).join(', '))}\n`,
        );
      }

      console.log(
        chalk.dim(
          'Tip: Use @<name> in your prompt (e.g. "@architect how should we structure the DB?")\n' +
            '     Or type /agent <name> to activate a subagent permanently for this session.\n' +
            '     Type /agent reset to return to the default coordinator.\n',
        ),
      );
      return;
    }

    if (raw === 'reset' || raw === 'clear' || raw === 'default') {
      if (context.setActiveSubagent) {
        context.setActiveSubagent(undefined);
      }
      context.activeSubagent = undefined;
      console.log(
        `\n${theme.success('✔ Subagent Unpinned.')} Returned to Default Coordinator mode.\n`,
      );
      return;
    }

    const subagent = getSubagent(raw);
    if (!subagent) {
      console.log(
        chalk.red(
          `\n✖ Unknown subagent: "${raw}". Available subagents: architect, coder, tester, reviewer, nvidia.\n`,
        ),
      );
      return;
    }

    if (context.setActiveSubagent) {
      context.setActiveSubagent(subagent);
    }
    context.activeSubagent = subagent;

    if (subagent.defaultMode && context.setMode) {
      context.setMode(subagent.defaultMode);
    }

    console.log(
      `\n${theme.success('✔ Active Subagent Switched:')} ${chalk.white.bold(subagent.name)} (${chalk.cyan(subagent.mention)})\n` +
        `  ${chalk.dim(subagent.description)}\n` +
        `  Mode: ${subagent.defaultMode ? chalk.cyan(subagent.defaultMode.toUpperCase()) : 'BUILD'}\n` +
        chalk.dim('Type /agent reset to return to default coordinator anytime.\n'),
    );
  },
};
