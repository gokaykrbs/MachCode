import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import chalk from 'chalk';
import ora from 'ora';
import figlet from 'figlet';
import boxen from 'boxen';
import { autoAssignAndSaveModels, ensureConfig, loadConfig } from './config/index.js';
import {
  autoRouteModels,
  VERIFIED_STRONG_POOL_MODELS,
  VERIFIED_WEAK_POOL_MODELS,
  type AutoRouteResult,
} from './engine/autoRouter.js';
import {
  executeParsedCode,
  type ConfirmWriteDecision,
  type ExecutionSummary,
  type ProposedFileChange,
} from './engine/executor.js';
import {
  DEFAULT_HANDOFF_WINDOW_MS,
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
import {
  buildAutocompleteItems,
  promptWithSuggestions,
  type AutocompleteItem,
} from './ui/autocomplete.js';

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
   * Optional multi-model StrongPool array to race in parallel.
   */
  strongPool?: string[];
  /**
   * Optional multi-model WeakPool array for fast parallel fallback.
   */
  weakPool?: string[];
  /**
   * Handoff window in milliseconds. Defaults to 3000 (3 seconds).
   */
  handoffWindowMs?: number;
  /**
   * Network and stream timeout in milliseconds. Defaults to 15000 (15 seconds).
   */
  timeoutMs?: number;
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
   * Optional confirmation callback invoked before writing each modified file (Antigravity / Claude Code style).
   */
  confirmBeforeWrite?: (
    change: ProposedFileChange,
  ) => Promise<ConfirmWriteDecision> | ConfirmWriteDecision;
  /**
   * When false, prompts the user for interactive confirmation ([Y]es / [n]o / [a]ll / [d]iff) before writing files.
   * When true, writes files automatically without prompting.
   */
  autoApprove?: boolean;
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
  /**
   * Optional active readline interface to pause during spinner/stream execution.
   */
  rl?: readline.Interface;
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

  // If no explicit file was matched (e.g., general project question or architectural chat),
  // automatically load package.json as lightweight project overview context
  // without setting inferredTargetFile so the assistant can answer project questions accurately and fast.
  if (fileContentsSections.length === 0 && workspaceFiles.length > 0) {
    const overviewCandidates = ['package.json'];
    const foundOverview = workspaceFiles.filter((f) => overviewCandidates.includes(f)).slice(0, 1);
    for (const relFile of foundOverview) {
      try {
        const content = await read_file(relFile, baseDir);
        const clipped =
          content.length > 1500 ? `${content.slice(0, 1500)}\n... (truncated)` : content;
        fileContentsSections.push(`### File: \`${relFile}\`\n\`\`\`\n${clipped}\n\`\`\``);
      } catch {
        // Ignore unreadable overview files
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
 * Prompts the user for interactive approval before modifying or creating a file (Antigravity / Claude Code style).
 * Displays a diff preview card and supports:
 * - [Y]es / Enter / evet: Approve and apply this file change
 * - [n]o / hayır: Reject and skip this file change
 * - [a]ll / hepsi: Approve this change and auto-approve remaining changes
 * - [d]iff / fark: Display the full colorized diff and re-prompt
 */
export async function promptFileChangeApproval(
  change: ProposedFileChange,
  existingRl?: readline.Interface,
  onAutoApproveAll?: () => void,
): Promise<ConfirmWriteDecision> {
  const actionBadge = change.isNewFile
    ? chalk.bgGreen.black.bold(' NEW FILE ')
    : chalk.bgCyan.black.bold(' MODIFY ');
  const statsBadge = change.isNewFile
    ? chalk.green(`+${change.addedLines} lines`)
    : `${chalk.green(`+${change.addedLines}`)} ${chalk.red(`-${change.removedLines}`)} lines`;

  console.log(
    '\n' +
      chalk.cyan('  ╭─ ') +
      chalk.white.bold('🛡️  Approval Required before File Write') +
      chalk.cyan(' ───────────────────') +
      '\n' +
      chalk.cyan('  │ ') +
      `${actionBadge} ${chalk.white.bold(change.targetPath)} ${chalk.gray(`(${statsBadge})`)}` +
      '\n' +
      chalk.cyan('  ╰──────────────────────────────────────────────────────────────'),
  );
  console.log(change.diffPreview + '\n');

  const ownsRl = !existingRl;
  const rl = existingRl ?? readline.createInterface({ input, output });
  if (existingRl) {
    existingRl.resume?.();
  }

  try {
    while (true) {
      const promptText =
        chalk.cyan.bold('  ? ') +
        chalk.white.bold(`Apply changes to ${change.targetPath}? `) +
        chalk.gray('[') +
        chalk.green.bold('Y') +
        chalk.gray('es / ') +
        chalk.red.bold('n') +
        chalk.gray('o / ') +
        chalk.magenta.bold('a') +
        chalk.gray('ll / ') +
        chalk.yellow.bold('d') +
        chalk.gray('iff]: ');

      const rawAnswer = await rl.question(promptText);
      const ans = rawAnswer.trim().toLowerCase();

      if (ans === '' || ans === 'y' || ans === 'yes' || ans === 'e' || ans === 'evet') {
        return 'approve';
      }
      if (
        ans === 'n' ||
        ans === 'no' ||
        ans === 'h' ||
        ans === 'hayir' ||
        ans === 'hayır' ||
        ans === 'iptal'
      ) {
        return 'reject';
      }
      if (
        ans === 'a' ||
        ans === 'all' ||
        ans === 'always' ||
        ans === 'hepsi' ||
        ans === 'tumu' ||
        ans === 'tümü'
      ) {
        if (onAutoApproveAll) {
          onAutoApproveAll();
        }
        return 'approve_all';
      }
      if (ans === 'd' || ans === 'diff' || ans === 'fark') {
        console.log(
          '\n' +
            chalk.cyan.bold(`  ─── Full Diff: ${change.targetPath} ───`) +
            '\n' +
            change.fullDiff +
            '\n',
        );
        continue;
      }

      console.log(
        chalk.yellow(
          '    Please enter Y (approve), n (reject), a (approve all), or d (show full diff).',
        ),
      );
    }
  } finally {
    if (ownsRl) {
      rl.close();
    } else {
      existingRl?.pause?.();
    }
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
  const config = await ensureConfig({
    apiKey: options.apiKey,
    fetchImpl: options.fetchImpl,
  });
  let lightModel = options.lightModel ?? config.lightModel;
  let heavyModel = options.heavyModel ?? config.heavyModel;

  // Determine the active multi-model racing pools:
  // If options.strongPool is explicitly passed, use it.
  // Else if caller explicitly forced a single heavyModel (e.g. /heavy, /fast, or custom single-model test), use [options.heavyModel].
  // Otherwise, race the full multi-model StrongPool from config / verified NIM models!
  let activeStrongPool: string[] =
    options.strongPool && options.strongPool.length > 0
      ? [...options.strongPool]
      : options.heavyModel
        ? [options.heavyModel]
        : config.strongPool && config.strongPool.length > 0
          ? [...config.strongPool]
          : [...VERIFIED_STRONG_POOL_MODELS];

  let activeWeakPool: string[] =
    options.weakPool && options.weakPool.length > 0
      ? [...options.weakPool]
      : options.lightModel
        ? [options.lightModel]
        : config.weakPool && config.weakPool.length > 0
          ? [...config.weakPool]
          : [...VERIFIED_WEAK_POOL_MODELS];

  const writeToStdout = options.writeToStdout ?? true;
  const maxQuestionRounds = options.maxQuestionRounds ?? 3;

  const apiKey = options.apiKey ?? config.nvidiaApiKey;
  const toolsLoaded = await getIntegratedTools({ fetchImpl: options.fetchImpl });

  if (writeToStdout) {
    const poolCount = activeStrongPool.length;
    console.log(
      '\n' +
        chalk.bgCyan.black.bold(' MACHCODE ') +
        ' ' +
        chalk.cyan.bold(
          poolCount > 1
            ? `Multi-Model Parallel Racing Engine (${poolCount} AI models competing)`
            : 'Tiered Priority Fallback Engine',
        ),
    );
  }

  let currentPrompt = initialPrompt;
  let questionRounds = 0;
  let autoHealRetries = 0;
  const deprecatedModels = new Set<string>();

  while (true) {
    const { contextText, inferredTargetFile } = await gatherWorkspaceContext(
      currentPrompt,
      baseDir,
      options.targetFilePath,
      options.history,
      options.addedFiles,
    );
    const systemPrompt = buildSniperSystemPrompt(contextText);

    options.rl?.pause?.();

    const uniqueProviders = Array.from(
      new Set(activeStrongPool.map((m) => m.split('/')[0] || m)),
    );
    const providerList =
      uniqueProviders.length > 5
        ? `${uniqueProviders.slice(0, 5).join(', ')} +${uniqueProviders.length - 5} more`
        : uniqueProviders.join(', ');
    const spinnerText =
      activeStrongPool.length > 1
        ? `Racing ${activeStrongPool.length} models in parallel (${providerList})...`
        : `Connecting to model (${activeStrongPool[0] ?? heavyModel})...`;

    const spinner = writeToStdout
      ? ora({
          text: chalk.cyan.bold(spinnerText),
          color: 'cyan',
          stream: process.stdout,
        }).start()
      : null;

    let spinnerStopped = false;
    const stopAndClearSpinner = () => {
      if (spinnerStopped) {
        return;
      }
      spinnerStopped = true;
      if (spinner) {
        if (spinner.isSpinning) {
          spinner.stop();
        }
        spinner.clear();
      }
      if (writeToStdout) {
        process.stdout.write('\r\x1b[2K');
      }
    };

    const startTime = Date.now();

    let raceResult: RaceModelsResult;
    try {
      raceResult = await raceModels(currentPrompt, lightModel, heavyModel, {
        apiKey,
        systemPrompt,
        tools: toolsLoaded,
        strongPool: activeStrongPool,
        weakPool: activeWeakPool,
        handoffWindowMs: options.handoffWindowMs,
        timeoutMs: options.timeoutMs,
        writeToStdout,
        fetchImpl: options.fetchImpl,
        promptOnQuestion: false,
        messages: options.history?.map((m) => ({ role: m.role, content: m.content })),
        onFirstToken: (model, tier, details) => {
          stopAndClearSpinner();
          if (writeToStdout) {
            const racedCount = details?.racedModels?.length ?? activeStrongPool.length;
            const latencyText = details?.latencyMs
              ? ` in ${(details.latencyMs / 1000).toFixed(2)}s`
              : '';
            const raceInfo =
              racedCount > 1
                ? chalk.gray(` [won race against ${racedCount} models${latencyText}]`)
                : chalk.gray(latencyText);
            if (tier === 'strong') {
              console.log(
                chalk.magenta.bold(`⚡ Streaming from winning model (${model})`) +
                  raceInfo +
                  '\n',
              );
            } else {
              console.log(
                chalk.blue.bold(`⚡ Streaming from fallback model (${model})`) +
                  raceInfo +
                  '\n',
              );
            }
          }
        },
        onFallback: (_fromTier, _toTier, _reason) => {
          if (writeToStdout) {
            console.log(
              chalk.yellow.dim(
                `\n⚠️  Strong pool failed or timed out. Racing fallback models...\n`,
              ),
            );
          }
        },
        onTerminalChunk: () => {
          stopAndClearSpinner();
        },
      });
    } catch (err: unknown) {
      stopAndClearSpinner();

      const isUnavailable =
        (err as { status?: number })?.status === 410 ||
        (err as { status?: number })?.status === 404 ||
        (err instanceof Error &&
          (err.message.includes('410') ||
            err.message.includes('404') ||
            err.message.includes('HTTP 410') ||
            err.message.includes('HTTP 404')));

      if (isUnavailable && autoHealRetries < 5) {
        autoHealRetries++;
        // Auto-Healing: Silently re-fetch /v1/models, run AutoRouter to find next best active models, and retry
        const badModel = (err as { model?: string })?.model;
        if (badModel) {
          deprecatedModels.add(badModel);
        } else {
          const errMsg = err instanceof Error ? err.message : String(err);
          if (errMsg.includes(lightModel)) deprecatedModels.add(lightModel);
          if (errMsg.includes(heavyModel)) deprecatedModels.add(heavyModel);
          if (!deprecatedModels.has(lightModel) && !deprecatedModels.has(heavyModel)) {
            deprecatedModels.add(lightModel);
            deprecatedModels.add(heavyModel);
          }
        }

        const newModels = await autoAssignAndSaveModels(apiKey, undefined, options.fetchImpl, {
          exclude: deprecatedModels,
        });
        lightModel = newModels.lightModel;
        heavyModel = newModels.heavyModel;
        activeStrongPool =
          newModels.strongPool && newModels.strongPool.length > 0
            ? newModels.strongPool
            : [newModels.heavyModel];
        activeWeakPool =
          newModels.weakPool && newModels.weakPool.length > 0
            ? newModels.weakPool
            : [newModels.lightModel];
        continue;
      }

      throw err;
    }

    stopAndClearSpinner();

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

    // Only apply fallbackTarget when explicit targetFilePath was given, OR when the model emitted pure code blocks
    // (prevents overwriting a file when the user asked a conversational question that happens to include a short example snippet)
    const strippedProse = raceResult.parseResult.visibleOutput
      .replace(/```[\s\S]*?```/g, '')
      .trim();
    const isPureCodeOutput =
      raceResult.parseResult.codeBlocks.length > 0 && strippedProse.length === 0;
    const fallbackTarget =
      options.targetFilePath ?? (isPureCodeOutput ? inferredTargetFile : undefined);

    const effectiveConfirm =
      options.confirmBeforeWrite ??
      (options.autoApprove === false
        ? (change: ProposedFileChange) => promptFileChangeApproval(change, options.rl)
        : undefined);

    const executionSummary = await executeParsedCode(raceResult.parseResult, {
      targetFilePath: fallbackTarget,
      baseDir,
      logSummary: writeToStdout,
      onBeforeWrite: options.onBeforeWrite,
      confirmBeforeWrite: effectiveConfirm,
    });

    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);
    if (writeToStdout) {
      const racedBadge =
        raceResult.racedModels && raceResult.racedModels.length > 1
          ? ` • raced ${raceResult.racedModels.length} models`
          : '';
      console.log(
        chalk.green.bold(`\n✨ Done in ${elapsedSec}s `) +
          chalk.gray(
            `via ${raceResult.winnerModel} [${raceResult.winnerTier || raceResult.winnerRole}${racedBadge}]`,
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

export interface ReplBannerOptions {
  cwd?: string;
  sessionId?: string;
  lightModel?: string;
  heavyModel?: string;
  strongPool?: string[];
  autoApprove?: boolean;
}

/**
 * Displays the compact, responsive Antigravity-style MachCode logo and Status Dashboard.
 * Never distorts or wraps awkwardly when the terminal window is resized or narrowed.
 */
export function printReplBanner(options: ReplBannerOptions = {}): void {
  const currentDir = options.cwd ?? process.cwd();
  const sessionId = options.sessionId ?? `sess_${Math.random().toString(36).substring(2, 10)}`;
  const poolModels = options.strongPool ?? [...VERIFIED_STRONG_POOL_MODELS];
  const uniqueProviders = Array.from(new Set(poolModels.map((m) => m.split('/')[0] || m)));
  const approvalBadge = options.autoApprove
    ? chalk.yellow('Auto-Approve')
    : chalk.green('Ask before write');

  const cols = process.stdout.columns || 80;
  const maxDirLen = Math.max(16, cols - 28);
  const displayDir =
    currentDir.length > maxDirLen
      ? `...${currentDir.slice(-(maxDirLen - 3))}`
      : currentDir;

  const border = chalk.cyan;
  const rows = [
    `${border('  ╭───────────╮')}  ${chalk.cyan.bold('⚡ MachCode')} ${chalk.gray('v0.1.0')}`,
    `${border('  │  ')}${chalk.cyanBright.bold('██▄ ▄██')}${border('  │')}  ${chalk.dim('Engine:')}   ${chalk.white('Multi-Model AI Coding & Q&A CLI')}`,
    `${border('  │  ')}${chalk.magentaBright.bold('███████')}${border('  │')}  ${chalk.dim('Models:')}   ${chalk.magenta.bold(`${poolModels.length} AI models racing`)} ${chalk.gray(`(${uniqueProviders.length} providers)`)}`,
    `${border('  │  ')}${chalk.magenta.bold('██ ▀ ██')}${border('  │')}  ${chalk.dim('Session:')}  ${chalk.white(sessionId)} ${chalk.gray('•')} ${approvalBadge}`,
    `${border('  │  ')}${chalk.blueBright.bold('██   ██')}${border('  │')}  ${chalk.dim('Path:')}     ${chalk.white(displayDir)}`,
    `${border('  ╰───────────╯')}  ${chalk.dim('Commands:')} ${chalk.yellow('/ask')} ${chalk.dim('•')} ${chalk.yellow('/approve')} ${chalk.dim('•')} ${chalk.yellow('/race')} ${chalk.dim('•')} ${chalk.yellow('/plan')} ${chalk.dim('•')} ${chalk.yellow('/help')} ${chalk.dim('•')} ${chalk.yellow('/exit')}`,
  ];

  console.log('\n' + rows.join('\n') + '\n');
}

/**
 * Starts the continuous interactive REPL loop (Read-Eval-Print Loop).
 * 1. Initializes configuration and ensures valid NVIDIA_API_KEY (prompting once if missing).
 * 2. Displays minimalist status dashboard and prompt: `[machcode✨] > `
 * 3. Keeps an in-memory session history array for multi-turn context retention.
 * 4. Routes slash commands starting with `/` dynamically through the CommandRegistry.
 * 5. Passes non-slash user instructions to the Multi-Model Parallel Racing Engine.
 * 6. Records pre-modification file snapshots for `/undo` revert capabilities.
 * 7. Gracefully handles 410/404 model errors and triggers dynamic model re-selection.
 * 8. Never exits the process on completion or errors — always presents the prompt again.
 */
export async function startRepl(options: ReplOptions = {}): Promise<void> {
  const config = await ensureConfig({
    apiKey: options.apiKey,
    fetchImpl: options.fetchImpl,
  });

  const baseDir = options.baseDir ?? process.cwd();
  let lightModel = options.lightModel ?? config.lightModel;
  let heavyModel = options.heavyModel ?? config.heavyModel;
  let strongPool: string[] =
    options.strongPool && options.strongPool.length > 0
      ? [...options.strongPool]
      : options.heavyModel
        ? [options.heavyModel]
        : config.strongPool && config.strongPool.length > 0
          ? [...config.strongPool]
          : [...VERIFIED_STRONG_POOL_MODELS];
  let weakPool: string[] =
    options.weakPool && options.weakPool.length > 0
      ? [...options.weakPool]
      : options.lightModel
        ? [options.lightModel]
        : config.weakPool && config.weakPool.length > 0
          ? [...config.weakPool]
          : [...VERIFIED_WEAK_POOL_MODELS];

  const handoffWindowMs = options.handoffWindowMs ?? DEFAULT_HANDOFF_WINDOW_MS;
  const sessionId = `mc_${Math.random().toString(36).substring(2, 10)}`;
  // Interactive terminal sessions default to Ask-Before-Write (autoApprove: false) unless overridden
  const initialAutoApprove = options.autoApprove ?? !(options.writeToStdout ?? true);

  // Display startup dashboard
  if (options.writeToStdout ?? true) {
    printReplBanner({
      cwd: baseDir,
      sessionId,
      strongPool,
      autoApprove: initialAutoApprove,
    });
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

  // Instruction executor with automatic pre-write file snapshotting & token estimation
  const executeInstruction = async (
    prompt: string,
    runOpts?: MachCodeRunOptions,
  ): Promise<MachCodeRunResult> => {
    rl?.pause?.();
    try {
      const mergedOptions: MachCodeRunOptions = {
        ...options,
        ...runOpts,
        rl,
        baseDir,
        lightModel: runOpts?.lightModel ?? commandContext.lightModel ?? lightModel,
        heavyModel: runOpts?.heavyModel ?? commandContext.heavyModel ?? heavyModel,
        strongPool: runOpts?.strongPool ?? commandContext.strongPool ?? strongPool,
        weakPool: runOpts?.weakPool ?? commandContext.weakPool ?? weakPool,
        handoffWindowMs: runOpts?.handoffWindowMs ?? handoffWindowMs,
        history: sessionHistory,
        addedFiles: addedContextFiles,
        autoApprove: runOpts?.autoApprove ?? commandContext.autoApprove,
        confirmBeforeWrite:
          runOpts?.confirmBeforeWrite ??
          options.confirmBeforeWrite ??
          (!commandContext.autoApprove
            ? (change: ProposedFileChange) =>
                promptFileChangeApproval(change, rl, () => {
                  commandContext.autoApprove = true;
                })
            : undefined),
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
          rl?.resume?.();
          try {
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
          } finally {
            rl?.pause?.();
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
          ? `Modified files: ${result.executionSummary.modifiedFiles.map((f) => f.relativePath).join(', ')}`
          : 'Task completed.');
      sessionHistory.push({ role: 'assistant', content: assistantOutput });

      return result;
    } finally {
      rl?.resume?.();
    }
  };

  const commandContext: CommandContext = {
    baseDir,
    lightModel,
    heavyModel,
    strongPool,
    weakPool,
    handoffWindowMs,
    apiKey: options.apiKey ?? config.nvidiaApiKey,
    fetchImpl: options.fetchImpl,
    sessionHistory,
    addedContextFiles,
    fileSnapshots,
    tokenStats,
    rl,
    shouldExit: false,
    sessionId,
    autoApprove: initialAutoApprove,
    runMachCode: executeInstruction,
  };

  rl.on('SIGINT', () => {
    commandContext.shouldExit = true;
    console.log(chalk.yellow('\n\n👋 Goodbye!\n'));
    rl.close();
    process.exit(0);
  });

  const deprecatedModels = new Set<string>();

  const handleExecutionError = async (err: unknown, currentPrompt: string): Promise<boolean> => {
    const isUnavailable =
      (err as { status?: number })?.status === 410 ||
      (err as { status?: number })?.status === 404 ||
      (err instanceof Error &&
        (err.message.includes('410') ||
          err.message.includes('404') ||
          err.message.includes('HTTP 410') ||
          err.message.includes('HTTP 404')));

    if (isUnavailable) {
      const badModel = (err as { model?: string })?.model;
      if (badModel) {
        deprecatedModels.add(badModel);
      } else {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (errMsg.includes(lightModel)) deprecatedModels.add(lightModel);
        if (errMsg.includes(heavyModel)) deprecatedModels.add(heavyModel);
        if (!deprecatedModels.has(lightModel) && !deprecatedModels.has(heavyModel)) {
          deprecatedModels.add(lightModel);
          deprecatedModels.add(heavyModel);
        }
      }

      try {
        const activeApiKey = commandContext.apiKey ?? (await ensureConfig()).nvidiaApiKey;
        const newModels = await autoAssignAndSaveModels(
          activeApiKey,
          undefined,
          commandContext.fetchImpl,
          { exclude: deprecatedModels },
        );
        commandContext.lightModel = newModels.lightModel;
        commandContext.heavyModel = newModels.heavyModel;
        lightModel = newModels.lightModel;
        heavyModel = newModels.heavyModel;

        await executeInstruction(currentPrompt, {
          lightModel: newModels.lightModel,
          heavyModel: newModels.heavyModel,
        });
        return true;
      } catch (autoHealErr) {
        console.error(
          chalk.red.bold(
            `\n✖ Auto-healing failed: ${autoHealErr instanceof Error ? autoHealErr.message : String(autoHealErr)}\n`,
          ),
        );
        return false;
      }
    }

    const rawMsg = err instanceof Error ? err.message : String(err);
    const isTimeout =
      (err as { isTimeout?: boolean })?.isTimeout ||
      rawMsg.includes('API Timeout') ||
      rawMsg.includes('No response in 10s') ||
      rawMsg.toLowerCase().includes('timeout') ||
      rawMsg.toLowerCase().includes('timed out');

    if (isTimeout) {
      console.error(chalk.red.bold('\n❌ API Timeout: No response in 10s\n'));
      return false;
    }

    const isNetwork =
      rawMsg.toLowerCase().includes('network') ||
      rawMsg.toLowerCase().includes('failed to stream') ||
      rawMsg.toLowerCase().includes('fetch') ||
      rawMsg.toLowerCase().includes('econnrefused') ||
      rawMsg.toLowerCase().includes('etimedout');

    if (isNetwork) {
      console.error(
        chalk.red(
          `\n✖ Network timeout or API failure. Please check your connection and try again.\n`,
        ),
      );
    } else {
      console.error(chalk.red(`\n✖ Error: ${rawMsg}\n`));
    }
    return false;
  };

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
      try {
        await handleExecutionError(err, firstPrompt);
      } catch {
        console.error(chalk.red.bold('\n❌ API Timeout: No response in 10s\n'));
      }
    }
  }

  // Interactive REPL prompt loop: exact format `[machcode✨] > `
  const promptLabel = `${chalk.cyan.bold('[machcode✨]')} ${chalk.yellow('>')} `;
  const autocompleteItems = buildAutocompleteItems(commandRegistry);
  const promptHistory: string[] = [];

  while (!commandContext.shouldExit) {
    let userInput = '';
    try {
      if (process.stdin.isTTY && !options.rlInterface) {
        userInput = await promptWithSuggestions({
          promptText: promptLabel,
          items: autocompleteItems,
          history: promptHistory,
          rlFallback: rl,
        });
      } else {
        userInput = await rl.question(promptLabel);
      }
    } catch {
      break;
    }

    const trimmed = userInput.trim();

    if (trimmed.length === 0) {
      continue;
    }

    promptHistory.push(trimmed);

    rl?.pause?.();

    try {
      // Dynamic Slash Command Dispatch
      if (trimmed.startsWith('/')) {
        await commandRegistry.dispatch(trimmed, commandContext);
        if (commandContext.shouldExit) {
          break;
        }
        continue;
      }

      // Standard prompt instruction execution with silent 410/404 Auto-Healing & Error Boundaries
      try {
        await executeInstruction(trimmed);
      } catch (err) {
        try {
          await handleExecutionError(err, trimmed);
        } catch {
          console.error(chalk.red.bold('\n❌ API Timeout: No response in 10s\n'));
        }
      }
    } finally {
      rl?.resume?.();
    }
  }
}

export * from './config/index.js';
export * from './prompts/sniper.js';
export * from './utils/streamParser.js';
export * from './engine/streamRacer.js';
export * from './engine/autoRouter.js';
export * from './engine/executor.js';
export * from './tools/index.js';
export * from './tools/nvidiaSkills.js';
export * from './commands/index.js';
export * from './ui/autocomplete.js';
