import type readline from 'node:readline/promises';
import chalk from 'chalk';
import { computeFileDiff } from './executor.js';
import type { CommandToolPlan, WriteToolPlan } from '../tools/agentTools.js';
import { isInteractiveTerminal, readLine, selectMenu, type MenuOption } from '../ui/terminalInput.js';

export type PermissionDecision =
  | { allowed: true }
  | { allowed: false; feedback?: string; cancelled?: boolean };

type Choice = 'yes' | 'always' | 'no';

/**
 * Abstraction over how the user is asked, so non-TTY sessions (tests, pipes) can answer via readline.
 */
export interface PermissionPrompter {
  choose(kind: 'write' | 'command', options: MenuOption<Choice>[], fullDiff?: string): Promise<Choice | 'cancel'>;
  askFeedback(): Promise<string>;
}

export interface PermissionManagerOptions {
  /** Global auto-approve switch (/approve auto, --yes). */
  isAutoApprove: () => boolean;
  /** Custom prompter (tests). Defaults to an arrow-key menu on TTYs or `rl` line input otherwise. */
  prompter?: PermissionPrompter;
  /** Readline used for line-based prompts when stdin is not a TTY. */
  rl?: readline.Interface;
  /** Whether to print approval cards and diffs. Defaults to true. */
  writeToStdout?: boolean;
}

const MULTI_WORD_TOOLS = new Set([
  'git',
  'npm',
  'pnpm',
  'yarn',
  'npx',
  'bun',
  'bunx',
  'deno',
  'cargo',
  'go',
  'dotnet',
  'pip',
  'pip3',
  'uv',
  'poetry',
  'docker',
  'kubectl',
  'gh',
  'make',
  'mvn',
  'gradle',
  'composer',
  'flutter',
  'dart',
]);

/**
 * Derives the "command type" used for session-wide "always allow" approvals.
 * `pnpm test --watch` → `pnpm test`, `git status` → `git status`, `ls -la` → `ls`.
 * Returns null for chained/redirected commands, which must always be confirmed individually.
 */
export function commandPermissionPrefix(command: string): string | null {
  const trimmed = command.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (/[;&|><`]|\$\(/.test(trimmed)) {
    return null;
  }
  const tokens = trimmed.split(/\s+/);
  const first = tokens[0].toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, '');
  const second = tokens[1];
  if (MULTI_WORD_TOOLS.has(first) && second && /^[a-z][\w:.-]*$/i.test(second)) {
    return `${first} ${second.toLowerCase()}`;
  }
  return first;
}

function commandMatchesPrefix(command: string, prefix: string): boolean {
  return commandPermissionPrefix(command) === prefix;
}

class TtyPrompter implements PermissionPrompter {
  async choose(
    _kind: 'write' | 'command',
    options: MenuOption<Choice>[],
    fullDiff?: string,
  ): Promise<Choice | 'cancel'> {
    return selectMenu<Choice | 'cancel'>(options, {
      cancelValue: 'cancel',
      actions: fullDiff
        ? {
            d: {
              hint: 'tam diff',
              run: () => {
                process.stdout.write(`${fullDiff}\n\n`);
              },
            },
          }
        : undefined,
    });
  }

  async askFeedback(): Promise<string> {
    return readLine(
      `  ${chalk.yellow('↳')} ${chalk.white('Bunun yerine ne yapılsın?')} ${chalk.dim('(boş bırak = dur)')} ${chalk.yellow('›')} `,
    );
  }
}

class LinePrompter implements PermissionPrompter {
  constructor(private readonly rl: readline.Interface) {}

  async choose(
    _kind: 'write' | 'command',
    options: MenuOption<Choice>[],
    fullDiff?: string,
  ): Promise<Choice | 'cancel'> {
    const keys = options.map((o) => o.shortcut).filter(Boolean).join('/');
    while (true) {
      const raw = await this.rl.question(`  ? Seçim [${keys}${fullDiff ? '/d' : ''}]: `);
      const ans = raw.trim().toLowerCase();
      if (ans === '' || ans === 'y' || ans === 'yes' || ans === 'e' || ans === 'evet') return 'yes';
      if (ans === 'a' || ans === 'always' || ans === 'hepsi') {
        return options.some((o) => o.value === 'always') ? 'always' : 'yes';
      }
      if (ans === 'n' || ans === 'no' || ans === 'h' || ans === 'hayir' || ans === 'hayır') return 'no';
      if ((ans === 'd' || ans === 'diff') && fullDiff) {
        console.log(`${fullDiff}\n`);
        continue;
      }
      const idx = Number.parseInt(ans, 10);
      if (Number.isInteger(idx) && idx >= 1 && idx <= options.length) {
        return options[idx - 1].value;
      }
    }
  }

  async askFeedback(): Promise<string> {
    return (await this.rl.question('  ↳ Bunun yerine ne yapılsın? (boş = dur): ')).trim();
  }
}

/**
 * Session permission state for agent tool calls (Claude Code style):
 * - read-only tools never ask
 * - file edits show a diff and ask [yes / always this session / no + feedback]
 * - shell commands ask [yes / always for this command type / no + feedback]
 * - writes outside the working directory ALWAYS ask again with an explicit warning
 */
export class PermissionManager {
  private allowAllEdits = false;
  private readonly allowedCommandPrefixes = new Set<string>();
  private readonly options: PermissionManagerOptions;

  constructor(options: PermissionManagerOptions) {
    this.options = options;
  }

  get sessionAllowsAllEdits(): boolean {
    return this.allowAllEdits;
  }

  get sessionAllowedCommands(): string[] {
    return Array.from(this.allowedCommandPrefixes);
  }

  reset(): void {
    this.allowAllEdits = false;
    this.allowedCommandPrefixes.clear();
  }

  private get print(): boolean {
    return this.options.writeToStdout ?? true;
  }

  private resolvePrompter(): PermissionPrompter | null {
    if (this.options.prompter) return this.options.prompter;
    if (isInteractiveTerminal()) return new TtyPrompter();
    if (this.options.rl) return new LinePrompter(this.options.rl);
    return null;
  }

  async requestWrite(plan: WriteToolPlan): Promise<PermissionDecision> {
    const diff = computeFileDiff(plan.displayPath, plan.previousContent, plan.newContent, 40);
    const autoApprove = this.options.isAutoApprove();
    const prompter = this.resolvePrompter();

    // Outside the working directory we always confirm interactively (when someone can answer)
    const mustAsk = plan.outsideWorkspace && prompter !== null;
    const preApproved = !mustAsk && (autoApprove || this.allowAllEdits);

    if (this.print) {
      this.printWriteCard(plan, diff.addedLines, diff.removedLines, diff.isNewFile, diff.diffPreview, preApproved);
    }

    if (preApproved) {
      return { allowed: true };
    }
    if (!prompter) {
      return {
        allowed: false,
        feedback:
          'Non-interactive session without auto-approve: file changes cannot be confirmed. Enable /approve auto or run with --yes.',
      };
    }

    const options: MenuOption<Choice>[] = [
      { label: 'Evet, uygula', value: 'yes', shortcut: 'y' },
    ];
    if (!plan.outsideWorkspace) {
      options.push({
        label: 'Evet, ve bu oturumda tüm düzenlemelere izin ver',
        value: 'always',
        shortcut: 'a',
      });
    }
    options.push({ label: 'Hayır, modele ne yapacağını söyle', value: 'no', shortcut: 'n' });

    const choice = await prompter.choose('write', options, diff.fullDiff);
    return this.finalizeChoice(choice, prompter, () => {
      this.allowAllEdits = true;
    });
  }

  async requestCommand(plan: CommandToolPlan): Promise<PermissionDecision> {
    const prefix = commandPermissionPrefix(plan.command);
    const sessionAllowed =
      prefix !== null &&
      Array.from(this.allowedCommandPrefixes).some((p) => commandMatchesPrefix(plan.command, p));
    const preApproved = this.options.isAutoApprove() || sessionAllowed;

    if (this.print) {
      this.printCommandCard(plan, preApproved);
    }
    if (preApproved) {
      return { allowed: true };
    }

    const prompter = this.resolvePrompter();
    if (!prompter) {
      return {
        allowed: false,
        feedback:
          'Non-interactive session without auto-approve: commands cannot be confirmed. Enable /approve auto or run with --yes.',
      };
    }

    const options: MenuOption<Choice>[] = [{ label: 'Evet, çalıştır', value: 'yes', shortcut: 'y' }];
    if (prefix) {
      options.push({
        label: `Evet, ve bu oturumda "${prefix}" komutlarına hep izin ver`,
        value: 'always',
        shortcut: 'a',
      });
    }
    options.push({ label: 'Hayır, modele ne yapacağını söyle', value: 'no', shortcut: 'n' });

    const choice = await prompter.choose('command', options);
    return this.finalizeChoice(choice, prompter, () => {
      if (prefix) this.allowedCommandPrefixes.add(prefix);
    });
  }

  private async finalizeChoice(
    choice: Choice | 'cancel',
    prompter: PermissionPrompter,
    onAlways: () => void,
  ): Promise<PermissionDecision> {
    if (choice === 'yes') {
      return { allowed: true };
    }
    if (choice === 'always') {
      onAlways();
      return { allowed: true };
    }
    if (choice === 'cancel') {
      return { allowed: false, cancelled: true };
    }
    const feedback = await prompter.askFeedback();
    return feedback ? { allowed: false, feedback } : { allowed: false, cancelled: true };
  }

  private printWriteCard(
    plan: WriteToolPlan,
    added: number,
    removed: number,
    isNewFile: boolean,
    preview: string,
    preApproved: boolean,
  ): void {
    const verb = isNewFile ? 'Create' : plan.toolName === 'edit_file' ? 'Edit' : 'Overwrite';
    const stats = isNewFile
      ? chalk.green(`+${added}`)
      : `${chalk.green(`+${added}`)} ${chalk.red(`-${removed}`)}`;
    const border = chalk.gray;
    const lines: string[] = [];
    lines.push(
      `${chalk.yellow('●')} ${chalk.white.bold(verb)}${chalk.gray('(')}${chalk.white(plan.displayPath)}${chalk.gray(')')}  ${stats}`,
    );
    lines.push(border('  ╭───────────────────────────────────────────────────────────────'));
    for (const row of preview.split('\n')) {
      lines.push(`${border('  │')}${row}`);
    }
    lines.push(border('  ╰───────────────────────────────────────────────────────────────'));
    if (plan.outsideWorkspace) {
      lines.push(
        `  ${chalk.bgYellow.black.bold(' UYARI ')} ${chalk.yellow('Çalışma dizini dışına yazılıyor:')} ${chalk.white.bold(plan.absPath)}`,
      );
    }
    if (!preApproved) {
      lines.push(`  ${chalk.white.bold(isNewFile ? 'Bu dosya oluşturulsun mu?' : 'Bu değişiklik uygulansın mı?')}`);
    }
    console.log(`\n${lines.join('\n')}`);
  }

  private printCommandCard(plan: CommandToolPlan, preApproved: boolean): void {
    const border = chalk.gray;
    const lines: string[] = [];
    lines.push(`${chalk.yellow('●')} ${chalk.white.bold('Run')}${chalk.gray('(')}${chalk.white(plan.command)}${chalk.gray(')')}`);
    if (!preApproved) {
      lines.push(border('  ╭───────────────────────────────────────────────────────────────'));
      for (const row of plan.command.split('\n')) {
        lines.push(`${border('  │')} ${chalk.cyan('$')} ${chalk.white(row)}`);
      }
      lines.push(`${border('  │')} ${chalk.dim(`konum: ${plan.cwd}`)}`);
      lines.push(border('  ╰───────────────────────────────────────────────────────────────'));
      lines.push(`  ${chalk.white.bold('Bu komut çalıştırılsın mı?')}`);
    }
    console.log(`\n${lines.join('\n')}`);
  }
}
