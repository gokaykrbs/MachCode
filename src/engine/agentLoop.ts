import chalk from 'chalk';
import {
  AGENT_TOOL_DEFINITIONS,
  READ_ONLY_TOOL_NAMES,
  planToolCall,
  ToolError,
  type ToolOutcome,
  type ToolPlan,
} from '../tools/agentTools.js';
import { buildAgentSystemPrompt } from '../prompts/agent.js';
import { PermissionManager } from './permissions.js';
import { extractCodeFromMarkdown } from '../utils/streamParser.js';
import { executeParsedCode, type ProposedFileChange } from './executor.js';

export interface AgentChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

export interface AgentLoopOptions {
  prompt: string;
  cwd: string;
  apiKey: string;
  model: string;
  candidateModels?: string[];
  permissionManager?: PermissionManager;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  pinnedFiles?: string[];
  readOnly?: boolean;
  maxSteps?: number;
  timeoutMs?: number;
  writeToStdout?: boolean;
  fetchImpl?: typeof fetch;
  onBeforeWrite?: (absPath: string, cwd: string) => Promise<void> | void;
  signal?: AbortSignal;
}

export interface AgentLoopResult {
  finalResponse: string;
  modifiedFiles: string[];
  toolCallsCount: number;
  stepsTaken: number;
  interrupted: boolean;
  modelUsed: string;
}

interface StreamedChoiceDelta {
  content?: string | null;
  reasoning_content?: string | null;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: string;
    function?: {
      name?: string;
      arguments?: string;
    };
  }>;
}

interface AccumulatedToolCall {
  id: string;
  name: string;
  arguments: string;
}

function _truncateArgs(argsStr: string, maxLen = 80): string {
  try {
    const parsed = JSON.parse(argsStr);
    const entries = Object.entries(parsed)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(', ');
    return entries.length > maxLen ? `${entries.slice(0, maxLen - 3)}...` : entries;
  } catch {
    const clean = argsStr.replace(/\s+/g, ' ').trim();
    return clean.length > maxLen ? `${clean.slice(0, maxLen - 3)}...` : clean;
  }
}

/**
 * Runs a single streaming request to the OpenAI-compatible chat completions endpoint,
 * collecting text content, reasoning content, and tool calls.
 */
async function streamCompletionStep(params: {
  endpoint: string;
  apiKey: string;
  model: string;
  messages: AgentChatMessage[];
  tools?: typeof AGENT_TOOL_DEFINITIONS;
  signal?: AbortSignal;
  fetchImpl: typeof fetch;
  timeoutMs?: number;
  writeToStdout: boolean;
}): Promise<{
  textContent: string;
  reasoningContent: string;
  toolCalls: AccumulatedToolCall[];
  status: number;
  error?: string;
}> {
  const fetchTimeoutMs = params.timeoutMs ?? 30000;
  const controller = new AbortController();

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, fetchTimeoutMs);

  const onAbort = () => controller.abort(params.signal?.reason);
  params.signal?.addEventListener('abort', onAbort, { once: true });

  const bodyPayload: Record<string, unknown> = {
    model: params.model,
    messages: params.messages,
    stream: true,
    temperature: 0.1,
  };
  if (params.tools && params.tools.length > 0) {
    bodyPayload.tools = params.tools;
  }

  let response: Response;
  try {
    response = await params.fetchImpl(params.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(bodyPayload),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    params.signal?.removeEventListener('abort', onAbort);
    if (timedOut) {
      throw new Error('API Timeout: No response in timeout window.');
    }
    throw err;
  }

  if (!response.ok) {
    clearTimeout(timer);
    params.signal?.removeEventListener('abort', onAbort);
    let errorText = '';
    try {
      errorText = await response.text();
    } catch {
      // Ignore
    }
    return {
      textContent: '',
      reasoningContent: '',
      toolCalls: [],
      status: response.status,
      error: errorText || response.statusText,
    };
  }

  if (!response.body) {
    clearTimeout(timer);
    params.signal?.removeEventListener('abort', onAbort);
    throw new Error('Response body is empty.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let sseBuffer = '';
  let textContent = '';
  let reasoningContent = '';
  const toolCallAccumulators = new Map<number, { id: string; name: string; arguments: string }>();

  try {
    while (true) {
      if (params.signal?.aborted || controller.signal.aborted) {
        break;
      }

      const { done, value } = await reader.read();
      if (done) {
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
          break;
        }

        try {
          const parsed = JSON.parse(payload) as {
            choices?: Array<{ delta?: StreamedChoiceDelta }>;
          };
          const delta = parsed.choices?.[0]?.delta;
          if (!delta) continue;

          // Streamed text content
          if (typeof delta.content === 'string' && delta.content.length > 0) {
            textContent += delta.content;
            if (params.writeToStdout) {
              process.stdout.write(delta.content);
            }
          }

          // Streamed reasoning content
          if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
            reasoningContent += delta.reasoning_content;
          }

          // Streamed tool calls
          if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              let existing = toolCallAccumulators.get(idx);
              if (!existing) {
                existing = { id: tc.id || `call_${idx}_${Date.now()}`, name: '', arguments: '' };
                toolCallAccumulators.set(idx, existing);
              }
              if (tc.id) {
                existing.id = tc.id;
              }
              if (tc.function?.name) {
                existing.name += tc.function.name;
              }
              if (tc.function?.arguments) {
                existing.arguments += tc.function.arguments;
              }
            }
          }
        } catch {
          // Ignore keep-alive or malformed sse chunks
        }
      }
    }
  } finally {
    clearTimeout(timer);
    params.signal?.removeEventListener('abort', onAbort);
    try {
      reader.cancel().catch(() => {});
    } catch {
      // Ignore
    }
  }

  const toolCalls: AccumulatedToolCall[] = Array.from(toolCallAccumulators.values()).filter(
    (tc) => tc.name.trim().length > 0,
  );

  return {
    textContent,
    reasoningContent,
    toolCalls,
    status: response.status,
  };
}

/**
 * Runs the autonomous coding agent loop:
 * - Uses native tool calling (`list_directory`, `read_file`, `glob`, `grep`, `edit_file`, `write_file`, `run_command`).
 * - Displays colored unified diffs and requests approval before writing or executing commands.
 * - Supports any absolute path (E:\, D:\, C:\) or relative path in user's filesystem.
 * - Loops iteratively until the model completes the task or reaches max steps.
 */
export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const cwd = options.cwd;
  const endpoint = 'https://integrate.api.nvidia.com/v1/chat/completions';
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const maxSteps = options.maxSteps ?? 25;
  const writeToStdout = options.writeToStdout ?? true;

  const permissionManager =
    options.permissionManager ??
    new PermissionManager({
      isAutoApprove: () => false,
      writeToStdout,
    });

  let activeModel = options.model;
  let toolsAvailable = true;
  const toolsToProvide = options.readOnly
    ? AGENT_TOOL_DEFINITIONS.filter((t) => READ_ONLY_TOOL_NAMES.has(t.function.name))
    : AGENT_TOOL_DEFINITIONS;

  const systemPrompt = buildAgentSystemPrompt({
    cwd,
    pinnedFiles: options.pinnedFiles,
    readOnly: options.readOnly,
    toolsUnavailable: false,
  });

  const messages: AgentChatMessage[] = [{ role: 'system', content: systemPrompt }];

  // Prior conversation history
  if (options.history && options.history.length > 0) {
    for (const msg of options.history.slice(-10)) {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  // Current turn prompt
  messages.push({ role: 'user', content: options.prompt });

  const modifiedFiles: string[] = [];
  let totalToolCalls = 0;
  let stepsTaken = 0;
  let finalResponse = '';

  while (stepsTaken < maxSteps) {
    if (options.signal?.aborted) {
      if (writeToStdout) {
        console.log(chalk.yellow('\n⚠ Operation interrupted by user.\n'));
      }
      return {
        finalResponse,
        modifiedFiles,
        toolCallsCount: totalToolCalls,
        stepsTaken,
        interrupted: true,
        modelUsed: activeModel,
      };
    }

    stepsTaken++;

    let stepResult;
    try {
      stepResult = await streamCompletionStep({
        endpoint,
        apiKey: options.apiKey,
        model: activeModel,
        messages,
        tools: toolsAvailable ? toolsToProvide : undefined,
        signal: options.signal,
        fetchImpl,
        timeoutMs: options.timeoutMs ?? 45000,
        writeToStdout,
      });
    } catch (err) {
      if (options.signal?.aborted) {
        return {
          finalResponse,
          modifiedFiles,
          toolCallsCount: totalToolCalls,
          stepsTaken,
          interrupted: true,
          modelUsed: activeModel,
        };
      }
      throw err;
    }

    // If model returned an HTTP error (404, 410, 500, etc.), auto-heal to next candidate model
    if (stepResult.error || stepResult.status >= 400) {
      const remainingCandidates = (options.candidateModels ?? []).filter((m) => m !== activeModel);
      if (remainingCandidates.length > 0) {
        const nextModel = remainingCandidates[0];
        if (writeToStdout) {
          console.log(
            chalk.yellow(
              `\n⚠️  Model "${activeModel}" returned HTTP ${stepResult.status}. Auto-routing to "${nextModel}"...\n`,
            ),
          );
        }
        activeModel = nextModel;
        options.candidateModels = remainingCandidates.slice(1);
        continue;
      }

      // If model rejected tools with 400, switch to fallback mode
      if (stepResult.status === 400 && toolsAvailable) {
        toolsAvailable = false;
        const fallbackPrompt = buildAgentSystemPrompt({
          cwd,
          pinnedFiles: options.pinnedFiles,
          readOnly: options.readOnly,
          toolsUnavailable: true,
        });
        messages[0] = { role: 'system', content: fallbackPrompt };
        continue;
      }

      throw new Error(`API returned HTTP ${stepResult.status}: ${stepResult.error}`);
    }

    finalResponse = stepResult.textContent;

    // If NO tool calls were requested, the model has finished its turn!
    if (stepResult.toolCalls.length === 0) {
      // Check for code block fallback (if model emitted ```ts // file: ... ```)
      const codeBlocks = extractCodeFromMarkdown(stepResult.textContent);
      if (codeBlocks.length > 0 && !options.readOnly) {
        const execSummary = await executeParsedCode(
          {
            plan: stepResult.reasoningContent,
            extractedCode: codeBlocks.map((b) => b.code).join('\n\n'),
            codeBlocks,
            question: null,
            isHalted: false,
            visibleOutput: stepResult.textContent,
          },
          {
            baseDir: cwd,
            logSummary: false,
            confirmBeforeWrite: async (change: ProposedFileChange) => {
              const dec = await permissionManager.requestWrite({
                kind: 'write',
                title: change.targetPath,
                toolName: 'write_file',
                absPath: change.targetPath,
                displayPath: change.targetPath,
                outsideWorkspace: false,
                previousContent: change.previousContent,
                newContent: change.newContent,
                commit: async () => ({
                  output: 'Written',
                  summary: 'Written',
                }),
              });
              if (dec.allowed) return 'approve';
              return 'reject';
            },
            onBeforeWrite: options.onBeforeWrite,
          },
        );
        for (const file of execSummary.modifiedFiles) {
          if (!modifiedFiles.includes(file.filePath)) {
            modifiedFiles.push(file.filePath);
          }
        }
      }

      break;
    }

    // Add assistant turn with tool_calls
    messages.push({
      role: 'assistant',
      content: stepResult.textContent || null,
      tool_calls: stepResult.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: {
          name: tc.name,
          arguments: tc.arguments,
        },
      })),
    });

    if (writeToStdout && stepResult.textContent.trim().length > 0) {
      console.log('');
    }

    // Execute tool calls sequentially
    for (const toolCall of stepResult.toolCalls) {
      totalToolCalls++;

      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = JSON.parse(toolCall.arguments || '{}');
      } catch (parseErr) {
        const errorMsg = `Invalid JSON arguments for "${toolCall.name}": ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`;
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolCall.name,
          content: errorMsg,
        });
        continue;
      }

      let plan: ToolPlan;
      try {
        plan = await planToolCall(toolCall.name, parsedArgs, {
          cwd,
          signal: options.signal,
        });
      } catch (err) {
        const msg = err instanceof ToolError ? err.message : String(err);
        if (writeToStdout) {
          console.log(`  ${chalk.red('✖')} ${chalk.yellow(toolCall.name)} ${chalk.red(msg)}`);
        }
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolCall.name,
          content: `Error: ${msg}`,
        });
        continue;
      }

      // PDF Phase 2 double-layer guard: in Plan mode (readOnly), mutating tools are rejected by the executor
      if (options.readOnly && plan.kind !== 'read') {
        const blockedMsg =
          'Hata: Plan modundasınız (Salt Okunur). Dosya düzenleme veya komut çalıştırma bu modda engellenmiştir. Değişiklik yapmak için build moduna geçin.';
        if (writeToStdout) {
          console.log(
            `  ${chalk.red('✖')} ${chalk.yellow(toolCall.name)} ${chalk.red('Plan modunda engellendi (Salt Okunur)')}`,
          );
        }
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolCall.name,
          content: blockedMsg,
        });
        continue;
      }

      let outcome: ToolOutcome;

      if (plan.kind === 'read') {
        if (writeToStdout) {
          console.log(
            `\n${chalk.cyan('●')} ${chalk.white.bold(toolCall.name)}${chalk.gray('(')}${chalk.white(plan.title)}${chalk.gray(')')}`,
          );
        }
        try {
          outcome = await plan.run();
          if (writeToStdout) {
            console.log(`  ${chalk.gray('⎿')}  ${chalk.dim(outcome.summary)}`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          outcome = { output: `Error: ${msg}`, summary: msg, isError: true };
          if (writeToStdout) {
            console.log(`  ${chalk.gray('⎿')}  ${chalk.red(msg)}`);
          }
        }
      } else if (plan.kind === 'write') {
        const decision = await permissionManager.requestWrite(plan);
        if (decision.allowed) {
          try {
            if (options.onBeforeWrite) {
              await options.onBeforeWrite(plan.absPath, cwd);
            }
            outcome = await plan.commit();
            if (!modifiedFiles.includes(plan.absPath)) {
              modifiedFiles.push(plan.absPath);
            }
            if (writeToStdout) {
              console.log(`  ${chalk.gray('⎿')}  ${chalk.green('✔ ' + outcome.summary)}`);
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            outcome = { output: `Error writing file: ${msg}`, summary: msg, isError: true };
            if (writeToStdout) {
              console.log(`  ${chalk.gray('⎿')}  ${chalk.red('✖ ' + msg)}`);
            }
          }
        } else {
          const userFeedback = decision.feedback
            ? `User rejected change: "${decision.feedback}". Modify your approach based on this feedback.`
            : 'User declined this file modification. Do not retry the exact same change; ask or try an alternative.';
          outcome = { output: userFeedback, summary: 'Kullanıcı reddetti' };
          if (writeToStdout) {
            console.log(`  ${chalk.gray('⎿')}  ${chalk.yellow('⊘ Değişiklik reddedildi')}`);
          }
        }
      } else {
        // Command plan
        const decision = await permissionManager.requestCommand(plan);
        if (decision.allowed) {
          try {
            outcome = await plan.run();
            if (writeToStdout) {
              console.log(`  ${chalk.gray('⎿')}  ${chalk.dim(outcome.summary)}`);
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            outcome = { output: `Command execution failed: ${msg}`, summary: msg, isError: true };
            if (writeToStdout) {
              console.log(`  ${chalk.gray('⎿')}  ${chalk.red(msg)}`);
            }
          }
        } else {
          const userFeedback = decision.feedback
            ? `User rejected command: "${decision.feedback}".`
            : 'User declined command execution.';
          outcome = { output: userFeedback, summary: 'Kullanıcı reddetti' };
          if (writeToStdout) {
            console.log(`  ${chalk.gray('⎿')}  ${chalk.yellow('⊘ Komut reddedildi')}`);
          }
        }
      }

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        name: toolCall.name,
        content: outcome.output,
      });
    }
  }

  return {
    finalResponse,
    modifiedFiles,
    toolCallsCount: totalToolCalls,
    stepsTaken,
    interrupted: false,
    modelUsed: activeModel,
  };
}
