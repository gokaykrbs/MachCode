import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StreamParser, extractCodeFromMarkdown } from './streamParser.js';
import { SNIPER_SYSTEM_PROMPT, buildSniperSystemPrompt } from '../prompts/sniper.js';

describe('Sniper System Prompt', () => {
  it('enforces Zero Chatter, Anti-Hallucination, Stop & Ask, and <plan> tags', () => {
    assert.ok(SNIPER_SYSTEM_PROMPT.includes('<plan>...</plan>'));
    assert.ok(SNIPER_SYSTEM_PROMPT.includes('QUESTION: [details]'));
    assert.ok(SNIPER_SYSTEM_PROMPT.includes('ZERO CHATTER'));
    assert.ok(SNIPER_SYSTEM_PROMPT.includes('ANTI-HALLUCINATION'));

    const withContext = buildSniperSystemPrompt('Target file: src/app.ts');
    assert.ok(withContext.includes('# WORKSPACE CONTEXT'));
    assert.ok(withContext.includes('Target file: src/app.ts'));
  });
});

describe('StreamParser', () => {
  it('hides <plan>...</plan> from terminal output, saves it to debug log, and extracts pure code across fragmented chunks', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'machcode-test-'));
    const debugLogPath = path.join(tmpDir, 'debug.log');
    const terminalChunks: string[] = [];

    const parser = new StreamParser({
      debugLogPath,
      onTerminalChunk: (chunk) => terminalChunks.push(chunk),
    });

    const fragmentedStream = [
      '<pl',
      'an>\n1. Check context\n2. Write sum function\n</p',
      'lan>\n```type',
      'script\nexport function add(a: number, b: number): number {\n',
      '  return a + b;\n}\n```',
    ];

    for (const chunk of fragmentedStream) {
      parser.feed(chunk);
    }

    const result = await parser.finalize();
    const combinedTerminal = terminalChunks.join('');

    // 1. Verify <plan> is hidden from terminal output
    assert.ok(!combinedTerminal.includes('<plan>'));
    assert.ok(!combinedTerminal.includes('Check context'));
    assert.equal(result.plan, '1. Check context\n2. Write sum function');

    // 2. Verify <plan> was saved to the debug log
    const logContent = await fs.readFile(debugLogPath, 'utf-8');
    assert.ok(logContent.includes('1. Check context\n2. Write sum function'));

    // 3. Verify pure code is extracted without markdown fences
    assert.equal(result.isHalted, false);
    assert.equal(result.question, null);
    assert.equal(result.codeBlocks.length, 1);
    assert.equal(result.codeBlocks[0]?.language, 'typescript');
    assert.equal(
      result.extractedCode,
      'export function add(a: number, b: number): number {\n  return a + b;\n}',
    );

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('halts and prompts the user when QUESTION: is detected across fragmented chunks', async () => {
    let promptedQuestion: string | null = null;

    const parser = new StreamParser({
      debugLogPath: null,
      onQuestion: async (question) => {
        promptedQuestion = question;
        return 'UserSession has id: string and expiresAt: number';
      },
    });

    const chunks = [
      '<plan>\nMissing UserSession interface definition.\n</plan>\n',
      'QUES',
      'TION: Please provide the ',
      'interface definition for UserSession in src/types.ts.',
    ];

    for (const chunk of chunks) {
      parser.feed(chunk);
    }

    const result = await parser.finalize();

    assert.equal(result.isHalted, true);
    assert.equal(parser.isHalted(), true);
    assert.equal(
      result.question,
      'Please provide the interface definition for UserSession in src/types.ts.',
    );
    assert.equal(
      promptedQuestion,
      'Please provide the interface definition for UserSession in src/types.ts.',
    );
    assert.equal(parser.getUserResponse(), 'UserSession has id: string and expiresAt: number');
    assert.equal(result.extractedCode, '');
    assert.equal(result.codeBlocks.length, 0);
  });

  it('extracts multiple fenced code blocks cleanly', () => {
    const markdown = ['```ts', 'const x = 1;', '```', '', '```json', '{"ok": true}', '```'].join(
      '\n',
    );

    const blocks = extractCodeFromMarkdown(markdown);
    assert.equal(blocks.length, 2);
    assert.deepEqual(blocks[0], { language: 'ts', code: 'const x = 1;' });
    assert.deepEqual(blocks[1], { language: 'json', code: '{"ok": true}' });
  });

  it('hides plan>...</plan> without leading bracket from terminal output', async () => {
    const terminalChunks: string[] = [];
    const parser = new StreamParser({
      debugLogPath: null,
      onTerminalChunk: (chunk) => terminalChunks.push(chunk),
    });

    const chunks = [
      'plan>\n',
      '1. Intent: User is greeting/chatting (CONVERSATIONAL Q&A MODE).\n',
      '2. Key facts from workspace context: Some details.\n',
      '</plan>\n',
      'Merhaba! Nasıl yardımcı olabilirim?',
    ];

    for (const chunk of chunks) {
      parser.feed(chunk);
    }

    const result = await parser.finalize();
    const combined = terminalChunks.join('');

    assert.ok(!combined.includes('plan>'));
    assert.ok(!combined.includes('1. Intent:'));
    assert.ok(!combined.includes('</plan>'));
    assert.equal(combined.trim(), 'Merhaba! Nasıl yardımcı olabilirim?');
    assert.equal(result.visibleOutput.trim(), 'Merhaba! Nasıl yardımcı olabilirim?');
    assert.ok(result.plan.includes('1. Intent: User is greeting/chatting'));
  });

  it('hides <think>...</think> DeepSeek reasoning tags from terminal output', async () => {
    const terminalChunks: string[] = [];
    const parser = new StreamParser({
      debugLogPath: null,
      onTerminalChunk: (chunk) => terminalChunks.push(chunk),
    });

    const chunks = [
      '<think>\nDeepSeek R1 reasoning tokens...\n</think>\n',
      'Here is the solution.',
    ];

    for (const chunk of chunks) {
      parser.feed(chunk);
    }

    const result = await parser.finalize();
    const combined = terminalChunks.join('');

    assert.ok(!combined.includes('<think>'));
    assert.ok(!combined.includes('DeepSeek R1 reasoning'));
    assert.ok(!combined.includes('</think>'));
    assert.equal(combined.trim(), 'Here is the solution.');
    assert.equal(result.visibleOutput.trim(), 'Here is the solution.');
  });

  it('hides [PLAN]...[/PLAN] bracketed blocks and handles fragmented open tag across chunks', async () => {
    const terminalChunks: string[] = [];
    const parser = new StreamParser({
      debugLogPath: null,
      onTerminalChunk: (chunk) => terminalChunks.push(chunk),
    });

    const fragmented = ['pl', 'an>\nInternal plan line\n</plan>\n', 'Hello world!'];

    for (const chunk of fragmented) {
      parser.feed(chunk);
    }

    const result = await parser.finalize();
    const combined = terminalChunks.join('');

    assert.ok(!combined.includes('plan>'));
    assert.ok(!combined.includes('Internal plan line'));
    assert.equal(combined.trim(), 'Hello world!');
    assert.equal(result.visibleOutput.trim(), 'Hello world!');
  });

  it('does not swallow or delay ordinary words ending with candidate prefix letters', async () => {
    const terminalChunks: string[] = [];
    const parser = new StreamParser({
      debugLogPath: null,
      onTerminalChunk: (chunk) => terminalChunks.push(chunk),
    });

    parser.feed('I can help you build high quality software.');
    const result = await parser.finalize();
    const combined = terminalChunks.join('');

    assert.equal(combined, 'I can help you build high quality software.');
    assert.equal(result.visibleOutput, 'I can help you build high quality software.');
  });
});
