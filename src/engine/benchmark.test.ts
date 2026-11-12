import { describe, it } from 'node:test';
import assert from 'node:assert';
import { runModelBenchmark } from './benchmark.js';

describe('Model Benchmark Suite', () => {
  it('measures latency, TTFT, and TPS with mock streaming response', async () => {
    const mockChunk =
      'data: {"choices":[{"delta":{"content":"function reverse(s){return s.split(\'\').reverse().join(\'\');}"}}]}\n\n';

    const mockFetch = (async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(mockChunk));
          controller.close();
        },
      });

      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as unknown as typeof fetch;

    const report = await runModelBenchmark(
      ['meta/llama-3.3-70b-instruct', 'qwen/qwen2.5-coder-32b-instruct'],
      {
        fetchImpl: mockFetch,
        apiKey: 'test-key',
      },
    );

    assert.strictEqual(report.results.length, 2);
    assert.strictEqual(report.results[0].status, 'success');
    assert.strictEqual(report.results[1].status, 'success');
    assert.ok(report.results[0].outputTokens >= 1);
    assert.ok(report.winnerModel !== undefined);
  });

  it('handles model timeouts gracefully', async () => {
    const mockHangingFetch = (async () => {
      return new Promise((_, reject) => {
        setTimeout(() => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        }, 50);
      });
    }) as unknown as typeof fetch;

    const report = await runModelBenchmark(['hanging-model'], {
      fetchImpl: mockHangingFetch,
      timeoutMs: 30,
      apiKey: 'test-key',
    });

    assert.strictEqual(report.results.length, 1);
    assert.strictEqual(report.results[0].status, 'timeout');
    assert.strictEqual(report.results[0].outputTokens, 0);
  });
});
