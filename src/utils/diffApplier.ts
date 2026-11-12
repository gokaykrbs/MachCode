/**
 * diffApplier.ts - Resilient Unified Diff Parser and Fuzzy Patch Applicator
 *
 * Provides:
 * 1. parseUnifiedDiff: Parses standard unified diff (hunks, line deltas)
 * 2. applyUnifiedDiff: Applies unified diff hunks with offset/context tolerance
 * 3. fuzzyReplace: Tolerant block replacement for whitespace / trailing-space variations
 */

export interface DiffHunkLine {
  type: 'context' | 'addition' | 'deletion';
  content: string; // text without the leading ' ', '+', or '-'
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffHunkLine[];
}

export interface UnifiedDiffFile {
  oldPath?: string;
  newPath?: string;
  hunks: DiffHunk[];
}

export interface PatchApplyResult {
  success: boolean;
  content: string;
  appliedHunks: number;
  totalHunks: number;
  error?: string;
}

const HUNK_HEADER_RE = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/;

/**
 * Parses unified diff text into structured hunks.
 */
export function parseUnifiedDiff(diffText: string): UnifiedDiffFile {
  const lines = diffText.replace(/\r\n/g, '\n').split('\n');
  const result: UnifiedDiffFile = { hunks: [] };

  let currentHunk: DiffHunk | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('--- ')) {
      result.oldPath = line
        .substring(4)
        .trim()
        .replace(/^[ab]\//, '');
      continue;
    }
    if (line.startsWith('+++ ')) {
      result.newPath = line
        .substring(4)
        .trim()
        .replace(/^[ab]\//, '');
      continue;
    }

    const hunkMatch = line.match(HUNK_HEADER_RE);
    if (hunkMatch) {
      if (currentHunk) {
        result.hunks.push(currentHunk);
      }
      currentHunk = {
        oldStart: parseInt(hunkMatch[1], 10),
        oldLines: hunkMatch[2] !== undefined ? parseInt(hunkMatch[2], 10) : 1,
        newStart: parseInt(hunkMatch[3], 10),
        newLines: hunkMatch[4] !== undefined ? parseInt(hunkMatch[4], 10) : 1,
        lines: [],
      };
      continue;
    }

    if (currentHunk) {
      if (line.startsWith('+')) {
        currentHunk.lines.push({ type: 'addition', content: line.substring(1) });
      } else if (line.startsWith('-')) {
        currentHunk.lines.push({ type: 'deletion', content: line.substring(1) });
      } else if (line.startsWith(' ') || line === '') {
        currentHunk.lines.push({
          type: 'context',
          content: line.startsWith(' ') ? line.substring(1) : '',
        });
      }
    }
  }

  if (currentHunk) {
    result.hunks.push(currentHunk);
  }

  return result;
}

/**
 * Applies unified diff hunks onto the target text.
 * Includes offset search tolerance (shifts search window up/down up to 50 lines).
 */
export function applyUnifiedDiff(targetContent: string, diffText: string): PatchApplyResult {
  const parsed = parseUnifiedDiff(diffText);
  if (parsed.hunks.length === 0) {
    return {
      success: false,
      content: targetContent,
      appliedHunks: 0,
      totalHunks: 0,
      error: 'No valid unified diff hunks found in patch input.',
    };
  }

  const isCRLF = targetContent.includes('\r\n');
  const targetLines = targetContent.replace(/\r\n/g, '\n').split('\n');
  const currentLines = [...targetLines];

  let appliedCount = 0;

  for (let hIndex = 0; hIndex < parsed.hunks.length; hIndex++) {
    const hunk = parsed.hunks[hIndex];

    // Build the expected sequence of original lines (context + deletions)
    const expectedOriginal: string[] = [];
    const replacementSlice: string[] = [];

    for (const hLine of hunk.lines) {
      if (hLine.type === 'context') {
        expectedOriginal.push(hLine.content);
        replacementSlice.push(hLine.content);
      } else if (hLine.type === 'deletion') {
        expectedOriginal.push(hLine.content);
      } else if (hLine.type === 'addition') {
        replacementSlice.push(hLine.content);
      }
    }

    // Try finding the exact line position starting from hunk.oldStart - 1
    const targetIdx = hunk.oldStart - 1;
    let matchIdx = -1;

    // 1. Direct match at specified line
    if (checkMatch(currentLines, targetIdx, expectedOriginal)) {
      matchIdx = targetIdx;
    } else {
      // 2. Fuzzy search in surrounding window (+/- 60 lines)
      const maxWindow = 60;
      for (let offset = 1; offset <= maxWindow; offset++) {
        if (checkMatch(currentLines, targetIdx - offset, expectedOriginal)) {
          matchIdx = targetIdx - offset;
          break;
        }
        if (checkMatch(currentLines, targetIdx + offset, expectedOriginal)) {
          matchIdx = targetIdx + offset;
          break;
        }
      }

      // 3. Fallback: Full file scan if still not found
      if (matchIdx === -1) {
        for (let idx = 0; idx <= currentLines.length - expectedOriginal.length; idx++) {
          if (checkMatch(currentLines, idx, expectedOriginal)) {
            matchIdx = idx;
            break;
          }
        }
      }

      // 4. Whitespace-trimmed match if strict string matching fails
      if (matchIdx === -1) {
        for (let idx = 0; idx <= currentLines.length - expectedOriginal.length; idx++) {
          if (checkTrimmedMatch(currentLines, idx, expectedOriginal)) {
            matchIdx = idx;
            break;
          }
        }
      }
    }

    if (matchIdx === -1) {
      return {
        success: false,
        content: targetContent,
        appliedHunks: appliedCount,
        totalHunks: parsed.hunks.length,
        error: `Failed to locate matching context for hunk #${hIndex + 1} (oldStart: ${hunk.oldStart}).`,
      };
    }

    // Replace the slice with replacementSlice
    currentLines.splice(matchIdx, expectedOriginal.length, ...replacementSlice);
    appliedCount++;
  }

  const finalStr = currentLines.join(isCRLF ? '\r\n' : '\n');
  return {
    success: true,
    content: finalStr,
    appliedHunks: appliedCount,
    totalHunks: parsed.hunks.length,
  };
}

function checkMatch(lines: string[], startIdx: number, expected: string[]): boolean {
  if (startIdx < 0 || startIdx + expected.length > lines.length) return false;
  for (let i = 0; i < expected.length; i++) {
    if (lines[startIdx + i] !== expected[i]) {
      return false;
    }
  }
  return true;
}

function checkTrimmedMatch(lines: string[], startIdx: number, expected: string[]): boolean {
  if (startIdx < 0 || startIdx + expected.length > lines.length) return false;
  for (let i = 0; i < expected.length; i++) {
    if (lines[startIdx + i].trimEnd() !== expected[i].trimEnd()) {
      return false;
    }
  }
  return true;
}

/**
 * Tolerant string replacement when exact string match fails due to trailing spaces,
 * CRLF/LF variations, or indentation trimming.
 */
export function fuzzyReplace(
  source: string,
  oldStr: string,
  newStr: string,
): { success: boolean; result: string; matchType: 'exact' | 'crlf' | 'trimmed' | 'none' } {
  // 1. Exact match
  if (source.includes(oldStr)) {
    return { success: true, result: source.replace(oldStr, () => newStr), matchType: 'exact' };
  }

  // 2. CRLF <-> LF variation
  const sourceLF = source.replace(/\r\n/g, '\n');
  const oldLF = oldStr.replace(/\r\n/g, '\n');
  const newLF = newStr.replace(/\r\n/g, '\n');

  if (sourceLF.includes(oldLF)) {
    const replacedLF = sourceLF.replace(oldLF, () => newLF);
    const finalResult = source.includes('\r\n') ? replacedLF.replace(/\n/g, '\r\n') : replacedLF;
    return { success: true, result: finalResult, matchType: 'crlf' };
  }

  // 3. Trimmed lines block matching
  const srcLines = sourceLF.split('\n');
  const oldLines = oldLF.split('\n');

  // Strip trailing whitespace from both for line comparison
  let matchStart = -1;
  let matchCount = 0;

  for (let i = 0; i <= srcLines.length - oldLines.length; i++) {
    let match = true;
    for (let j = 0; j < oldLines.length; j++) {
      if (srcLines[i + j].trimEnd() !== oldLines[j].trimEnd()) {
        match = false;
        break;
      }
    }
    if (match) {
      matchStart = i;
      matchCount++;
    }
  }

  // Only apply if uniquely matched exactly once
  if (matchCount === 1 && matchStart !== -1) {
    const newLines = newLF.split('\n');
    srcLines.splice(matchStart, oldLines.length, ...newLines);
    const combined = srcLines.join(source.includes('\r\n') ? '\r\n' : '\n');
    return { success: true, result: combined, matchType: 'trimmed' };
  }

  return { success: false, result: source, matchType: 'none' };
}
