import fs from 'node:fs/promises';
import path from 'node:path';
import { AGENT_IGNORED_DIRS, isIgnoredFile } from './agentTools.js';

export interface FastSearchMatch {
  absPath: string;
  displayPath: string;
  lineNumber: number;
  lineText: string;
  beforeContext?: string[];
  afterContext?: string[];
}

export interface FastSearchOptions {
  query: string;
  baseDir: string;
  isRegex?: boolean;
  caseSensitive?: boolean;
  contextLinesBefore?: number;
  contextLinesAfter?: number;
  filePattern?: string;
  maxMatches?: number;
  maxFileSizeBytes?: number;
}

export interface FastSearchResult {
  query: string;
  matches: FastSearchMatch[];
  totalFilesSearched: number;
  durationMs: number;
  truncated: boolean;
}

const DEFAULT_MAX_MATCHES = 100;
const DEFAULT_MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

/**
 * High-performance multi-file regex and text search engine with context lines.
 * Automatically respects ignore lists, ignores binary files, and protects sensitive secrets.
 */
export async function fastSearchCode(options: FastSearchOptions): Promise<FastSearchResult> {
  const startTime = Date.now();
  const maxMatches = options.maxMatches ?? DEFAULT_MAX_MATCHES;
  const maxFileSize = options.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE;
  const ctxBefore = Math.max(0, options.contextLinesBefore ?? 0);
  const ctxAfter = Math.max(0, options.contextLinesAfter ?? 0);

  let searchRegex: RegExp;
  if (options.isRegex) {
    searchRegex = new RegExp(options.query, options.caseSensitive ? 'g' : 'gi');
  } else {
    const escaped = options.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    searchRegex = new RegExp(escaped, options.caseSensitive ? 'g' : 'gi');
  }

  let fileFilterRegex: RegExp | null = null;
  if (options.filePattern) {
    const pat = options.filePattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.');
    fileFilterRegex = new RegExp(`^${pat}$`, 'i');
  }

  const matches: FastSearchMatch[] = [];
  let totalFilesSearched = 0;
  let truncated = false;

  async function searchDir(dir: string): Promise<void> {
    if (matches.length >= maxMatches) {
      truncated = true;
      return;
    }

    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (matches.length >= maxMatches) {
        truncated = true;
        break;
      }

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (AGENT_IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) {
          continue;
        }
        await searchDir(fullPath);
      } else if (entry.isFile()) {
        if (isIgnoredFile(entry.name)) {
          continue;
        }
        if (fileFilterRegex && !fileFilterRegex.test(entry.name)) {
          continue;
        }

        try {
          const stat = await fs.stat(fullPath);
          if (stat.size > maxFileSize || stat.size === 0) continue;

          totalFilesSearched++;
          const content = await fs.readFile(fullPath, 'utf-8');

          // Skip binary heuristics (null characters)
          if (content.includes('\0')) continue;

          const lines = content.replace(/\r\n/g, '\n').split('\n');
          const relPath = path.relative(options.baseDir, fullPath).replace(/\\/g, '/');

          for (let i = 0; i < lines.length; i++) {
            searchRegex.lastIndex = 0;
            if (searchRegex.test(lines[i])) {
              const beforeLines =
                ctxBefore > 0 ? lines.slice(Math.max(0, i - ctxBefore), i) : undefined;
              const afterLines =
                ctxAfter > 0
                  ? lines.slice(i + 1, Math.min(lines.length, i + 1 + ctxAfter))
                  : undefined;

              matches.push({
                absPath: fullPath,
                displayPath: relPath || entry.name,
                lineNumber: i + 1,
                lineText: lines[i],
                beforeContext: beforeLines,
                afterContext: afterLines,
              });

              if (matches.length >= maxMatches) {
                truncated = true;
                break;
              }
            }
          }
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  await searchDir(options.baseDir);

  matches.sort((a, b) => a.displayPath.localeCompare(b.displayPath) || a.lineNumber - b.lineNumber);

  return {
    query: options.query,
    matches,
    totalFilesSearched,
    durationMs: Date.now() - startTime,
    truncated,
  };
}
