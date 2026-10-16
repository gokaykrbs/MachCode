import chalk from 'chalk';
import { write_file, type WriteFileResult } from '../tools/index.js';
import type { ExtractedCodeBlock, StreamParseResult } from '../utils/streamParser.js';

export interface ExecutorOptions {
  /**
   * Default target file path when a code block does not specify an inline `// file: <path>` header.
   */
  targetFilePath?: string;
  /**
   * Workspace base directory for safe path resolution. Defaults to process.cwd().
   */
  baseDir?: string;
  /**
   * Whether to print the green summary to the terminal via console.log. Defaults to true.
   */
  logSummary?: boolean;
  /**
   * Optional custom logger function (useful for capturing terminal output in tests).
   */
  logger?: (message: string) => void;
  /**
   * Optional callback invoked immediately before a file is written or overwritten.
   */
  onBeforeWrite?: (targetPath: string, baseDir: string) => Promise<void> | void;
}

export interface ExecutionSummary {
  modifiedFiles: WriteFileResult[];
  skipped: boolean;
  skippedReason?: 'halted_on_question' | 'no_code_extracted';
  formattedSummary: string;
}

const FILE_HEADER_REGEX =
  /^(?:\/\/|#|\/\*+|<!--)\s*(?:file|filepath|path):\s*([^\s*>-]+?)(?:\s*\*+\/|\s*-->)?\s*\r?\n([\s\S]*)$/i;

/**
 * Inspects a code block for an optional leading file path annotation
 * such as `// file: src/index.ts` or `# file: main.py`.
 */
export function resolveBlockTarget(
  block: ExtractedCodeBlock,
  fallbackFilePath?: string,
): { filePath: string; cleanCode: string } | null {
  const match = FILE_HEADER_REGEX.exec(block.code);
  if (match && match[1]) {
    return {
      filePath: match[1].trim(),
      cleanCode: match[2] ?? '',
    };
  }

  if (fallbackFilePath && fallbackFilePath.trim().length > 0) {
    return {
      filePath: fallbackFilePath.trim(),
      cleanCode: block.code,
    };
  }

  return null;
}

/**
 * Formats the summary of modified files in green using chalk.
 */
export function formatModifiedFilesSummary(modifiedFiles: WriteFileResult[]): string {
  if (modifiedFiles.length === 0) {
    return chalk.yellow('No files were modified.');
  }

  const header = chalk.green.bold(`✔ Successfully modified ${modifiedFiles.length} file(s):`);
  const lines = modifiedFiles.map((file) =>
    chalk.green(`  • ${file.relativePath} (${file.bytesWritten} bytes)`),
  );

  return [header, ...lines].join('\n');
}

/**
 * Safely applies the pure code extracted by `StreamParser` to disk using the `write_file` tool,
 * and outputs a green summary of all modified files.
 */
export async function executeParsedCode(
  parseResult: StreamParseResult,
  options: ExecutorOptions = {},
): Promise<ExecutionSummary> {
  const baseDir = options.baseDir ?? process.cwd();
  const logSummary = options.logSummary ?? true;
  const log = options.logger ?? console.log;

  // Safety gate 1: Never write files if the stream halted on a QUESTION: directive
  if (parseResult.isHalted) {
    const formattedSummary = chalk.yellow(
      'Execution halted due to missing context (QUESTION). No files were modified.',
    );
    return {
      modifiedFiles: [],
      skipped: true,
      skippedReason: 'halted_on_question',
      formattedSummary,
    };
  }

  // Safety gate 2: Never overwrite files if no valid code was extracted
  if (parseResult.codeBlocks.length === 0 || parseResult.extractedCode.trim().length === 0) {
    const formattedSummary = chalk.yellow(
      'No code blocks found in response. No files were modified.',
    );
    return {
      modifiedFiles: [],
      skipped: true,
      skippedReason: 'no_code_extracted',
      formattedSummary,
    };
  }

  // Group extracted code blocks by target file path
  const fileContentsMap = new Map<string, string[]>();

  for (const block of parseResult.codeBlocks) {
    if (block.code.trim().length === 0) {
      continue;
    }

    const resolved = resolveBlockTarget(block, options.targetFilePath);
    if (!resolved) {
      throw new Error(
        'Cannot apply extracted code: no targetFilePath was provided and the code block has no `// file: <path>` header.',
      );
    }

    const existingChunks = fileContentsMap.get(resolved.filePath) ?? [];
    existingChunks.push(resolved.cleanCode);
    fileContentsMap.set(resolved.filePath, existingChunks);
  }

  const modifiedFiles: WriteFileResult[] = [];

  for (const [targetPath, codeChunks] of fileContentsMap.entries()) {
    const combinedCode = `${codeChunks.join('\n\n').replace(/\r?\n$/, '')}\n`;
    if (options.onBeforeWrite) {
      await options.onBeforeWrite(targetPath, baseDir);
    }
    const writeResult = await write_file(targetPath, combinedCode, baseDir);
    modifiedFiles.push(writeResult);
  }

  const formattedSummary = formatModifiedFilesSummary(modifiedFiles);
  if (logSummary) {
    log(formattedSummary);
  }

  return {
    modifiedFiles,
    skipped: false,
    formattedSummary,
  };
}
