import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fetchNvidiaModels, autoAssignAndSaveModels, saveConfig, loadConfig } from './index.js';
import {
  autoRouteModels,
  extractModelParamCount,
  isUsableGenerativeModel,
  scoreModelRole,
} from '../engine/autoRouter.js';

describe('AutoRouter & Autonomous Model Routing', () => {
  it('isUsableGenerativeModel filters out embedding, safety, guard, and clip models', () => {
    assert.equal(isUsableGenerativeModel('nvidia/embed-qa-4'), false);
    assert.equal(isUsableGenerativeModel('meta/llama-guard-4-12b'), false);
    assert.equal(isUsableGenerativeModel('nvidia/nemotron-3.5-content-safety'), false);
    assert.equal(isUsableGenerativeModel('nvidia/nvclip'), false);
    assert.equal(isUsableGenerativeModel('deepseek-ai/deepseek-coder-6.7b-instruct'), true);
    assert.equal(isUsableGenerativeModel('meta/codellama-70b'), true);
  });

  it('extractModelParamCount extracts integer billion count correctly', () => {
    assert.equal(extractModelParamCount('meta/llama-3.1-8b-instruct'), 8);
    assert.equal(extractModelParamCount('meta/codellama-70b'), 70);
    assert.equal(extractModelParamCount('mistralai/mistral-large'), null);
  });

  it('autoRouteModels autonomously classifies lightweight (fast) and heavyweight (smart) models', () => {
    const candidates = [
      'nvidia/llama-3.1-nemoguard-8b-content-safety', // safety - excluded
      'nvidia/embed-qa-4', // embed - excluded
      'mistralai/mistral-7b-instruct-v0.3', // 7b instruct -> light
      'deepseek-ai/deepseek-coder-6.7b-instruct', // coder + 6.7b -> light winner
      'nvidia/llama-3.1-nemotron-70b-instruct', // 70b instruct -> heavy
      'meta/codellama-70b', // coder + 70b -> heavy winner
    ];

    const routed = autoRouteModels(candidates);
    assert.equal(routed.lightModel, 'deepseek-ai/deepseek-coder-6.7b-instruct');
    assert.equal(routed.heavyModel, 'meta/codellama-70b');
  });

  it('autoRouteModels supports excluding deprecated models for auto-healing', () => {
    const candidates = [
      'deepseek-ai/deepseek-coder-6.7b-instruct',
      'mistralai/mistral-7b-instruct-v0.3',
      'meta/codellama-70b',
      'nvidia/llama-3.1-nemotron-70b-instruct',
    ];

    // Exclude the first choice lightweight model
    const routed = autoRouteModels(candidates, {
      exclude: new Set(['deepseek-ai/deepseek-coder-6.7b-instruct', 'meta/codellama-70b']),
    });

    assert.equal(routed.lightModel, 'mistralai/mistral-7b-instruct-v0.3');
    assert.equal(routed.heavyModel, 'nvidia/llama-3.1-nemotron-70b-instruct');
  });

  it('autoAssignAndSaveModels fetches, routes, and saves models silently', async () => {
    const existingConfig = await loadConfig();
    try {
      const mockFetch: typeof fetch = async (input, init) => {
        const url = String(input);
        assert.ok(url.includes('/models'));

        const mockResponse = {
          data: [
            { id: 'deepseek-ai/deepseek-coder-6.7b-instruct' },
            { id: 'nvidia/llama-3.1-nemotron-70b-instruct' },
          ],
        };

        return new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      const result = await autoAssignAndSaveModels(
        'nvapi-test',
        'https://mock.nvidia.com/v1',
        mockFetch,
      );
      assert.equal(result.lightModel, 'deepseek-ai/deepseek-coder-6.7b-instruct');
      assert.equal(result.heavyModel, 'nvidia/llama-3.1-nemotron-70b-instruct');
    } finally {
      if (existingConfig) {
        await saveConfig(
          existingConfig.nvidiaApiKey,
          existingConfig.lightModel,
          existingConfig.heavyModel,
          existingConfig.strongPool,
          existingConfig.weakPool,
        );
      }
    }
  });
});

describe('Dynamic Model Fetching & Configuration', () => {
  it('fetchNvidiaModels retrieves and sorts active models from NVIDIA NIM endpoint', async () => {
    const mockFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      assert.ok(url.includes('/models'));
      assert.equal(init?.method, 'GET');
      assert.ok(
        String(init?.headers && (init.headers as Record<string, string>)['Authorization']).includes(
          'Bearer test-key',
        ),
      );

      const mockResponse = {
        data: [
          { id: 'meta/llama-3.1-70b-instruct', object: 'model' },
          { id: 'deepseek-ai/deepseek-r1', object: 'model' },
          { id: 'mistralai/mistral-large', object: 'model' },
        ],
      };

      return new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const models = await fetchNvidiaModels('test-key', 'https://mock.nvidia.com/v1', mockFetch);
    assert.deepEqual(models, [
      'deepseek-ai/deepseek-r1',
      'meta/llama-3.1-70b-instruct',
      'mistralai/mistral-large',
    ]);
  });

  it('fetchNvidiaModels throws descriptive error when response is not ok', async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response('Unauthorized key', { status: 401, statusText: 'Unauthorized' });
    };

    await assert.rejects(
      async () => {
        await fetchNvidiaModels('invalid-key', 'https://mock.nvidia.com/v1', mockFetch);
      },
      (err: Error) => {
        assert.ok(err.message.includes('HTTP 401'));
        assert.ok(err.message.includes('Unauthorized key'));
        return true;
      },
    );
  });

  it('fetchNvidiaModels aborts and throws Timeout Error when request exceeds timeoutMs', async () => {
    const mockFetch: typeof fetch = async (_input, init) => {
      const signal = init?.signal;
      return new Promise((resolve, reject) => {
        signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
        });
      });
    };

    const startTime = Date.now();
    await assert.rejects(
      async () => {
        await fetchNvidiaModels('test-key', 'https://mock.nvidia.com/v1', mockFetch, 50);
      },
      (err: Error) => {
        const elapsed = Date.now() - startTime;
        assert.ok(elapsed < 1000, `Expected timeout to resolve fast, took ${elapsed}ms`);
        assert.ok(
          err.message.includes('Network timeout'),
          `Expected timeout message, got: ${err.message}`,
        );
        return true;
      },
    );
  });
});
