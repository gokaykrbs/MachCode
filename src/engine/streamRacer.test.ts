import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { raceModels } from './streamRacer.js';

interface MockStreamChunk {
  delayMs: number;
  content: string;
}

/**
 * Creates a mock `fetch` implementation that simulates OpenAI-compatible SSE streams
 * for `lightModel` and `heavyModel` with deterministic per-chunk delays and AbortSignal support.
 */
function createMockNimFetch(
  schedules: Record<string, MockStreamChunk[]>,
  recordedRequests: Array<{ url: string; model: string; stream: boolean }>,
): typeof fetch {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    const bodyText = typeof init?.body === 'string' ? init.body : '{}';
    const parsedBody = JSON.parse(bodyText) as { model: string; stream: boolean };
    const signal = init?.signal;

    recordedRequests.push({
      url,
      model: parsedBody.model,
      stream: Boolean(parsedBody.stream),
    });

    const chunks = schedules[parsedBody.model] ?? [];
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const onAbort = () => {
          try {
            controller.error(
              Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
            );
          } catch {
            // Stream already closed
          }
        };

        if (signal?.aborted) {
          onAbort();
          return;
        }
        signal?.addEventListener('abort', onAbort, { once: true });

        try {
          for (const item of chunks) {
            await new Promise<void>((resolve, reject) => {
              const timer = setTimeout(resolve, item.delayMs);
              signal?.addEventListener(
                'abort',
                () => {
                  clearTimeout(timer);
                  reject(
                    Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
                  );
                },
                { once: true },
              );
            });

            if (signal?.aborted) {
              return;
            }

            const ssePayload = `data: ${JSON.stringify({
              choices: [{ index: 0, delta: { content: item.content } }],
            })}\n\n`;
            controller.enqueue(encoder.encode(ssePayload));
          }

          if (!signal?.aborted) {
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          }
        } catch (err) {
          try {
            controller.error(err);
          } catch {
            // Ignore if already closed
          }
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  };
}

describe('Streaming Handoff Engine (raceModels)', () => {
  const LIGHT_MODEL = 'meta/llama-3.1-70b-instruct';
  const HEAVY_MODEL = 'deepseek-ai/deepseek-r1';

  it('performs THE HANDOFF when Heavyweight starts within the 3-second window after Lightweight', async () => {
    const recordedRequests: Array<{ url: string; model: string; stream: boolean }> = [];
    let clearedOutput = '';
    let handoffDetails: {
      fromModel: string;
      toModel: string;
      elapsedMs: number;
      clearedTerminalOutput: string;
    } | null = null;

    const mockFetch = createMockNimFetch(
      {
        [LIGHT_MODEL]: [
          { delayMs: 20, content: '<plan>Light thinking</plan>\n' },
          { delayMs: 30, content: '```typescript\nconst source = "light";\n' },
          // Next chunk happens at 300ms, after Heavyweight has already taken over at 90ms
          { delayMs: 250, content: 'export default source;\n```' },
        ],
        [HEAVY_MODEL]: [
          // Starts at 90ms (70ms after Light's first token — well inside the 3000ms handoff window!)
          { delayMs: 90, content: '<plan>Heavy deep architecture</plan>\n' },
          { delayMs: 30, content: '```typescript\n' },
          { delayMs: 30, content: 'export const source = "heavy-winner";\n```' },
        ],
      },
      recordedRequests,
    );

    const result = await raceModels('Write source constant', LIGHT_MODEL, HEAVY_MODEL, {
      apiKey: 'nvapi-test-key',
      handoffWindowMs: 3000,
      writeToStdout: false,
      debugLogPath: null,
      fetchImpl: mockFetch,
      onTerminalClear: (cleared) => {
        clearedOutput = cleared;
      },
      onHandoff: (details) => {
        handoffDetails = details;
      },
    });

    // Both endpoints called with stream: true
    assert.equal(recordedRequests.length, 2);
    assert.ok(recordedRequests.every((r) => r.stream === true));
    assert.ok(recordedRequests.every((r) => r.url.endsWith('/v1/chat/completions')));

    // Handoff assertions
    assert.equal(result.handoffOccurred, true);
    assert.equal(result.winnerRole, 'heavy');
    assert.equal(result.winnerModel, HEAVY_MODEL);
    assert.equal(result.lightAborted, true);
    assert.equal(result.heavyAborted, false);
    assert.ok(clearedOutput.includes('const source = "light";'));
    assert.ok(handoffDetails !== null);

    // Final output is 100% from Heavyweight model from the beginning
    assert.equal(result.parseResult.plan, 'Heavy deep architecture');
    assert.equal(result.parseResult.extractedCode, 'export const source = "heavy-winner";');
    assert.ok(!result.finalTerminalOutput.includes('"light"'));
  });

  it('aborts Heavyweight and sticks with Lightweight when Heavyweight exceeds the handoff window', async () => {
    const recordedRequests: Array<{ url: string; model: string; stream: boolean }> = [];
    let windowExpiredCalled = false;

    const mockFetch = createMockNimFetch(
      {
        [LIGHT_MODEL]: [
          { delayMs: 15, content: '<plan>Fast light plan</plan>\n' },
          { delayMs: 25, content: '```typescript\nexport const fast = true;\n```' },
        ],
        [HEAVY_MODEL]: [
          // Delayed 500ms, which exceeds the 120ms test handoff window
          {
            delayMs: 500,
            content: '<plan>Too slow heavy plan</plan>\n```ts\nconst slow = 1;\n```',
          },
        ],
      },
      recordedRequests,
    );

    const result = await raceModels('Write fast flag', LIGHT_MODEL, HEAVY_MODEL, {
      apiKey: 'nvapi-test-key',
      handoffWindowMs: 120,
      writeToStdout: false,
      debugLogPath: null,
      fetchImpl: mockFetch,
      onHandoffWindowExpired: () => {
        windowExpiredCalled = true;
      },
    });

    assert.equal(windowExpiredCalled, true);
    assert.equal(result.handoffOccurred, false);
    assert.equal(result.winnerRole, 'light');
    assert.equal(result.winnerModel, LIGHT_MODEL);
    assert.equal(result.lightAborted, false);
    assert.equal(result.heavyAborted, true);
    assert.equal(result.parseResult.plan, 'Fast light plan');
    assert.equal(result.parseResult.extractedCode, 'export const fast = true;');
  });

  it('immediately aborts Lightweight if Heavyweight emits the very first token first', async () => {
    const recordedRequests: Array<{ url: string; model: string; stream: boolean }> = [];

    const mockFetch = createMockNimFetch(
      {
        [LIGHT_MODEL]: [
          { delayMs: 250, content: '<plan>Late light</plan>\n```ts\nconst x = 1;\n```' },
        ],
        [HEAVY_MODEL]: [
          {
            delayMs: 10,
            content: '<plan>Instant heavy</plan>\n```ts\nexport const instant = 42;\n```',
          },
        ],
      },
      recordedRequests,
    );

    const result = await raceModels('Write instant constant', LIGHT_MODEL, HEAVY_MODEL, {
      apiKey: 'nvapi-test-key',
      handoffWindowMs: 3000,
      writeToStdout: false,
      debugLogPath: null,
      fetchImpl: mockFetch,
    });

    assert.equal(result.handoffOccurred, false);
    assert.equal(result.winnerRole, 'heavy');
    assert.equal(result.winnerModel, HEAVY_MODEL);
    assert.equal(result.lightAborted, true);
    assert.equal(result.heavyAborted, false);
    assert.equal(result.parseResult.extractedCode, 'export const instant = 42;');
  });

  it('forwards multi-turn session messages in request payload to both models', async () => {
    const recordedPayloads: Array<{
      model: string;
      messages: Array<{ role: string; content: string }>;
    }> = [];

    const mockFetch: typeof fetch = async (_input, init) => {
      const parsedBody = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
        model: string;
        messages: Array<{ role: string; content: string }>;
      };
      recordedPayloads.push(parsedBody);

      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const sse = `data: ${JSON.stringify({
            choices: [{ index: 0, delta: { content: '```ts\nconst ok = true;\n```' } }],
          })}\n\ndata: [DONE]\n\n`;
          controller.enqueue(encoder.encode(sse));
          controller.close();
        },
      });

      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    };

    const priorHistory = [
      { role: 'user' as const, content: 'Previous prompt: create auth.ts' },
      { role: 'assistant' as const, content: 'export const token = "abc";' },
    ];

    await raceModels('Now add refresh token function', LIGHT_MODEL, HEAVY_MODEL, {
      apiKey: 'nvapi-test-key',
      handoffWindowMs: 50,
      writeToStdout: false,
      debugLogPath: null,
      fetchImpl: mockFetch,
      messages: priorHistory,
    });

    assert.ok(recordedPayloads.length >= 1);
    for (const payload of recordedPayloads) {
      assert.ok(
        payload.messages.some(
          (m) => m.role === 'user' && m.content.includes('Previous prompt: create auth.ts'),
        ),
      );
      assert.ok(
        payload.messages.some(
          (m) => m.role === 'assistant' && m.content.includes('export const token = "abc";'),
        ),
      );
      assert.ok(
        payload.messages.some(
          (m) => m.role === 'user' && m.content.includes('Now add refresh token function'),
        ),
      );
    }
  });

  it('gracefully recovers and allows Heavyweight to win if Lightweight encounters an error', async () => {
    let callCount = 0;
    const mockFetch: typeof fetch = async (_input, init) => {
      const parsedBody = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
        model: string;
      };
      callCount++;

      if (parsedBody.model === LIGHT_MODEL) {
        // Return 500 error for light model
        return new Response('Rate limit exceeded', { status: 500 });
      }

      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          setTimeout(() => {
            const sse = `data: ${JSON.stringify({
              choices: [
                { index: 0, delta: { content: '```ts\nexport const heavyRecovery = true;\n```' } },
              ],
            })}\n\ndata: [DONE]\n\n`;
            controller.enqueue(encoder.encode(sse));
            controller.close();
          }, 30);
        },
      });

      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    };

    const result = await raceModels('Recover test', LIGHT_MODEL, HEAVY_MODEL, {
      apiKey: 'nvapi-test-key',
      handoffWindowMs: 3000,
      writeToStdout: false,
      debugLogPath: null,
      fetchImpl: mockFetch,
    });

    assert.equal(result.winnerRole, 'heavy');
    assert.equal(result.winnerModel, HEAVY_MODEL);
    assert.equal(result.parseResult.extractedCode, 'export const heavyRecovery = true;');
  });

  it('strictly aborts and throws Timeout Error when both models fail to respond within timeoutMs', async () => {
    const mockFetch: typeof fetch = async (_input, init) => {
      const signal = init?.signal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
        });
      });
    };

    const startTime = Date.now();
    await assert.rejects(
      async () => {
        await raceModels('Hanging test', LIGHT_MODEL, HEAVY_MODEL, {
          apiKey: 'nvapi-test-key',
          timeoutMs: 80,
          writeToStdout: false,
          debugLogPath: null,
          fetchImpl: mockFetch,
        });
      },
      (err: Error) => {
        const elapsed = Date.now() - startTime;
        assert.ok(elapsed < 2000, `Expected timeout to resolve promptly, took ${elapsed}ms`);
        assert.ok(
          err.message.toLowerCase().includes('timeout') ||
            err.message.toLowerCase().includes('timed out'),
          `Expected timeout error message, got: ${err.message}`,
        );
        return true;
      },
    );
  });
});
