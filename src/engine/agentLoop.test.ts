import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runAgentLoop } from './agentLoop.js';
import { PermissionManager } from './permissions.js';

describe('Autonomous Agent Loop (runAgentLoop)', () => {
  it('executes multi-step tool calls, handles approvals, and writes modified files', async () => {
    const tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-test-'));
    try {
      await fs.writeFile(
        path.join(tmpWorkspace, 'calc.ts'),
        'export function calc(x: number) { return x; }\n',
        'utf-8',
      );

      let step = 0;

      const mockFetch: typeof fetch = async (_input, init) => {
        step++;
        const encoder = new TextEncoder();
        const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
          messages: Array<{ role: string; content?: string; tool_calls?: unknown[] }>;
        };

        let sseChunks: string[] = [];

        if (step === 1) {
          // Model decides to inspect directory
          sseChunks = [
            `data: ${JSON.stringify({
              choices: [
                {
                  delta: {
                    content: 'Checking project files...',
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call_list_1',
                        type: 'function',
                        function: {
                          name: 'list_directory',
                          arguments: JSON.stringify({ path: '.' }),
                        },
                      },
                    ],
                  },
                },
              ],
            })}\n\ndata: [DONE]\n\n`,
          ];
        } else if (step === 2) {
          // Verify previous tool message was received by model
          const toolMsg = body.messages.find(
            (m) =>
              m.role === 'tool' && (m as { tool_call_id?: string }).tool_call_id === 'call_list_1',
          );
          assert.ok(toolMsg, 'Expected tool result message in conversation history');

          // Model decides to read calc.ts
          sseChunks = [
            `data: ${JSON.stringify({
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call_read_2',
                        type: 'function',
                        function: {
                          name: 'read_file',
                          arguments: JSON.stringify({ path: 'calc.ts' }),
                        },
                      },
                    ],
                  },
                },
              ],
            })}\n\ndata: [DONE]\n\n`,
          ];
        } else if (step === 3) {
          // Model decides to edit calc.ts
          sseChunks = [
            `data: ${JSON.stringify({
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call_edit_3',
                        type: 'function',
                        function: {
                          name: 'edit_file',
                          arguments: JSON.stringify({
                            path: 'calc.ts',
                            old_string: 'return x;',
                            new_string: 'return x * 2;',
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
          // Step 4: Final response
          sseChunks = [
            `data: ${JSON.stringify({
              choices: [
                {
                  delta: {
                    content: 'Successfully updated calc.ts to double the input.',
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
        isAutoApprove: () => true, // Auto-approve for the automated test
        writeToStdout: false,
      });

      const result = await runAgentLoop({
        prompt: 'Multiply the result in calc.ts by 2',
        cwd: tmpWorkspace,
        apiKey: 'test-nvapi',
        model: 'meta/llama-3.1-70b-instruct',
        permissionManager: pm,
        writeToStdout: false,
        fetchImpl: mockFetch,
        maxSteps: 10,
      });

      assert.equal(result.interrupted, false);
      assert.equal(result.toolCallsCount, 3);
      assert.ok(result.stepsTaken >= 4);
      assert.ok(result.finalResponse.includes('Successfully updated calc.ts'));

      // Check file was modified on disk
      const updated = await fs.readFile(path.join(tmpWorkspace, 'calc.ts'), 'utf-8');
      assert.ok(updated.includes('return x * 2;'));
    } finally {
      await fs.rm(tmpWorkspace, { recursive: true, force: true });
    }
  });

  it('stops and reports user rejection when file edit is declined', async () => {
    const tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-reject-'));
    try {
      await fs.writeFile(path.join(tmpWorkspace, 'a.txt'), 'version 1', 'utf-8');

      let step = 0;
      const mockFetch: typeof fetch = async (_input, init) => {
        step++;
        const encoder = new TextEncoder();
        const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
          messages: Array<{ role: string; content?: string }>;
        };

        let sse = '';
        if (step === 1) {
          sse = `data: ${JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_1',
                      type: 'function',
                      function: {
                        name: 'edit_file',
                        arguments: JSON.stringify({
                          path: 'a.txt',
                          old_string: 'version 1',
                          new_string: 'version 2',
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          })}\n\ndata: [DONE]\n\n`;
        } else {
          // Model sees rejection in tool message
          const toolMsg = body.messages.find((m) => m.role === 'tool');
          assert.ok(
            toolMsg?.content?.includes('declined') || toolMsg?.content?.includes('rejected'),
          );
          sse = `data: ${JSON.stringify({
            choices: [{ delta: { content: 'Understood, I will keep version 1.' } }],
          })}\n\ndata: [DONE]\n\n`;
        }

        return new Response(encoder.encode(sse), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      };

      const pm = new PermissionManager({
        isAutoApprove: () => false,
        prompter: {
          choose: async () => 'no',
          askFeedback: async () => 'Keep version 1 unchanged',
        },
        writeToStdout: false,
      });

      const result = await runAgentLoop({
        prompt: 'Change to version 2',
        cwd: tmpWorkspace,
        apiKey: 'test-nvapi',
        model: 'meta/llama-3.1-70b-instruct',
        permissionManager: pm,
        writeToStdout: false,
        fetchImpl: mockFetch,
        maxSteps: 5,
      });

      assert.equal(result.modifiedFiles.length, 0);
      assert.ok(result.finalResponse.includes('keep version 1'));
      const onDisk = await fs.readFile(path.join(tmpWorkspace, 'a.txt'), 'utf-8');
      assert.equal(onDisk, 'version 1');
    } finally {
      await fs.rm(tmpWorkspace, { recursive: true, force: true });
    }
  });
});
