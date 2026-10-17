#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import {
  DEFAULT_HANDOFF_WINDOW_MS,
  OFFICIAL_NVIDIA_SKILLS_CATALOG,
  ensureConfig,
  runMachCode,
  startRepl,
} from '../src/index.js';

const program = new Command();

program
  .name('mach')
  .description(
    'MachCode: Zero-hallucination, high-speed AI code editor CLI powered by Streaming Handoff Racing on NVIDIA NIM.',
  )
  .version('0.1.0')
  .option('-f, --file <path>', 'Target file path to read and overwrite')
  .option('-l, --light-model <model>', 'Lightweight fast NIM model')
  .option('-m, --heavy-model <model>', 'Heavyweight deep coding NIM model')
  .option(
    '-w, --window <ms>',
    'Streaming handoff window in milliseconds',
    String(DEFAULT_HANDOFF_WINDOW_MS),
  )
  .argument('[prompt...]', 'Optional coding instruction to launch in interactive REPL session')
  .action(
    async (
      promptParts: string[],
      options: {
        file?: string;
        lightModel?: string;
        heavyModel?: string;
        window: string;
      },
    ) => {
      const initialPrompt =
        promptParts && promptParts.length > 0 ? promptParts.join(' ').trim() : undefined;
      const handoffWindowMs = Number.parseInt(options.window, 10) || DEFAULT_HANDOFF_WINDOW_MS;

      await startRepl({
        initialPrompt,
        targetFilePath: options.file,
        lightModel: options.lightModel,
        heavyModel: options.heavyModel,
        handoffWindowMs,
      });
    },
  );

program
  .command('hello')
  .description('Verify MachCode installation and configuration')
  .action(async () => {
    await ensureConfig();
    console.log(chalk.green.bold('MachCode is ready!'));
  });

program
  .command('skills')
  .description('List integrated official NVIDIA Agent Skills')
  .action(() => {
    console.log(
      chalk.cyan.bold(
        '\nIntegrated NVIDIA Verified Agent Skills (https://github.com/NVIDIA/skills):\n',
      ),
    );
    for (const skill of OFFICIAL_NVIDIA_SKILLS_CATALOG) {
      console.log(
        `  ${chalk.green.bold('•')} ${chalk.white.bold(skill.name)} ${chalk.gray(`(${skill.product})`)}\n    ${chalk.dim(skill.description)}`,
      );
    }
    console.log('');
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(chalk.red.bold(`\n✖ Fatal error: ${message}`));
  process.exit(1);
});
