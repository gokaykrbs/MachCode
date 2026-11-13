import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import type readlinePromises from 'node:readline/promises';
import chalk from 'chalk';
import type { CommandRegistry } from '../commands/commandHandler.js';

export interface AutocompleteItem {
  prefix: string;
  displayCommand: string;
  description: string;
  category: 'Command' | 'Skill' | 'File' | 'Subagent';
}

/**
 * Builds the comprehensive list of slash commands, official NVIDIA skills, and workspace files for autocomplete.
 */
export function buildAutocompleteItems(
  _registry?: CommandRegistry,
  baseDir?: string,
): AutocompleteItem[] {
  const items: AutocompleteItem[] = [];
  const seenPrefixes = new Set<string>();

  // 1. Core slash commands from registry or standard list
  const coreCommands: Array<{ prefix: string; displayCommand: string; description: string }> = [
    {
      prefix: '/ask',
      displayCommand: '/ask <question>',
      description: 'Ask a question or chat without modifying workspace files',
    },
    {
      prefix: '/approve',
      displayCommand: '/approve [ask|auto]',
      description: 'Toggle interactive diff approval before modifying files',
    },
    {
      prefix: '/skills',
      displayCommand: '/skills [name] [task]',
      description: 'List or run tasks with loaded official NVIDIA Agent Skills',
    },
    {
      prefix: '/race',
      displayCommand: '/race',
      description: 'Run live parallel speed benchmark across all AI models',
    },
    {
      prefix: '/plan',
      displayCommand: '/plan <prompt>',
      description: 'Generate architectural plan only without modifying files',
    },
    {
      prefix: '/heavy',
      displayCommand: '/heavy <prompt>',
      description: 'Execute exclusively using the Heavyweight model',
    },
    {
      prefix: '/fast',
      displayCommand: '/fast <prompt>',
      description: 'Execute exclusively using the Lightweight model',
    },
    {
      prefix: '/review',
      displayCommand: '/review <file>',
      description: 'Run deep security, bug and edge-case code review',
    },
    {
      prefix: '/undo',
      displayCommand: '/undo',
      description: 'Revert the last file modification made by the AI',
    },
    {
      prefix: '/diff',
      displayCommand: '/diff',
      description: 'Show terminal diff of uncommitted git changes',
    },
    {
      prefix: '/commit',
      displayCommand: '/commit',
      description: 'Generate conventional commit message and commit',
    },
    {
      prefix: '/config',
      displayCommand: '/config [refresh|key]',
      description: 'View or refresh autonomous multi-model racing pools & key',
    },
    {
      prefix: '/tokens',
      displayCommand: '/tokens',
      description: 'Show session token usage statistics',
    },
    {
      prefix: '/add',
      displayCommand: '/add <path>',
      description: 'Add file or directory to active session context',
    },
    {
      prefix: '/drop',
      displayCommand: '/drop <path>',
      description: 'Remove file or directory from session context',
    },
    {
      prefix: '/cd',
      displayCommand: '/cd <path>',
      description: 'Change active workspace directory (e.g. /cd D:\\ or /cd ..)',
    },
    {
      prefix: '/ls',
      displayCommand: '/ls [path]',
      description: 'List files and directories in current workspace or path',
    },
    {
      prefix: '/context',
      displayCommand: '/context',
      description: 'List currently loaded files and token usage estimate',
    },
    {
      prefix: '/reset',
      displayCommand: '/reset',
      description: 'Clear entire session history and context files',
    },
    {
      prefix: '/run',
      displayCommand: '/run <cmd>',
      description: 'Execute shell command directly in workspace',
    },
    {
      prefix: '/status',
      displayCommand: '/status',
      description: 'Show interactive session status card and bar',
    },
    {
      prefix: '/theme',
      displayCommand: '/theme [name]',
      description: 'Switch terminal theme (tokyo-night, dracula, matrix, monokai)',
    },
    {
      prefix: '/model',
      displayCommand: '/model [model-id|reset]',
      description: 'Pin queries to model or view racing pools',
    },
    {
      prefix: '/mode',
      displayCommand: '/mode [plan|build|toggle]',
      description: 'Switch between Plan (read-only) and Build (full agent) modes',
    },
    {
      prefix: '/agent',
      displayCommand: '/agent [architect|coder|tester|reviewer|nvidia|reset]',
      description: 'Switch or inspect specialized NVIDIA NIM subagents',
    },
    {
      prefix: '/build',
      displayCommand: '/build',
      description: 'Switch session directly to Build Mode',
    },
    { prefix: '/help', displayCommand: '/help', description: 'Print table of all slash commands' },
    { prefix: '/clear', displayCommand: '/clear', description: 'Clear the terminal screen' },
    { prefix: '/exit', displayCommand: '/exit', description: 'Gracefully exit the MachCode CLI' },
  ];

  for (const cmd of coreCommands) {
    if (!seenPrefixes.has(cmd.prefix)) {
      seenPrefixes.add(cmd.prefix);
      items.push({
        prefix: cmd.prefix,
        displayCommand: cmd.displayCommand,
        description: cmd.description,
        category: 'Command',
      });
    }
  }

  // 2. Official NVIDIA Skills as top-level skill suggestions
  const skillShorthands: Array<{
    prefix: string;
    displayCommand: string;
    description: string;
    tags?: string[];
  }> = [
    {
      prefix: '/skill cuopt',
      displayCommand: '/skill cuopt [task]',
      description: 'cuOpt: GPU-accelerated LP, MILP & Vehicle Routing API',
    },
    {
      prefix: '/skill cudf',
      displayCommand: '/skill cudf [task]',
      description: 'cuDF: GPU DataFrames, pandas acceleration & ETL',
    },
    {
      prefix: '/skill cudaq',
      displayCommand: '/skill cudaq [task]',
      description: 'CUDA-Q: Quantum-classical hybrid programming guide',
    },
    {
      prefix: '/skill deepstream',
      displayCommand: '/skill deepstream [task]',
      description: 'DeepStream: Vision AI & video analytics pipelines',
    },
    {
      prefix: '/skill doca',
      displayCommand: '/skill doca [task]',
      description: 'DOCA: BlueField DPU & ConnectX NIC programming',
    },
    {
      prefix: '/skill dali',
      displayCommand: '/skill dali [task]',
      description: 'DALI: GPU data loading & preprocessing pipelines',
    },
    {
      prefix: '/skill bionemo',
      displayCommand: '/skill bionemo [task]',
      description: 'BioNeMo: Biomolecular research & protein design',
    },
    {
      prefix: '/skill dynamo',
      displayCommand: '/skill dynamo [task]',
      description: 'Dynamo: Distributed LLM inference deployment on K8s',
    },
    {
      prefix: '/skill data-designer',
      displayCommand: '/skill data-designer',
      description: 'NeMo Data Designer: Declarative synthetic datasets',
    },
    {
      prefix: '/skill earth2',
      displayCommand: '/skill earth2 [task]',
      description: 'Earth2Studio: Deep learning weather & climate AI',
    },
    {
      prefix: '/skill ethos',
      displayCommand: '/skill ethos [task]',
      description: 'Ethos: Agent purpose, boundaries & governance',
    },
    {
      prefix: '/skill ontology',
      displayCommand: '/skill ontology [task]',
      description: 'Auto Ontology: Semantic models & text-to-SQL',
    },
  ];

  for (const skill of skillShorthands) {
    if (!seenPrefixes.has(skill.prefix)) {
      seenPrefixes.add(skill.prefix);
      items.push({
        prefix: skill.prefix,
        displayCommand: skill.displayCommand,
        description: skill.description,
        category: 'Skill',
      });
    }
  }

  // 3. Direct skill shortcuts (e.g. /cuopt, /cudf, /cudaq)
  const directShortcuts = [
    {
      prefix: '/cuopt',
      display: '/cuopt [task]',
      desc: 'cuOpt: GPU vehicle routing & optimization',
    },
    {
      prefix: '/cudf',
      display: '/cudf [task]',
      desc: 'cuDF: GPU DataFrames & pandas acceleration',
    },
    { prefix: '/cudaq', display: '/cudaq [task]', desc: 'CUDA-Q: Quantum-classical programming' },
    {
      prefix: '/deepstream',
      display: '/deepstream [task]',
      desc: 'DeepStream: Vision AI & video analytics',
    },
    { prefix: '/doca', display: '/doca [task]', desc: 'DOCA: BlueField DPU networking' },
    { prefix: '/dali', display: '/dali [task]', desc: 'DALI: GPU data preprocessing' },
    {
      prefix: '/bionemo',
      display: '/bionemo [task]',
      desc: 'BioNeMo: Drug discovery & protein design',
    },
    { prefix: '/dynamo', display: '/dynamo [task]', desc: 'Dynamo: Distributed LLM inference' },
  ];

  for (const sc of directShortcuts) {
    if (!seenPrefixes.has(sc.prefix)) {
      seenPrefixes.add(sc.prefix);
      items.push({
        prefix: sc.prefix,
        displayCommand: sc.display,
        description: sc.desc,
        category: 'Skill',
      });
    }
  }

  // 3. Specialized NVIDIA NIM Subagents for @ mentions
  const subagentItems: Array<{ prefix: string; description: string }> = [
    {
      prefix: '@architect',
      description: 'Subagent: System architecture, RFCs, modularity & schemas',
    },
    {
      prefix: '@coder',
      description: 'Subagent: Surgical code implementation, diff generation & bug fixing',
    },
    {
      prefix: '@tester',
      description: 'Subagent: Automated test suite engineering & edge-case coverage',
    },
    {
      prefix: '@reviewer',
      description: 'Subagent: Security auditing, performance bottlenecks & code quality',
    },
    {
      prefix: '@nvidia',
      description: 'Subagent: NVIDIA GPU acceleration, CUDA C++, TensorRT & cuDF',
    },
  ];

  for (const sa of subagentItems) {
    if (!seenPrefixes.has(sa.prefix)) {
      seenPrefixes.add(sa.prefix);
      items.push({
        prefix: sa.prefix,
        displayCommand: sa.prefix,
        description: sa.description,
        category: 'Subagent',
      });
    }
  }

  // 4. Workspace files for @ mentions autocomplete (if baseDir specified)
  if (baseDir) {
    try {
      const scanDir = (dir: string, depth = 0) => {
        if (depth > 2) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (
            entry.name.startsWith('.') ||
            entry.name === 'node_modules' ||
            entry.name === 'dist' ||
            entry.name === '.pnpm-store'
          ) {
            continue;
          }
          const full = path.join(dir, entry.name);
          const rel = path.relative(baseDir, full).replace(/\\/g, '/');
          if (entry.isFile()) {
            const prefix = `@${rel}`;
            if (!seenPrefixes.has(prefix)) {
              seenPrefixes.add(prefix);
              items.push({
                prefix,
                displayCommand: prefix,
                description: `Workspace file (${entry.name})`,
                category: 'File',
              });
            }
          } else if (entry.isDirectory()) {
            scanDir(full, depth + 1);
          }
        }
      };
      scanDir(baseDir);
    } catch {
      // ignore
    }
  }

  return items;
}

/**
 * Filters autocomplete items matching the current user input buffer.
 */
export function filterAutocompleteItems(
  buffer: string,
  allItems: AutocompleteItem[],
): AutocompleteItem[] {
  if (buffer.startsWith('/')) {
    const query = buffer.slice(1).trim().toLowerCase();
    if (query.length === 0) {
      // Return all command/skill items when user typed "/"
      return allItems.filter((i) => i.prefix.startsWith('/'));
    }

    return allItems.filter((item) => {
      if (item.category === 'File') return false;
      const itemPrefix = item.prefix.toLowerCase();
      const itemDisplay = item.displayCommand.toLowerCase();
      const itemDesc = item.description.toLowerCase();
      const queryNoSlash = query.startsWith('/') ? query.slice(1) : query;

      return (
        itemPrefix.includes(query) ||
        itemDisplay.includes(query) ||
        itemDesc.includes(query) ||
        itemPrefix.replace(/[^a-z0-9]/g, '').includes(queryNoSlash)
      );
    });
  }

  // Check for @ mention trigger (files and subagents)
  const mentionMatch = /(?:^|\s)@([a-zA-Z0-9_\-./\\]*)$/.exec(buffer);
  if (mentionMatch) {
    const query = mentionMatch[1].toLowerCase();
    return allItems.filter((item) => {
      if (item.category !== 'File' && item.category !== 'Subagent') return false;
      const cleanPrefix = item.prefix.replace(/^@/, '').toLowerCase();
      return query === '' || cleanPrefix.includes(query);
    });
  }

  return [];
}

/**
 * Strips all ANSI escape sequences (CSI, OSC, color codes, mode set/reset).
 */
export function stripAnsiCodes(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;?]*[a-zA-Z]|\x1b\].*?(?:\x07|\x1b\\)|\x1b[()][AB012]/g, '');
}

/**
 * Calculates visual column width of a character or code point in a terminal emulator.
 * Supports emojis (✨, ⚡, 💎, 🧛), East Asian wide characters, and zero-width modifiers.
 */
export function getCodePointWidth(codePoint: number): number {
  if (codePoint === 0) return 0;
  // Control characters
  if (codePoint < 32 || (codePoint >= 0x7f && codePoint < 0xa0)) return 0;
  // Combining characters, zero-width spaces, variation selectors
  if (
    (codePoint >= 0x0300 && codePoint <= 0x036f) || // Combining Diacritical Marks
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0x200b && codePoint <= 0x200f) || // Zero-width spaces & marks
    (codePoint >= 0x202a && codePoint <= 0x202e) || // Directional formatting
    (codePoint >= 0x2060 && codePoint <= 0x206f) ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) || // Variation Selectors
    (codePoint >= 0xe0100 && codePoint <= 0xe01ef)
  ) {
    return 0;
  }
  // East Asian Wide / Fullwidth / Emojis
  if (
    codePoint >= 0x1100 &&
    (codePoint <= 0x115f || // Hangul Jamo
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) || // CJK Radicals, Kanji
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) || // Hangul Syllables
      (codePoint >= 0xf900 && codePoint <= 0xfaff) || // CJK Compatibility Ideographs
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) || // Vertical forms
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) || // CJK Compatibility Forms
      (codePoint >= 0xff00 && codePoint <= 0xff60) || // Fullwidth Forms
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x20000 && codePoint <= 0x3fffd) ||
      // Symbols, Dingbats & Emojis (✨ 0x2728, ⚡ 0x26A1, 💎 0x1F48E, 🧛 0x1F9DB, 🤖 0x1F916, etc.)
      (codePoint >= 0x2600 && codePoint <= 0x27bf) ||
      (codePoint >= 0x1f000 && codePoint <= 0x1f9ff) ||
      (codePoint >= 0x1fa00 && codePoint <= 0x1faff))
  ) {
    return 2;
  }
  return 1;
}

/**
 * Accurately measures the visual column width of any string in terminal monospace cells,
 * taking into account ANSI escape sequences, multi-byte emojis, and fullwidth glyphs.
 */
export function getVisualWidth(text: string): number {
  const clean = stripAnsiCodes(text);
  let width = 0;
  for (const char of clean) {
    const codePoint = char.codePointAt(0);
    if (codePoint !== undefined) {
      width += getCodePointWidth(codePoint);
    }
  }
  return width;
}

export interface PromptWithSuggestionsOptions {
  promptText: string | (() => string);
  items?: AutocompleteItem[];
  history?: string[];
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  rlFallback?: readlinePromises.Interface;
  onTabToggleMode?: () => void;
}

/**
 * Prompts the user with an interactive Antigravity-style autocomplete suggestion card.
 * Whenever the user types `/`, a live filtered dropdown of slash commands & loaded NVIDIA skills
 * appears underneath the prompt, navigable via arrow keys and autocompletable via Tab.
 */
export async function promptWithSuggestions(
  options: PromptWithSuggestionsOptions,
): Promise<string> {
  const isTty = process.stdin.isTTY && process.stdout.isTTY;

  // Fall back to standard readline question if not in an interactive TTY
  if (!isTty && options.rlFallback) {
    const fallbackText =
      typeof options.promptText === 'function' ? options.promptText() : options.promptText;
    return options.rlFallback.question(fallbackText);
  }

  let currentPromptText =
    typeof options.promptText === 'function' ? options.promptText() : options.promptText;

  const allItems = options.items ?? buildAutocompleteItems();
  const history = options.history ?? [];
  let historyIndex = history.length;

  let buffer = '';
  let cursor = 0;
  let selectedIndex = 0;
  let scrollOffset = 0;
  let isDismissed = false;
  let lastBoxLines = 0;
  const maxVisible = 6;

  const stdout = process.stdout;
  const stdin = process.stdin;

  return new Promise<string>((resolve) => {
    // Enable raw mode
    readline.emitKeypressEvents(stdin);
    const wasRaw = stdin.isRaw;
    if (stdin.setRawMode) {
      stdin.setRawMode(true);
    }
    stdin.resume();

    function clearRenderedBox() {
      if (lastBoxLines > 0) {
        // Clear previous suggestion box downwards from current prompt line
        stdout.write('\r\x1b[2K\x1b[J');
        lastBoxLines = 0;
      }
    }

    function render() {
      clearRenderedBox();

      currentPromptText =
        typeof options.promptText === 'function' ? options.promptText() : currentPromptText;

      // Clear current line and re-render prompt + buffer
      stdout.write(`\r\x1b[2K${currentPromptText}${buffer}`);

      const filtered =
        !isDismissed && (buffer.startsWith('/') || buffer.includes('@'))
          ? filterAutocompleteItems(buffer, allItems)
          : [];

      if (filtered.length > 0) {
        if (selectedIndex >= filtered.length) {
          selectedIndex = Math.max(0, filtered.length - 1);
        }
        if (selectedIndex < scrollOffset) {
          scrollOffset = selectedIndex;
        } else if (selectedIndex >= scrollOffset + maxVisible) {
          scrollOffset = selectedIndex - maxVisible + 1;
        }

        const visibleItems = filtered.slice(scrollOffset, scrollOffset + maxVisible);
        const termCols = stdout.columns || 80;
        const cardWidth = Math.min(termCols - 4, 76);

        const lines: string[] = [];
        const matchCountText =
          filtered.length !== allItems.length ? ` (${filtered.length} matches)` : '';
        const isFileMode = filtered.some((f) => f.category === 'File');
        const headerTitle = isFileMode
          ? ` Mention Workspace File${matchCountText} `
          : ` Commands & Loaded Skills${matchCountText} `;
        const borderCyan = isFileMode ? chalk.magenta : chalk.cyan;

        // Top border
        const topFillLen = Math.max(0, cardWidth - headerTitle.length - 4);
        lines.push(borderCyan(`  ╭──${chalk.white.bold(headerTitle)}${'─'.repeat(topFillLen)}╮`));

        for (let i = 0; i < visibleItems.length; i++) {
          const item = visibleItems[i];
          const globalIdx = scrollOffset + i;
          const isSelected = globalIdx === selectedIndex;

          const pointer = isSelected ? chalk.cyan.bold(' ❯ ') : '   ';
          const cmdColor = isSelected
            ? chalk.white.bold
            : item.category === 'File'
              ? chalk.magenta
              : chalk.cyan;
          const catBadge =
            item.category === 'Skill'
              ? chalk.bgGreen.black.bold(' SKILL ')
              : item.category === 'File'
                ? chalk.bgMagenta.black.bold(' FILE ')
                : chalk.bgBlue.black.bold(' CMD ');

          const cmdPadded = item.displayCommand.padEnd(26, ' ');
          const descLen = Math.max(10, cardWidth - 36);
          const descTrunc =
            item.description.length > descLen
              ? `${item.description.slice(0, descLen - 3)}...`
              : item.description;

          const descColor = isSelected ? chalk.white : chalk.gray;
          const rowContent = `${pointer}${catBadge} ${cmdColor(cmdPadded)} ${descColor(descTrunc)}`;

          lines.push(
            borderCyan('  │') +
              rowContent.padEnd(cardWidth - 2, ' ').slice(0, cardWidth - 2) +
              borderCyan('│'),
          );
        }

        // Bottom border
        lines.push(borderCyan(`  ╰${'─'.repeat(cardWidth - 2)}╯`));
        lines.push(chalk.dim('   ↑/↓ navigate • Tab complete • Enter run • Esc close'));

        lastBoxLines = lines.length;

        // Print box lines below
        stdout.write('\n' + lines.join('\n'));

        // Return cursor back to prompt line at correct column
        stdout.write(`\x1b[${lastBoxLines}A`);
      }

      // Position terminal cursor precisely at buffer insertion point using accurate visual width
      const promptColWidth = getVisualWidth(currentPromptText);
      const bufferColWidth = getVisualWidth(buffer.slice(0, cursor));
      const cursorCol = promptColWidth + bufferColWidth + 1;
      stdout.write(`\r\x1b[${cursorCol}G`);
    }

    function cleanup() {
      clearRenderedBox();
      stdin.removeListener('keypress', onKeypress);
      if (stdin.setRawMode) {
        stdin.setRawMode(wasRaw ?? false);
      }
    }

    function onKeypress(_str: string, key: readline.Key) {
      if (!key) {
        return;
      }

      // Handle Ctrl+C
      if (key.ctrl && key.name === 'c') {
        cleanup();
        stdout.write(chalk.yellow('\n\n👋 Goodbye!\n\n'));
        process.exit(0);
      }

      // Handle Enter / Return
      if (key.name === 'return' || key.name === 'enter') {
        const filtered =
          !isDismissed && (buffer.startsWith('/') || buffer.includes('@'))
            ? filterAutocompleteItems(buffer, allItems)
            : [];

        // If user typed exact "/" and hit Enter with an item selected, autocomplete and submit
        if (buffer === '/' && filtered.length > 0 && filtered[selectedIndex]) {
          buffer = filtered[selectedIndex].prefix;
        }

        cleanup();
        stdout.write('\n');
        resolve(buffer.trim());
        return;
      }

      // Handle Tab (autocomplete selected item into buffer, or toggle mode when buffer is empty)
      if (key.name === 'tab') {
        const filtered =
          !isDismissed && (buffer.startsWith('/') || buffer.includes('@'))
            ? filterAutocompleteItems(buffer, allItems)
            : [];

        if (filtered.length > 0 && filtered[selectedIndex]) {
          const item = filtered[selectedIndex];
          if (item.category === 'File') {
            buffer = buffer.replace(/(?:^|\s)@([a-zA-Z0-9_\-./\\]*)$/, (m) => {
              const leadingSpace = m.startsWith(' ') ? ' ' : '';
              return `${leadingSpace}${item.prefix} `;
            });
          } else {
            buffer = `${item.prefix} `;
          }
          cursor = buffer.length;
          selectedIndex = 0;
          scrollOffset = 0;
          render();
          return;
        }

        // When prompt buffer is empty, Tab toggles between Plan Mode and Build Mode (PDF requirement)
        if (buffer.length === 0 && options.onTabToggleMode) {
          options.onTabToggleMode();
          currentPromptText =
            typeof options.promptText === 'function' ? options.promptText() : options.promptText;
          render();
          return;
        }
      }

      // Handle Escape (dismiss suggestion box)
      if (key.name === 'escape') {
        isDismissed = true;
        render();
        return;
      }

      // Handle Up Arrow
      if (key.name === 'up') {
        const filtered =
          !isDismissed && (buffer.startsWith('/') || buffer.includes('@'))
            ? filterAutocompleteItems(buffer, allItems)
            : [];

        if (filtered.length > 0) {
          selectedIndex = (selectedIndex - 1 + filtered.length) % filtered.length;
          render();
          return;
        }

        // Navigate input history when box is not visible
        if (history.length > 0 && historyIndex > 0) {
          historyIndex -= 1;
          buffer = history[historyIndex] ?? '';
          cursor = buffer.length;
          render();
          return;
        }
      }

      // Handle Down Arrow
      if (key.name === 'down') {
        const filtered =
          !isDismissed && (buffer.startsWith('/') || buffer.includes('@'))
            ? filterAutocompleteItems(buffer, allItems)
            : [];

        if (filtered.length > 0) {
          selectedIndex = (selectedIndex + 1) % filtered.length;
          render();
          return;
        }

        // Navigate input history down
        if (history.length > 0 && historyIndex < history.length - 1) {
          historyIndex += 1;
          buffer = history[historyIndex] ?? '';
          cursor = buffer.length;
          render();
          return;
        } else if (historyIndex === history.length - 1) {
          historyIndex = history.length;
          buffer = '';
          cursor = 0;
          render();
          return;
        }
      }

      // Handle Left Arrow
      if (key.name === 'left') {
        if (cursor > 0) {
          const prevCode = buffer.charCodeAt(cursor - 1);
          const step = prevCode >= 0xdc00 && prevCode <= 0xdfff && cursor >= 2 ? 2 : 1;
          cursor -= step;
          render();
        }
        return;
      }

      // Handle Right Arrow
      if (key.name === 'right') {
        if (cursor < buffer.length) {
          const nextCode = buffer.charCodeAt(cursor);
          const step = nextCode >= 0xd800 && nextCode <= 0xdbff && cursor + 1 < buffer.length ? 2 : 1;
          cursor += step;
          render();
        } else {
          // At end of line: can autocomplete current match
          const filtered =
            !isDismissed && buffer.startsWith('/') ? filterAutocompleteItems(buffer, allItems) : [];
          if (filtered.length > 0 && filtered[selectedIndex]) {
            buffer = `${filtered[selectedIndex].prefix} `;
            cursor = buffer.length;
            render();
          }
        }
        return;
      }

      // Handle Backspace
      if (key.name === 'backspace') {
        if (cursor > 0) {
          const prevCode = buffer.charCodeAt(cursor - 1);
          const step = prevCode >= 0xdc00 && prevCode <= 0xdfff && cursor >= 2 ? 2 : 1;
          buffer = buffer.slice(0, cursor - step) + buffer.slice(cursor);
          cursor -= step;
          selectedIndex = 0;
          scrollOffset = 0;
          isDismissed = false;
          render();
        }
        return;
      }

      // Handle Delete
      if (key.name === 'delete') {
        if (cursor < buffer.length) {
          const nextCode = buffer.charCodeAt(cursor);
          const step = nextCode >= 0xd800 && nextCode <= 0xdbff && cursor + 1 < buffer.length ? 2 : 1;
          buffer = buffer.slice(0, cursor) + buffer.slice(cursor + step);
          selectedIndex = 0;
          scrollOffset = 0;
          render();
        }
        return;
      }

      // Handle Home / Ctrl+A
      if (key.name === 'home' || (key.ctrl && key.name === 'a')) {
        cursor = 0;
        render();
        return;
      }

      // Handle End / Ctrl+E
      if (key.name === 'end' || (key.ctrl && key.name === 'e')) {
        cursor = buffer.length;
        render();
        return;
      }

      // Handle Ctrl+U (clear line)
      if (key.ctrl && key.name === 'u') {
        buffer = '';
        cursor = 0;
        selectedIndex = 0;
        scrollOffset = 0;
        render();
        return;
      }

      // Regular character insertion (characters, emojis, unicode glyphs, pasted text)
      const inputStr = _str || key.sequence;
      // eslint-disable-next-line no-control-regex
      if (inputStr && !key.ctrl && !key.meta && !/[\x00-\x08\x0a-\x1f\x7f]/.test(inputStr)) {
        buffer = buffer.slice(0, cursor) + inputStr + buffer.slice(cursor);
        cursor += inputStr.length;
        selectedIndex = 0;
        scrollOffset = 0;
        isDismissed = false;
        render();
      }
    }

    stdin.on('keypress', onKeypress);
    render();
  });
}
