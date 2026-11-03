import readline from 'node:readline';
import type readlinePromises from 'node:readline/promises';
import chalk from 'chalk';
import type { CommandRegistry } from '../commands/commandHandler.js';

export interface AutocompleteItem {
  prefix: string;
  displayCommand: string;
  description: string;
  category: 'Command' | 'Skill';
}

/**
 * Builds the comprehensive list of slash commands and official NVIDIA skills for autocomplete.
 */
export function buildAutocompleteItems(_registry?: CommandRegistry): AutocompleteItem[] {
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

  return items;
}

/**
 * Filters autocomplete items matching the current user input buffer.
 */
export function filterAutocompleteItems(
  buffer: string,
  allItems: AutocompleteItem[],
): AutocompleteItem[] {
  if (!buffer.startsWith('/')) {
    return [];
  }

  const query = buffer.slice(1).trim().toLowerCase();
  if (query.length === 0) {
    // Return all items when user just typed "/"
    return allItems;
  }

  return allItems.filter((item) => {
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
        // Move down line by line and clear each line
        for (let i = 0; i < lastBoxLines; i++) {
          stdout.write('\n\x1b[2K');
        }
        // Move back up
        stdout.write(`\x1b[${lastBoxLines}A`);
        lastBoxLines = 0;
      }
    }

    function render() {
      clearRenderedBox();

      // Clear current line and re-render prompt + buffer
      stdout.write(`\r\x1b[2K${currentPromptText}${buffer}`);

      const filtered =
        !isDismissed && buffer.startsWith('/') ? filterAutocompleteItems(buffer, allItems) : [];

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
        const headerTitle = ` Commands & Loaded Skills${matchCountText} `;
        const borderCyan = chalk.cyan;

        // Top border
        const topFillLen = Math.max(0, cardWidth - headerTitle.length - 4);
        lines.push(borderCyan(`  ╭──${chalk.white.bold(headerTitle)}${'─'.repeat(topFillLen)}╮`));

        for (let i = 0; i < visibleItems.length; i++) {
          const item = visibleItems[i];
          const globalIdx = scrollOffset + i;
          const isSelected = globalIdx === selectedIndex;

          const pointer = isSelected ? chalk.cyan.bold(' ❯ ') : '   ';
          const cmdColor = isSelected ? chalk.white.bold : chalk.cyan;
          const catBadge =
            item.category === 'Skill'
              ? chalk.bgGreen.black.bold(' SKILL ')
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

      // Position terminal cursor at buffer insertion point
      // eslint-disable-next-line no-control-regex
      const cursorCol = currentPromptText.replace(/\x1b\[[0-9;]*m/g, '').length + cursor + 1;
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
          !isDismissed && buffer.startsWith('/') ? filterAutocompleteItems(buffer, allItems) : [];

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
          !isDismissed && buffer.startsWith('/') ? filterAutocompleteItems(buffer, allItems) : [];

        if (filtered.length > 0 && filtered[selectedIndex]) {
          const item = filtered[selectedIndex];
          buffer = `${item.prefix} `;
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
          !isDismissed && buffer.startsWith('/') ? filterAutocompleteItems(buffer, allItems) : [];

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
          !isDismissed && buffer.startsWith('/') ? filterAutocompleteItems(buffer, allItems) : [];

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
          cursor -= 1;
          render();
        }
        return;
      }

      // Handle Right Arrow
      if (key.name === 'right') {
        if (cursor < buffer.length) {
          cursor += 1;
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
          buffer = buffer.slice(0, cursor - 1) + buffer.slice(cursor);
          cursor -= 1;
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
          buffer = buffer.slice(0, cursor) + buffer.slice(cursor + 1);
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

      // Regular character insertion
      if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
        buffer = buffer.slice(0, cursor) + key.sequence + buffer.slice(cursor);
        cursor += 1;
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
