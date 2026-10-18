import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tieredFallback, raceModels } from './streamRacer.js';

interface MockStreamChunk {
  delayMs: number;
  content: string;
}

/**
 * Creates a mock `fetch` implementation that simulates OpenAI-compatible SSE streams
 * with deterministic per-chunk delays and AbortSignal support.
 */
function createMockNimFetch(
  schedules: Record<string, MockStreamChunk[] | { errorStatus: number; errorBody?: string }>,
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

    const target = schedules[parsedBody.model];
    if (target && 'errorStatus' in target) {
      return new Response(target.errorBody ?? 'API Error', {
        status: target.errorStatus,
        statusText: 'Internal Error',
      });
    }

    const chunks = (target as MockStreamChunk[]) ?? [];
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

describe('Tiered Priority Fallback Engine (tieredFallback / raceModels)', () => {
  const WEAK_MODEL = 'meta/llama-3.2-11b-vision-instruct';
  const STRONG_MODEL = 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning';

  it('prioritizes StrongPool: locks onto Strong model when it successfully connects', async () => {
    const recordedRequests: Array<{ url: string; model: string; stream: boolean }> = [];
    let firstTokenReceived = false;

    const mockFetch = createMockNimFetch(
      {
        [STRONG_MODEL]: [
          { delayMs: 15, content: '<plan>Strong deep architecture</plan>\n' },
          { delayMs: 20, content: '```typescript\nexport const answer = 42;\n```' },
        ],
        [WEAK_MODEL]: [
          { delayMs: 5, content: '<plan>Weak plan</plan>\n' },
          { delayMs: 10, content: '```typescript\nexport const answer = 0;\n```' },
        ],
      },
      recordedRequests,
    );

    const result = await tieredFallback('Write answer constant', WEAK_MODEL, STRONG_MODEL, {
      apiKey: 'nvapi-test-key',
      writeToStdout: false,
      debugLogPath: null,
      fetchImpl: mockFetch,
      onFirstToken: (model, tier) => {
        assert.equal(model, STRONG_MODEL);
        assert.equal(tier, 'strong');
        firstTokenReceived = true;
      },
    });

    assert.equal(firstTokenReceived, true);
    assert.equal(result.winnerTier, 'strong');
    assert.equal(result.winnerModel, STRONG_MODEL);
    assert.equal(result.parseResult.plan, 'Strong deep architecture');
    assert.equal(result.parseResult.extractedCode, 'export const answer = 42;');

    // Only Strong model was called because it succeeded
    assert.equal(recordedRequests.length, 1);
    assert.equal(recordedRequests[0].model, STRONG_MODEL);
  });

  it('falls back to WeakPool when Strong model fails with HTTP error', async () => {
    const recordedRequests: Array<{ url: string; model: string; stream: boolean }> = [];
    let fallbackTriggered = false;

    const mockFetch = createMockNimFetch(
      {
        [STRONG_MODEL]: { errorStatus: 404, errorBody: 'Function not found' },
        [WEAK_MODEL]: [
          { delayMs: 10, content: '<plan>Fallback fast plan</plan>\n' },
          { delayMs: 15, content: '```typescript\nexport const fallbackActive = true;\n```' },
        ],
      },
      recordedRequests,
    );

    const result = await raceModels('Write fallback flag', WEAK_MODEL, STRONG_MODEL, {
      apiKey: 'nvapi-test-key',
      writeToStdout: false,
      debugLogPath: null,
      fetchImpl: mockFetch,
      onFallback: (fromTier, toTier) => {
        assert.equal(fromTier, 'strong');
        assert.equal(toTier, 'weak');
        fallbackTriggered = true;
      },
    });

    assert.equal(fallbackTriggered, true);
    assert.equal(result.winnerTier, 'weak');
    assert.equal(result.winnerModel, WEAK_MODEL);
    assert.equal(result.parseResult.plan, 'Fallback fast plan');
    assert.equal(result.parseResult.extractedCode, 'export const fallbackActive = true;');

    // Strong model was called first, then Weak model was called as fallback
    assert.equal(recordedRequests.length, 2);
    assert.equal(recordedRequests[0].model, STRONG_MODEL);
    assert.equal(recordedRequests[1].model, WEAK_MODEL);
  });

  it('forwards multi-turn session messages in request payload', async () => {
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

    await raceModels('Now add refresh token function', WEAK_MODEL, STRONG_MODEL, {
      apiKey: 'nvapi-test-key',
      writeToStdout: false,
      debugLogPath: null,
      fetchImpl: mockFetch,
      messages: priorHistory,
    });

    assert.ok(recordedPayloads.length >= 1);
    const payload = recordedPayloads[0];
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
  });

  it('supports strongPool and weakPool options explicitly', async () => {
    const recordedRequests: Array<{ url: string; model: string; stream: boolean }> = [];

    const mockFetch = createMockNimFetch(
      {
        'strong-a': { errorStatus: 500 },
        'strong-b': [
          { delayMs: 10, content: '```ts\nexport const strongB = true;\n```' },
        ],
        'weak-a': [
          { delayMs: 10, content: '```ts\nexport const weakA = true;\n```' },
        ],
      },
      recordedRequests,
    );

    const result = await tieredFallback('Custom pool test', undefined, undefined, {
      apiKey: 'nvapi-test-key',
      strongPool: ['strong-a', 'strong-b'],
      weakPool: ['weak-a'],
      writeToStdout: false,
      debugLogPath: null,
      fetchImpl: mockFetch,
    });

    assert.equal(result.winnerModel, 'strong-b');
    assert.equal(result.winnerTier, 'strong');
    assert.equal(result.parseResult.extractedCode, 'export const strongB = true;');
  });

  it('strictly aborts and throws Timeout Error when all models in both pools hang', async () => {
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
        await raceModels('Hanging test', WEAK_MODEL, STRONG_MODEL, {
          apiKey: 'nvapi-test-key',
          timeoutMs: 60,
          writeToStdout: false,
          debugLogPath: null,
          fetchImpl: mockFetch,
        });
      },
      (err: Error) => {
        const elapsed = Date.now() - startTime;
        assert.ok(elapsed < 2000, `Expected timeout to resolve promptly, took ${elapsed}ms`);
        assert.equal(err.message, '❌ API Timeout: No response in 10s');
        assert.equal((err as { isTimeout?: boolean }).isTimeout, true);
        return true;
      },
    );
  });
});
