export interface BenchmarkModelResult {
  model: string;
  ttftMs: number | null;
  totalLatencyMs: number;
  outputTokens: number;
  tokensPerSecond: number;
  status: 'success' | 'timeout' | 'error';
  httpStatus?: number;
  errorMessage?: string;
}

export interface BenchmarkReport {
  prompt: string;
  timestamp: number;
  results: BenchmarkModelResult[];
  winnerModel?: string;
  fastestTtftModel?: string;
  highestTpsModel?: string;
}

export interface BenchmarkOptions {
  apiKey?: string;
  prompt?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_PROMPT = 'Write a one-line JavaScript function that reverses a string.';
const DEFAULT_TIMEOUT_MS = 10000;

/**
 * Runs a parallel streaming benchmark across multiple AI models,
 * measuring Time-to-First-Token (TTFT), Total Latency, and Tokens Per Second (TPS).
 */
export async function runModelBenchmark(
  models: string[],
  options: BenchmarkOptions = {},
): Promise<BenchmarkReport> {
  const fetchFn = options.fetchImpl ?? globalThis.fetch;
  const apiKey = options.apiKey ?? process.env.NVIDIA_API_KEY;
  const prompt = options.prompt ?? DEFAULT_PROMPT;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const results: BenchmarkModelResult[] = await Promise.all(
    models.map(async (model): Promise<BenchmarkModelResult> => {
      const startTime = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let ttftMs: number | null = null;
      let tokenCount = 0;

      try {
        const response = await fetchFn('https://integrate.api.nvidia.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            stream: true,
            max_tokens: 64,
          }),
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (!response.ok) {
          return {
            model,
            ttftMs: null,
            totalLatencyMs: Date.now() - startTime,
            outputTokens: 0,
            tokensPerSecond: 0,
            status: 'error',
            httpStatus: response.status,
            errorMessage: `HTTP ${response.status}`,
          };
        }

        if (!response.body) {
          return {
            model,
            ttftMs: null,
            totalLatencyMs: Date.now() - startTime,
            outputTokens: 0,
            tokensPerSecond: 0,
            status: 'error',
            httpStatus: response.status,
            errorMessage: 'No response body',
          };
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          if (ttftMs === null && chunk.trim().length > 0) {
            ttftMs = Date.now() - startTime;
          }

          // Count SSE data events as token indicators
          const matches = chunk.match(/data:\s*\{/g);
          if (matches) {
            tokenCount += matches.length;
          }
        }

        const totalLatencyMs = Math.max(1, Date.now() - startTime);
        const durationSec = totalLatencyMs / 1000;
        const tokensPerSecond = Math.round((tokenCount / durationSec) * 10) / 10;

        return {
          model,
          ttftMs: ttftMs ?? totalLatencyMs,
          totalLatencyMs,
          outputTokens: tokenCount,
          tokensPerSecond,
          status: 'success',
          httpStatus: response.status,
        };
      } catch (err) {
        clearTimeout(timer);
        const isTimeout =
          err instanceof Error && (err.name === 'AbortError' || err.message.includes('abort'));
        return {
          model,
          ttftMs: null,
          totalLatencyMs: Date.now() - startTime,
          outputTokens: 0,
          tokensPerSecond: 0,
          status: isTimeout ? 'timeout' : 'error',
          errorMessage: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );

  // Determine winners
  const successful = results.filter((r) => r.status === 'success');
  let winnerModel: string | undefined;
  let fastestTtftModel: string | undefined;
  let highestTpsModel: string | undefined;

  if (successful.length > 0) {
    const sortedByLatency = [...successful].sort((a, b) => a.totalLatencyMs - b.totalLatencyMs);
    winnerModel = sortedByLatency[0].model;

    const sortedByTtft = [...successful].sort((a, b) => (a.ttftMs ?? 99999) - (b.ttftMs ?? 99999));
    fastestTtftModel = sortedByTtft[0].model;

    const sortedByTps = [...successful].sort((a, b) => b.tokensPerSecond - a.tokensPerSecond);
    highestTpsModel = sortedByTps[0].model;
  }

  return {
    prompt,
    timestamp: Date.now(),
    results,
    winnerModel,
    fastestTtftModel,
    highestTpsModel,
  };
}
