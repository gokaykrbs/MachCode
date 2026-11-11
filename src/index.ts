import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import chalk from 'chalk';
import ora from 'ora';
import { autoAssignAndSaveModels, ensureConfig } from './config/index.js';
import { VERIFIED_STRONG_POOL_MODELS, VERIFIED_WEAK_POOL_MODELS } from './engine/autoRouter.js';
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
import { buildAgentSystemPrompt } from './prompts/agent.js';
import {
  ALL_TOOLS,
  getIntegratedTools,
  read_file,
  type OpenAIToolDefinition,
  type WriteFileResult,
} from './tools/index.js';
import { OFFICIAL_NVIDIA_SKILLS_CATALOG, loadNvidiaSkill } from './tools/nvidiaSkills.js';
import { runAgentLoop } from './engine/agentLoop.js';
import { PermissionManager } from './engine/permissions.js';
import { AGENT_TOOL_DEFINITIONS } from './tools/agentTools.js';
import {
  createDefaultCommandRegistry,
  type CommandContext,
  type FileSnapshot,
  type TokenStats,
} from './commands/index.js';
import { buildAutocompleteItems, promptWithSuggestions } from './ui/autocomplete.js';
import { loadSavedTheme, getActiveTheme } from './ui/theme.js';
import { renderStatusBar, getGitBranch } from './ui/statusBar.js';
import { parseAndExpandMentions } from './utils/mentionParser.js';
import { saveSession, loadSession } from './engine/sessionManager.js';
import { summarizeOldestTurns } from './engine/contextSummarizer.js';

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
  /**
   * When true (default in REPL / agent workflows), uses the autonomous Agent Loop
   * with tools (list_directory, read_file, glob, grep, edit_file, write_file, run_command) and
   * interactive diff/command approval across all drives and folders.
   */
  agentMode?: boolean;
  /**
   * Restrict tools to read-only operations (/ask, /plan, /review).
   */
  readOnly?: boolean;
  /**
   * Optional custom PermissionManager instance to govern approvals across turns.
   */
  permissionManager?: PermissionManager;
  /**
   * Optional AbortSignal to interrupt agent operations.
   */
  signal?: AbortSignal;
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
 * Detects whether the user's input is a pure greeting or casual hello without a specific coding instruction.
 */
export function isPureGreeting(prompt: string): boolean {
  const p = prompt.trim().toLowerCase();
  return /^(merhaba|selam|selamlar|hey|hi|hello|günaydın|gunaydin|iyi günler|iyi gunler|iyi akşamlar|iyi aksamlar)[!.,? ]*$/i.test(
    p,
  );
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
  if (isPureGreeting(prompt)) {
    return {
      contextText:
        'User sent a greeting. Adhere strictly to the GREETINGS RULE: reply in EXACTLY ONE short, polite sentence (e.g. "Merhaba! Nasıl yardımcı olabilirim?"). Do NOT provide a capability list, menu, or list of workspace files.',
    };
  }

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

  // Also check if the prompt mentions an explicit filename to create (e.g., "create src/auth.ts" or "D:\test.txt")
  if (!inferredTargetFile) {
    const fileMatch =
      /(?:^|\s|"|'|`)([a-zA-Z]:[/\\][^\s"'>`]+|[a-zA-Z0-9_./\\-]+\.(?:ts|tsx|js|jsx|py|json|css|html|md|cu|cpp|rs|go|txt|env|yaml|yml|sh))/i.exec(
        prompt,
      );
    if (fileMatch?.[1]) {
      inferredTargetFile = fileMatch[1].trim();
    }
  }

  // Check if the user prompt asks to reach or inspect an external drive (e.g. "D: ye ulas" or "D: deki projeler" or "C:")
  const driveMatch = /\b([a-zA-Z]):(?:[/\\])?(?:\s|$|ye|e|yi|i|de|da)/i.exec(prompt);
  if (driveMatch?.[1]) {
    const driveLetter = driveMatch[1].toUpperCase();
    const driveRoot = `${driveLetter}:\\`;
    try {
      const stats = await fs.stat(driveRoot);
      if (stats.isDirectory()) {
        const driveEntries = await fs.readdir(driveRoot, { withFileTypes: true });
        const summary = driveEntries
          .slice(0, 45)
          .map((e) => `- [${e.isDirectory() ? 'DIR' : 'FILE'}] ${e.name}`)
          .join('\n');
        fileContentsSections.push(
          `### Drive & Path Discovered (${driveRoot})\n${summary}\n(Instruction: The user can switch active workspace to this drive anytime with \`/cd ${driveRoot}\` or read/write files at full paths like \`${driveRoot}folder/file\`).`,
        );

        // Intelligent discovery: if the prompt is looking for a project or folder by name (e.g. "Machcode")
        const candidateKeywords = promptWords.filter(
          (w) =>
            w.length >= 4 &&
            ![
              'deki',
              'daki',
              'ulas',
              'ulaş',
              'bana',
              'bunu',
              'olan',
              'goster',
              'göster',
              'klasor',
              'klasör',
              'drive',
            ].includes(w),
        );
        for (const kw of candidateKeywords) {
          const directMatch = driveEntries.filter((e) => e.name.toLowerCase().includes(kw));
          if (directMatch.length > 0) {
            fileContentsSections.push(
              `### Matched Items on ${driveRoot} for "${kw}":\n${directMatch.map((m) => `- ${driveRoot}${m.name}`).join('\n')}`,
            );
          } else {
            // Not directly at root of this drive; scan other mounted drives (e.g. D:, C:) to help the user locate it
            for (const otherLetter of ['D', 'C', 'E'].filter((l) => l !== driveLetter)) {
              const otherRoot = `${otherLetter}:\\`;
              try {
                const otherEntries = await fs.readdir(otherRoot, { withFileTypes: true });
                for (const oe of otherEntries) {
                  if (oe.name.toLowerCase().includes(kw)) {
                    fileContentsSections.push(
                      `### Discovered Location for "${kw}":\nNotice: "${kw}" was not found directly on drive ${driveRoot}, but was located at: \`${otherRoot}${oe.name}\`\n(Instruction: Inform the user that "${kw}" is located on ${otherRoot} and specify the full path).`,
                    );
                  }
                  if (
                    oe.isDirectory() &&
                    ['my projects', 'projects', 'dev', 'workspace', 'repos'].includes(
                      oe.name.toLowerCase(),
                    )
                  ) {
                    try {
                      const subEnts = await fs.readdir(path.join(otherRoot, oe.name), {
                        withFileTypes: true,
                      });
                      const subMatch = subEnts.filter((s) => s.name.toLowerCase().includes(kw));
                      if (subMatch.length > 0) {
                        fileContentsSections.push(
                          `### Discovered Location for "${kw}":\nNotice: "${kw}" was not found directly on drive ${driveRoot}, but was located at: \`${path.join(otherRoot, oe.name, subMatch[0].name)}\`\n(Instruction: Inform the user that "${kw}" is located at \`${path.join(otherRoot, oe.name, subMatch[0].name)}\`).`,
                        );
                      }
                    } catch {
                      // Ignore sub-read errors
                    }
                  }
                }
              } catch {
                // Ignore unmounted drives
              }
            }
          }
        }
      }
    } catch {
      // Drive not present or not mounted
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

  const isRealTty = Boolean(process.stdin.isTTY);
  const ownsRl = isRealTty || !existingRl;
  const rl = isRealTty
    ? readline.createInterface({ input, output })
    : (existingRl ?? readline.createInterface({ input, output }));
  if (!isRealTty && existingRl) {
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

  if (options.agentMode === true) {
    const uniqueProviders = Array.from(new Set(activeStrongPool.map((m) => m.split('/')[0] || m)));
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

    let raceWinner = heavyModel;
    try {
      const initialRace = await raceModels(currentPrompt, lightModel, heavyModel, {
        apiKey,
        systemPrompt: buildAgentSystemPrompt({ cwd: baseDir, readOnly: options.readOnly }),
        strongPool: activeStrongPool,
        weakPool: activeWeakPool,
        handoffWindowMs: options.handoffWindowMs,
        timeoutMs: options.timeoutMs,
        writeToStdout: false,
        fetchImpl: options.fetchImpl,
      });
      raceWinner = initialRace.winnerModel;
    } catch {
      // Fallback to default model if initial race failed
    } finally {
      if (spinner && spinner.isSpinning) {
        spinner.stop();
        spinner.clear();
      }
    }

    if (writeToStdout) {
      console.log(chalk.magenta.bold(`⚡ Agent locked onto winning model (${raceWinner})\n`));
    }

    const permissionMgr =
      options.permissionManager ??
      new PermissionManager({
        isAutoApprove: () => Boolean(options.autoApprove),
        rl: options.rl,
        writeToStdout,
      });

    const agentResult = await runAgentLoop({
      prompt: currentPrompt,
      cwd: baseDir,
      apiKey,
      model: raceWinner,
      candidateModels: activeStrongPool,
      permissionManager: permissionMgr,
      history: options.history?.map((m) => ({ role: m.role, content: m.content })),
      pinnedFiles: options.addedFiles ? Array.from(options.addedFiles) : undefined,
      readOnly: options.readOnly,
      timeoutMs: options.timeoutMs,
      writeToStdout,
      fetchImpl: options.fetchImpl,
      onBeforeWrite: options.onBeforeWrite ? (p, dir) => options.onBeforeWrite!(p, dir) : undefined,
      signal: options.signal,
    });

    const modifiedFiles: WriteFileResult[] = agentResult.modifiedFiles.map((f) => ({
      filePath: f,
      relativePath: path.relative(baseDir, f) || path.basename(f),
      bytesWritten: 0,
    }));

    const executionSummary: ExecutionSummary = {
      modifiedFiles,
      rejectedFiles: [],
      skipped: modifiedFiles.length === 0,
      formattedSummary:
        modifiedFiles.length > 0
          ? chalk.green(`✔ Successfully modified ${modifiedFiles.length} file(s):`)
          : chalk.yellow('No files were modified.'),
    };

    const raceResult: RaceModelsResult = {
      winnerModel: agentResult.modelUsed,
      winnerRole: 'heavy',
      winnerTier: 'strong',
      handoffOccurred: false,
      handoffElapsedMs: null,
      lightAborted: false,
      heavyAborted: false,
      finalTerminalOutput: agentResult.finalResponse,
      parseResult: {
        plan: '',
        extractedCode: '',
        codeBlocks: [],
        question: null,
        isHalted: false,
        visibleOutput: agentResult.finalResponse,
      },
    };

    return {
      raceResult,
      executionSummary,
      toolsLoaded: AGENT_TOOL_DEFINITIONS,
      questionRounds: 0,
    };
  }

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

    const uniqueProviders = Array.from(new Set(activeStrongPool.map((m) => m.split('/')[0] || m)));
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
                chalk.magenta.bold(`⚡ Streaming from winning model (${model})`) + raceInfo + '\n',
              );
            } else {
              console.log(
                chalk.blue.bold(`⚡ Streaming from fallback model (${model})`) + raceInfo + '\n',
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

    const hasCodeBlocks = raceResult.parseResult.codeBlocks.length > 0;
    const promptLower = initialPrompt.toLowerCase();
    const promptHasFileIntent = Boolean(
      inferredTargetFile &&
      (promptLower.includes('oluştur') ||
        promptLower.includes('olustur') ||
        promptLower.includes('create') ||
        promptLower.includes('yaz') ||
        promptLower.includes('write') ||
        promptLower.includes('güncelle') ||
        promptLower.includes('guncelle') ||
        promptLower.includes('update') ||
        promptLower.includes('modify') ||
        promptLower.includes('edit') ||
        promptLower.includes('add') ||
        promptLower.includes('ekle') ||
        promptLower.includes('değiştir') ||
        promptLower.includes('degistir') ||
        promptLower.includes('fix') ||
        promptLower.includes('düzelt') ||
        promptLower.includes('duzelt')),
    );

    const fallbackTarget =
      options.targetFilePath ??
      (isPureCodeOutput || (hasCodeBlocks && promptHasFileIntent) ? inferredTargetFile : undefined);

    const effectiveConfirm =
      options.confirmBeforeWrite ??
      (!options.autoApprove && (writeToStdout || Boolean(options.rl))
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
   * Initial active mode: 'build' (full agent with file edits and commands) or 'plan' (read-only).
   */
  initialMode?: 'build' | 'plan';
  /**
   * Optional injected readline interface (useful for automated testing).
   */
  rlInterface?: readline.Interface;
  /**
   * Optional session ID or name to resume from disk.
   */
  resumeSessionId?: string;
  /**
   * When true, resumes the latest saved session in this workspace.
   */
  resumeLatest?: boolean;
}

export interface ReplBannerOptions {
  cwd?: string;
  sessionId?: string;
  lightModel?: string;
  heavyModel?: string;
  strongPool?: string[];
  autoApprove?: boolean;
  mode?: 'build' | 'plan';
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
  const modeBadge =
    options.mode === 'plan'
      ? chalk.magenta.bold('Plan (Read-Only)')
      : chalk.green.bold('Build (Full Agent)');

  const cols = process.stdout.columns || 80;
  const maxDirLen = Math.max(16, cols - 28);
  const displayDir =
    currentDir.length > maxDirLen ? `...${currentDir.slice(-(maxDirLen - 3))}` : currentDir;

  const border = chalk.cyan;
  const rows = [
    `${border('  ╭───────────╮')}  ${chalk.cyan.bold('⚡ MachCode')} ${chalk.gray('v0.1.0')}`,
    `${border('  │  ')}${chalk.cyanBright.bold('██▄ ▄██')}${border('  │')}  ${chalk.dim('Engine:')}   ${chalk.white('Multi-Model AI Coding & Q&A CLI')}`,
    `${border('  │  ')}${chalk.magentaBright.bold('███████')}${border('  │')}  ${chalk.dim('Models:')}   ${chalk.magenta.bold(`${poolModels.length} AI models racing`)} ${chalk.gray(`(${uniqueProviders.length} providers)`)}`,
    `${border('  │  ')}${chalk.magenta.bold('██ ▀ ██')}${border('  │')}  ${chalk.dim('Session:')}  ${chalk.white(sessionId)} ${chalk.gray('•')} ${modeBadge} ${chalk.gray('•')} ${approvalBadge}`,
    `${border('  │  ')}${chalk.blueBright.bold('██   ██')}${border('  │')}  ${chalk.dim('Path:')}     ${chalk.white(displayDir)}`,
    `${border('  ╰───────────╯')}  ${chalk.dim('Commands:')} ${chalk.yellow('/mode')} ${chalk.dim('•')} ${chalk.yellow('/approve')} ${chalk.dim('•')} ${chalk.yellow('/race')} ${chalk.dim('•')} ${chalk.yellow('/plan')} ${chalk.dim('•')} ${chalk.yellow('/help')} ${chalk.dim('•')} ${chalk.yellow('/exit')}`,
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
  const strongPool: string[] =
    options.strongPool && options.strongPool.length > 0
      ? [...options.strongPool]
      : options.heavyModel
        ? [options.heavyModel]
        : config.strongPool && config.strongPool.length > 0
          ? [...config.strongPool]
          : [...VERIFIED_STRONG_POOL_MODELS];
  const weakPool: string[] =
    options.weakPool && options.weakPool.length > 0
      ? [...options.weakPool]
      : options.lightModel
        ? [options.lightModel]
        : config.weakPool && config.weakPool.length > 0
          ? [...config.weakPool]
          : [...VERIFIED_WEAK_POOL_MODELS];

  const handoffWindowMs = options.handoffWindowMs ?? DEFAULT_HANDOFF_WINDOW_MS;
  let sessionId = `mc_${Math.random().toString(36).substring(2, 10)}`;
  // Load saved theme preference
  await loadSavedTheme();
  // Interactive terminal sessions default to Ask-Before-Write (autoApprove: false) unless overridden
  const initialAutoApprove = options.autoApprove ?? !(options.writeToStdout ?? true);
  let activeMode: 'build' | 'plan' = options.initialMode ?? 'build';

  // Session state tracking
  const sessionHistory: SessionMessage[] = [...(options.history ?? [])];
  const addedContextFiles = new Set<string>();
  const fileSnapshots: FileSnapshot[] = [];
  const tokenStats: TokenStats = {
    estimatedPromptTokens: 0,
    estimatedCompletionTokens: 0,
    totalTurns: 0,
  };

  // Resume session if requested via CLI flag (--resume [id])
  if (options.resumeSessionId || options.resumeLatest) {
    const resumeTarget = options.resumeLatest ? 'latest' : options.resumeSessionId;
    const loaded = await loadSession(resumeTarget, baseDir);
    if (loaded) {
      sessionId = loaded.sessionId;
      sessionHistory.push(...loaded.history);
      for (const f of loaded.addedFiles || []) {
        addedContextFiles.add(f);
      }
      tokenStats.estimatedPromptTokens = loaded.tokenStats?.estimatedPromptTokens ?? 0;
      tokenStats.estimatedCompletionTokens = loaded.tokenStats?.estimatedCompletionTokens ?? 0;
      tokenStats.totalTurns = loaded.tokenStats?.totalTurns ?? 0;
      if (loaded.mode) {
        activeMode = loaded.mode;
      }
      if (options.writeToStdout ?? true) {
        console.log(
          chalk.green(
            `\n✔ Resumed session ${chalk.white.bold(loaded.sessionId)}${loaded.name ? ` ("${loaded.name}")` : ''} (${Math.floor(loaded.history.length / 2)} turns restored)\n`,
          ),
        );
      }
    } else if (options.writeToStdout ?? true) {
      console.log(
        chalk.yellow(
          `\n⚠️  No previous session found matching "${resumeTarget}". Starting fresh session.\n`,
        ),
      );
    }
  }

  // Display startup dashboard
  if (options.writeToStdout ?? true) {
    printReplBanner({
      cwd: baseDir,
      sessionId,
      strongPool,
      autoApprove: initialAutoApprove,
      mode: activeMode,
    });
  }

  const commandRegistry = createDefaultCommandRegistry();

  const rl =
    options.rlInterface ??
    readline.createInterface({
      input,
      output,
    });

  let activeAutoApprove = initialAutoApprove;
  const permissionManager = new PermissionManager({
    isAutoApprove: () => activeAutoApprove,
    rl,
    writeToStdout: options.writeToStdout ?? true,
  });

  // Instruction executor with automatic pre-write file snapshotting & token estimation
  const executeInstruction = async (
    prompt: string,
    runOpts?: MachCodeRunOptions,
  ): Promise<MachCodeRunResult> => {
    rl?.pause?.();
    try {
      // Context summarization check (PDF Phase 4: prevent context overflow)
      const summaryResult = await summarizeOldestTurns(sessionHistory, {
        maxContextTokens: 12000,
        turnsToSummarize: 8,
        keepRecentTurns: 4,
      });
      if (summaryResult.summarized) {
        sessionHistory.length = 0;
        sessionHistory.push(...summaryResult.history);
        if (options.writeToStdout ?? true) {
          console.log(
            chalk.cyan(
              `  🧠 [Context Condensed: Saved ${summaryResult.savedTokens} tokens across ${summaryResult.summarizedTurnsCount} earlier turns]`,
            ),
          );
        }
      }

      // Parse and expand @file mentions in prompt
      const mentionResult = await parseAndExpandMentions(prompt, baseDir);
      if (mentionResult.mentionedFiles.length > 0) {
        for (const mf of mentionResult.mentionedFiles) {
          addedContextFiles.add(mf.relativePath);
          if (options.writeToStdout ?? true) {
            console.log(chalk.cyan(`  📎 [Included @${mf.relativePath} (${mf.lineCount} lines)]`));
          }
        }
      }
      const effectivePrompt = prompt + mentionResult.augmentedContext;

      const effectiveStrongPool = commandContext.pinnedModel
        ? [commandContext.pinnedModel]
        : (runOpts?.strongPool ?? commandContext.strongPool ?? strongPool);
      const effectiveWeakPool = commandContext.pinnedModel
        ? [commandContext.pinnedModel]
        : (runOpts?.weakPool ?? commandContext.weakPool ?? weakPool);
      const effectiveHandoff = commandContext.pinnedModel
        ? 0
        : (runOpts?.handoffWindowMs ?? handoffWindowMs);

      const mergedOptions: MachCodeRunOptions = {
        ...options,
        ...runOpts,
        rl,
        baseDir,
        lightModel: runOpts?.lightModel ?? commandContext.lightModel ?? lightModel,
        heavyModel: runOpts?.heavyModel ?? commandContext.heavyModel ?? heavyModel,
        strongPool: effectiveStrongPool,
        weakPool: effectiveWeakPool,
        handoffWindowMs: effectiveHandoff,
        history: sessionHistory,
        addedFiles: addedContextFiles,
        autoApprove: runOpts?.autoApprove ?? commandContext.autoApprove,
        readOnly: runOpts?.readOnly ?? activeMode === 'plan',
        permissionManager,
        agentMode: runOpts?.agentMode ?? options.agentMode ?? true,
        confirmBeforeWrite:
          runOpts?.confirmBeforeWrite ??
          options.confirmBeforeWrite ??
          (!commandContext.autoApprove
            ? (change: ProposedFileChange) =>
                promptFileChangeApproval(change, rl, () => {
                  commandContext.autoApprove = true;
                  activeAutoApprove = true;
                })
            : undefined),
        onBeforeWrite: async (targetPath: string, workspaceDir: string) => {
          try {
            const absPath = path.isAbsolute(targetPath)
              ? targetPath
              : path.resolve(workspaceDir, targetPath);
            const existing = await fs.readFile(absPath, 'utf-8');
            fileSnapshots.push({
              file: absPath,
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

      const result = await runMachCode(effectivePrompt, mergedOptions);

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

      // Auto-save session state to disk (~/.machcode/sessions/<sessionId>.json)
      try {
        await saveSession({
          sessionId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          workspaceDir: baseDir,
          mode: activeMode,
          history: sessionHistory,
          addedFiles: Array.from(addedContextFiles),
          tokenStats,
          snapshots: fileSnapshots,
        });
      } catch {
        // ignore auto-save errors
      }

      // Render interactive status bar after execution
      if (options.writeToStdout ?? true) {
        const totalTokens = tokenStats.estimatedPromptTokens + tokenStats.estimatedCompletionTokens;
        const branch = getGitBranch(baseDir);
        const sb = renderStatusBar({
          mode: activeMode,
          baseDir,
          strongPoolCount: commandContext.pinnedModel
            ? 1
            : (commandContext.strongPool?.length ?? strongPool.length),
          activeModel: commandContext.pinnedModel ?? commandContext.heavyModel,
          isPinned: Boolean(commandContext.pinnedModel),
          gitBranch: branch ?? undefined,
          totalTokens,
          autoApprove: commandContext.autoApprove,
          sessionId,
        });
        console.log(`\n${sb}\n`);
      }

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
    get mode() {
      return activeMode;
    },
    set mode(val: 'build' | 'plan' | undefined) {
      activeMode = val ?? 'build';
    },
    setMode(val: 'build' | 'plan') {
      activeMode = val;
    },
    get autoApprove() {
      return activeAutoApprove;
    },
    set autoApprove(val: boolean | undefined) {
      activeAutoApprove = Boolean(val);
    },
    permissionManager,
    pinnedModel: undefined,
    setPinnedModel(m) {
      commandContext.pinnedModel = m;
    },
    get activeTheme() {
      return getActiveTheme().name;
    },
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

  // Interactive REPL prompt loop: styled using active theme and mode
  const getPromptLabel = () => {
    const theme = getActiveTheme();
    return theme.formatPrompt(activeMode);
  };
  const autocompleteItems = buildAutocompleteItems(commandRegistry, baseDir);
  const promptHistory: string[] = [];

  while (!commandContext.shouldExit) {
    let userInput = '';
    try {
      if (process.stdin.isTTY && !options.rlInterface) {
        userInput = await promptWithSuggestions({
          promptText: getPromptLabel,
          items: autocompleteItems,
          history: promptHistory,
          rlFallback: rl,
          onTabToggleMode: () => {
            activeMode = activeMode === 'plan' ? 'build' : 'plan';
            const theme = getActiveTheme();
            const label =
              activeMode === 'plan'
                ? theme.planMode('[PLAN MODE]')
                : theme.buildMode('[BUILD MODE]');
            process.stdout.write(`\n  ${label} ${chalk.dim('Toggled via Tab')}\n`);
          },
        });
      } else {
        userInput = await rl.question(getPromptLabel());
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
      // Auto-detect drive change commands like "D:" or "cd D:\" or "cd .."
      const driveOnlyMatch = /^[a-zA-Z]:[/\\]?$/.exec(trimmed);
      const cdBareMatch = /^cd\s+(.+)$/i.exec(trimmed);
      if (driveOnlyMatch || cdBareMatch) {
        const targetPath = driveOnlyMatch
          ? `${trimmed.toUpperCase().replace(/[/\\]?$/, '')}\\`
          : cdBareMatch![1].trim();
        await commandRegistry.dispatch(`/cd ${targetPath}`, commandContext);
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
export * from './prompts/agent.js';
export * from './utils/streamParser.js';
export * from './engine/streamRacer.js';
export * from './engine/autoRouter.js';
export * from './engine/executor.js';
export * from './engine/permissions.js';
export * from './engine/agentLoop.js';
export * from './tools/index.js';
export * from './tools/agentTools.js';
export * from './tools/nvidiaSkills.js';
export * from './commands/index.js';
export * from './ui/autocomplete.js';
export * from './ui/terminalInput.js';
export * from './ui/theme.js';
export * from './ui/statusBar.js';
export * from './utils/mentionParser.js';
export * from './engine/sessionManager.js';
export * from './engine/contextSummarizer.js';
