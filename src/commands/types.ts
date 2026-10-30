import type readline from 'node:readline/promises';
import type { SessionMessage, MachCodeRunOptions, MachCodeRunResult } from '../index.js';
import type { PermissionManager } from '../engine/permissions.js';

export type CommandCategory = 'Context & Memory' | 'Execution & Modes' | 'Safety & Git' | 'System';

export interface FileSnapshot {
  file: string;
  previousContent: string;
  timestamp: number;
}

export interface TokenStats {
  estimatedPromptTokens: number;
  estimatedCompletionTokens: number;
  totalTurns: number;
}

export interface CommandContext {
  baseDir: string;
  lightModel: string;
  heavyModel: string;
  strongPool?: string[];
  weakPool?: string[];
  handoffWindowMs: number;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  sessionHistory: SessionMessage[];
  addedContextFiles: Set<string>;
  fileSnapshots: FileSnapshot[];
  tokenStats: TokenStats;
  rl: readline.Interface;
  shouldExit: boolean;
  sessionId?: string;
  autoApprove?: boolean;
  permissionManager?: PermissionManager;
  runMachCode: (prompt: string, options?: MachCodeRunOptions) => Promise<MachCodeRunResult>;
}

export interface CommandResult {
  handled: boolean;
  output?: string;
}

export interface SlashCommand {
  name: string;
  description: string;
  category: CommandCategory;
  usage?: string;
  aliases?: string[];
  execute: (args: string, context: CommandContext) => Promise<CommandResult | void>;
}
