import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runAgentLoop } from './agentLoop.js';
import { PermissionManager, isDangerousCommand, commandPermissionPrefix } from './permissions.js';
import { planToolCall, isIgnoredFile, READ_ONLY_TOOL_NAMES } from '../tools/agentTools.js';

describe('Phase 2: Editing, Commands, Security & Build/Plan Modes', () => {
  it('Kabul Ölçütü: Ajan küçük bir hatayı bulup düzeltiyor, testi çalıştırıp geçtiğini doğruluyor', async () => {
    const tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'machcode-phase2-acceptance-'));
    try {
      const srcDir = path.join(tmpWorkspace, 'src');
      const testDir = path.join(tmpWorkspace, 'test');
      await fs.mkdir(srcDir, { recursive: true });
      await fs.mkdir(testDir, { recursive: true });

      // Create buggy code
      const calcPath = path.join(srcDir, 'calculator.js');
      await fs.writeFile(
        calcPath,
        'export function multiply(a, b) {\n  return a + b; // BUG: addition instead of multiplication\n}\n',
        'utf-8',
      );

      // Create verification test
      const testPath = path.join(testDir, 'calculator.test.mjs');
      await fs.writeFile(
        testPath,
        `import assert from 'node:assert/strict';
import { multiply } from '../src/calculator.js';

assert.equal(multiply(2, 3), 6);
console.log('ALL_TESTS_PASSED');
`,
        'utf-8',
      );

      let step = 0;
      const testCommand = `node "${testPath}"`;

      // Mock LLM streaming simulating the agent finding the bug, fixing it, and running the test
      const mockFetch: typeof fetch = async (_input, init) => {
        step++;
        const encoder = new TextEncoder();
        const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
          messages: Array<{ role: string; content?: string; tool_calls?: unknown[] }>;
        };

        let sseChunks: string[] = [];

        if (step === 1) {
          // Model inspects the buggy file
          sseChunks = [
            `data: ${JSON.stringify({
              choices: [
                {
                  delta: {
                    content: 'Checking calculator.js...',
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call_read_calc',
                        type: 'function',
                        function: {
                          name: 'read_file',
                          arguments: JSON.stringify({ path: 'src/calculator.js' }),
                        },
                      },
                    ],
                  },
                },
              ],
            })}\n\ndata: [DONE]\n\n`,
          ];
        } else if (step === 2) {
          // Verify model received the file content
          const readResultMsg = body.messages.find(
            (m) =>
              m.role === 'tool' &&
              (m as { tool_call_id?: string }).tool_call_id === 'call_read_calc',
          );
          assert.ok(readResultMsg, 'Expected tool result for read_file');

          // Model edits the file to fix the bug
          sseChunks = [
            `data: ${JSON.stringify({
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call_edit_calc',
                        type: 'function',
                        function: {
                          name: 'edit_file',
                          arguments: JSON.stringify({
                            path: 'src/calculator.js',
                            old_string:
                              '  return a + b; // BUG: addition instead of multiplication',
                            new_string: '  return a * b;',
                          }),
                        },
                      },
                    ],
                  },
                },
              ],
            })}\n\ndata: [DONE]\n\n`,
          ];
        } else if (step === 3) {
          // Verify model received the edit result
          const editResultMsg = body.messages.find(
            (m) =>
              m.role === 'tool' &&
              (m as { tool_call_id?: string }).tool_call_id === 'call_edit_calc',
          );
          assert.ok(editResultMsg, 'Expected tool result for edit_file');

          // Model runs the test to verify
          sseChunks = [
            `data: ${JSON.stringify({
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call_run_test',
                        type: 'function',
                        function: {
                          name: 'run_command',
                          arguments: JSON.stringify({
                            command: testCommand,
                          }),
                        },
                      },
                    ],
                  },
                },
              ],
            })}\n\ndata: [DONE]\n\n`,
          ];
        } else {
          // Step 4: Model confirms test passed
          const cmdResultMsg = body.messages.find(
            (m) =>
              m.role === 'tool' &&
              (m as { tool_call_id?: string }).tool_call_id === 'call_run_test',
          );
          assert.ok(cmdResultMsg, 'Expected tool result for run_command');
          assert.ok(
            (cmdResultMsg as { content?: string })?.content?.includes('ALL_TESTS_PASSED'),
            'Test command output should contain ALL_TESTS_PASSED',
          );

          sseChunks = [
            `data: ${JSON.stringify({
              choices: [
                {
                  delta: {
                    content:
                      'Hata başarıyla düzeltildi: `multiply` fonksiyonu artık çarpma işlemi yapıyor ve doğrulama testleri başarıyla geçti.',
                  },
                },
              ],
            })}\n\ndata: [DONE]\n\n`,
          ];
        }

        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            for (const chunk of sseChunks) {
              controller.enqueue(encoder.encode(chunk));
            }
            controller.close();
          },
        });

        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      };

      const pm = new PermissionManager({
        isAutoApprove: () => true, // Auto-approve for the automated acceptance test
        writeToStdout: false,
      });

      const result = await runAgentLoop({
        prompt: 'Fix the bug in src/calculator.js and verify the test passes.',
        cwd: tmpWorkspace,
        apiKey: 'nvapi-acceptance-test',
        model: 'meta/llama-3.1-70b-instruct',
        permissionManager: pm,
        writeToStdout: false,
        fetchImpl: mockFetch,
        maxSteps: 10,
      });

      // Verify acceptance criteria
      assert.equal(result.interrupted, false);
      assert.equal(result.toolCallsCount, 3);
      assert.ok(result.stepsTaken >= 4);
      assert.ok(result.finalResponse.includes('Hata başarıyla düzeltildi'));

      // 1. Verify file was fixed on disk
      const updatedCode = await fs.readFile(calcPath, 'utf-8');
      assert.ok(updatedCode.includes('return a * b;'));
      assert.ok(!updatedCode.includes('return a + b;'));

      // 2. Verify modified files recorded
      assert.ok(result.modifiedFiles.some((f) => f.includes('calculator.js')));
    } finally {
      await fs.rm(tmpWorkspace, { recursive: true, force: true });
    }
  });

  it('Plan Modu vs Build Modu: Plan modunda çift katmanlı koruma ile yazma ve komutlar engellenir', async () => {
    const tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'machcode-plan-mode-test-'));
    try {
      const fileToProtect = path.join(tmpWorkspace, 'safe.txt');
      await fs.writeFile(fileToProtect, 'initial content', 'utf-8');

      let step = 0;
      let toolsSentToModel: string[] = [];

      const mockFetch: typeof fetch = async (_input, init) => {
        step++;
        const encoder = new TextEncoder();
        const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
          messages: Array<{ role: string; content?: string; tool_calls?: unknown[] }>;
          tools?: Array<{ function?: { name?: string } }>;
        };

        if (body.tools) {
          toolsSentToModel = body.tools.map((t) => t.function?.name ?? '');
        }

        let sseChunks: string[] = [];

        if (step === 1) {
          // Model attempts to call edit_file even though it was not provided
          sseChunks = [
            `data: ${JSON.stringify({
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call_blocked_edit',
                        type: 'function',
                        function: {
                          name: 'edit_file',
                          arguments: JSON.stringify({
                            path: 'safe.txt',
                            old_string: 'initial content',
                            new_string: 'hacked content',
                          }),
                        },
                      },
                    ],
                  },
                },
              ],
            })}\n\ndata: [DONE]\n\n`,
          ];
        } else {
          // Step 2: Model receives rejection message from executor
          const blockMsg = body.messages.find(
            (m) =>
              m.role === 'tool' &&
              (m as { tool_call_id?: string }).tool_call_id === 'call_blocked_edit',
          );
          assert.ok(blockMsg, 'Expected tool block message');
          assert.ok(
            (blockMsg as { content?: string })?.content?.includes('Plan modundasınız'),
            'Rejection message must mention Plan Mode restriction',
          );

          sseChunks = [
            `data: ${JSON.stringify({
              choices: [
                {
                  delta: {
                    content: 'Plan modunda olduğum için dosya düzenleyemem.',
                  },
                },
              ],
            })}\n\ndata: [DONE]\n\n`,
          ];
        }

        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            for (const chunk of sseChunks) {
              controller.enqueue(encoder.encode(chunk));
            }
            controller.close();
          },
        });

        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      };

      const pm = new PermissionManager({
        isAutoApprove: () => true,
        writeToStdout: false,
      });

      const result = await runAgentLoop({
        prompt: 'Change safe.txt to hacked content',
        cwd: tmpWorkspace,
        apiKey: 'nvapi-plan-test',
        model: 'meta/llama-3.1-70b-instruct',
        readOnly: true, // PLAN MODE
        permissionManager: pm,
        writeToStdout: false,
        fetchImpl: mockFetch,
        maxSteps: 5,
      });

      // Layer 1: Only read-only tools were provided to the model
      assert.ok(toolsSentToModel.length > 0);
      for (const t of toolsSentToModel) {
        assert.ok(READ_ONLY_TOOL_NAMES.has(t), `Tool ${t} should be read-only in plan mode`);
      }
      assert.ok(!toolsSentToModel.includes('edit_file'));
      assert.ok(!toolsSentToModel.includes('write_file'));
      assert.ok(!toolsSentToModel.includes('run_command'));
      assert.ok(!toolsSentToModel.includes('bash'));

      // Layer 2: Executor blocked the tool call and file remained untouched
      assert.equal(result.modifiedFiles.length, 0);
      const content = await fs.readFile(fileToProtect, 'utf-8');
      assert.equal(content, 'initial content');
    } finally {
      await fs.rm(tmpWorkspace, { recursive: true, force: true });
    }
  });

  it('Güvenlik: Tehlikeli komutlar her zaman açık onay ister ve auto-approve ile atlanamaz', async () => {
    // 1. Detection tests
    assert.equal(isDangerousCommand('rm -rf /'), true);
    assert.equal(isDangerousCommand('rm -fr ./build'), true);
    assert.equal(isDangerousCommand('rmdir /s /q temp'), true);
    assert.equal(isDangerousCommand('del /f /s C:\\windows'), true);
    assert.equal(isDangerousCommand('git push origin main --force'), true);
    assert.equal(isDangerousCommand('git push -f origin main'), true);
    assert.equal(isDangerousCommand('git reset --hard HEAD~1'), true);
    assert.equal(isDangerousCommand('format D:'), true);
    assert.equal(isDangerousCommand('npm test'), false);
    assert.equal(isDangerousCommand('git status'), false);
    assert.equal(isDangerousCommand('ls -la'), false);

    // 2. Dangerous commands never have a reusable session prefix
    assert.equal(commandPermissionPrefix('rm -rf /tmp/data'), null);
    assert.equal(commandPermissionPrefix('git push --force'), null);

    // 3. PermissionManager blocks auto-approval for dangerous commands
    let promptWasCalled = false;
    const mockPrompter = {
      choose: async () => {
        promptWasCalled = true;
        return 'no' as const;
      },
      askFeedback: async () => 'Dangerous command blocked by user',
    };

    const pm = new PermissionManager({
      isAutoApprove: () => true, // Global auto-approve enabled!
      prompter: mockPrompter,
      writeToStdout: false,
    });

    const dangerousPlan = {
      kind: 'command' as const,
      title: 'rm -rf /',
      command: 'rm -rf /',
      cwd: '/workspace',
      outsideWorkspace: false,
      run: async () => ({ output: '', summary: '' }),
    };

    const decision = await pm.requestCommand(dangerousPlan);
    assert.equal(
      promptWasCalled,
      true,
      'Dangerous command must prompt even when autoApprove is true',
    );
    assert.equal(decision.allowed, false);
  });

  it('Güvenlik: .env dosyaları okuma ve arama araçlarında varsayılan olarak korunur', async () => {
    assert.equal(isIgnoredFile('.env'), true);
    assert.equal(isIgnoredFile('.env.production'), true);
    assert.equal(isIgnoredFile('.env.local'), true);
    assert.equal(isIgnoredFile('src/config.ts'), false);

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'machcode-env-sec-'));
    try {
      await fs.writeFile(path.join(tmp, '.env'), 'SECRET_KEY=123456\n', 'utf-8');
      await fs.writeFile(path.join(tmp, 'public.txt'), 'hello world\n', 'utf-8');

      // Attempting to read_file on .env throws security error
      const envReadPlan = await planToolCall('read_file', { path: '.env' }, { cwd: tmp });
      assert.equal(envReadPlan.kind, 'read');
      if (envReadPlan.kind === 'read') {
        let threw = false;
        try {
          await envReadPlan.run();
        } catch (err: unknown) {
          threw = true;
          assert.ok(
            (err as Error).message.includes('Access to sensitive file') &&
              (err as Error).message.includes('blocked by security policy'),
          );
        }
        assert.equal(threw, true, 'Reading .env file should be blocked by security policy');
      }

      // Glob skips .env
      const globPlan = await planToolCall('glob', { pattern: '*' }, { cwd: tmp });
      assert.equal(globPlan.kind, 'read');
      if (globPlan.kind === 'read') {
        const globRes = await globPlan.run();
        assert.ok(!globRes.output.includes('.env'));
        assert.ok(globRes.output.includes('public.txt'));
      }
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
