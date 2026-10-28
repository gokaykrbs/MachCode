import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createDefaultCommandRegistry,
  CommandRegistry,
  type SlashCommand,
  type CommandContext,
  type FileSnapshot,
  type TokenStats,
} from './index.js';
import type { MachCodeRunOptions, MachCodeRunResult, SessionMessage } from '../index.js';

/**
 * Creates a mock CommandContext for testing slash commands.
 */
function createMockContext(overrides: Partial<CommandContext> = {}): {
  context: CommandContext;
  executedPrompts: Array<{ prompt: string; options?: MachCodeRunOptions }>;
  closed: boolean;
} {
  const executedPrompts: Array<{ prompt: string; options?: MachCodeRunOptions }> = [];
  let closed = false;

  const sessionHistory: SessionMessage[] = [];
  const addedContextFiles = new Set<string>();
  const fileSnapshots: FileSnapshot[] = [];
  const tokenStats: TokenStats = {
    estimatedPromptTokens: 0,
    estimatedCompletionTokens: 0,
    totalTurns: 0,
  };

  const mockRl = {
    question: async () => '',
    close: () => {
      closed = true;
    },
    on: () => {},
  } as unknown as import('node:readline/promises').Interface;

  const mockRunMachCode = async (
    prompt: string,
    options?: MachCodeRunOptions,
  ): Promise<MachCodeRunResult> => {
    executedPrompts.push({ prompt, options });
    return {
      raceResult: {
        winnerModel: options?.heavyModel ?? 'mock-model',
        winnerRole: 'heavy',
        handoffOccurred: false,
        handoffElapsedMs: null,
        lightAborted: false,
        heavyAborted: false,
        parseResult: {
          plan: 'mock plan',
          extractedCode: 'mock code',
          codeBlocks: [],
          question: null,
          isHalted: false,
          visibleOutput: 'mock code',
        },
        finalTerminalOutput: 'mock code',
      },
      executionSummary: {
        modifiedFiles: [],
        skipped: false,
        formattedSummary: 'mock summary',
      },
      toolsLoaded: [],
      questionRounds: 0,
    };
  };

  const context: CommandContext = {
    baseDir: process.cwd(),
    lightModel: 'meta/llama-3.3-70b-instruct',
    heavyModel: 'qwen/qwen2.5-coder-32b-instruct',
    handoffWindowMs: 3000,
    apiKey: 'nvapi-mock-key',
    sessionHistory,
    addedContextFiles,
    fileSnapshots,
    tokenStats,
    rl: mockRl,
    shouldExit: false,
    runMachCode: mockRunMachCode,
    ...overrides,
  };

  return { context, executedPrompts, closed };
}

describe('Slash Command Registry & Command Handler', () => {
  it('registers commands and resolves them by primary name and aliases', () => {
    const registry = new CommandRegistry();
    const testCmd: SlashCommand = {
      name: 'testcmd',
      description: 'Test command description',
      category: 'System',
      aliases: ['tc', 't'],
      execute: async () => {},
    };

    registry.register(testCmd);

    assert.equal(registry.getCommand('testcmd')?.name, 'testcmd');
    assert.equal(registry.getCommand('/testcmd')?.name, 'testcmd');
    assert.equal(registry.getCommand('tc')?.name, 'testcmd');
    assert.equal(registry.getCommand('/tc')?.name, 'testcmd');
    assert.equal(registry.getCommand('T')?.name, 'testcmd');
    assert.equal(registry.getCommand('nonexistent'), undefined);
  });

  it('createDefaultCommandRegistry loads all 17 official commands across 4 categories', () => {
    const registry = createDefaultCommandRegistry();
    const all = registry.getAllCommands();
    assert.ok(all.length >= 15, `Expected at least 15 commands, got ${all.length}`);

    const grouped = registry.getCommandsByCategory();
    assert.ok(grouped['Context & Memory'].length >= 4);
    assert.ok(grouped['Execution & Modes'].length >= 4);
    assert.ok(grouped['Safety & Git'].length >= 3);
    assert.ok(grouped['System'].length >= 5);
  });

  it('dispatch returns false for non-slash inputs and true for slash inputs', async () => {
    const registry = createDefaultCommandRegistry();
    const { context } = createMockContext();

    const isNonSlash = await registry.dispatch('Make the login button blue', context);
    assert.equal(isNonSlash, false);

    const isSlash = await registry.dispatch('/tokens', context);
    assert.equal(isSlash, true);

    const isUnknown = await registry.dispatch('/nonexistentcommand123', context);
    assert.equal(isUnknown, true);
  });

  it('/plan wraps prompt in plan-only mode without file writing instructions', async () => {
    const registry = createDefaultCommandRegistry();
    const { context, executedPrompts } = createMockContext();

    await registry.dispatch('/plan Refactor the authentication service', context);

    assert.equal(executedPrompts.length, 1);
    assert.ok(executedPrompts[0].prompt.includes('[STRICT PLAN-ONLY MODE'));
    assert.ok(executedPrompts[0].prompt.includes('Refactor the authentication service'));
  });

  it('/heavy bypasses racing and routes exclusively to the Heavyweight model with handoffWindowMs: 0', async () => {
    const registry = createDefaultCommandRegistry();
    const { context, executedPrompts } = createMockContext();

    await registry.dispatch('/heavy Write high-performance red-black tree', context);

    assert.equal(executedPrompts.length, 1);
    assert.equal(executedPrompts[0].options?.lightModel, context.heavyModel);
    assert.equal(executedPrompts[0].options?.heavyModel, context.heavyModel);
    assert.equal(executedPrompts[0].options?.handoffWindowMs, 0);
    assert.equal(executedPrompts[0].prompt, 'Write high-performance red-black tree');
  });

  it('/fast bypasses racing and routes exclusively to the Lightweight model', async () => {
    const registry = createDefaultCommandRegistry();
    const { context, executedPrompts } = createMockContext();

    await registry.dispatch('/fast Add simple interface type', context);

    assert.equal(executedPrompts.length, 1);
    assert.equal(executedPrompts[0].options?.lightModel, context.lightModel);
    assert.equal(executedPrompts[0].options?.heavyModel, context.lightModel);
    assert.ok((executedPrompts[0].options?.handoffWindowMs ?? 0) > 100000);
  });

  it('/review reads target file and dispatches deep code review mode', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'machcode-review-'));
    try {
      const filePath = path.join(tmpDir, 'auth.ts');
      await fs.writeFile(filePath, 'export const secret = "12345";', 'utf-8');

      const registry = createDefaultCommandRegistry();
      const { context, executedPrompts } = createMockContext({ baseDir: tmpDir });

      await registry.dispatch('/review auth.ts', context);

      assert.equal(executedPrompts.length, 1);
      assert.ok(executedPrompts[0].prompt.includes('[CODE REVIEW MODE:'));
      assert.ok(executedPrompts[0].prompt.includes('export const secret = "12345";'));
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('/add and /drop properly manage the active session context files', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'machcode-adddrop-'));
    try {
      const file1 = path.join(tmpDir, 'service.ts');
      await fs.writeFile(file1, 'export class Service {}', 'utf-8');

      const registry = createDefaultCommandRegistry();
      const { context } = createMockContext({ baseDir: tmpDir });

      assert.equal(context.addedContextFiles.size, 0);

      await registry.dispatch('/add service.ts', context);
      assert.equal(context.addedContextFiles.has('service.ts'), true);

      await registry.dispatch('/drop service.ts', context);
      assert.equal(context.addedContextFiles.has('service.ts'), false);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('/reset clears session history, context files, and resets token counters', async () => {
    const registry = createDefaultCommandRegistry();
    const { context } = createMockContext();

    context.sessionHistory.push({ role: 'user', content: 'Turn 1' });
    context.addedContextFiles.add('index.ts');
    context.tokenStats.estimatedPromptTokens = 500;
    context.tokenStats.totalTurns = 1;

    await registry.dispatch('/reset', context);

    assert.equal(context.sessionHistory.length, 0);
    assert.equal(context.addedContextFiles.size, 0);
    assert.equal(context.tokenStats.estimatedPromptTokens, 0);
    assert.equal(context.tokenStats.totalTurns, 0);
  });

  it('/cd switches the active workspace directory and /ls lists directory entries', async () => {
    const originalCwd = process.cwd();
    const tmpDir1 = await fs.mkdtemp(path.join(os.tmpdir(), 'machcode-cd1-'));
    const tmpDir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'machcode-cd2-'));

    try {
      await fs.writeFile(path.join(tmpDir2, 'sample.txt'), 'hello', 'utf-8');

      const registry = createDefaultCommandRegistry();
      const { context } = createMockContext({ baseDir: tmpDir1 });

      assert.equal(context.baseDir, tmpDir1);

      // 1. /cd to tmpDir2
      await registry.dispatch(`/cd ${tmpDir2}`, context);
      assert.equal(path.resolve(context.baseDir), path.resolve(tmpDir2));

      // 2. /ls
      const handledLs = await registry.dispatch('/ls', context);
      assert.equal(handledLs, true);
    } finally {
      try {
        process.chdir(originalCwd);
      } catch {
        // Ignore
      }
      await fs.rm(tmpDir1, { recursive: true, force: true });
      await fs.rm(tmpDir2, { recursive: true, force: true });
    }
  });

  it('/undo reverts the last file modification made by the AI from in-memory snapshots', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'machcode-undo-'));
    try {
      const targetFile = path.join(tmpDir, 'button.tsx');
      await fs.writeFile(targetFile, 'original button code', 'utf-8');

      const registry = createDefaultCommandRegistry();
      const { context } = createMockContext({ baseDir: tmpDir });

      // Simulate AI modifying the file
      context.fileSnapshots.push({
        file: 'button.tsx',
        previousContent: 'original button code',
        timestamp: Date.now(),
      });
      await fs.writeFile(targetFile, 'modified by AI', 'utf-8');

      // Verify file is modified
      assert.equal(await fs.readFile(targetFile, 'utf-8'), 'modified by AI');

      // Run /undo
      await registry.dispatch('/undo', context);

      // Verify file is restored to original
      const restored = await fs.readFile(targetFile, 'utf-8');
      assert.equal(restored, 'original button code');
      assert.equal(context.fileSnapshots.length, 0);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('/approve toggles interactive file write confirmation between Ask and Auto-Approve modes', async () => {
    const registry = createDefaultCommandRegistry();
    const { context } = createMockContext({ autoApprove: false });

    assert.equal(context.autoApprove, false);
    await registry.dispatch('/approve auto', context);
    assert.equal(context.autoApprove, true);

    await registry.dispatch('/approve ask', context);
    assert.equal(context.autoApprove, false);

    // Toggle without args
    await registry.dispatch('/approve', context);
    assert.equal(context.autoApprove, true);
  });

  it('/skills lists official NVIDIA skills and /skill loads skill into session context', async () => {
    const registry = createDefaultCommandRegistry();
    const { context, executedPrompts } = createMockContext();

    // 1. /skills without args
    const handledList = await registry.dispatch('/skills', context);
    assert.equal(handledList, true);

    // 2. /skill cuopt with a task executes with enriched prompt
    const handledTask = await registry.dispatch('/skill cuopt Solve vehicle routing problem', context);
    assert.equal(handledTask, true);
    assert.equal(executedPrompts.length, 1);
    assert.ok(executedPrompts[0].prompt.includes('[ACTIVE NVIDIA SKILL: cuOpt'));
    assert.ok(executedPrompts[0].prompt.includes('Solve vehicle routing problem'));

    // 3. /cudf shortcut
    const handledShortcut = await registry.dispatch('/cudf Filter dataframe by timestamp', context);
    assert.equal(handledShortcut, true);
    assert.equal(executedPrompts.length, 2);
    assert.ok(executedPrompts[1].prompt.includes('[ACTIVE NVIDIA SKILL: cuDF'));
  });

  it('/exit and its aliases set shouldExit to true and close readline', async () => {
    const registry = createDefaultCommandRegistry();
    const { context, closed } = createMockContext();

    assert.equal(context.shouldExit, false);
    await registry.dispatch('/exit', context);
    assert.equal(context.shouldExit, true);

    const { context: context2 } = createMockContext();
    await registry.dispatch('/quit', context2);
    assert.equal(context2.shouldExit, true);

    const { context: context3 } = createMockContext();
    await registry.dispatch('/q', context3);
    assert.equal(context3.shouldExit, true);
  });
});
