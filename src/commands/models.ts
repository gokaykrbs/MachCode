import chalk from 'chalk';
import { getActiveTheme } from '../ui/theme.js';
import type { SlashCommand, CommandContext } from './types.js';

export const modelCommand: SlashCommand = {
  name: 'model',
  description: 'View active model racing pools, or pin queries to a specific model',
  category: 'System',
  usage: '/model [model-id|reset]',
  aliases: ['models', 'llm'],
  execute: async (args: string, context: CommandContext) => {
    const raw = args.trim();
    const theme = getActiveTheme();

    if (!raw) {
      console.log(theme.primary('\n══════════════════════════════════════════════════════════════════'));
      console.log(theme.primary('               ACTIVE NVIDIA NIM MODEL RACING POOL'));
      console.log(theme.primary('══════════════════════════════════════════════════════════════════\n'));

      if (context.pinnedModel) {
        console.log(
          `  ${chalk.yellow.bold('📌 Pinned Focus Model:')} ${chalk.white.bold(context.pinnedModel)} ${chalk.dim('(Parallel racing disabled)')}\n`,
        );
      } else {
        console.log(
          `  ${chalk.green.bold('🏁 Parallel Racing Mode:')} ${chalk.white.bold('ACTIVE')} ${chalk.dim('(All models race concurrently, fastest wins)')}\n`,
        );
      }

      console.log(`  ${chalk.bold('Fast Lightweight Model:')} ${chalk.yellow(context.lightModel)}`);
      console.log(`  ${chalk.bold('Smart Heavyweight Model:')} ${chalk.yellow(context.heavyModel)}\n`);

      const strongPool = context.strongPool ?? [];
      const weakPool = context.weakPool ?? [];

      console.log(chalk.cyan.bold(`▶ StrongPool (${strongPool.length} Generative Models):`));
      for (const m of strongPool.slice(0, 15)) {
        const isCurrent = m === context.heavyModel || m === context.pinnedModel;
        const marker = isCurrent ? chalk.green('★ ') : chalk.gray('• ');
        console.log(`  ${marker}${chalk.white(m)}`);
      }
      if (strongPool.length > 15) {
        console.log(chalk.dim(`  ... and ${strongPool.length - 15} more frontier models in parallel race`));
      }

      if (weakPool.length > 0) {
        console.log(chalk.cyan.bold(`\n▶ WeakPool Fallback (${weakPool.length} Models):`));
        for (const m of weakPool.slice(0, 8)) {
          console.log(`  ${chalk.gray('• ')}${chalk.dim(m)}`);
        }
      }

      console.log(
        chalk.dim('\nTip: To pin a specific model, type /model <model-id>. To resume full racing, type /model reset.\n'),
      );
      return;
    }

    if (raw.toLowerCase() === 'reset' || raw.toLowerCase() === 'auto' || raw.toLowerCase() === 'race') {
      if (context.setPinnedModel) {
        context.setPinnedModel(undefined);
      }
      context.pinnedModel = undefined;
      console.log(
        `\n${theme.success('✔ Resumed Full Parallel Multi-Model Racing!')} All models in StrongPool will race concurrently.\n`,
      );
      return;
    }

    // Find closest match or exact match in pool
    const allKnown = [...(context.strongPool ?? []), ...(context.weakPool ?? [])];
    const directMatch = allKnown.find(
      (m) => m.toLowerCase() === raw.toLowerCase() || m.toLowerCase().includes(raw.toLowerCase()),
    );

    const chosenModel = directMatch ?? raw;
    if (context.setPinnedModel) {
      context.setPinnedModel(chosenModel);
    }
    context.pinnedModel = chosenModel;

    console.log(
      `\n${theme.success('✔ Model Pinned:')} Queries will now route directly to ${chalk.white.bold(chosenModel)}.\n` +
        chalk.dim('Type /model reset to re-enable parallel multi-model racing anytime.\n'),
    );
  },
};
