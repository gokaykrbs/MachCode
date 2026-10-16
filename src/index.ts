import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import chalk from 'chalk';
import ora from 'ora';
import { ensureConfig } from './config/index.js';
import { executeParsedCode, type ExecutionSummary } from './engine/executor.js';
import {
  DEFAULT_HANDOFF_WINDOW_MS,
  DEFAULT_HEAVY_MODEL,
  DEFAULT_LIGHT_MODEL,
  raceModels,
  type RaceModelsResult,
} from './engine/streamRacer.js';
import { buildSniperSystemPrompt } from './prompts/sniper.js';
import {
  ALL_TOOLS,
  getIntegratedTools,
  read_file,
  type OpenAIToolDefinition,
} from './tools/index.js';
import { OFFICIAL_NVIDIA_SKILLS_CATALOG, loadNvidiaSkill } from './tools/nvidiaSkills.js';
import {
  createDefaultCommandRegistry,
  type CommandContext,
  type FileSnapshot,
  type TokenStats,
} from './commands/index.js';

export interface SessionMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface MachCodeRunOptions {
  /**
   * Explicit target file path (e.g. from `-f / --file`).
   */
  targetFilePath?: string;
  /**
   * Working directory to scan and modify files in. Defaults to process.cwd().
   */
  baseDir?: string;
  /**
   * Lightweight fast model ID on NVIDIA NIM.
   */
  lightModel?: string;
  /**
   * Heavyweight deep reasoning/coding model ID on NVIDIA NIM.
   */
  heavyModel?: string;
  /**
   * Handoff window in milliseconds. Defaults to 3000 (3 seconds).
   */
  handoffWindowMs?: number;
  /**
   * Optional explicit API key (skips interactive first-run config prompt when provided).
   */
  apiKey?: string;
  /**
   * Prior conversation turns for multi-step interactive REPL context retention.
   */
  history?: SessionMessage[];
  /**
   * Explicitly added context files from `/add <path>`.
   */
  addedFiles?: Set<string>;
  /**
   * Callback invoked before modifying a file (used for /undo snapshotting).
   */
  onBeforeWrite?: (targetPath: string, baseDir: string) => Promise<void> | void;
  /**
   * Optional custom fetch implementation for end-to-end testing.
   */
  fetchImpl?: typeof fetch;
  /**
   * Optional custom handler for `QUESTION:` prompts (defaults to interactive terminal readline).
   */
  askUserQuestion?: (question: string) => Promise<string>;
  /**
   * Whether to write streaming chunks and banners to stdout. Defaults to true.
   */
  writeToStdout?: boolean;
  /**
   * Maximum number of QUESTION clarification rounds before stopping. Defaults to 3.
   */
  maxQuestionRounds?: number;
}

export interface MachCodeRunResult {
  raceResult: RaceModelsResult;
  executionSummary: ExecutionSummary;
  toolsLoaded: OpenAIToolDefinition[];
  questionRounds: number;
}

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.pnpm',
  'coverage',
  '.machcode',
]);

const CODE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.json',
  '.css',
  '.html',
  '.md',
  '.yaml',
  '.yml',
  '.sh',
  '.cu',
  '.cpp',
  '.c',
  '.h',
  '.rs',
  '.go',
]);

/**
 * Recursively collects relative file paths in the workspace up to a bounded depth and count.
 */
export async function scanWorkspaceFiles(
  baseDir: string,
  maxFiles = 60,
  maxDepth = 4,
): Promise<string[]> {
  const results: string[] = [];

  async function walk(currentDir: string, depth: number): Promise<void> {
    if (depth > maxDepth || results.length >= maxFiles) {
      return;
    }

    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= maxFiles) {
        break;
      }

      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          await walk(path.join(currentDir, entry.name), depth + 1);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (CODE_EXTENSIONS.has(ext)) {
          const relPath = path
            .relative(baseDir, path.join(currentDir, entry.name))
            .split(path.sep)
            .join('/');
          results.push(relPath);
        }
      }
    }
  }

  await walk(baseDir, 0);
  return results;
}

/**
 * Identifies candidate target files from the workspace that match the user's prompt or explicit target flag,
 * and reads their contents using the `read_file` tool.
 */
export async function gatherWorkspaceContext(
  prompt: string,
  baseDir: string,
  explicitTargetFile?: string,
  history?: SessionMessage[],
  addedFiles?: Set<string>,
): Promise<{
  contextText: string;
  inferredTargetFile?: string;
}> {
  const workspaceFiles = await scanWorkspaceFiles(baseDir);
  const promptLower = prompt.toLowerCase();
  const promptWords = promptLower
    .replace(/[^a-z0-9_./-]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3);

  const matchedFiles = new Set<string>();

  if (explicitTargetFile) {
    matchedFiles.add(explicitTargetFile.split(path.sep).join('/'));
  }

  // Include any files explicitly added via /add <path>
  if (addedFiles) {
    for (const addPath of addedFiles) {
      matchedFiles.add(addPath.split(path.sep).join('/'));
    }
  }

  for (const relFile of workspaceFiles) {
    const fileLower = relFile.toLowerCase();
    const baseName = path.basename(fileLower, path.extname(fileLower));

    if (
      promptLower.includes(fileLower) ||
      (baseName.length >= 3 && promptWords.includes(baseName))
    ) {
      matchedFiles.add(relFile);
    }
  }

  // If no target file is directly in the prompt, inspect recent session history
  let inferredTargetFile = explicitTargetFile;
  if (!inferredTargetFile && history && history.length > 0) {
    for (let i = history.length - 1; i >= 0; i--) {
      const prevText = history[i].content.toLowerCase();
      for (const relFile of workspaceFiles) {
        if (prevText.includes(relFile.toLowerCase())) {
          inferredTargetFile = relFile;
          matchedFiles.add(relFile);
          break;
        }
      }
      if (inferredTargetFile) {
        break;
      }
    }
  }

  const fileContentsSections: string[] = [];

  for (const relFile of Array.from(matchedFiles).slice(0, 5)) {
    try {
      const content = await read_file(relFile, baseDir);
      if (!inferredTargetFile) {
        inferredTargetFile = relFile;
      }
      fileContentsSections.push(`### File: \`${relFile}\`\n\`\`\`\n${content}\n\`\`\``);
    } catch {
      // File may be a new file to be created; still usable as inferredTargetFile
      if (!inferredTargetFile) {
        inferredTargetFile = relFile;
      }
    }
  }

  // Also check if the prompt mentions an explicit filename to create (e.g., "create src/auth.ts")
  if (!inferredTargetFile) {
    const fileMatch =
      /\b([a-zA-Z0-9_./-]+\.(?:ts|tsx|js|jsx|py|json|css|html|md|cu|cpp|rs|go))\b/.exec(prompt);
    if (fileMatch?.[1]) {
      inferredTargetFile = fileMatch[1];
    }
  }

  // Check if any official NVIDIA skill matches the prompt and load its SKILL.md automatically
  const skillSections: string[] = [];
  for (const skillMeta of OFFICIAL_NVIDIA_SKILLS_CATALOG) {
    const keywords = [
      skillMeta.name.toLowerCase(),
      skillMeta.product.toLowerCase(),
      ...(skillMeta.tags ?? []),
    ];
    if (keywords.some((kw) => kw.length >= 4 && promptLower.includes(kw))) {
      const loaded = await loadNvidiaSkill(skillMeta.name);
      skillSections.push(`### Active NVIDIA Verified Skill (${loaded.name})\n${loaded.content}`);
      break;
    }
  }

  const availableToolsList = ALL_TOOLS.map(
    (t) => `- \`${t.function.name}\`: ${t.function.description}`,
  ).join('\n');

  const sections: string[] = [
    `## Workspace Files (${baseDir})\n${
      workspaceFiles.length > 0
        ? workspaceFiles.map((f) => `- ${f}`).join('\n')
        : '(empty directory)'
    }`,
    `## Integrated Tools & Official NVIDIA Skills\n${availableToolsList}`,
    `## File Output Contract\nAlways begin every Markdown code fence with a file path comment on the very first line inside the fence: \`// file: <relative/path/to/file>\` (or \`# file: <relative/path/to/file>\` for Python/shell).`,
  ];

  if (inferredTargetFile) {
    sections.push(`## Primary Target File\n\`${inferredTargetFile}\``);
  }

  if (fileContentsSections.length > 0) {
    sections.push(`## Loaded File Contents (via read_file)\n${fileContentsSections.join('\n\n')}`);
  }

  if (skillSections.length > 0) {
    sections.push(skillSections.join('\n\n'));
  }

  if (history && history.length > 0) {
    const recentHistory = history
      .slice(-4)
      .map(
        (m) =>
          `[${m.role.toUpperCase()}]: ${m.content.length > 300 ? m.content.slice(0, 300) + '...' : m.content}`,
      )
      .join('\n');
    sections.push(`## Recent Session History Context\n${recentHistory}`);
  }

  return {
    contextText: sections.join('\n\n'),
    inferredTargetFile,
  };
}

/**
 * Prompts the user in yellow when `QUESTION:` is triggered during CLI execution.
 */
async function promptUserInYellow(question: string): Promise<string> {
  console.log(
    '\n' + chalk.bgYellow.black.bold(' ? QUESTION ') + ' ' + chalk.yellow.bold(question) + '\n',
  );

  const rl = readline.createInterface({ input, output });
  try {
    while (true) {
      const answer = await rl.question(
        chalk.yellow.bold('➤ ') + chalk.white.bold('Enter clarification: '),
      );
      const trimmed = answer.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
      console.log(chalk.yellow('Please provide a non-empty response to continue.'));
    }
  } finally {
    rl.close();
  }
}

/**
 * Executes the full MachCode end-to-end flow:
 * 1. Loads config & workspace context (via `read_file` and automatic NVIDIA skills integration).
 * 2. Builds the Sniper system prompt.
 * 3. Displays the `ora` spinner ("Racing models...") and runs the Streaming Handoff Racing Engine.
 * 4. If `QUESTION:` is triggered, pauses the spinner, prints the question in yellow, gathers user input, and re-runs.
 * 5. Safely writes extracted code via the Executor and outputs the green summary of modified files.
 */
export async function runMachCode(
  initialPrompt: string,
  options: MachCodeRunOptions = {},
): Promise<MachCodeRunResult> {
  const baseDir = options.baseDir ?? process.cwd();
  const lightModel = options.lightModel ?? DEFAULT_LIGHT_MODEL;
  const heavyModel = options.heavyModel ?? DEFAULT_HEAVY_MODEL;
  const writeToStdout = options.writeToStdout ?? true;
  const maxQuestionRounds = options.maxQuestionRounds ?? 3;

  const apiKey = options.apiKey ?? (await ensureConfig()).nvidiaApiKey;
  const toolsLoaded = await getIntegratedTools({ fetchImpl: options.fetchImpl });

  if (writeToStdout) {
    console.log(
      '\n' +
        chalk.bgCyan.black.bold(' MACHCODE ') +
        ' ' +
        chalk.cyan.bold('Streaming Handoff Racing Engine') +
        chalk.gray(` [${lightModel} ⚡ ${heavyModel}]`),
    );
  }

  let currentPrompt = initialPrompt;
  let questionRounds = 0;

  while (true) {
    let handoffTriggered = false;
    const { contextText, inferredTargetFile } = await gatherWorkspaceContext(
      currentPrompt,
      baseDir,
      options.targetFilePath,
      options.history,
      options.addedFiles,
    );
    const systemPrompt = buildSniperSystemPrompt(contextText);

    const spinner = writeToStdout
      ? ora({
          text: chalk.cyan.bold('Racing models...'),
          color: 'cyan',
        }).start()
      : null;

    const startTime = Date.now();

    const raceResult = await raceModels(currentPrompt, lightModel, heavyModel, {
      apiKey,
      systemPrompt,
      tools: toolsLoaded,
      handoffWindowMs: options.handoffWindowMs,
      writeToStdout,
      fetchImpl: options.fetchImpl,
      promptOnQuestion: false,
      messages: options.history?.map((m) => ({ role: m.role, content: m.content })),
      onFirstToken: (model, role) => {
        if (spinner && spinner.isSpinning) {
          spinner.stop();
        }
        if (writeToStdout && role === 'light') {
          console.log(
            chalk.dim(
              `⚡ First token from lightweight model (${model}) — 3s handoff window active...\n`,
            ),
          );
        } else if (writeToStdout && role === 'heavy' && !handoffTriggered) {
          console.log(chalk.magenta.bold(`🔥 Streaming from heavyweight model (${model})...\n`));
        }
      },
      onHandoff: ({ fromModel, toModel, elapsedMs }) => {
        handoffTriggered = true;
        if (spinner && spinner.isSpinning) {
          spinner.stop();
        }
        if (writeToStdout) {
          console.log(
            chalk.bgMagenta.white.bold(' HANDOFF ') +
              ' ' +
              chalk.magenta.bold(
                `Heavyweight (${toModel}) started within ${elapsedMs}ms — aborted ${fromModel} & restarted stream:\n`,
              ),
          );
        }
      },
    });

    if (spinner && spinner.isSpinning) {
      spinner.stop();
    }

    // Handle Stop & Ask Protocol (`QUESTION:`)
    if (raceResult.parseResult.isHalted && raceResult.parseResult.question) {
      questionRounds += 1;
      if (questionRounds > maxQuestionRounds) {
        const executionSummary = await executeParsedCode(raceResult.parseResult, {
          targetFilePath: options.targetFilePath ?? inferredTargetFile,
          baseDir,
          logSummary: writeToStdout,
          onBeforeWrite: options.onBeforeWrite,
        });
        return {
          raceResult,
          executionSummary,
          toolsLoaded,
          questionRounds,
        };
      }

      const askFn = options.askUserQuestion ?? promptUserInYellow;
      const userAnswer = await askFn(raceResult.parseResult.question);

      currentPrompt = `${currentPrompt}\n\n[Additional User Context / Answer to "${raceResult.parseResult.question}"]:\n${userAnswer}`;
      continue;
    }

    if (writeToStdout) {
      console.log('');
    }

    const fallbackTarget = options.targetFilePath ?? inferredTargetFile ?? 'machcode.output.ts';
    const executionSummary = await executeParsedCode(raceResult.parseResult, {
      targetFilePath: fallbackTarget,
      baseDir,
      logSummary: writeToStdout,
      onBeforeWrite: options.onBeforeWrite,
    });

    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);
    if (writeToStdout && !executionSummary.skipped) {
      console.log(
        chalk.green.bold(`\n✨ Done in ${elapsedSec}s `) +
          chalk.gray(
            `via ${raceResult.winnerModel}${
              raceResult.handoffOccurred ? ' (after seamless handoff)' : ''
            }`,
          ),
      );
    }

    return {
      raceResult,
      executionSummary,
      toolsLoaded,
      questionRounds,
    };
  }
}

export interface ReplOptions extends MachCodeRunOptions {
  /**
   * Optional initial instruction to execute upon entering the REPL.
   */
  initialPrompt?: string;
  /**
   * Optional injected readline interface (useful for automated testing).
   */
  rlInterface?: readline.Interface;
}

/**
 * Displays the MachCode ASCII branding banner in the terminal.
 */
export function printReplBanner(): void {
  console.log(
    chalk.cyan.bold('\n⚡ MACHCODE CLI v1.0.0') +
      chalk.gray(' — Speed-driven autonomous code editor (NVIDIA NIM)\n') +
      chalk.dim('Type your instruction, or ') +
      chalk.yellow('/clear') +
      chalk.dim(' to clear screen, ') +
      chalk.yellow('/exit') +
      chalk.dim(' to quit.\n'),
  );
}

/**
 * Starts the continuous interactive REPL loop (Read-Eval-Print Loop).
 * 1. Initializes configuration and ensures valid NVIDIA_API_KEY (prompting once if missing).
 * 2. Displays startup banner and prompt: `[machcode✨] > `
 * 3. Keeps an in-memory session history array for multi-turn context retention.
 * 4. Routes slash commands starting with `/` dynamically through the CommandRegistry.
 * 5. Passes non-slash user instructions to the Streaming Handoff Racing Engine.
 * 6. Records pre-modification file snapshots for `/undo` revert capabilities.
 * 7. Never exits the process on completion or errors — always presents the prompt again.
 */
export async function startRepl(options: ReplOptions = {}): Promise<void> {
  // Step 1: Ensure NVIDIA_API_KEY configuration
  if (!options.apiKey) {
    await ensureConfig();
  }

  // Display startup banner
  if (options.writeToStdout ?? true) {
    printReplBanner();
  }

  // Session state tracking
  const sessionHistory: SessionMessage[] = [...(options.history ?? [])];
  const addedContextFiles = new Set<string>();
  const fileSnapshots: FileSnapshot[] = [];
  const tokenStats: TokenStats = {
    estimatedPromptTokens: 0,
    estimatedCompletionTokens: 0,
    totalTurns: 0,
  };

  const commandRegistry = createDefaultCommandRegistry();

  const rl =
    options.rlInterface ??
    readline.createInterface({
      input,
      output,
    });

  const baseDir = options.baseDir ?? process.cwd();
  const lightModel = options.lightModel ?? DEFAULT_LIGHT_MODEL;
  const heavyModel = options.heavyModel ?? DEFAULT_HEAVY_MODEL;
  const handoffWindowMs = options.handoffWindowMs ?? DEFAULT_HANDOFF_WINDOW_MS;

  // Instruction executor with automatic pre-write file snapshotting & token estimation
  const executeInstruction = async (
    prompt: string,
    runOpts?: MachCodeRunOptions,
  ): Promise<MachCodeRunResult> => {
    const mergedOptions: MachCodeRunOptions = {
      ...options,
      ...runOpts,
      baseDir,
      lightModel: runOpts?.lightModel ?? lightModel,
      heavyModel: runOpts?.heavyModel ?? heavyModel,
      handoffWindowMs: runOpts?.handoffWindowMs ?? handoffWindowMs,
      history: sessionHistory,
      addedFiles: addedContextFiles,
      onBeforeWrite: async (targetPath: string, workspaceDir: string) => {
        try {
          const existing = await read_file(targetPath, workspaceDir);
          fileSnapshots.push({
            file: targetPath,
            previousContent: existing,
            timestamp: Date.now(),
          });
        } catch {
          fileSnapshots.push({
            file: targetPath,
            previousContent: '__FILE_DID_NOT_EXIST__',
            timestamp: Date.now(),
          });
        }
      },
      askUserQuestion: async (question: string) => {
        console.log(
          '\n' +
            chalk.bgYellow.black.bold(' ? QUESTION ') +
            ' ' +
            chalk.yellow.bold(question) +
            '\n',
        );
        while (true) {
          const answer = await rl.question(
            chalk.yellow.bold('➤ ') + chalk.white.bold('Enter clarification: '),
          );
          const trimmedAns = answer.trim();
          if (trimmedAns.length > 0) {
            return trimmedAns;
          }
          console.log(chalk.yellow('Please provide a non-empty response to continue.'));
        }
      },
    };

    const result = await runMachCode(prompt, mergedOptions);

    // Update session tokens & history
    const promptTokens = Math.ceil(prompt.length / 4);
    const completionTokens = Math.ceil(
      (result.raceResult.parseResult.visibleOutput.length || 80) / 4,
    );
    tokenStats.estimatedPromptTokens += promptTokens;
    tokenStats.estimatedCompletionTokens += completionTokens;
    tokenStats.totalTurns += 1;

    sessionHistory.push({ role: 'user', content: prompt });
    const assistantOutput =
      result.raceResult.parseResult.visibleOutput.trim() ||
      (result.executionSummary.modifiedFiles.length > 0
        ? `Modified files: ${result.executionSummary.modifiedFiles.join(', ')}`
        : 'Task completed.');
    sessionHistory.push({ role: 'assistant', content: assistantOutput });

    return result;
  };

  const commandContext: CommandContext = {
    baseDir,
    lightModel,
    heavyModel,
    handoffWindowMs,
    apiKey: options.apiKey,
    fetchImpl: options.fetchImpl,
    sessionHistory,
    addedContextFiles,
    fileSnapshots,
    tokenStats,
    rl,
    shouldExit: false,
    runMachCode: executeInstruction,
  };

  rl.on('SIGINT', () => {
    commandContext.shouldExit = true;
    console.log(chalk.yellow('\n\n👋 Goodbye!\n'));
    rl.close();
    process.exit(0);
  });

  // Execute initial prompt if provided via CLI argument
  if (options.initialPrompt && options.initialPrompt.trim().length > 0) {
    const firstPrompt = options.initialPrompt.trim();
    if (options.writeToStdout ?? true) {
      console.log(
        `${chalk.cyan.bold('[machcode✨]')} ${chalk.yellow('>')} ${chalk.white(firstPrompt)}`,
      );
    }

    try {
      if (firstPrompt.startsWith('/')) {
        await commandRegistry.dispatch(firstPrompt, commandContext);
      } else {
        await executeInstruction(firstPrompt);
      }
    } catch (err) {
      console.error(
        chalk.red.bold(`\n✖ Error: ${err instanceof Error ? err.message : String(err)}\n`),
      );
    }
  }

  // Interactive REPL prompt loop
  const promptLabel = `${chalk.cyan.bold('[machcode✨]')} ${chalk.yellow('>')} `;

  while (!commandContext.shouldExit) {
    let userInput = '';
    try {
      userInput = await rl.question(promptLabel);
    } catch {
      break;
    }

    const trimmed = userInput.trim();

    if (trimmed.length === 0) {
      continue;
    }

    // Dynamic Slash Command Dispatch
    if (trimmed.startsWith('/')) {
      await commandRegistry.dispatch(trimmed, commandContext);
      if (commandContext.shouldExit) {
        break;
      }
      continue;
    }

    // Standard prompt instruction execution
    try {
      await executeInstruction(trimmed);
    } catch (err) {
      console.error(
        chalk.red.bold(`\n✖ Error: ${err instanceof Error ? err.message : String(err)}\n`),
      );
    }
  }
}

export * from './config/index.js';
export * from './prompts/sniper.js';
export * from './utils/streamParser.js';
export * from './engine/streamRacer.js';
export * from './engine/executor.js';
export * from './tools/index.js';
export * from './tools/nvidiaSkills.js';
export * from './commands/index.js';
