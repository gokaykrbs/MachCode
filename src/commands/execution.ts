import chalk from 'chalk';
import { read_file } from '../tools/index.js';
import type { SlashCommand, CommandContext } from './types.js';

export const planCommand: SlashCommand = {
  name: 'plan',
  description: 'Generate an architectural plan, or switch session to Plan Mode (read-only)',
  category: 'Execution & Modes',
  usage: '/plan [prompt]',
  execute: async (args: string, context: CommandContext) => {
    if (!args || args.trim().length === 0) {
      if (context.setMode) {
        context.setMode('plan');
      } else {
        context.mode = 'plan';
      }
      console.log(
        `\n${chalk.magenta.bold('🔍 PLAN MODU Etkinleştirildi (Salt Okunur)')}\n` +
          chalk.gray(
            '  Dosya düzenleme ve komut yürütme çift katmanlı güvenlikle kilitlendi. Çıkmak için /build yazın veya Tab tuşuna basın.\n',
          ),
      );
      return;
    }

    console.log(chalk.cyan.bold('\n🧠 Generating Architectural Plan (Read-Only Mode)...\n'));

    const planPrompt = `[STRICT PLAN-ONLY MODE: Do NOT output code fences or modify files. Formulate a comprehensive, structured technical architectural blueprint in crisp Markdown detailing architecture, affected files, edge cases, and steps]:\n${args.trim()}`;

    await context.runMachCode(planPrompt, {
      baseDir: context.baseDir,
      lightModel: context.lightModel,
      heavyModel: context.heavyModel,
      handoffWindowMs: context.handoffWindowMs,
      apiKey: context.apiKey,
      fetchImpl: context.fetchImpl,
      history: context.sessionHistory,
      readOnly: true,
      writeToStdout: true,
    });
  },
};

export const modeCommand: SlashCommand = {
  name: 'mode',
  description: 'Switch between Plan (read-only) and Build (full agent) modes',
  category: 'Execution & Modes',
  usage: '/mode [plan|build|toggle]',
  aliases: ['m'],
  execute: async (args: string, context: CommandContext) => {
    const raw = args.trim().toLowerCase();
    const current = context.mode ?? 'build';

    let target: 'build' | 'plan';
    if (!raw || raw === 'status' || raw === 'info') {
      console.log(
        `\n${chalk.cyan.bold('ℹ Aktif Mod:')} ${
          current === 'plan'
            ? chalk.magenta.bold('PLAN MODU (Salt Okunur - dosya düzenleme ve komutlar kilitli)')
            : chalk.green.bold(
                'BUILD MODU (Tam Yetkili - dosya düzenleme ve komut çalıştırma etkin)',
              )
        }`,
      );
      console.log(
        chalk.gray(
          '  İpucu: /mode plan veya /mode build yazın ya da boş istemdeyken Tab tuşuna basarak mod değiştirin.\n',
        ),
      );
      return;
    }

    if (raw === 'toggle' || raw === 't') {
      target = current === 'plan' ? 'build' : 'plan';
    } else if (raw === 'plan' || raw === 'p' || raw === 'readonly' || raw === 'ro') {
      target = 'plan';
    } else if (raw === 'build' || raw === 'b' || raw === 'dev' || raw === 'agent') {
      target = 'build';
    } else {
      console.log(
        chalk.yellow(
          `Bilinmeyen mod "${args.trim()}". Geçerli seçenekler: /mode plan, /mode build, /mode toggle`,
        ),
      );
      return;
    }

    if (context.setMode) {
      context.setMode(target);
    } else {
      context.mode = target;
    }

    if (target === 'plan') {
      console.log(
        `\n${chalk.magenta.bold('🔍 Mod Değiştirildi: PLAN MODU (Salt Okunur)')}\n` +
          chalk.gray(
            '  Model yalnızca okuma araçlarını (read_file, list_directory, glob, grep) kullanabilir.\n  Dosya düzenleme ve komut yürütme çift katmanlı güvenlikle kilitlendi.\n',
          ),
      );
    } else {
      console.log(
        `\n${chalk.green.bold('🛠️  Mod Değiştirildi: BUILD MODU (Tam Yetkili Ajan)')}\n` +
          chalk.gray(
            '  Model dosya okuma, surgical edit_file, write_file ve run_command/bash çalıştırabilir.\n  Değişiklikler diff önizlemesi ve onay istemiyle korunur.\n',
          ),
      );
    }
  },
};

export const buildCommand: SlashCommand = {
  name: 'build',
  description: 'Switch session to Build Mode (enables file edits and bash execution)',
  category: 'Execution & Modes',
  usage: '/build',
  aliases: ['dev', 'write'],
  execute: async (_args: string, context: CommandContext) => {
    if (context.setMode) {
      context.setMode('build');
    } else {
      context.mode = 'build';
    }
    console.log(
      `\n${chalk.green.bold('🛠️  BUILD MODU Etkinleştirildi')}\n` +
        chalk.gray(
          '  Dosya düzenleme ve komut çalıştırma araçları aktif. Değişiklikler diff önizlemesiyle denetlenir.\n',
        ),
    );
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
      strongPool: [context.heavyModel],
      weakPool: [context.heavyModel],
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
      strongPool: [context.lightModel],
      weakPool: [context.lightModel],
      handoffWindowMs: 9999999,
      apiKey: context.apiKey,
      fetchImpl: context.fetchImpl,
      history: context.sessionHistory,
      writeToStdout: true,
    });
  },
};

export const askCommand: SlashCommand = {
  name: 'ask',
  description: 'Ask a question, explain code, or chat without modifying any workspace files',
  category: 'Execution & Modes',
  usage: '/ask <question>',
  aliases: ['chat', 'explain', 'qna'],
  execute: async (args: string, context: CommandContext) => {
    if (!args || args.trim().length === 0) {
      console.log(chalk.yellow('Usage: /ask <question or topic to explain>'));
      return;
    }

    console.log(chalk.cyan.bold('\n💬 Direct Answer Mode (Read-Only)...\n'));

    const askPrompt = `[Direct Answer Mode: Answer concisely and directly in Markdown. Do not modify files]:\n${args.trim()}`;

    await context.runMachCode(askPrompt, {
      baseDir: context.baseDir,
      lightModel: context.lightModel,
      heavyModel: context.heavyModel,
      strongPool: context.strongPool,
      weakPool: context.weakPool,
      handoffWindowMs: context.handoffWindowMs,
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

    console.log(
      chalk.magenta.bold(`\n🔍 Performing Code Review on ${relFile} (${context.heavyModel})...\n`),
    );

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

export const agentCommand: SlashCommand = {
  name: 'agent',
  description: 'Run in autonomous multi-step agent mode with tool calling across all drives',
  category: 'Execution & Modes',
  usage: '/agent <task description>',
  aliases: ['auto', 'loop'],
  execute: async (args: string, context: CommandContext) => {
    if (!args || args.trim().length === 0) {
      console.log(chalk.yellow('Usage: /agent <task description>'));
      return;
    }

    console.log(chalk.cyan.bold('\n🤖 Starting Autonomous Agent Mode...\n'));

    await context.runMachCode(args.trim(), {
      baseDir: context.baseDir,
      agentMode: true,
      writeToStdout: true,
      history: context.sessionHistory,
    });
  },
};

export const executionCommands: SlashCommand[] = [
  askCommand,
  planCommand,
  modeCommand,
  buildCommand,
  heavyCommand,
  fastCommand,
  reviewCommand,
  agentCommand,
];
