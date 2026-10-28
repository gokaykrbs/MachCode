import chalk from 'chalk';
import { read_file, write_file, type WriteFileResult } from '../tools/index.js';
import type { ExtractedCodeBlock, StreamParseResult } from '../utils/streamParser.js';

export type ConfirmWriteDecision = 'approve' | 'reject' | 'approve_all' | boolean;

export interface ProposedFileChange {
  targetPath: string;
  baseDir: string;
  isNewFile: boolean;
  previousContent: string | null;
  newContent: string;
  addedLines: number;
  removedLines: number;
  diffPreview: string;
  fullDiff: string;
}

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
  /**
   * Optional confirmation callback invoked before writing each modified file (Antigravity / Claude Code style).
   * Return true / 'approve' to write, false / 'reject' to skip, or 'approve_all' to write and auto-approve remaining files.
   */
  confirmBeforeWrite?: (
    change: ProposedFileChange,
  ) => Promise<ConfirmWriteDecision> | ConfirmWriteDecision;
}

export interface ExecutionSummary {
  modifiedFiles: WriteFileResult[];
  rejectedFiles?: string[];
  skipped: boolean;
  skippedReason?: 'halted_on_question' | 'no_code_extracted' | 'user_rejected';
  formattedSummary: string;
}

const FILE_HEADER_REGEX =
  /^(?:\/\/|#|\/\*+|<!--)\s*(?:(?:file|filepath|path):\s*)?([a-zA-Z]:[/\\][^\s*>-]+|[a-zA-Z0-9_./\\-]+\.[a-zA-Z0-9_-]+)(?:\s*\*+\/|\s*-->)?\s*\r?\n([\s\S]*)$/i;

/**
 * Inspects a code block for an optional leading file path annotation
 * such as `// file: src/index.ts`, `// D:\test.txt`, or `# main.py`.
 */
export function resolveBlockTarget(
  block: ExtractedCodeBlock,
  fallbackFilePath?: string,
): { filePath: string; cleanCode: string } | null {
  const match = FILE_HEADER_REGEX.exec(block.code);
  if (match && match[1]) {
    const rawPath = match[1].trim();
    if (!rawPath.includes('://') && !rawPath.startsWith('e.g.') && !rawPath.startsWith('http')) {
      return {
        filePath: rawPath,
        cleanCode: match[2] ?? '',
      };
    }
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
 * Computes line-level diff statistics and colorized unified diff output between previous and new file contents.
 */
export function computeFileDiff(
  targetPath: string,
  previousContent: string | null,
  newContent: string,
  maxPreviewLines = 14,
): Omit<ProposedFileChange, 'baseDir'> {
  const isNewFile = previousContent === null;
  const oldLines =
    previousContent !== null ? previousContent.replace(/\r?\n$/, '').split(/\r?\n/) : [];
  const newLines = newContent.replace(/\r?\n$/, '').split(/\r?\n/);

  if (isNewFile) {
    const formattedLines = newLines.map((line, idx) =>
      chalk.green(`  + ${String(idx + 1).padStart(3, ' ')} │ ${line}`),
    );
    const fullDiff = formattedLines.join('\n');
    const previewSlice = formattedLines.slice(0, maxPreviewLines);
    if (formattedLines.length > maxPreviewLines) {
      previewSlice.push(
        chalk.gray(
          `    ... (+${formattedLines.length - maxPreviewLines} more lines — press [d] for full diff)`,
        ),
      );
    }
    return {
      targetPath,
      isNewFile: true,
      previousContent,
      newContent,
      addedLines: newLines.length,
      removedLines: 0,
      diffPreview: previewSlice.join('\n'),
      fullDiff,
    };
  }

  // Compute LCS-style or windowed line diff for clear visualization
  const diffRows: Array<{ type: 'same' | 'add' | 'del'; lineNum: number; text: string }> = [];
  let i = 0;
  let j = 0;
  let addedLines = 0;
  let removedLines = 0;

  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      diffRows.push({ type: 'same', lineNum: j + 1, text: newLines[j] });
      i += 1;
      j += 1;
      continue;
    }

    // Look ahead up to 8 lines to resynchronize
    let syncOld = -1;
    let syncNew = -1;
    const lookahead = 8;
    for (let dist = 1; dist <= lookahead; dist++) {
      if (j + dist < newLines.length && i < oldLines.length && oldLines[i] === newLines[j + dist]) {
        syncOld = i;
        syncNew = j + dist;
        break;
      }
      if (i + dist < oldLines.length && j < newLines.length && oldLines[i + dist] === newLines[j]) {
        syncOld = i + dist;
        syncNew = j;
        break;
      }
    }

    if (syncOld !== -1 && syncNew !== -1) {
      while (i < syncOld) {
        diffRows.push({ type: 'del', lineNum: i + 1, text: oldLines[i] });
        removedLines += 1;
        i += 1;
      }
      while (j < syncNew) {
        diffRows.push({ type: 'add', lineNum: j + 1, text: newLines[j] });
        addedLines += 1;
        j += 1;
      }
    } else {
      if (i < oldLines.length) {
        diffRows.push({ type: 'del', lineNum: i + 1, text: oldLines[i] });
        removedLines += 1;
        i += 1;
      }
      if (j < newLines.length) {
        diffRows.push({ type: 'add', lineNum: j + 1, text: newLines[j] });
        addedLines += 1;
        j += 1;
      }
    }
  }

  // Keep changed lines plus 1 line of context around changes
  const visibleIndices = new Set<number>();
  diffRows.forEach((row, idx) => {
    if (row.type !== 'same') {
      if (idx > 0) visibleIndices.add(idx - 1);
      visibleIndices.add(idx);
      if (idx + 1 < diffRows.length) visibleIndices.add(idx + 1);
    }
  });

  const formattedDiffLines: string[] = [];
  let lastIdx = -1;
  for (let idx = 0; idx < diffRows.length; idx++) {
    if (!visibleIndices.has(idx)) {
      continue;
    }
    if (lastIdx !== -1 && idx - lastIdx > 1) {
      formattedDiffLines.push(chalk.cyan(`    @@ ... @@`));
    }
    const row = diffRows[idx];
    const numStr = String(row.lineNum).padStart(3, ' ');
    if (row.type === 'add') {
      formattedDiffLines.push(chalk.green(`  + ${numStr} │ ${row.text}`));
    } else if (row.type === 'del') {
      formattedDiffLines.push(chalk.red(`  - ${numStr} │ ${row.text}`));
    } else {
      formattedDiffLines.push(chalk.dim(`    ${numStr} │ ${row.text}`));
    }
    lastIdx = idx;
  }

  if (formattedDiffLines.length === 0) {
    formattedDiffLines.push(chalk.dim('    (No line differences detected)'));
  }

  const fullDiff = formattedDiffLines.join('\n');
  const previewSlice = formattedDiffLines.slice(0, maxPreviewLines);
  if (formattedDiffLines.length > maxPreviewLines) {
    previewSlice.push(
      chalk.gray(
        `    ... (+${formattedDiffLines.length - maxPreviewLines} more diff lines — press [d] for full diff)`,
      ),
    );
  }

  return {
    targetPath,
    isNewFile: false,
    previousContent,
    newContent,
    addedLines,
    removedLines,
    diffPreview: previewSlice.join('\n'),
    fullDiff,
  };
}

/**
 * Formats the summary of modified files in green using chalk.
 */
export function formatModifiedFilesSummary(
  modifiedFiles: WriteFileResult[],
  rejectedFiles: string[] = [],
): string {
  const parts: string[] = [];

  if (modifiedFiles.length > 0) {
    const header = chalk.green.bold(`✔ Successfully modified ${modifiedFiles.length} file(s):`);
    const lines = modifiedFiles.map((file) =>
      chalk.green(`  • ${file.relativePath} (${file.bytesWritten} bytes)`),
    );
    parts.push([header, ...lines].join('\n'));
  }

  if (rejectedFiles.length > 0) {
    const rejHeader = chalk.yellow(`⊘ Skipped ${rejectedFiles.length} file(s) (user declined):`);
    const rejLines = rejectedFiles.map((file) => chalk.yellow(`  • ${file}`));
    parts.push([rejHeader, ...rejLines].join('\n'));
  }

  if (parts.length === 0) {
    return chalk.yellow('No files were modified.');
  }

  return parts.join('\n');
}

/**
 * Safely applies the pure code extracted by `StreamParser` to disk using the `write_file` tool,
 * optionally requesting user approval before writing, and outputs a summary of modified files.
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
      // Code block has no `// file: <path>` header and no explicit targetFilePath:
      // treat it as an illustrative snippet inside a conversational Q&A response.
      continue;
    }

    const existingChunks = fileContentsMap.get(resolved.filePath) ?? [];
    existingChunks.push(resolved.cleanCode);
    fileContentsMap.set(resolved.filePath, existingChunks);
  }

  if (fileContentsMap.size === 0) {
    const formattedSummary = chalk.yellow(
      'Conversational response only (no target file headers). No files were modified.',
    );
    return {
      modifiedFiles: [],
      skipped: true,
      skippedReason: 'no_code_extracted',
      formattedSummary,
    };
  }

  const modifiedFiles: WriteFileResult[] = [];
  const rejectedFiles: string[] = [];
  let autoApproveRemaining = false;

  for (const [targetPath, codeChunks] of fileContentsMap.entries()) {
    const combinedCode = `${codeChunks.join('\n\n').replace(/\r?\n$/, '')}\n`;

    if (options.confirmBeforeWrite && !autoApproveRemaining) {
      let previousContent: string | null = null;
      try {
        previousContent = await read_file(targetPath, baseDir);
      } catch {
        previousContent = null;
      }

      const diffInfo = computeFileDiff(targetPath, previousContent, combinedCode);
      const decision = await options.confirmBeforeWrite({
        ...diffInfo,
        baseDir,
      });

      if (decision === 'approve_all') {
        autoApproveRemaining = true;
      } else if (decision === false || decision === 'reject') {
        rejectedFiles.push(targetPath);
        continue;
      }
    }

    if (options.onBeforeWrite) {
      await options.onBeforeWrite(targetPath, baseDir);
    }
    const writeResult = await write_file(targetPath, combinedCode, baseDir);
    modifiedFiles.push(writeResult);
  }

  const formattedSummary = formatModifiedFilesSummary(modifiedFiles, rejectedFiles);
  if (logSummary) {
    log(formattedSummary);
  }

  const allRejected = modifiedFiles.length === 0 && rejectedFiles.length > 0;

  return {
    modifiedFiles,
    rejectedFiles,
    skipped: allRejected,
    skippedReason: allRejected ? 'user_rejected' : undefined,
    formattedSummary,
  };
}
