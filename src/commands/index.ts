import { contextCommands } from './context.js';
import { executionCommands } from './execution.js';
import { gitCommands } from './git.js';
import { systemCommands } from './system.js';
import { skillsCommands } from './skills.js';
import { agentCommand } from './agent.js';
import { CommandRegistry } from './commandHandler.js';
import type { SlashCommand } from './types.js';

export * from './types.js';
export * from './commandHandler.js';
export * from './context.js';
export * from './execution.js';
export * from './git.js';
export * from './system.js';
export * from './skills.js';
export * from './agent.js';

export const allCommands: SlashCommand[] = [
  ...contextCommands,
  ...executionCommands,
  ...skillsCommands,
  agentCommand,
  ...gitCommands,
  ...systemCommands,
];

/**
 * Creates and initializes the CommandRegistry with all 17 official slash commands.
 */
export function createDefaultCommandRegistry(): CommandRegistry {
  const registry = new CommandRegistry();
  registry.registerAll(allCommands);
  return registry;
}
