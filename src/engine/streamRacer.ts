import { stdout as output } from 'node:process';
import { loadConfig } from '../config/index.js';
import { SNIPER_SYSTEM_PROMPT } from '../prompts/sniper.js';
import type { OpenAIToolDefinition } from '../tools/index.js';
import { StreamParser, type StreamParseResult } from '../utils/streamParser.js';

export const DEFAULT_NVIDIA_NIM_BASE_URL = 'https://integrate.api.nvidia.com/v1';
export const DEFAULT_HANDOFF_WINDOW_MS = 3000;
export const DEFAULT_LIGHT_MODEL = 'meta/llama-3.3-70b-instruct';
export const DEFAULT_HEAVY_MODEL = 'qwen/qwen2.5-coder-32b-instruct';

export interface RaceModelsOptions {
  /**
   * NVIDIA NIM API Key. If omitted, read from process.env.NVIDIA_API_KEY or ~/.machcode/config.json.
   */
  apiKey?: string;
  /**
   * OpenAI-compatible base URL. Defaults to https://integrate.api.nvidia.com/v1.
   */
  baseUrl?: string;
  /**
   * System prompt sent to both models. Defaults to SNIPER_SYSTEM_PROMPT.
   */
  systemPrompt?: string;
  /**
   * OpenAI Tool Calling definitions (local FS tools + NVIDIA official skills) available to the engine.
   */
  tools?: OpenAIToolDefinition[];
  /**
   * Handoff window in milliseconds after the Lightweight model outputs its first token.
   * Defaults to 3000 (3 seconds).
   */
  handoffWindowMs?: number;
  /**
   * Whether to write visible stream output directly to process.stdout. Defaults to true.
   */
  writeToStdout?: boolean;
  /**
   * Optional path for the <plan> debug log file. Set to null to disable disk logging.
   */
  debugLogPath?: string | null;
  /**
   * Optional custom fetch implementation (used for mock testing). Defaults to global fetch.
   */
  fetchImpl?: typeof fetch;
  /**
   * Invoked when either model produces its first content token while active.
   */
  onFirstToken?: (model: string, role: 'light' | 'heavy') => void;
  /**
   * Invoked when the Heavyweight model starts within the handoff window and takes over.
   */
  onHandoff?: (details: {
    fromModel: string;
    toModel: string;
    elapsedMs: number;
    clearedTerminalOutput: string;
  }) => void;
  /**
   * Invoked when the Heavyweight model fails to start within the 3-second window and is aborted.
   */
  onHandoffWindowExpired?: (details: {
    winnerModel: string;
    abortedModel: string;
    windowMs: number;
  }) => void;
  /**
   * Invoked for each visible terminal chunk emitted by the active model's StreamParser.
   */
  onTerminalChunk?: (chunk: string, model: string, role: 'light' | 'heavy') => void;
  /**
   * Invoked when the terminal output from the Lightweight model is cleared during a handoff.
   */
  onTerminalClear?: (clearedOutput: string) => void;
  /**
   * Custom QUESTION handler passed to StreamParser.
   */
  onQuestion?: (question: string) => Promise<string | void> | string | void;
  /**
   * Whether StreamParser should interactively prompt on QUESTION.
   */
  promptOnQuestion?: boolean;
  /**
   * Prior conversation messages for multi-turn session context retention.
   */
  messages?: ChatMessage[];
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface RaceModelsResult {
  winnerModel: string;
  winnerRole: 'light' | 'heavy';
  handoffOccurred: boolean;
  handoffElapsedMs: number | null;
  lightAborted: boolean;
  heavyAborted: boolean;
  parseResult: StreamParseResult;
  finalTerminalOutput: string;
}

interface ChatCompletionDeltaChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
    };
  }>;
}

/**
 * Clears previously printed multi-line output from the terminal using ANSI escape sequences.
 */
export function clearTerminalBlock(printedText: string, writeToStdout: boolean): void {
  if (!writeToStdout || printedText.length === 0) {
    return;
  }

  const lines = printedText.split('\n');
  const lineMoves = lines.length - 1;

  // Clear current line
  output.write('\r\x1b[2K');
  // Move cursor up and clear each preceding line
  for (let i = 0; i < lineMoves; i++) {
    output.write('\x1b[1A\r\x1b[2K');
  }
}

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
 * Streams content tokens from an OpenAI-compatible `/v1/chat/completions` SSE endpoint.
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
}): AsyncGenerator<string, void, unknown> {
  const requestMessages: ChatMessage[] = [
    { role: 'system', content: params.systemPrompt },
    ...(params.messages ?? []),
    { role: 'user', content: params.userPrompt },
  ];

  const response = await params.fetchImpl(params.endpoint, {
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
    signal: params.signal,
  });

  if (!response.ok) {
    let errorBody = '';
    try {
      errorBody = await response.text();
    } catch {
      // Ignore body read errors
    }
    throw new Error(
      `Model "${params.model}" request failed with HTTP ${response.status}: ${errorBody || response.statusText}`,
    );
  }

  if (!response.body) {
    throw new Error(`Model "${params.model}" returned an empty response body.`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let sseBuffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split(/\r?\n/);
      sseBuffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || !line.startsWith('data:')) {
          continue;
        }

        const payload = line.slice('data:'.length).trim();
        if (payload === '[DONE]') {
          return;
        }

        try {
          const parsed = JSON.parse(payload) as ChatCompletionDeltaChunk;
          const content = parsed.choices?.[0]?.delta?.content;
          if (typeof content === 'string' && content.length > 0) {
            yield content;
          }
        } catch {
          // Ignore malformed keep-alive or non-JSON comments
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Ignore releaseLock errors on aborted streams
    }
  }
}

/**
 * Checks whether an error was caused by an intentional AbortController.abort() call.
 */
function isAbortError(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) {
    return true;
  }
  if (error instanceof Error) {
    return error.name === 'AbortError' || error.message.toLowerCase().includes('abort');
  }
  return false;
}

/**
 * Streaming Handoff Racing Engine (`raceModels`).
 *
 * Simultaneously launches streaming requests to `lightModel` and `heavyModel` on NVIDIA NIM:
 * - Whichever model emits the first token starts streaming through `StreamParser` to the terminal.
 * - If `lightModel` starts first, a 3-second handoff window opens:
 *   - If `heavyModel` emits its first token within 3 seconds of `lightModel`'s first token,
 *     `lightModel` is IMMEDIATELY aborted, its terminal output is cleared/overwritten, and
 *     `heavyModel`'s stream is processed and displayed seamlessly from the beginning.
 *   - If `heavyModel` does not emit a token within 3 seconds, `heavyModel` is IMMEDIATELY aborted
 *     and `lightModel` continues to completion.
 */
export async function raceModels(
  prompt: string,
  lightModel: string,
  heavyModel: string,
  options: RaceModelsOptions = {},
): Promise<RaceModelsResult> {
  const apiKey = await resolveApiKey(options.apiKey);
  const baseUrl = (options.baseUrl ?? DEFAULT_NVIDIA_NIM_BASE_URL).replace(/\/+$/, '');
  const endpoint = `${baseUrl}/chat/completions`;
  const systemPrompt = options.systemPrompt ?? SNIPER_SYSTEM_PROMPT;
  const handoffWindowMs = options.handoffWindowMs ?? DEFAULT_HANDOFF_WINDOW_MS;
  const writeToStdout = options.writeToStdout ?? true;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  const lightController = new AbortController();
  const heavyController = new AbortController();

  let lightAborted = false;
  let heavyAborted = false;
  let handoffOccurred = false;
  let handoffElapsedMs: number | null = null;

  let activeWinner: 'light' | 'heavy' | null = null;
  let lightFirstTokenTime: number | null = null;
  let handoffWindowOpen = false;
  let handoffTimer: ReturnType<typeof setTimeout> | null = null;
  let handoffWindowPromiseResolve: (() => void) | null = null;

  let lightTerminalOutput = '';
  let heavyTerminalOutput = '';

  const lightParser = new StreamParser({
    debugLogPath: options.debugLogPath,
    writeToStdout: false,
    onQuestion: options.onQuestion,
    promptOnQuestion: options.promptOnQuestion,
    onTerminalChunk: (chunk) => {
      if (activeWinner !== 'light' || lightAborted) {
        return;
      }
      lightTerminalOutput += chunk;
      if (writeToStdout) {
        output.write(chunk);
      }
      options.onTerminalChunk?.(chunk, lightModel, 'light');
    },
  });

  const heavyParser = new StreamParser({
    debugLogPath: options.debugLogPath,
    writeToStdout: false,
    onQuestion: options.onQuestion,
    promptOnQuestion: options.promptOnQuestion,
    onTerminalChunk: (chunk) => {
      if (activeWinner !== 'heavy' || heavyAborted) {
        return;
      }
      heavyTerminalOutput += chunk;
      if (writeToStdout) {
        output.write(chunk);
      }
      options.onTerminalChunk?.(chunk, heavyModel, 'heavy');
    },
  });

  const clearHandoffTimer = (): void => {
    if (handoffTimer !== null) {
      clearTimeout(handoffTimer);
      handoffTimer = null;
    }
    handoffWindowOpen = false;
    if (handoffWindowPromiseResolve) {
      const resolve = handoffWindowPromiseResolve;
      handoffWindowPromiseResolve = null;
      resolve();
    }
  };

  const abortLight = (): void => {
    if (!lightAborted) {
      lightAborted = true;
      lightController.abort();
    }
  };

  const abortHeavy = (): void => {
    if (!heavyAborted) {
      heavyAborted = true;
      heavyController.abort();
    }
  };

  const startHandoffTimer = (): Promise<void> => {
    handoffWindowOpen = true;
    return new Promise<void>((resolve) => {
      handoffWindowPromiseResolve = resolve;
      handoffTimer = setTimeout(() => {
        handoffTimer = null;
        if (handoffWindowOpen && activeWinner === 'light') {
          handoffWindowOpen = false;
          abortHeavy();
          options.onHandoffWindowExpired?.({
            winnerModel: lightModel,
            abortedModel: heavyModel,
            windowMs: handoffWindowMs,
          });
        }
        if (handoffWindowPromiseResolve) {
          const done = handoffWindowPromiseResolve;
          handoffWindowPromiseResolve = null;
          done();
        }
      }, handoffWindowMs);
    });
  };

  let handoffWindowWait: Promise<void> | null = null;
  let lightError: unknown = null;
  let heavyError: unknown = null;

  const consumeLight = async (): Promise<void> => {
    let seenFirstToken = false;
    try {
      const tokenStream = streamChatCompletionTokens({
        endpoint,
        apiKey,
        model: lightModel,
        systemPrompt,
        userPrompt: prompt,
        messages: options.messages,
        signal: lightController.signal,
        fetchImpl,
      });

      for await (const token of tokenStream) {
        if (lightAborted || activeWinner === 'heavy') {
          return;
        }

        if (!seenFirstToken) {
          seenFirstToken = true;
          lightFirstTokenTime = Date.now();
          activeWinner = 'light';
          options.onFirstToken?.(lightModel, 'light');
          handoffWindowWait = startHandoffTimer();
        }

        lightParser.feed(token);
      }
    } catch (err) {
      if (!isAbortError(err, lightController.signal)) {
        lightError = err;
        // If Lightweight errored while waiting for Heavyweight, close the timer and let Heavyweight run
        if (handoffWindowOpen && !heavyAborted) {
          clearHandoffTimer();
          if (lightTerminalOutput.length > 0) {
            clearTerminalBlock(lightTerminalOutput, writeToStdout);
            options.onTerminalClear?.(lightTerminalOutput);
            lightTerminalOutput = '';
          }
          activeWinner = null;
        }
      }
    }
  };

  const consumeHeavy = async (): Promise<void> => {
    let seenFirstToken = false;
    try {
      const tokenStream = streamChatCompletionTokens({
        endpoint,
        apiKey,
        model: heavyModel,
        systemPrompt,
        userPrompt: prompt,
        messages: options.messages,
        signal: heavyController.signal,
        fetchImpl,
      });

      for await (const token of tokenStream) {
        if (heavyAborted) {
          return;
        }

        if (!seenFirstToken) {
          seenFirstToken = true;

          if (activeWinner === null) {
            // Heavyweight beat Lightweight to the very first token
            activeWinner = 'heavy';
            abortLight();
            options.onFirstToken?.(heavyModel, 'heavy');
          } else if (activeWinner === 'light' && handoffWindowOpen) {
            // THE HANDOFF: Heavyweight started within the 3-second window after Lightweight!
            const elapsed = lightFirstTokenTime !== null ? Date.now() - lightFirstTokenTime : 0;
            clearHandoffTimer();
            abortLight();

            handoffOccurred = true;
            handoffElapsedMs = elapsed;
            activeWinner = 'heavy';

            const clearedText = lightTerminalOutput;
            clearTerminalBlock(clearedText, writeToStdout);
            lightTerminalOutput = '';
            options.onTerminalClear?.(clearedText);
            options.onHandoff?.({
              fromModel: lightModel,
              toModel: heavyModel,
              elapsedMs: elapsed,
              clearedTerminalOutput: clearedText,
            });
            options.onFirstToken?.(heavyModel, 'heavy');
          } else {
            // Handoff window already expired; abort Heavyweight
            abortHeavy();
            return;
          }
        }

        if (activeWinner === 'heavy') {
          heavyParser.feed(token);
        }
      }
    } catch (err) {
      if (!isAbortError(err, heavyController.signal)) {
        heavyError = err;
        // If Heavyweight failed during the handoff window, close the window immediately and stick with Lightweight
        if (handoffWindowOpen && activeWinner === 'light') {
          clearHandoffTimer();
          abortHeavy();
        }
      }
    }
  };

  // Start both streams simultaneously
  const lightPromise = consumeLight();
  const heavyPromise = consumeHeavy();

  await Promise.all([
    lightPromise.then(async () => {
      // If Lightweight finished all tokens while the 3-second handoff window is still open,
      // wait for either the handoff or the 3-second window expiry before finalizing.
      if (handoffWindowWait && handoffWindowOpen) {
        await handoffWindowWait;
      }
    }),
    heavyPromise,
  ]);

  clearHandoffTimer();

  if (activeWinner === 'heavy') {
    const parseResult = await heavyParser.finalize();
    return {
      winnerModel: heavyModel,
      winnerRole: 'heavy',
      handoffOccurred,
      handoffElapsedMs,
      lightAborted,
      heavyAborted,
      parseResult,
      finalTerminalOutput: heavyTerminalOutput,
    };
  }

  if (activeWinner === 'light') {
    const parseResult = await lightParser.finalize();
    return {
      winnerModel: lightModel,
      winnerRole: 'light',
      handoffOccurred: false,
      handoffElapsedMs: null,
      lightAborted,
      heavyAborted,
      parseResult,
      finalTerminalOutput: lightTerminalOutput,
    };
  }

  // Neither model succeeded
  const lightMsg =
    lightError instanceof Error ? lightError.message : String(lightError ?? 'unknown');
  const heavyMsg =
    heavyError instanceof Error ? heavyError.message : String(heavyError ?? 'unknown');
  throw new Error(
    `Both models failed to stream responses. Light (${lightModel}): ${lightMsg} | Heavy (${heavyModel}): ${heavyMsg}`,
  );
}
