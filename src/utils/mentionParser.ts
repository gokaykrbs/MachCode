import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

export interface MentionedFile {
  mentionText: string;
  relativePath: string;
  absolutePath: string;
  lineCount: number;
  byteLength: number;
  content: string;
  isTruncated: boolean;
}

export interface ParseMentionsResult {
  cleanedPrompt: string;
  mentionedFiles: MentionedFile[];
  augmentedContext: string;
}

const MAX_MENTION_FILE_BYTES = 50 * 1024; // 50 KB limit per mentioned file
const MAX_MENTION_LINES = 1000;

/**
 * Extracts and resolves @file mentions from user input.
 * Excludes email addresses (e.g. test@example.com) by requiring whitespace, start of line,
 * or punctuation immediately before the @ symbol.
 */
export async function parseAndExpandMentions(
  rawPrompt: string,
  baseDir: string = process.cwd(),
): Promise<ParseMentionsResult> {
  const mentionedFiles: MentionedFile[] = [];
  const seenPaths = new Set<string>();

  // Matches @path/to/file while avoiding emails like test@example.com
  const mentionRegex = /(?:^|[\s,;:])@((?:[a-zA-Z]:[/\\])?[a-zA-Z0-9_.\-/\\]+)/g;
  let match: RegExpExecArray | null;

  while ((match = mentionRegex.exec(rawPrompt)) !== null) {
    const rawPath = match[1];

    // Filter out common false positives (like git tags, plain usernames without extensions/paths)
    if (rawPath.length < 2) continue;

    // Resolve target path
    const candidatePath = path.isAbsolute(rawPath)
      ? path.normalize(rawPath)
      : path.resolve(baseDir, rawPath);

    if (seenPaths.has(candidatePath)) continue;

    try {
      if (fsSync.existsSync(candidatePath)) {
        const stat = await fs.stat(candidatePath);
        if (stat.isFile()) {
          seenPaths.add(candidatePath);

          let content = await fs.readFile(candidatePath, 'utf-8');
          let isTruncated = false;

          if (Buffer.byteLength(content, 'utf-8') > MAX_MENTION_FILE_BYTES) {
            content = content.slice(0, MAX_MENTION_FILE_BYTES);
            isTruncated = true;
          }

          const lines = content.split('\n');
          let finalContent = content;
          if (lines.length > MAX_MENTION_LINES) {
            finalContent = lines.slice(0, MAX_MENTION_LINES).join('\n');
            isTruncated = true;
          }

          const relPath = path.relative(baseDir, candidatePath);

          mentionedFiles.push({
            mentionText: `@${rawPath}`,
            relativePath: relPath.length < candidatePath.length ? relPath : candidatePath,
            absolutePath: candidatePath,
            lineCount: lines.length,
            byteLength: stat.size,
            content: finalContent,
            isTruncated,
          });
        }
      }
    } catch {
      // Ignore files that cannot be read or accessed
    }
  }

  // Format context block to append to the model prompt
  let augmentedContext = '';
  if (mentionedFiles.length > 0) {
    const blocks = mentionedFiles.map((f) => {
      const truncNote = f.isTruncated ? ' [TRUNCATED - first 1000 lines]' : '';
      return `--- File Context (@${f.relativePath}${truncNote}) ---\n${f.content}\n--- End of @${f.relativePath} ---`;
    });
    augmentedContext = `\n\n[Referenced Workspace Files via @ Mentions]:\n${blocks.join('\n\n')}`;
  }

  return {
    cleanedPrompt: rawPrompt,
    mentionedFiles,
    augmentedContext,
  };
}

/**
 * Rapidly gathers workspace file candidates for autocomplete when the user types `@`.
 */
export async function getWorkspaceFileCandidates(
  prefix: string,
  baseDir: string = process.cwd(),
  maxResults: number = 15,
): Promise<string[]> {
  const normalizedPrefix = prefix.replace(/^@/, '').toLowerCase();
  const results: string[] = [];

  const ignoredDirs = new Set(['node_modules', '.git', 'dist', '.pnpm-store', 'build', '.next', 'coverage']);

  async function walk(dir: string, currentDepth: number = 0): Promise<void> {
    if (results.length >= maxResults || currentDepth > 4) return;

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= maxResults) break;

        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');

        if (entry.isDirectory()) {
          if (!ignoredDirs.has(entry.name) && !entry.name.startsWith('.')) {
            await walk(fullPath, currentDepth + 1);
          }
        } else if (entry.isFile()) {
          if (!entry.name.startsWith('.') && (normalizedPrefix === '' || relPath.toLowerCase().includes(normalizedPrefix))) {
            results.push(`@${relPath}`);
          }
        }
      }
    } catch {
      // Ignore unreadable dirs
    }
  }

  await walk(baseDir);
  return results.slice(0, maxResults);
}
