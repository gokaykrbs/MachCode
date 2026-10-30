import { stdout as output } from 'node:process';
import { loadConfig, DEFAULT_API_TIMEOUT_MS } from '../config/index.js';
import { VERIFIED_STRONG_POOL_MODELS, VERIFIED_WEAK_POOL_MODELS } from './autoRouter.js';
import { buildSniperSystemPrompt } from '../prompts/sniper.js';
import { StreamParser, type StreamParseResult } from '../utils/streamParser.js';
import type { OpenAIToolDefinition } from '../tools/index.js';

export const DEFAULT_HANDOFF_WINDOW_MS = 3000;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface TieredFallbackOptions {
  apiKey?: string;
  systemPrompt?: string;
  tools?: OpenAIToolDefinition[];
  timeoutMs?: number;
  writeToStdout?: boolean;
  debugLogPath?: string | null;
  fetchImpl?: typeof fetch;
  promptOnQuestion?: boolean;
  onQuestion?: (question: string) => Promise<string | void> | string | void;
  onFirstToken?: (
    model: string,
    tier: 'strong' | 'weak',
    details?: { racedModels: string[]; latencyMs: number },
  ) => void;
  onFallback?: (fromTier: 'strong', toTier: 'weak', reason: string) => void;
  onTerminalChunk?: (chunk: string, model: string, tier: string) => void;
  onTerminalClear?: (clearedText: string) => void;
  messages?: ChatMessage[];
  strongPool?: string[];
  weakPool?: string[];
  // Backwards compatibility for existing callers/tests:
  handoffWindowMs?: number;
  onHandoff?: (details: unknown) => void;
  onHandoffWindowExpired?: (details: unknown) => void;
}

export type RaceModelsOptions = TieredFallbackOptions;

export interface TieredFallbackResult {
  winnerModel: string;
  winnerRole: 'strong' | 'weak' | 'heavy' | 'light';
  winnerTier?: 'strong' | 'weak';
  racedModels?: string[];
  winnerLatencyMs?: number;
  handoffOccurred: boolean;
  handoffElapsedMs: number | null;
  lightAborted: boolean;
  heavyAborted: boolean;
  parseResult: StreamParseResult;
  finalTerminalOutput: string;
}

export type RaceModelsResult = TieredFallbackResult;

/**
 * Resolves the NVIDIA API key from options, environment, or ~/.machcode/config.json.
 */
async function resolveApiKey(explicitKey?: string): Promise<string> {
  if (explicitKey && explicitKey.trim().length > 0) {
    return explicitKey.trim();
  }
  if (process.env.NVIDIA_API_KEY && process.env.NVIDIA_API_KEY.trim().length > 0) {
    return process.env.NVIDIA_API_KEY.trim();
  }
  const config = await loadConfig();
  if (config?.nvidiaApiKey) {
    return config.nvidiaApiKey;
  }
  throw new Error(
    'NVIDIA_API_KEY is not configured. Run a MachCode command to initialize ~/.machcode/config.json.',
  );
}

/**
 * Streams content tokens from an OpenAI-compatible /v1/chat/completions SSE endpoint.
 * Enforces a strict 10s start timeout via AbortController.
 */
async function* streamChatCompletionTokens(params: {
  endpoint: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  messages?: ChatMessage[];
  signal: AbortSignal;
  fetchImpl: typeof fetch;
  timeoutMs?: number;
}): AsyncGenerator<string, void, unknown> {
  const requestMessages: ChatMessage[] = [
    { role: 'system', content: params.systemPrompt },
    ...(params.messages ?? []),
    { role: 'user', content: params.userPrompt },
  ];

  const fetchTimeoutMs = params.timeoutMs ?? DEFAULT_API_TIMEOUT_MS;
  const fetchController = new AbortController();

  let isTimedOut = false;
  let streamStarted = false;

  const onExternalAbort = () => {
    fetchController.abort(params.signal.reason);
  };

  if (params.signal.aborted) {
    return;
  }
  params.signal.addEventListener('abort', onExternalAbort, { once: true });

  const timeoutTimer = setTimeout(() => {
    if (!streamStarted) {
      isTimedOut = true;
      const timeoutErr = new Error('❌ API Timeout: No response in 10s');
      (timeoutErr as unknown as { isTimeout: boolean }).isTimeout = true;
      (timeoutErr as unknown as { model: string }).model = params.model;
      fetchController.abort(timeoutErr);
    }
  }, fetchTimeoutMs);

  const clearTimer = () => {
    clearTimeout(timeoutTimer);
  };

  let response: Response;
  try {
    response = await params.fetchImpl(params.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model: params.model,
        messages: requestMessages,
        stream: true,
        temperature: 0.1,
      }),
      signal: fetchController.signal,
    });
  } catch (err) {
    clearTimer();
    params.signal.removeEventListener('abort', onExternalAbort);

    if (isTimedOut) {
      const timeoutErr = new Error('❌ API Timeout: No response in 10s');
      (timeoutErr as unknown as { isTimeout: boolean }).isTimeout = true;
      (timeoutErr as unknown as { model: string }).model = params.model;
      throw timeoutErr;
    }

    if (params.signal.aborted || fetchController.signal.aborted) {
      return;
    }
    throw err;
  }

  if (!response.ok) {
    clearTimer();
    params.signal.removeEventListener('abort', onExternalAbort);
    let errorBody = '';
    try {
      errorBody = await response.text();
    } catch {
      // Ignore body read errors
    }
    const err = new Error(
      `Model "${params.model}" request failed with HTTP ${response.status}: ${errorBody || response.statusText}`,
    );
    (err as unknown as { status: number }).status = response.status;
    (err as unknown as { model: string }).model = params.model;
    throw err;
  }

  if (!response.body) {
    clearTimer();
    params.signal.removeEventListener('abort', onExternalAbort);
    throw new Error(`Model "${params.model}" returned an empty response body.`);
  }

  const reader = response.body.getReader();
  const cancelReader = () => {
    try {
      reader.cancel().catch(() => {});
    } catch {
      // Ignore
    }
  };
  params.signal.addEventListener('abort', cancelReader, { once: true });
  fetchController.signal.addEventListener('abort', cancelReader, { once: true });

  const decoder = new TextDecoder('utf-8');
  let sseBuffer = '';
  let reasoningBuffer = '';
  let emittedContent = false;

  try {
    while (true) {
      if (params.signal.aborted || fetchController.signal.aborted) {
        if (isTimedOut) {
          const timeoutErr = new Error('❌ API Timeout: No response in 10s');
          (timeoutErr as unknown as { isTimeout: boolean }).isTimeout = true;
          (timeoutErr as unknown as { model: string }).model = params.model;
          throw timeoutErr;
        }
        return;
      }

      let done = false;
      let value: Uint8Array | undefined;
      try {
        const result = await reader.read();
        done = result.done;
        value = result.value;
      } catch (readErr) {
        if (isTimedOut) {
          const timeoutErr = new Error('❌ API Timeout: No response in 10s');
          (timeoutErr as unknown as { isTimeout: boolean }).isTimeout = true;
          (timeoutErr as unknown as { model: string }).model = params.model;
          throw timeoutErr;
        }
        if (params.signal.aborted || fetchController.signal.aborted) {
          return;
        }
        throw readErr;
      }

      if (done) {
        if (!emittedContent && reasoningBuffer.trim().length > 0) {
          yield reasoningBuffer;
        }
        break;
      }

      if (value) {
        sseBuffer += decoder.decode(value, { stream: true });
      }
      const lines = sseBuffer.split(/\r?\n/);
      sseBuffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || !line.startsWith('data:')) {
          continue;
        }

        const payload = line.slice('data:'.length).trim();
        if (payload === '[DONE]') {
          if (!emittedContent && reasoningBuffer.trim().length > 0) {
            yield reasoningBuffer;
          }
          return;
        }

        try {
          const parsed = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string | null; reasoning_content?: string | null } }>;
          };
          const delta = parsed.choices?.[0]?.delta;
          const reasoningChunk = delta?.reasoning_content;
          const contentChunk = delta?.content;

          // If the model is streaming internal chain-of-thought (`reasoning_content`),
          // keep the connection alive and buffer it into <plan> so raw thinking never leaks to stdout
          // and models only win the race once they emit actual user-facing `content`.
          if (typeof reasoningChunk === 'string' && reasoningChunk.length > 0) {
            if (!streamStarted) {
              streamStarted = true;
              clearTimer();
            }
            reasoningBuffer += reasoningChunk;
          }

          if (typeof contentChunk === 'string' && contentChunk.length > 0) {
            if (!streamStarted) {
              streamStarted = true;
              clearTimer();
            }
            if (!emittedContent) {
              emittedContent = true;
              if (reasoningBuffer.trim().length > 0 && !contentChunk.includes('<plan>')) {
                const prefixed = `<plan>${reasoningBuffer.trim()}</plan>\n${contentChunk}`;
                reasoningBuffer = '';
                yield prefixed;
                continue;
              }
            }
            yield contentChunk;
          }
        } catch {
          // Ignore malformed keep-alive comments
        }
      }
    }
  } finally {
    clearTimer();
    params.signal.removeEventListener('abort', onExternalAbort);
    params.signal.removeEventListener('abort', cancelReader);
    fetchController.signal.removeEventListener('abort', cancelReader);
  }
}

interface TierExecutionResult {
  winnerModel: string;
  firstToken: string;
  tokenStream: AsyncGenerator<string, void, unknown>;
  winnerTier: 'strong' | 'weak';
  racedModels: string[];
  latencyMs: number;
}

/**
 * Fires requests in parallel to all models in a tier.
 * Returns the first model that successfully connects (200 OK) and yields its first token,
 * immediately aborting all other competing requests in the tier.
 */
async function executeTier(
  models: string[],
  tier: 'strong' | 'weak',
  params: {
    endpoint: string;
    apiKey: string;
    systemPrompt: string;
    userPrompt: string;
    messages?: ChatMessage[];
    fetchImpl: typeof fetch;
    timeoutMs: number;
    parentSignal?: AbortSignal;
  },
): Promise<TierExecutionResult> {
  const uniqueModels = Array.from(new Set(models)).filter(Boolean);
  if (uniqueModels.length === 0) {
    throw new Error(`No models available for tier: ${tier}`);
  }

  const controllers = new Map<string, AbortController>();
  const errorMap = new Map<string, unknown>();
  const tierStartTime = Date.now();

  return new Promise<TierExecutionResult>((resolve, reject) => {
    let resolved = false;
    let pendingCount = uniqueModels.length;

    const abortOthers = (winner: string) => {
      for (const [model, controller] of controllers) {
        if (model !== winner) {
          try {
            controller.abort();
          } catch {
            // Ignore
          }
        }
      }
    };

    const checkAllFailed = () => {
      if (!resolved && pendingCount === 0) {
        const errorMessages = Array.from(errorMap.entries()).map(
          ([m, err]) => `${m}: ${err instanceof Error ? err.message : String(err)}`,
        );
        const combined = new Error(
          `All models in ${tier} tier failed. Details: ${errorMessages.join(' | ')}`,
        );
        (combined as unknown as { tier: string; errors: Map<string, unknown> }).tier = tier;
        (combined as unknown as { errors: Map<string, unknown> }).errors = errorMap;
        // Check if any error was a timeout
        const hadTimeout = Array.from(errorMap.values()).some(
          (e) => (e as { isTimeout?: boolean })?.isTimeout || (e instanceof Error && e.message.includes('10s')),
        );
        if (hadTimeout) {
          (combined as unknown as { isTimeout: boolean }).isTimeout = true;
        }
        reject(combined);
      }
    };

    for (const model of uniqueModels) {
      const controller = new AbortController();
      controllers.set(model, controller);

      const onParentAbort = () => {
        controller.abort(params.parentSignal?.reason);
      };
      params.parentSignal?.addEventListener('abort', onParentAbort, { once: true });

      (async () => {
        try {
          if (uniqueModels.length > 1 && model.includes('bolt-e4b')) {
            await new Promise<void>((r) => {
              const t = setTimeout(r, 1800);
              controller.signal.addEventListener('abort', () => {
                clearTimeout(t);
                r();
              }, { once: true });
            });
            if (resolved || controller.signal.aborted) {
              return;
            }
          }

          const stream = streamChatCompletionTokens({
            endpoint: params.endpoint,
            apiKey: params.apiKey,
            model,
            systemPrompt: params.systemPrompt,
            userPrompt: params.userPrompt,
            messages: params.messages,
            signal: controller.signal,
            fetchImpl: params.fetchImpl,
            timeoutMs: params.timeoutMs,
          });

          // Wait strictly for the first token of actual content
          const firstIteration = await stream.next();

          if (firstIteration.done || typeof firstIteration.value !== 'string') {
            throw new Error(`Model "${model}" completed without emitting any tokens.`);
          }

          if (resolved) {
            controller.abort();
            return;
          }

          resolved = true;
          abortOthers(model);

          resolve({
            winnerModel: model,
            firstToken: firstIteration.value,
            tokenStream: stream,
            winnerTier: tier,
            racedModels: uniqueModels,
            latencyMs: Date.now() - tierStartTime,
          });
        } catch (err) {
          errorMap.set(model, err);
          pendingCount--;
          checkAllFailed();
        }
      })();
    }
  });
}

/**
 * Multi-Model Parallel Racing & Tiered Priority Fallback Engine.
 * 
 * 1. Primary: Fires parallel requests across all models in the StrongPool.
 * 2. As soon as the fastest strong model returns 200 OK and emits its first actual content token,
 *    instantly locks onto it, streams it to the UI, and aborts all competing requests.
 * 3. Fallback: IF AND ONLY IF all models in the StrongPool fail, timeout, or return errors,
 *    THEN immediately fires parallel requests to the WeakPool to guarantee the user gets a response.
 * 4. Clean UI: Only starts rendering stream chunks to the terminal ONCE a model has won the race.
 */
export async function tieredFallback(
  prompt: string,
  lightModelOrWeakPool?: string | string[],
  heavyModelOrStrongPool?: string | string[],
  options: TieredFallbackOptions = {},
): Promise<TieredFallbackResult> {
  const apiKey = await resolveApiKey(options.apiKey);
  const endpoint = 'https://integrate.api.nvidia.com/v1/chat/completions';
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_API_TIMEOUT_MS;
  const writeToStdout = options.writeToStdout ?? true;

  // Resolve StrongPool and WeakPool
  const strongPool: string[] = options.strongPool ??
    (Array.isArray(heavyModelOrStrongPool) && heavyModelOrStrongPool.length > 0
      ? heavyModelOrStrongPool
      : typeof heavyModelOrStrongPool === 'string' && heavyModelOrStrongPool.trim().length > 0
        ? [heavyModelOrStrongPool.trim()]
        : [...VERIFIED_STRONG_POOL_MODELS]);

  const weakPool: string[] = options.weakPool ??
    (Array.isArray(lightModelOrWeakPool) && lightModelOrWeakPool.length > 0
      ? lightModelOrWeakPool
      : typeof lightModelOrWeakPool === 'string' && lightModelOrWeakPool.trim().length > 0
        ? [lightModelOrWeakPool.trim()]
        : [...VERIFIED_WEAK_POOL_MODELS]);

  const systemPrompt = options.systemPrompt ?? buildSniperSystemPrompt();

  let finalTerminalOutput = '';

  const parser = new StreamParser({
    debugLogPath: options.debugLogPath,
    writeToStdout: false,
    onQuestion: options.onQuestion,
    promptOnQuestion: options.promptOnQuestion,
    onTerminalChunk: (chunk) => {
      finalTerminalOutput += chunk;
      if (writeToStdout) {
        output.write(chunk);
      }
      options.onTerminalChunk?.(chunk, activeModel, activeTier);
    },
  });

  let activeModel = '';
  let activeTier: 'strong' | 'weak' = 'strong';

  let winnerExecution: TierExecutionResult | null = null;
  let strongError: unknown = null;

  // Step 1 & 2: Primary — Fire to StrongPool
  try {
    winnerExecution = await executeTier(strongPool, 'strong', {
      endpoint,
      apiKey,
      systemPrompt,
      userPrompt: prompt,
      messages: options.messages,
      fetchImpl,
      timeoutMs,
    });
  } catch (err) {
    strongError = err;
  }

  // Step 3: Fallback — IF AND ONLY IF all models in StrongPool fail, fire to WeakPool
  if (!winnerExecution) {
    const fallbackReason = strongError instanceof Error ? strongError.message : String(strongError);
    options.onFallback?.('strong', 'weak', fallbackReason);

    try {
      winnerExecution = await executeTier(weakPool, 'weak', {
        endpoint,
        apiKey,
        systemPrompt,
        userPrompt: prompt,
        messages: options.messages,
        fetchImpl,
        timeoutMs,
      });
    } catch (weakError) {
      const isTimeout =
        (strongError as { isTimeout?: boolean })?.isTimeout ||
        (weakError as { isTimeout?: boolean })?.isTimeout ||
        fallbackReason.includes('10s') ||
        (weakError instanceof Error && weakError.message.includes('10s'));

      if (isTimeout) {
        const timeoutErr = new Error('❌ API Timeout: No response in 10s');
        (timeoutErr as unknown as { isTimeout: boolean }).isTimeout = true;
        throw timeoutErr;
      }

      const strongMsg = strongError instanceof Error ? strongError.message : String(strongError);
      const weakMsg = weakError instanceof Error ? weakError.message : String(weakError);
      throw new Error(`Both Strong and Fallback tiers failed. Strong: ${strongMsg} | Weak: ${weakMsg}`);
    }
  }

  // Lock onto the winning model
  const { winnerModel, firstToken, tokenStream, winnerTier, racedModels, latencyMs } =
    winnerExecution;
  activeModel = winnerModel;
  activeTier = winnerTier;

  // Clean UI: Signal that model has successfully connected before any rendering starts
  options.onFirstToken?.(winnerModel, winnerTier, { racedModels, latencyMs });

  // Feed first token into parser
  parser.feed(firstToken);

  // Consume remainder of the winning stream linearly with zero stream switching
  try {
    for await (const chunk of tokenStream) {
      parser.feed(chunk);
    }
  } catch {
    // If stream aborted or errored during delivery, finalize what we have
  }

  const parseResult = await parser.finalize();

  const isStrong = winnerTier === 'strong';
  return {
    winnerModel,
    winnerRole: isStrong ? 'heavy' : 'light',
    winnerTier,
    racedModels,
    winnerLatencyMs: latencyMs,
    handoffOccurred: false,
    handoffElapsedMs: 0,
    lightAborted: isStrong,
    heavyAborted: !isStrong,
    parseResult,
    finalTerminalOutput,
  };
}

/**
 * Alias for tieredFallback to maintain complete backward compatibility with all commands & callers.
 */
export const raceModels = tieredFallback;
