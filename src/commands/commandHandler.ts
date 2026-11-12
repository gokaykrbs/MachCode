import chalk from 'chalk';
import type { SlashCommand, CommandContext, CommandCategory } from './types.js';

export class CommandRegistry {
  private commands = new Map<string, SlashCommand>();
  private aliases = new Map<string, string>();

  /**
   * Registers a slash command and its aliases in the registry.
   */
  public register(command: SlashCommand): this {
    const cleanName = command.name.toLowerCase().replace(/^\//, '');
    this.commands.set(cleanName, command);

    if (command.aliases) {
      for (const alias of command.aliases) {
        const cleanAlias = alias.toLowerCase().replace(/^\//, '');
        this.aliases.set(cleanAlias, cleanName);
      }
    }
    return this;
  }

  /**
   * Registers multiple slash commands.
   */
  public registerAll(commands: SlashCommand[]): this {
    for (const cmd of commands) {
      this.register(cmd);
    }
    return this;
  }

  /**
   * Resolves a command by its primary name or alias.
   */
  public getCommand(nameOrAlias: string): SlashCommand | undefined {
    const clean = nameOrAlias.toLowerCase().replace(/^\//, '');
    const resolvedName = this.aliases.get(clean) ?? clean;
    return this.commands.get(resolvedName);
  }

  /**
   * Returns all registered unique commands.
   */
  public getAllCommands(): SlashCommand[] {
    return Array.from(this.commands.values());
  }

  /**
   * Returns commands grouped by category.
   */
  public getCommandsByCategory(): Record<CommandCategory, SlashCommand[]> {
    const categories: Record<CommandCategory, SlashCommand[]> = {
      'Context & Memory': [],
      'Execution & Modes': [],
      'Safety & Git': [],
      System: [],
      Subagents: [],
    };

    for (const cmd of this.commands.values()) {
      categories[cmd.category].push(cmd);
    }

    return categories;
  }

  /**
   * Dispatches a raw input line if it starts with '/'.
   * Returns true if handled as a slash command, false if plain text prompt.
   */
  public async dispatch(rawInput: string, context: CommandContext): Promise<boolean> {
    const trimmed = rawInput.trim();
    if (!trimmed.startsWith('/')) {
      return false;
    }

    // Parse command name and trailing arguments
    const withoutSlash = trimmed.slice(1).trim();
    const spaceIndex = withoutSlash.search(/\s/);
    const cmdName = spaceIndex === -1 ? withoutSlash : withoutSlash.slice(0, spaceIndex);
    const args = spaceIndex === -1 ? '' : withoutSlash.slice(spaceIndex).trim();

    if (cmdName.length === 0) {
      return true;
    }

    const command = this.getCommand(cmdName);
    if (!command) {
      console.log(
        chalk.red(`\n✖ Unknown slash command: /${cmdName}`) +
          chalk.gray(' — type ') +
          chalk.yellow('/help') +
          chalk.gray(' to view available commands.\n'),
      );
      return true;
    }

    try {
      await command.execute(args, context);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(chalk.red.bold(`\n✖ Error executing /${cmdName}: ${msg}\n`));
    }

    return true;
  }
}
