import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import chalk from 'chalk';
import { getConfigDir } from '../config/index.js';

export interface ExtractedCodeBlock {
  language: string;
  code: string;
}

export interface StreamParseResult {
  plan: string;
  extractedCode: string;
  codeBlocks: ExtractedCodeBlock[];
  question: string | null;
  isHalted: boolean;
  visibleOutput: string;
}

export interface StreamParserOptions {
  /**
   * Path to write <plan>...</plan> debug logs.
   * Defaults to ~/.machcode/debug.log. Set to null to disable disk logging.
   */
  debugLogPath?: string | null;
  /**
   * Callback invoked with visible terminal chunks (excludes <plan>...</plan> and QUESTION:).
   * If WriteToStdout is true, also writes to process.stdout.
   */
  onTerminalChunk?: (chunk: string) => void;
  /**
   * Whether to write visible chunks directly to process.stdout. Defaults to false.
   */
  writeToStdout?: boolean;
  /**
   * Custom handler triggered when QUESTION: is detected and the stream halts.
   * If omitted and promptOnQuestion is true, prompts the user interactively via readline.
   */
  onQuestion?: (question: string) => Promise<string | void> | string | void;
  /**
   * Whether to interactively prompt the user in the terminal when QUESTION: is detected.
   * Defaults to false in programmatic mode unless enabled or onQuestion is provided.
   */
  promptOnQuestion?: boolean;
}

const OPEN_PLAN_REGEX =
  /(?:<plan\b[^>]*>|<think\b[^>]*>|<thought\b[^>]*>|\[PLAN\]|\[THINK\]|(?:^|\r?\n)\s*(?:plan|think|thought)\s*>)/i;

const CLOSE_PLAN_REGEX =
  /(?:<\/plan\s*>|<\/think\s*>|<\/thought\s*>|\[\/(?:PLAN|THINK)\]|\[END_(?:PLAN|THINK)\]|(?:^|\r?\n)\s*(?:<\/plan>|<\/think>|<\/thought>|\/plan>|\/think>|\/thought>|plan>|think>|thought>))/i;

const BRACKETED_OPEN_TAGS = ['<plan>', '<think>', '<thought>', '[PLAN]', '[THINK]'];
const BARE_OPEN_TAGS = ['plan>', 'think>', 'thought>'];

const CLOSE_TAG_CANDIDATES = [
  '</plan>',
  '</think>',
  '</thought>',
  '[/PLAN]',
  '[/THINK]',
  '[END_PLAN]',
  '[END_THINK]',
  '/plan>',
  '/think>',
  '/thought>',
];
const QUESTION_PREFIX = 'QUESTION:';

/**
 * Checks if `buffer` ends with any non-empty prefix of `tag`.
 * Returns the length of the matching prefix at the end of `buffer`, or 0.
 */
function getTrailingTagPrefixLength(buffer: string, tag: string): number {
  const maxLen = Math.min(buffer.length, tag.length - 1);
  for (let len = maxLen; len >= 1; len--) {
    const suffix = buffer.slice(buffer.length - len);
    const prefix = tag.slice(0, len);
    if (suffix.toLowerCase() === prefix.toLowerCase()) {
      return len;
    }
  }
  return 0;
}

/**
 * Returns the maximum trailing prefix length matching any tag in `tags`.
 */
function getMaxTrailingPrefixLength(buffer: string, tags: string[]): number {
  let max = 0;
  for (const tag of tags) {
    const len = getTrailingTagPrefixLength(buffer, tag);
    if (len > max) {
      max = len;
    }
  }
  return max;
}

/**
 * Calculates trailing open tag hold length. Bracketed tags (<plan>, <think>, etc.) can appear anywhere.
 * Bare tags (plan>, think>, etc.) are only held if positioned at stream start or immediately after a newline.
 */
function getTrailingOpenTagHoldLength(buffer: string, isStreamStart: boolean): number {
  let maxHold = 0;

  for (const tag of BRACKETED_OPEN_TAGS) {
    const len = getTrailingTagPrefixLength(buffer, tag);
    if (len > maxHold) {
      maxHold = len;
    }
  }

  for (const tag of BARE_OPEN_TAGS) {
    const len = getTrailingTagPrefixLength(buffer, tag);
    if (len > 0) {
      const startIdx = buffer.length - len;
      const isStart =
        startIdx === 0 ? isStreamStart : /[\r\n]\s*$/.test(buffer.slice(0, startIdx));
      if (isStart && len > maxHold) {
        maxHold = len;
      }
    }
  }

  return maxHold;
}

/**
 * Extracts pure code blocks from markdown fences (```lang ... ```).
 */
export function extractCodeFromMarkdown(markdown: string): ExtractedCodeBlock[] {
  const blocks: ExtractedCodeBlock[] = [];
  const fenceRegex = /```([a-zA-Z0-9_-]*)[ \t]*\r?\n([\s\S]*?)```/g;

  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(markdown)) !== null) {
    const language = (match[1] ?? '').trim();
    const rawCode = match[2] ?? '';
    const cleanedCode = rawCode.replace(/\r?\n$/, '');
    blocks.push({
      language,
      code: cleanedCode,
    });
  }

  return blocks;
}

/**
 * Prompts the user in the terminal when the LLM triggers the Stop & Ask protocol.
 */
export async function promptUserForQuestion(question: string): Promise<string> {
  console.log(
    '\n' +
      chalk.bgYellow.black.bold(' STOP & ASK ') +
      ' ' +
      chalk.yellow.bold('Missing Critical Context:'),
  );
  console.log(chalk.white(question) + '\n');

  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(chalk.cyan('? ') + chalk.bold('Your response: '));
    return answer.trim();
  } finally {
    rl.close();
  }
}

/**
 * Stateful streaming parser for MachCode Sniper responses.
 * - Strips and logs <plan>...</plan> blocks to a debug log file.
 * - Detects QUESTION: [details] to immediately halt the CLI and prompt the user.
 * - Extracts pure code from Markdown code fences (```).
 */
export class StreamParser {
  private readonly options: StreamParserOptions;
  private mode: 'OUTSIDE_PLAN' | 'IN_PLAN' | 'IN_QUESTION' = 'OUTSIDE_PLAN';
  private pendingBuffer = '';
  private planBuffer = '';
  private visibleBuffer = '';
  private questionBuffer = '';
  private halted = false;
  private userPromptResponse: string | null = null;

  constructor(options: StreamParserOptions = {}) {
    this.options = options;
  }

  /**
   * Returns true if the parser detected a QUESTION: directive and halted execution.
   */
  public isHalted(): boolean {
    return this.halted;
  }

  /**
   * Returns the user's response if a QUESTION prompt was answered.
   */
  public getUserResponse(): string | null {
    return this.userPromptResponse;
  }

  /**
   * Feeds a single streaming chunk into the parser state machine.
   */
  public feed(chunk: string): void {
    if (!chunk) {
      return;
    }

    this.pendingBuffer += chunk;
    this.processPendingBuffer(false);
  }

  /**
   * Flushes remaining buffers, writes the <plan> debug log, and triggers the QUESTION handler if halted.
   */
  public async finalize(): Promise<StreamParseResult> {
    this.processPendingBuffer(true);

    if (this.planBuffer.trim().length > 0) {
      await this.writeDebugLog(this.planBuffer.trim());
    }

    const question = this.halted ? this.questionBuffer.trim() : null;

    if (this.halted && question !== null) {
      if (this.options.onQuestion) {
        const result = await this.options.onQuestion(question);
        if (typeof result === 'string') {
          this.userPromptResponse = result;
        }
      } else if (this.options.promptOnQuestion) {
        this.userPromptResponse = await promptUserForQuestion(question);
      }
    }

    // Defense-in-depth: strip any residual plan/think blocks that might have slipped through
    const cleanedVisible = this.visibleBuffer
      .replace(/<plan\b[^>]*>[\s\S]*?<\/plan\s*>/gi, '')
      .replace(/(?:^|\r?\n)\s*plan>[\s\S]*?<\/plan\s*>/gi, '')
      .replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/gi, '')
      .replace(/(?:^|\r?\n)\s*think>[\s\S]*?<\/think\s*>/gi, '')
      .replace(/<thought\b[^>]*>[\s\S]*?<\/thought\s*>/gi, '')
      .replace(/(?:^|\r?\n)\s*thought>[\s\S]*?<\/thought\s*>/gi, '')
      .replace(/\[PLAN\][\s\S]*?\[\/(?:PLAN|END_PLAN)\]/gi, '')
      .trimStart();

    this.visibleBuffer = cleanedVisible;

    const codeBlocks = this.halted ? [] : extractCodeFromMarkdown(this.visibleBuffer);
    const extractedCode = codeBlocks.map((block) => block.code).join('\n\n');

    return {
      plan: this.planBuffer.trim(),
      extractedCode,
      codeBlocks,
      question,
      isHalted: this.halted,
      visibleOutput: this.visibleBuffer,
    };
  }

  /**
   * Convenience method to consume an AsyncIterable stream of token chunks.
   */
  public async processStream(stream: AsyncIterable<string>): Promise<StreamParseResult> {
    for await (const chunk of stream) {
      this.feed(chunk);
    }
    return this.finalize();
  }

  private emitVisible(text: string): void {
    if (!text) {
      return;
    }

    // Secondary defense: strip any closed plan/think blocks
    const sanitized = text
      .replace(/<plan\b[^>]*>[\s\S]*?<\/plan\s*>/gi, '')
      .replace(/(?:^|\r?\n)\s*plan>[\s\S]*?<\/plan\s*>/gi, '')
      .replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/gi, '')
      .replace(/(?:^|\r?\n)\s*think>[\s\S]*?<\/think\s*>/gi, '')
      .replace(/<thought\b[^>]*>[\s\S]*?<\/thought\s*>/gi, '')
      .replace(/(?:^|\r?\n)\s*thought>[\s\S]*?<\/thought\s*>/gi, '')
      .replace(/\[PLAN\][\s\S]*?\[\/(?:PLAN|END_PLAN)\]/gi, '');

    if (!sanitized) {
      return;
    }

    this.visibleBuffer += sanitized;
    if (this.options.onTerminalChunk) {
      this.options.onTerminalChunk(sanitized);
    }
    if (this.options.writeToStdout) {
      output.write(sanitized);
    }
  }

  private processPendingBuffer(flush: boolean): void {
    let keepProcessing = true;

    while (keepProcessing && this.pendingBuffer.length > 0) {
      keepProcessing = false;

      if (this.mode === 'IN_QUESTION') {
        this.questionBuffer += this.pendingBuffer;
        this.pendingBuffer = '';
        return;
      }

      if (this.mode === 'IN_PLAN') {
        const closeMatch = CLOSE_PLAN_REGEX.exec(this.pendingBuffer);
        if (closeMatch && closeMatch.index !== undefined) {
          const closeIdx = closeMatch.index;
          const closeLen = closeMatch[0].length;
          this.planBuffer += this.pendingBuffer.slice(0, closeIdx);
          this.pendingBuffer = this.pendingBuffer.slice(closeIdx + closeLen);
          // Strip immediate leading newline after close tag so terminal output stays clean
          this.pendingBuffer = this.pendingBuffer.replace(/^\r?\n/, '');
          this.mode = 'OUTSIDE_PLAN';
          keepProcessing = true;
          continue;
        }

        if (flush) {
          this.planBuffer += this.pendingBuffer;
          this.pendingBuffer = '';
          return;
        }

        const holdLen = getMaxTrailingPrefixLength(this.pendingBuffer, CLOSE_TAG_CANDIDATES);
        const safeLen = this.pendingBuffer.length - holdLen;
        if (safeLen > 0) {
          this.planBuffer += this.pendingBuffer.slice(0, safeLen);
          this.pendingBuffer = this.pendingBuffer.slice(safeLen);
        }
        return;
      }

      // Mode: OUTSIDE_PLAN
      const openMatch = OPEN_PLAN_REGEX.exec(this.pendingBuffer);
      if (openMatch && openMatch.index !== undefined) {
        const openIdx = openMatch.index;
        const openLen = openMatch[0].length;
        const beforePlan = this.pendingBuffer.slice(0, openIdx);
        if (beforePlan.length > 0) {
          if (this.checkAndHandleQuestion(beforePlan, true)) {
            return;
          }
        }
        this.pendingBuffer = this.pendingBuffer.slice(openIdx + openLen);
        this.mode = 'IN_PLAN';
        keepProcessing = true;
        continue;
      }

      if (flush) {
        this.checkAndHandleQuestion(this.pendingBuffer, true);
        this.pendingBuffer = '';
        return;
      }

      // Hold back any trailing prefix of open tags or QUESTION:
      const isStreamStart = this.visibleBuffer.length === 0;
      const planHold = getTrailingOpenTagHoldLength(this.pendingBuffer, isStreamStart);
      const questionHold = this.getQuestionHoldLength(this.pendingBuffer);
      const holdLen = Math.max(planHold, questionHold);
      const safeLen = this.pendingBuffer.length - holdLen;

      if (safeLen > 0) {
        const chunkToProcess = this.pendingBuffer.slice(0, safeLen);
        this.pendingBuffer = this.pendingBuffer.slice(safeLen);
        if (this.checkAndHandleQuestion(chunkToProcess, false)) {
          this.questionBuffer += this.pendingBuffer;
          this.pendingBuffer = '';
          return;
        }
      }
    }
  }

  /**
   * Determines how many trailing characters could be part of a `QUESTION:` directive
   * at the start of the output or immediately following a newline.
   */
  private getQuestionHoldLength(buffer: string): number {
    const trimmedStart = buffer.replace(/^\s+/, '');
    if (
      this.visibleBuffer.trim().length === 0 &&
      trimmedStart.length > 0 &&
      QUESTION_PREFIX.startsWith(trimmedStart)
    ) {
      return buffer.length;
    }

    const lastNewline = buffer.lastIndexOf('\n');
    if (lastNewline !== -1) {
      const afterNewline = buffer.slice(lastNewline + 1).replace(/^\s+/, '');
      if (afterNewline.length > 0 && QUESTION_PREFIX.startsWith(afterNewline)) {
        return buffer.length - lastNewline;
      }
    }

    return getTrailingTagPrefixLength(buffer, QUESTION_PREFIX);
  }

  /**
   * Checks if `text` contains a `QUESTION:` directive at the beginning of a line.
   * If found, switches to IN_QUESTION mode, halts, and stores the question details.
   */
  private checkAndHandleQuestion(text: string, _isFlush: boolean): boolean {
    const questionRegex = /(?:^|\r?\n)\s*QUESTION:\s*([\s\S]*)$/;
    const match = questionRegex.exec(text);

    if (match && match.index !== undefined) {
      const beforeQuestion = text.slice(0, match.index);
      if (beforeQuestion.length > 0) {
        this.emitVisible(beforeQuestion);
      }
      this.halted = true;
      this.mode = 'IN_QUESTION';
      this.questionBuffer += match[1] ?? '';
      return true;
    }

    this.emitVisible(text);
    return false;
  }

  private async writeDebugLog(planContent: string): Promise<void> {
    if (this.options.debugLogPath === null) {
      return;
    }

    const logPath = this.options.debugLogPath ?? path.join(getConfigDir(), 'debug.log');
    const logDir = path.dirname(logPath);
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] <plan>\n${planContent}\n</plan>\n${'-'.repeat(60)}\n`;

    await fs.mkdir(logDir, { recursive: true, mode: 0o700 });
    await fs.appendFile(logPath, entry, { encoding: 'utf-8', mode: 0o600 });
  }
}
