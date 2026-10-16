import chalk from 'chalk';
import { read_file } from '../tools/index.js';
import type { SlashCommand, CommandContext } from './types.js';

export const planCommand: SlashCommand = {
  name: 'plan',
  description: 'Generate an implementation plan only without modifying files',
  category: 'Execution & Modes',
  usage: '/plan <prompt>',
  execute: async (args: string, context: CommandContext) => {
    if (!args || args.trim().length === 0) {
      console.log(chalk.yellow('Usage: /plan <what you want to build or refactor>'));
      return;
    }

    console.log(chalk.cyan.bold('\n🧠 Generating Architectural Plan (Read-Only Mode)...\n'));

    const planPrompt = `[STRICT PLAN-ONLY MODE: Do NOT output code fences or modify files. Formulate a comprehensive technical plan inside <plan>...</plan> detailing architecture, affected files, edge cases, and steps]:\n${args.trim()}`;

    await context.runMachCode(planPrompt, {
      baseDir: context.baseDir,
      lightModel: context.lightModel,
      heavyModel: context.heavyModel,
      handoffWindowMs: context.handoffWindowMs,
      apiKey: context.apiKey,
      fetchImpl: context.fetchImpl,
      history: context.sessionHistory,
      writeToStdout: true,
    });
  },
};

export const heavyCommand: SlashCommand = {
  name: 'heavy',
  description: 'Bypass racing and execute using only the Heavyweight model',
  category: 'Execution & Modes',
  usage: '/heavy <prompt>',
  aliases: ['deep', 'hw'],
  execute: async (args: string, context: CommandContext) => {
    if (!args || args.trim().length === 0) {
      console.log(chalk.yellow('Usage: /heavy <coding prompt>'));
      return;
    }

    console.log(chalk.magenta.bold(`\n🔥 Direct Heavyweight Mode: ${context.heavyModel}\n`));

    await context.runMachCode(args.trim(), {
      baseDir: context.baseDir,
      lightModel: context.heavyModel,
      heavyModel: context.heavyModel,
      handoffWindowMs: 0,
      apiKey: context.apiKey,
      fetchImpl: context.fetchImpl,
      history: context.sessionHistory,
      writeToStdout: true,
    });
  },
};

export const fastCommand: SlashCommand = {
  name: 'fast',
  description: 'Bypass racing and execute using only the Lightweight model',
  category: 'Execution & Modes',
  usage: '/fast <prompt>',
  aliases: ['light', 'quick'],
  execute: async (args: string, context: CommandContext) => {
    if (!args || args.trim().length === 0) {
      console.log(chalk.yellow('Usage: /fast <coding prompt>'));
      return;
    }

    console.log(chalk.blue.bold(`\n⚡ Direct Fast Mode: ${context.lightModel}\n`));

    await context.runMachCode(args.trim(), {
      baseDir: context.baseDir,
      lightModel: context.lightModel,
      heavyModel: context.lightModel,
      handoffWindowMs: 9999999,
      apiKey: context.apiKey,
      fetchImpl: context.fetchImpl,
      history: context.sessionHistory,
      writeToStdout: true,
    });
  },
};

export const reviewCommand: SlashCommand = {
  name: 'review',
  description: 'Run an in-depth code review on a file without applying changes',
  category: 'Execution & Modes',
  usage: '/review <file>',
  aliases: ['audit', 'inspect'],
  execute: async (args: string, context: CommandContext) => {
    if (!args || args.trim().length === 0) {
      console.log(chalk.yellow('Usage: /review <target-file-path>'));
      return;
    }

    const relFile = args.trim();
    let fileContent = '';
    try {
      fileContent = await read_file(relFile, context.baseDir);
    } catch {
      console.log(chalk.red(`✖ Unable to read target file: ${relFile}`));
      return;
    }

    console.log(chalk.magenta.bold(`\n🔍 Performing Code Review on ${relFile} (${context.heavyModel})...\n`));

    const reviewPrompt = `[CODE REVIEW MODE: Review the following file thoroughly. Evaluate architecture, security vulnerabilities, edge-case bugs, performance bottlenecks, and clarity. Do NOT output code fences to overwrite the file; output a structured markdown review]:
File: \`${relFile}\`
\`\`\`
${fileContent}
\`\`\``;

    await context.runMachCode(reviewPrompt, {
      baseDir: context.baseDir,
      lightModel: context.heavyModel,
      heavyModel: context.heavyModel,
      handoffWindowMs: 0,
      apiKey: context.apiKey,
      fetchImpl: context.fetchImpl,
      history: context.sessionHistory,
      writeToStdout: true,
    });
  },
};

export const executionCommands: SlashCommand[] = [
  planCommand,
  heavyCommand,
  fastCommand,
  reviewCommand,
];
