import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  saveSession,
  loadSession,
  listSessions,
  deleteSession,
  type SessionData,
} from './sessionManager.js';
import {
  estimateTextTokens,
  estimateHistoryTokens,
  summarizeOldestTurns,
  generateDeterministicSummary,
} from './contextSummarizer.js';
import { createDefaultCommandRegistry, type CommandContext } from '../commands/index.js';
import type { SessionMessage } from '../index.js';

describe('Phase 4: Resilience, Session Management & Context Summarization', () => {
  const testSessionId = `test_sess_${Date.now()}`;

  test('Session Manager: saves, lists, loads, and deletes session files', async () => {
    const dummySession: SessionData = {
      sessionId: testSessionId,
      name: 'Integration Test Session',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      workspaceDir: process.cwd(),
      mode: 'build',
      history: [
        { role: 'user', content: 'Create a test file in src/test.ts' },
        { role: 'assistant', content: 'Modified files: src/test.ts' },
      ],
      addedFiles: ['src/test.ts'],
      tokenStats: {
        estimatedPromptTokens: 120,
        estimatedCompletionTokens: 80,
        totalTurns: 1,
      },
      snapshots: [],
    };

    // 1. Save session
    const savedPath = await saveSession(dummySession);
    assert.ok(savedPath.endsWith(`${testSessionId}.json`));

    // 2. List sessions
    const sessions = await listSessions(process.cwd());
    const found = sessions.find((s) => s.sessionId === testSessionId);
    assert.ok(found, 'Saved session should appear in listSessions');
    assert.equal(found?.turnCount, 1);
    assert.equal(found?.totalTokens, 200);

    // 3. Load session by ID
    const loaded = await loadSession(testSessionId, process.cwd());
    assert.ok(loaded);
    assert.equal(loaded?.sessionId, testSessionId);
    assert.equal(loaded?.name, 'Integration Test Session');
    assert.equal(loaded?.history.length, 2);

    // 4. Load session by 'latest'
    const latest = await loadSession('latest', process.cwd());
    assert.ok(latest);

    // 5. Delete test session
    const deleted = await deleteSession(testSessionId);
    assert.equal(deleted, true);
    const afterDelete = await loadSession(testSessionId, process.cwd());
    assert.equal(afterDelete, null);
  });

  test('Context Summarizer: calculates tokens and condenses oldest turns when limit is reached', async () => {
    // 1. Token estimation
    assert.equal(estimateTextTokens('hello world'), 3);
    const testMessages: SessionMessage[] = [
      { role: 'user', content: 'What is the capital of France?' },
      { role: 'assistant', content: 'The capital of France is Paris.' },
    ];
    const estimated = estimateHistoryTokens(testMessages);
    assert.ok(estimated > 10, 'Should estimate token footprint');

    // 2. Deterministic summary generation
    const summary = generateDeterministicSummary([
      { role: 'user', content: 'Refactor database models' },
      { role: 'assistant', content: 'Modified files: src/db/schema.ts' },
      { role: 'user', content: 'Add unit tests' },
      { role: 'assistant', content: 'Modified files: src/db/schema.test.ts' },
    ]);
    assert.ok(summary.includes('Refactor database models'));
    assert.ok(summary.includes('Modified src/db/schema.ts'));

    // 3. Automatic summarization on long conversations
    const longHistory: SessionMessage[] = [];
    for (let i = 0; i < 20; i++) {
      longHistory.push({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Step ${i}: This is a verbose detailed technical message explaining complex algorithms and operations in great detail to simulate real-world large token context usage.`,
      });
    }

    // Set maxContextTokens low to trigger summarization
    const result = await summarizeOldestTurns(longHistory, {
      maxContextTokens: 100, // force threshold trigger
      turnsToSummarize: 8,
      keepRecentTurns: 4,
    });

    assert.equal(result.summarized, true);
    assert.ok(result.savedTokens > 0, 'Should save tokens');
    assert.equal(result.summarizedTurnsCount, 8);
    assert.ok(result.history[0].content.includes('[Context Summary'));
    // 20 total - 8 condensed + 1 summary message = 13 messages
    assert.equal(result.history.length, 13);
  });

  test('Slash Commands: /save, /sessions, and /resume execute cleanly in CommandRegistry', async () => {
    const registry = createDefaultCommandRegistry();

    assert.ok(registry.getCommand('save'), '/save should be registered');
    assert.ok(registry.getCommand('sessions'), '/sessions should be registered');
    assert.ok(registry.getCommand('resume'), '/resume should be registered');

    const dummyContext: CommandContext = {
      baseDir: process.cwd(),
      lightModel: 'meta/llama-3.3-70b-instruct',
      heavyModel: 'qwen/qwen2.5-coder-32b-instruct',
      handoffWindowMs: 3000,
      apiKey: 'nvapi-mock-key',
      sessionHistory: [
        { role: 'user', content: 'Mock user prompt' },
        { role: 'assistant', content: 'Mock assistant response' },
      ],
      addedContextFiles: new Set<string>(['src/index.ts']),
      fileSnapshots: [],
      tokenStats: { estimatedPromptTokens: 50, estimatedCompletionTokens: 50, totalTurns: 1 },
      rl: {} as unknown as import('node:readline/promises').Interface,
      shouldExit: false,
      sessionId: `mock_test_${Date.now()}`,
      runMachCode: async () => ({
        raceResult: {
          winnerModel: 'mock',
          winnerRole: 'heavy',
          handoffOccurred: false,
          handoffElapsedMs: null,
          lightAborted: false,
          heavyAborted: false,
          finalTerminalOutput: '',
          parseResult: {
            plan: '',
            extractedCode: '',
            codeBlocks: [],
            visibleOutput: '',
            question: null,
            isHalted: false,
          },
        },
        executionSummary: {
          createdFiles: [],
          modifiedFiles: [],
          errorFiles: [],
          skipped: false,
          formattedSummary: '',
        },
        toolsLoaded: [],
        questionRounds: 0,
      }),
    };

    // 1. /save
    const handledSave = await registry.dispatch('/save my-checkpoint', dummyContext);
    assert.equal(handledSave, true);

    // 2. /sessions
    const handledList = await registry.dispatch('/sessions', dummyContext);
    assert.equal(handledList, true);

    // 3. /resume
    const handledResume = await registry.dispatch('/resume latest', dummyContext);
    assert.equal(handledResume, true);

    // Clean up test session file
    await deleteSession(dummyContext.sessionId!);
  });
});
