import readline from 'node:readline';
import chalk from 'chalk';

/**
 * Single owner of raw-mode keypress input while the agent is running.
 *
 * Handlers are kept on a stack: only the top-most handler receives keys. This lets the
 * agent's "Esc / Ctrl+C to interrupt" watcher coexist with approval menus that temporarily
 * take over the keyboard, without multiple readline interfaces fighting over stdin.
 */
type KeyHandler = (str: string | undefined, key: readline.Key) => void;

const handlerStack: KeyHandler[] = [];
let dispatcherAttached = false;
let previousRawMode = false;

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;?]*[A-Za-z]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

export function isInteractiveTerminal(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function dispatchKeypress(str: string | undefined, key: readline.Key | undefined): void {
  const handler = handlerStack[handlerStack.length - 1];
  if (handler) {
    handler(str, key ?? { sequence: str ?? '', name: undefined, ctrl: false, meta: false, shift: false });
  }
}

/**
 * Pushes a keypress handler on top of the stack, enabling raw mode while any handler is active.
 * Returns a disposer that removes the handler (and restores the terminal when the stack empties).
 */
export function pushKeyHandler(handler: KeyHandler): () => void {
  const stdin = process.stdin;
  if (!dispatcherAttached) {
    readline.emitKeypressEvents(stdin);
    stdin.on('keypress', dispatchKeypress);
    dispatcherAttached = true;
  }

  if (handlerStack.length === 0) {
    previousRawMode = Boolean(stdin.isRaw);
    if (stdin.isTTY && stdin.setRawMode) {
      stdin.setRawMode(true);
    }
    stdin.resume();
  }
  handlerStack.push(handler);

  let disposed = false;
  return () => {
    if (disposed) {
      return;
    }
    disposed = true;
    const idx = handlerStack.lastIndexOf(handler);
    if (idx >= 0) {
      handlerStack.splice(idx, 1);
    }
    if (handlerStack.length === 0) {
      if (stdin.isTTY && stdin.setRawMode) {
        stdin.setRawMode(previousRawMode);
      }
      stdin.pause();
    }
  };
}

/**
 * Watches for Esc or Ctrl+C while a long-running agent turn is active.
 * Any other keys typed meanwhile are swallowed so they don't leak into later prompts.
 */
export function watchInterrupt(onInterrupt: () => void): () => void {
  return pushKeyHandler((_str, key) => {
    if ((key.ctrl && key.name === 'c') || key.name === 'escape') {
      onInterrupt();
    }
  });
}

function truncateToWidth(text: string, width: number): string {
  const plain = stripAnsi(text);
  if (plain.length <= width) {
    return text;
  }
  // Fall back to a plain truncated string so ANSI codes are never cut in half
  return `${plain.slice(0, Math.max(0, width - 1))}…`;
}

export interface MenuOption<T> {
  label: string;
  value: T;
  /** Optional single-character shortcut (e.g. 'y', 'a', 'n'). */
  shortcut?: string;
}

export interface SelectMenuOptions<T> {
  /** Value returned when the user presses Esc or Ctrl+C. */
  cancelValue: T;
  /** Extra hotkeys that run an action and then re-render the menu (e.g. 'd' for full diff). */
  actions?: Record<string, { hint: string; run: () => void | Promise<void> }>;
}

/**
 * Claude Code style arrow-key selection menu.
 * Supports ↑/↓ + Enter, number keys (1..n), letter shortcuts, and Esc to cancel.
 */
export async function selectMenu<T>(
  options: MenuOption<T>[],
  menuOptions: SelectMenuOptions<T>,
): Promise<T> {
  const stdout = process.stdout;
  let selected = 0;
  let renderedLines = 0;
  const actions = menuOptions.actions ?? {};
  const hintParts = [
    '↑/↓ seç',
    'Enter onayla',
    ...Object.entries(actions).map(([k, a]) => `${k} ${a.hint}`),
    'Esc iptal',
  ];

  const render = () => {
    const cols = stdout.columns || 80;
    if (renderedLines > 0) {
      stdout.write(`\x1b[${renderedLines}A\r\x1b[0J`);
    }
    const lines = options.map((opt, idx) => {
      const isSel = idx === selected;
      const pointer = isSel ? chalk.cyan.bold('❯') : ' ';
      const num = chalk.gray(`${idx + 1}.`);
      const label = isSel ? chalk.white.bold(opt.label) : chalk.white(opt.label);
      return truncateToWidth(`  ${pointer} ${num} ${label}`, cols - 1);
    });
    lines.push(truncateToWidth(chalk.dim(`    ${hintParts.join(' • ')}`), cols - 1));
    stdout.write(`${lines.join('\n')}\n`);
    renderedLines = lines.length;
  };

  const collapse = (chosen: MenuOption<T> | null) => {
    if (renderedLines > 0) {
      stdout.write(`\x1b[${renderedLines}A\r\x1b[0J`);
      renderedLines = 0;
    }
    if (chosen) {
      stdout.write(`  ${chalk.gray('⎿')}  ${chalk.white(chosen.label)}\n`);
    } else {
      stdout.write(`  ${chalk.gray('⎿')}  ${chalk.yellow('İptal edildi')}\n`);
    }
  };

  stdout.write('\x1b[?25l');
  render();

  return new Promise<T>((resolve) => {
    let busy = false;
    let dispose: () => void = () => {};

    const finish = (value: T, chosen: MenuOption<T> | null) => {
      dispose();
      collapse(chosen);
      stdout.write('\x1b[?25h');
      resolve(value);
    };

    dispose = pushKeyHandler((str, key) => {
      if (busy) {
        return;
      }
      if ((key.ctrl && key.name === 'c') || key.name === 'escape') {
        finish(menuOptions.cancelValue, null);
        return;
      }
      if (key.name === 'up' || key.name === 'k') {
        selected = (selected - 1 + options.length) % options.length;
        render();
        return;
      }
      if (key.name === 'down' || key.name === 'j' || key.name === 'tab') {
        selected = (selected + 1) % options.length;
        render();
        return;
      }
      if (key.name === 'return' || key.name === 'enter') {
        finish(options[selected].value, options[selected]);
        return;
      }

      const ch = (str ?? '').toLowerCase();
      if (/^[1-9]$/.test(ch)) {
        const idx = Number.parseInt(ch, 10) - 1;
        if (idx < options.length) {
          finish(options[idx].value, options[idx]);
        }
        return;
      }

      const byShortcut = options.find((o) => o.shortcut && o.shortcut === ch);
      if (byShortcut) {
        finish(byShortcut.value, byShortcut);
        return;
      }

      const action = actions[ch];
      if (action) {
        busy = true;
        // Clear the menu, run the action (e.g. print a full diff), then render the menu again below it
        stdout.write(`\x1b[${renderedLines}A\r\x1b[0J`);
        renderedLines = 0;
        Promise.resolve(action.run())
          .catch(() => {})
          .finally(() => {
            busy = false;
            render();
          });
      }
    });
  });
}

/**
 * Minimal raw-mode line editor used for short free-text answers (e.g. rejection feedback).
 * Enter submits, Esc / Ctrl+C returns an empty string.
 */
export async function readLine(promptText: string): Promise<string> {
  const stdout = process.stdout;
  let buffer = '';

  const redraw = () => {
    stdout.write(`\r\x1b[2K${promptText}${buffer}`);
  };
  redraw();

  return new Promise<string>((resolve) => {
    const dispose = pushKeyHandler((str, key) => {
      if ((key.ctrl && key.name === 'c') || key.name === 'escape') {
        dispose();
        stdout.write('\n');
        resolve('');
        return;
      }
      if (key.name === 'return' || key.name === 'enter') {
        dispose();
        stdout.write('\n');
        resolve(buffer.trim());
        return;
      }
      if (key.name === 'backspace') {
        buffer = buffer.slice(0, -1);
        redraw();
        return;
      }
      if (key.ctrl || key.meta) {
        return;
      }
      // eslint-disable-next-line no-control-regex
      if (str && !/[\x00-\x1f\x7f]/.test(str)) {
        buffer += str;
        redraw();
      }
    });
  });
}
