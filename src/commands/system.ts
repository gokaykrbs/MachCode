import { exec } from 'node:child_process';
import chalk from 'chalk';
import { promptForApiKey, getConfigPath, loadConfig } from '../config/index.js';
import { printReplBanner } from '../index.js';
import type { SlashCommand, CommandContext } from './types.js';

export const helpCommand: SlashCommand = {
  name: 'help',
  description: 'Print a beautifully formatted table of all slash commands',
  category: 'System',
  usage: '/help',
  aliases: ['h', 'commands'],
  execute: async (_args: string, _context: CommandContext) => {
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
  description: 'View or refresh autonomous multi-model racing pools & API key',
  category: 'System',
  usage: '/config [refresh|key]',
  aliases: ['setup', 'apikey', 'models', 'router'],
  execute: async (args: string, context: CommandContext) => {
    const configPath = getConfigPath();
    const existing = await loadConfig();
    const strongPool = context.strongPool ?? existing?.strongPool ?? [context.heavyModel];
    const weakPool = context.weakPool ?? existing?.weakPool ?? [context.lightModel];

    console.log(chalk.cyan.bold('\n⚙ MachCode Autonomous Multi-Model Configuration:'));
    console.log(`  Config File:  ${chalk.gray(configPath)}`);
    console.log(
      `  API Key:      ${
        existing?.nvidiaApiKey
          ? chalk.green(
              `Configured (${existing.nvidiaApiKey.slice(0, 10)}...${existing.nvidiaApiKey.slice(-4)})`,
            )
          : chalk.red('Missing')
      }`,
    );
    console.log(
      `  Strong Pool:  ${chalk.magenta.bold(`${strongPool.length} models racing in parallel`)}`,
    );
    for (const m of strongPool) {
      console.log(`                ${chalk.magenta('•')} ${chalk.white(m)}`);
    }
    console.log(`  Weak Pool:    ${chalk.blue.bold(`${weakPool.length} fast fallback models`)}`);
    for (const m of weakPool) {
      console.log(`                ${chalk.blue('•')} ${chalk.gray(m)}`);
    }
    console.log('');

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
      context.strongPool = updated.strongPool;
      context.weakPool = updated.weakPool;
      console.log(
        chalk.green.bold('✔ AutoRouter updated multi-model racing pools:') +
          chalk.white(
            `\n  🏎️  Strong Pool (${updated.strongPool?.length ?? 1}): ${(updated.strongPool ?? [updated.heavyModel]).join(', ')}\n  ⚡ Weak Pool   (${updated.weakPool?.length ?? 1}): ${(updated.weakPool ?? [updated.lightModel]).join(', ')}\n`,
          ),
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
      context.strongPool = updated.strongPool;
      context.weakPool = updated.weakPool;
      console.log(chalk.green.bold('✔ API Key & AutoRouter model pools successfully updated!\n'));
      return;
    }

    console.log(
      chalk.dim('Tip: Use ') +
        chalk.yellow('/config refresh') +
        chalk.dim(' to re-scan active NIM models, ') +
        chalk.yellow('/race') +
        chalk.dim(' to live-benchmark all models, or ') +
        chalk.yellow('/config key') +
        chalk.dim(' to update your API key.\n'),
    );
  },
};

export const raceCommand: SlashCommand = {
  name: 'race',
  description: 'Run a live parallel speed benchmark across all AI models in the racing pool',
  category: 'System',
  usage: '/race',
  aliases: ['benchmark', 'ping'],
  execute: async (_args: string, context: CommandContext) => {
    const existing = await loadConfig();
    const apiKey = context.apiKey ?? existing?.nvidiaApiKey;
    if (!apiKey) {
      console.log(chalk.red('\n✖ NVIDIA_API_KEY is not configured.\n'));
      return;
    }

    const { VERIFIED_STRONG_POOL_MODELS, VERIFIED_WEAK_POOL_MODELS } =
      await import('../engine/autoRouter.js');
    const pool = Array.from(
      new Set([
        ...(context.strongPool ?? existing?.strongPool ?? VERIFIED_STRONG_POOL_MODELS),
        ...(context.weakPool ?? existing?.weakPool ?? VERIFIED_WEAK_POOL_MODELS),
      ]),
    );

    console.log(
      chalk.cyan.bold(
        `\n🏎️  Racing & Benchmarking ${pool.length} AI models in parallel on NVIDIA NIM...\n`,
      ),
    );

    const { runModelBenchmark } = await import('../engine/benchmark.js');
    const report = await runModelBenchmark(pool, {
      apiKey,
      fetchImpl: context.fetchImpl,
      timeoutMs: 8000,
    });

    const medals = ['🏆 1st', '🥈 2nd', '🥉 3rd'];
    let okRank = 0;
    const sorted = [...report.results].sort((a, b) => {
      if (a.status !== b.status) return a.status === 'success' ? -1 : 1;
      return a.totalLatencyMs - b.totalLatencyMs;
    });

    for (const r of sorted) {
      if (r.status === 'success') {
        const badge = medals[okRank]
          ? chalk.yellow.bold(medals[okRank].padEnd(8))
          : chalk.green('✔ OK    ');
        okRank++;
        const ttftStr = r.ttftMs ? `TTFT: ${r.ttftMs}ms` : '';
        const tpsStr = r.tokensPerSecond > 0 ? `${r.tokensPerSecond} t/s` : '';
        console.log(
          `  ${badge} ${chalk.white.bold(r.model.padEnd(44))} ${chalk.green(`${r.totalLatencyMs}ms`.padEnd(8))} ${chalk.dim(`│ ${ttftStr.padEnd(14)} │ ${tpsStr}`)}`,
        );
      } else {
        console.log(
          `  ${chalk.red('✖ FAIL  ')} ${chalk.gray(r.model.padEnd(44))} ${chalk.red(`${r.status.toUpperCase()} (${r.totalLatencyMs}ms)`)}`,
        );
      }
    }
    console.log('');
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
      strongPool: context.strongPool,
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

export const mcpCommand: SlashCommand = {
  name: 'mcp',
  description: 'Manage Model Context Protocol (MCP) servers and external tools',
  category: 'System',
  usage: '/mcp [reload|list]',
  aliases: ['servers'],
  execute: async (args: string, context: CommandContext) => {
    const sub = args.trim().toLowerCase();
    const { defaultMcpBridge } = await import('../tools/mcpBridge.js');

    if (sub === 'reload' || sub === 'refresh') {
      const res = await defaultMcpBridge.loadConfig(context.baseDir);
      console.log(
        chalk.green(`✔ MCP configuration reloaded: ${res.serverCount} server(s) active.`),
      );
      return;
    }

    const servers = defaultMcpBridge.getServers();
    const tools = defaultMcpBridge.getToolDefinitions();

    console.log(
      chalk.cyan.bold('\n══════════════════════════════════════════════════════════════════'),
    );
    console.log(chalk.cyan.bold('             MODEL CONTEXT PROTOCOL (MCP) INTEGRATION'));
    console.log(
      chalk.cyan.bold('══════════════════════════════════════════════════════════════════\n'),
    );

    if (servers.length === 0) {
      console.log(chalk.dim('No external MCP servers configured.'));
      console.log(chalk.dim('To configure, create .machcode/mcp.json in your workspace:'));
      console.log(
        chalk.gray(
          `{\n  "mcpServers": {\n    "my-server": { "command": "npx", "args": ["-y", "my-mcp-pkg"] }\n  }\n}`,
        ),
      );
    } else {
      console.log(chalk.yellow.bold(`Active MCP Servers (${servers.length}):`));
      for (const s of servers) {
        console.log(
          `  • ${chalk.green.bold(s.name)} ${s.command ? chalk.dim(`(${s.command})`) : ''} — ${s.toolCount} tool(s) registered`,
        );
      }
      if (tools.length > 0) {
        console.log(chalk.yellow.bold(`\nExposed MCP Tools (${tools.length}):`));
        for (const t of tools) {
          console.log(
            `  • ${chalk.white.bold(t.function.name)}: ${chalk.dim(t.function.description)}`,
          );
        }
      }
    }
    console.log(
      chalk.dim('\nTip: Type /mcp reload to re-read .machcode/mcp.json after editing.\n'),
    );
  },
};

import { themeCommand } from './theme.js';
import { modelCommand } from './models.js';
import { statusCommand } from './status.js';

export { themeCommand } from './theme.js';
export { modelCommand } from './models.js';
export { statusCommand } from './status.js';

export const systemCommands: SlashCommand[] = [
  helpCommand,
  statusCommand,
  themeCommand,
  modelCommand,
  mcpCommand,
  tokensCommand,
  runCommand,
  configCommand,
  raceCommand,
  clearCommand,
  exitCommand,
];
