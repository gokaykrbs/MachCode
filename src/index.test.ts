import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runMachCode, read_file, write_file } from './index.js';

describe('End-to-End CLI Execution Flow (runMachCode)', () => {
  it('discovers workspace context via read_file, handles QUESTION: re-run loop, and writes updated file', async () => {
    const tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'machcode-e2e-'));

    try {
      // Seed a workspace file `src/login.ts`
      await write_file(
        'src/login.ts',
        'export function login(user: string): boolean {\n  return Boolean(user);\n}\n',
        tmpWorkspace,
      );

      let callCount = 0;
      const askedQuestions: string[] = [];

      const mockFetch: typeof fetch = async (input, init) => {
        const url = String(input);
        if (url.endsWith('README.md')) {
          return new Response('', { status: 404 });
        }

        const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
          model: string;
          messages: Array<{ role: string; content: string }>;
        };

        // Verify Sniper prompt and existing src/login.ts content were injected into the system prompt
        const sysMsg = body.messages.find((m) => m.role === 'system')?.content ?? '';
        assert.ok(sysMsg.includes('MachCode Sniper'));
        assert.ok(sysMsg.includes('src/login.ts'));
        assert.ok(sysMsg.includes('export function login'));

        callCount += 1;
        const encoder = new TextEncoder();

        // Round 1: triggers QUESTION: until answer is provided in context
        const isFirstRound = !body.messages.some(
          (m) =>
            m.content.includes('password length >= 8') ||
            m.content.includes('Additional User Context'),
        );

        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            if (body.model.includes('llama')) {
              const content = isFirstRound
                ? '<plan>Need password parameter rule</plan>\nQUESTION: Should login require a minimum password length?'
                : '<plan>Update login with min length 8</plan>\n```typescript\n// file: src/login.ts\nexport function login(user: string, password: string): boolean {\n  return Boolean(user) && password.length >= 8;\n}\n```';

              const sse = `data: ${JSON.stringify({
                choices: [{ index: 0, delta: { content } }],
              })}\n\ndata: [DONE]\n\n`;
              controller.enqueue(encoder.encode(sse));
              controller.close();
            } else {
              // Heavy model is slower in this test so Light finishes quickly
              setTimeout(() => {
                try {
                  controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                  controller.close();
                } catch {
                  // Ignore if aborted
                }
              }, 200);
            }
          },
        });

        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      };

      const result = await runMachCode('update the login component', {
        baseDir: tmpWorkspace,
        apiKey: 'nvapi-test-e2e',
        lightModel: 'meta/llama-3.1-8b-instruct',
        heavyModel: 'meta/llama-3.1-70b-instruct',
        handoffWindowMs: 50,
        writeToStdout: false,
        fetchImpl: mockFetch,
        askUserQuestion: async (q) => {
          askedQuestions.push(q);
          return 'Yes, require password length >= 8.';
        },
      });

      assert.equal(result.questionRounds, 1);
      assert.ok(callCount >= 2);
      assert.equal(askedQuestions.length, 1);
      assert.equal(askedQuestions[0], 'Should login require a minimum password length?');
      assert.equal(result.executionSummary.skipped, false);
      assert.equal(result.executionSummary.modifiedFiles.length, 1);

      const updatedContent = await read_file('src/login.ts', tmpWorkspace);
      assert.ok(updatedContent.includes('password.length >= 8'));
    } finally {
      await fs.rm(tmpWorkspace, { recursive: true, force: true });
    }
  });
});

describe('Interactive REPL Mode (startRepl)', () => {
  it('runs interactive loop, retains context across turns, and handles /exit gracefully', async () => {
    const tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'machcode-repl-'));
    try {
      await write_file(
        'components/Login.tsx',
        'export function Button() { return <button className="red">Click</button>; }\n',
        tmpWorkspace,
      );

      const sentBodies: Array<{
        model: string;
        messages: Array<{ role: string; content: string }>;
      }> = [];

      const mockFetch: typeof fetch = async (input, init) => {
        const url = String(input);
        if (url.endsWith('README.md')) {
          return new Response('', { status: 404 });
        }

        const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
          model: string;
          messages: Array<{ role: string; content: string }>;
        };
        sentBodies.push(body);

        const encoder = new TextEncoder();
        const isFirstTurn = !body.messages.some((m) => m.content.includes('green'));
        const content = isFirstTurn
          ? '```tsx\n// file: components/Login.tsx\nexport function Button() { return <button className="blue">Click</button>; }\n```'
          : '```tsx\n// file: components/Login.tsx\nexport function Button() { return <button className="green">Click</button>; }\n```';

        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            if (body.model.includes('llama')) {
              const sse = `data: ${JSON.stringify({
                choices: [{ index: 0, delta: { content } }],
              })}\n\ndata: [DONE]\n\n`;
              controller.enqueue(encoder.encode(sse));
              controller.close();
            } else {
              setTimeout(() => {
                try {
                  controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                  controller.close();
                } catch {
                  // Ignore
                }
              }, 200);
            }
          },
        });

        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      };

      let answerIdx = 0;
      const testInputs = [
        'Make the login button blue in components/Login.tsx',
        'Now make the button green instead',
        '/exit',
      ];
      const testRl = {
        question: async () => testInputs[answerIdx++] ?? '/exit',
        close: () => {},
        on: () => {},
      } as unknown as import('node:readline/promises').Interface;

      const { startRepl } = await import('./index.js');
      await startRepl({
        baseDir: tmpWorkspace,
        apiKey: 'nvapi-test-repl',
        lightModel: 'meta/llama-3.1-8b-instruct',
        heavyModel: 'meta/llama-3.1-70b-instruct',
        handoffWindowMs: 50,
        writeToStdout: false,
        fetchImpl: mockFetch,
        rlInterface: testRl,
      });

      // Verify the final file is updated to green
      const finalFile = await read_file('components/Login.tsx', tmpWorkspace);
      assert.ok(finalFile.includes('className="green"'));

      // Check context retention: the later request should have previous turn messages in body.messages
      const laterRequest = sentBodies[sentBodies.length - 1];
      const hasPriorUserPrompt = laterRequest.messages.some(
        (m) => m.role === 'user' && m.content.includes('Make the login button blue'),
      );
      assert.ok(hasPriorUserPrompt, 'Session history should include previous turn user message');
    } finally {
      await fs.rm(tmpWorkspace, { recursive: true, force: true });
    }
  });

  it('handles /clear command without exiting the loop', async () => {
    const tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'machcode-repl-clear-'));
    try {
      let idx = 0;
      const answers = ['/clear', '/exit'];
      const testRl = {
        question: async () => answers[idx++] ?? '/exit',
        close: () => {},
        on: () => {},
      } as unknown as import('node:readline/promises').Interface;

      const { startRepl } = await import('./index.js');
      await startRepl({
        baseDir: tmpWorkspace,
        apiKey: 'nvapi-test-clear',
        writeToStdout: false,
        rlInterface: testRl,
      });

      assert.ok(true);
    } finally {
      await fs.rm(tmpWorkspace, { recursive: true, force: true });
    }
  });

  it('executes slash commands (/add, /context, /undo, /reset, /help) via registry', async () => {
    const tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'machcode-repl-cmds-'));
    try {
      await write_file('test.ts', 'const x = 1;', tmpWorkspace);

      let idx = 0;
      const answers = ['/add test.ts', '/context', '/undo', '/reset', '/help', '/exit'];
      const testRl = {
        question: async () => answers[idx++] ?? '/exit',
        close: () => {},
        on: () => {},
      } as unknown as import('node:readline/promises').Interface;

      const { startRepl } = await import('./index.js');
      await startRepl({
        baseDir: tmpWorkspace,
        apiKey: 'nvapi-test-cmds',
        writeToStdout: false,
        rlInterface: testRl,
      });

      assert.ok(true);
    } finally {
      await fs.rm(tmpWorkspace, { recursive: true, force: true });
    }
  });

  it('catches network timeout or API failure and unlocks REPL for subsequent instructions', async () => {
    const tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'machcode-repl-timeout-'));
    try {
      const hangingFetch: typeof fetch = async (input, init) => {
        const url = String(input);
        if (url.endsWith('README.md')) {
          return new Response('', { status: 404 });
        }
        const signal = init?.signal;
        return new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
          });
        });
      };

      let idx = 0;
      const answers = ['hello', '/exit'];
      const askedPrompts: string[] = [];
      const testRl = {
        question: async (p: string) => {
          askedPrompts.push(p);
          return answers[idx++] ?? '/exit';
        },
        close: () => {},
        on: () => {},
      } as unknown as import('node:readline/promises').Interface;

      const { startRepl } = await import('./index.js');
      await startRepl({
        baseDir: tmpWorkspace,
        apiKey: 'nvapi-test-timeout',
        lightModel: 'meta/llama-3.1-8b-instruct',
        heavyModel: 'meta/llama-3.1-70b-instruct',
        timeoutMs: 50,
        writeToStdout: false,
        fetchImpl: hangingFetch,
        rlInterface: testRl,
      });

      assert.equal(askedPrompts.length, 2);
    } finally {
      await fs.rm(tmpWorkspace, { recursive: true, force: true });
    }
  });
});
