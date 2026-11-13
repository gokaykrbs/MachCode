import chalk from 'chalk';
import { getActiveTheme } from '../ui/theme.js';
import { loadConfig } from '../config/index.js';
import type { SlashCommand, CommandContext } from './types.js';

export const modelCommand: SlashCommand = {
  name: 'model',
  description:
    'View active model racing pools, pin queries to a model, or sync live with NVIDIA Build API',
  category: 'System',
  usage: '/model [model-id|reset|refresh]',
  aliases: ['models', 'llm'],
  execute: async (args: string, context: CommandContext) => {
    const raw = args.trim();
    const theme = getActiveTheme();

    if (!raw) {
      const existing = await loadConfig();
      console.log(
        theme.primary('\n══════════════════════════════════════════════════════════════════'),
      );
      console.log(theme.primary('               ACTIVE NVIDIA NIM MODEL RACING POOL'));
      console.log(
        theme.primary('══════════════════════════════════════════════════════════════════\n'),
      );

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
      console.log(
        `  ${chalk.bold('Smart Heavyweight Model:')} ${chalk.yellow(context.heavyModel)}`,
      );

      if (existing?.updatedAt) {
        const syncDate = new Date(existing.updatedAt).toLocaleString();
        console.log(`  ${chalk.bold('Live NIM Catalog Sync:')} ${chalk.cyan(syncDate)}`);
      }
      console.log('');

      const strongPool = context.strongPool ?? [];
      const weakPool = context.weakPool ?? [];

      console.log(chalk.cyan.bold(`▶ StrongPool (${strongPool.length} Generative Models):`));
      for (const m of strongPool.slice(0, 15)) {
        const isCurrent = m === context.heavyModel || m === context.pinnedModel;
        const marker = isCurrent ? chalk.green('★ ') : chalk.gray('• ');
        console.log(`  ${marker}${chalk.white(m)}`);
      }
      if (strongPool.length > 15) {
        console.log(
          chalk.dim(`  ... and ${strongPool.length - 15} more frontier models in parallel race`),
        );
      }

      if (weakPool.length > 0) {
        console.log(chalk.cyan.bold(`\n▶ WeakPool Fallback (${weakPool.length} Models):`));
        for (const m of weakPool.slice(0, 8)) {
          console.log(`  ${chalk.gray('• ')}${chalk.dim(m)}`);
        }
      }

      console.log(
        chalk.dim(
          '\nTips:' +
            '\n  • To pin a specific model:     /model <model-id>' +
            '\n  • To resume full racing:        /model reset' +
            '\n  • To sync live with NVIDIA:     /model refresh\n',
        ),
      );
      return;
    }

    const sub = raw.toLowerCase();
    if (sub === 'refresh' || sub === 'sync') {
      const existing = await loadConfig();
      const apiKey = context.apiKey ?? existing?.nvidiaApiKey;
      if (!apiKey) {
        console.log(chalk.red('\n✖ Cannot refresh: NVIDIA_API_KEY is not configured.\n'));
        return;
      }

      console.log(
        chalk.cyan(
          '\n🔄 Connecting to NVIDIA Build API (https://integrate.api.nvidia.com/v1/models)...',
        ),
      );
      try {
        const { autoAssignAndSaveModels } = await import('../config/index.js');
        const updated = await autoAssignAndSaveModels(apiKey, undefined, context.fetchImpl);
        context.lightModel = updated.lightModel;
        context.heavyModel = updated.heavyModel;
        context.strongPool = updated.strongPool;
        context.weakPool = updated.weakPool;

        const totalDiscovered = (updated.strongPool?.length ?? 0) + (updated.weakPool?.length ?? 0);
        console.log(
          theme.success(
            `\n✔ NVIDIA Build API Sync Complete! (${totalDiscovered} active models discovered for your API key)`,
          ),
        );
        console.log(
          `  ${chalk.bold('Fast Lightweight Model:')} ${chalk.yellow(updated.lightModel)}`,
        );
        console.log(
          `  ${chalk.bold('Smart Heavyweight Model:')} ${chalk.yellow(updated.heavyModel)}`,
        );
        console.log(
          `  ${chalk.cyan('StrongPool:')} ${chalk.white(updated.strongPool?.length ?? 0)} models ready for parallel racing.\n`,
        );
      } catch (err) {
        console.log(
          chalk.red(
            `\n✖ Failed to sync models from NVIDIA Build API: ${err instanceof Error ? err.message : String(err)}\n`,
          ),
        );
      }
      return;
    }

    if (
      raw.toLowerCase() === 'reset' ||
      raw.toLowerCase() === 'auto' ||
      raw.toLowerCase() === 'race'
    ) {
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
