import { exec } from 'node:child_process';
import chalk from 'chalk';
import { promptForApiKey, saveConfig, getConfigPath, loadConfig } from '../config/index.js';
import { printReplBanner } from '../index.js';
import type { SlashCommand, CommandContext } from './types.js';

export const helpCommand: SlashCommand = {
  name: 'help',
  description: 'Print a beautifully formatted table of all slash commands',
  category: 'System',
  usage: '/help',
  aliases: ['h', 'commands'],
  execute: async (_args: string, context: CommandContext) => {
    console.log(
      chalk.cyan.bold('\n══════════════════════════════════════════════════════════════════'),
    );
    console.log(chalk.cyan.bold('                MACHCODE SLASH COMMAND SYSTEM'));
    console.log(
      chalk.cyan.bold('══════════════════════════════════════════════════════════════════\n'),
    );

    // We can import or access all commands dynamically
    const { allCommands } = await import('./index.js');

    const grouped: Record<string, SlashCommand[]> = {};
    for (const cmd of allCommands) {
      if (!grouped[cmd.category]) {
        grouped[cmd.category] = [];
      }
      grouped[cmd.category].push(cmd);
    }

    const categories = ['Context & Memory', 'Execution & Modes', 'Safety & Git', 'System'];

    for (const cat of categories) {
      const cmds = grouped[cat] ?? [];
      console.log(chalk.yellow.bold(`▶ ${cat}:`));
      for (const c of cmds) {
        const cmdName = chalk.green.bold(`/${c.name}`.padEnd(16));
        const usage = c.usage ? chalk.dim(`[${c.usage}]`.padEnd(22)) : ''.padEnd(22);
        const aliases =
          c.aliases && c.aliases.length > 0
            ? chalk.gray(` (aliases: ${c.aliases.map((a) => `/${a}`).join(', ')})`)
            : '';
        console.log(`  ${cmdName} ${usage} ${chalk.white(c.description)}${aliases}`);
      }
      console.log('');
    }
    console.log(chalk.dim('Tip: Any input NOT starting with "/" is treated as a coding prompt.\n'));
  },
};

export const tokensCommand: SlashCommand = {
  name: 'tokens',
  description: 'Show session token usage statistics',
  category: 'System',
  usage: '/tokens',
  aliases: ['stats', 'usage'],
  execute: async (_args: string, context: CommandContext) => {
    const promptTokens = context.tokenStats.estimatedPromptTokens;
    const completionTokens = context.tokenStats.estimatedCompletionTokens;
    const total = promptTokens + completionTokens;

    console.log(chalk.cyan.bold('\n📊 Session Token Usage Statistics:'));
    console.log(`  Total Turns:             ${chalk.white(context.tokenStats.totalTurns)}`);
    console.log(`  Estimated Prompt Tokens:  ${chalk.yellow(promptTokens.toLocaleString())}`);
    console.log(`  Estimated Output Tokens:  ${chalk.yellow(completionTokens.toLocaleString())}`);
    console.log(`  Combined Token Footprint: ${chalk.green.bold(total.toLocaleString())} tokens`);
    console.log(`  Retained Messages:        ${chalk.white(context.sessionHistory.length)}`);
    console.log(`  Active Context Files:     ${chalk.white(context.addedContextFiles.size)}\n`);
  },
};

export const runCommand: SlashCommand = {
  name: 'run',
  description: 'Execute a shell command directly in the current workspace',
  category: 'System',
  usage: '/run <shell-command>',
  aliases: ['sh', 'exec'],
  execute: async (args: string, context: CommandContext) => {
    if (!args || args.trim().length === 0) {
      console.log(chalk.yellow('Usage: /run <shell command> (e.g. /run npm test)'));
      return;
    }

    const commandStr = args.trim();
    console.log(chalk.dim(`$ ${commandStr}\n`));

    return new Promise<void>((resolve) => {
      const child = exec(commandStr, { cwd: context.baseDir });

      child.stdout?.on('data', (data) => {
        process.stdout.write(data);
      });

      child.stderr?.on('data', (data) => {
        process.stderr.write(data);
      });

      child.on('close', (code) => {
        if (code === 0) {
          console.log(chalk.green(`\n✔ Command completed (exit code 0).\n`));
        } else {
          console.log(chalk.red(`\n✖ Command failed with exit code ${code}.\n`));
        }
        resolve();
      });

      child.on('error', (err) => {
        console.error(chalk.red(`\n✖ Command execution failed: ${err.message}\n`));
        resolve();
      });
    });
  },
};

export const configCommand: SlashCommand = {
  name: 'config',
  description: 'View or refresh autonomous model routing & API key',
  category: 'System',
  usage: '/config [refresh|key]',
  aliases: ['setup', 'apikey', 'models', 'router'],
  execute: async (args: string, context: CommandContext) => {
    const configPath = getConfigPath();
    const existing = await loadConfig();

    console.log(chalk.cyan.bold('\n⚙ MachCode Autonomous Configuration:'));
    console.log(`  Config File: ${chalk.gray(configPath)}`);
    console.log(
      `  API Key:     ${
        existing?.nvidiaApiKey
          ? chalk.green(
              `Configured (${existing.nvidiaApiKey.slice(0, 10)}...${existing.nvidiaApiKey.slice(-4)})`,
            )
          : chalk.red('Missing')
      }`,
    );
    console.log(
      `  Fast Model:  ${chalk.magenta(existing?.lightModel || context.lightModel || 'Auto-routing...')}`,
    );
    console.log(
      `  Smart Model: ${chalk.magenta(existing?.heavyModel || context.heavyModel || 'Auto-routing...')}\n`,
    );

    const sub = (args || '').trim().toLowerCase();
    if (sub === 'refresh' || sub === 'models') {
      const apiKey = existing?.nvidiaApiKey ?? context.apiKey;
      if (!apiKey) {
        console.log(chalk.red('Cannot refresh: NVIDIA_API_KEY is not set.\n'));
        return;
      }
      console.log(chalk.cyan('Running AutoRouter scan on NVIDIA NIM active models...'));
      const { autoAssignAndSaveModels } = await import('../config/index.js');
      const updated = await autoAssignAndSaveModels(apiKey, undefined, context.fetchImpl);
      context.lightModel = updated.lightModel;
      context.heavyModel = updated.heavyModel;
      console.log(
        chalk.green.bold('✔ AutoRouter updated models:') +
          chalk.white(`\n  ⚡ Fast:  ${updated.lightModel}\n  🧠 Smart: ${updated.heavyModel}\n`),
      );
      return;
    }

    if (sub === 'key' || sub === 'apikey') {
      const newKey = await promptForApiKey();
      const { autoAssignAndSaveModels } = await import('../config/index.js');
      const updated = await autoAssignAndSaveModels(newKey, undefined, context.fetchImpl);
      context.apiKey = newKey;
      context.lightModel = updated.lightModel;
      context.heavyModel = updated.heavyModel;
      console.log(chalk.green.bold('✔ API Key & AutoRouter models successfully updated!\n'));
      return;
    }

    console.log(
      chalk.dim('Tip: Use ') +
        chalk.yellow('/config refresh') +
        chalk.dim(' to re-scan active NIM models, or ') +
        chalk.yellow('/config key') +
        chalk.dim(' to update your API key.\n'),
    );
  },
};

export const clearCommand: SlashCommand = {
  name: 'clear',
  description: 'Clear the terminal screen',
  category: 'System',
  usage: '/clear',
  aliases: ['cls'],
  execute: async (_args: string, context: CommandContext) => {
    console.clear();
    printReplBanner({
      cwd: context.baseDir,
      sessionId: context.sessionId,
      lightModel: context.lightModel,
      heavyModel: context.heavyModel,
    });
  },
};

export const exitCommand: SlashCommand = {
  name: 'exit',
  description: 'Gracefully close and exit the MachCode CLI',
  category: 'System',
  usage: '/exit',
  aliases: ['quit', 'q', ':q'],
  execute: async (_args: string, context: CommandContext) => {
    context.shouldExit = true;
    console.log(chalk.yellow('\n👋 Goodbye! Happy coding.\n'));
    context.rl.close();
  },
};

export const systemCommands: SlashCommand[] = [
  helpCommand,
  tokensCommand,
  runCommand,
  configCommand,
  clearCommand,
  exitCommand,
];
