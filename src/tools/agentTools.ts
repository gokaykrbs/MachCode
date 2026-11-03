import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { OpenAIToolDefinition } from './nvidiaSkills.js';

/**
 * Agent tool suite (Claude Code / OpenCode style).
 *
 * Every tool accepts relative paths (resolved against the active working directory) as well as
 * absolute paths on ANY drive (C:\, D:\, E:\, /home/...), so the agent can reach every folder the
 * user points it at. Read-only tools run immediately; mutating tools (edit/write/command) return a
 * plan that must be approved by the permission layer before it is committed.
 */

export const AGENT_IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '.pnpm-store',
  '.venv',
  'venv',
  '__pycache__',
  'coverage',
  'target',
  '$RECYCLE.BIN',
  'System Volume Information',
]);

const MAX_READ_BYTES = 5 * 1024 * 1024;
const DEFAULT_READ_LIMIT = 2000;
const MAX_LINE_CHARS = 2000;
const MAX_TOOL_OUTPUT_CHARS = 30000;
const MAX_GLOB_RESULTS = 200;
const MAX_GREP_MATCHES = 120;
const SEARCH_TIME_BUDGET_MS = 20000;
const DEFAULT_COMMAND_TIMEOUT_MS = 60000;
const MAX_COMMAND_TIMEOUT_MS = 600000;

/**
 * Identifies sensitive files that must be excluded from automated searches and reading by default,
 * protecting secrets and credentials (.env, .env.local, .git, etc.) as mandated by Phase 2 security policy.
 */
export function isIgnoredFile(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  if (base === '.env' || base.startsWith('.env.') || base.endsWith('.env')) {
    return true;
  }
  if (base === '.git' || base.startsWith('.git')) {
    return true;
  }
  return false;
}

export class ToolError extends Error {}

export interface ToolContext {
  /** Active working directory (relative paths resolve here). */
  cwd: string;
  /** Aborts long-running tools (commands, searches) when the user interrupts the turn. */
  signal?: AbortSignal;
}

export interface ToolOutcome {
  /** Text returned to the model as the tool result. */
  output: string;
  /** One-line human summary rendered under the tool call in the terminal. */
  summary: string;
  /** Optional extra dim preview lines (e.g. tail of command output). */
  preview?: string[];
  isError?: boolean;
  /** Set when a file on disk was created or modified. */
  writtenFile?: { absPath: string; bytesWritten: number; isNewFile: boolean };
}

export interface ReadToolPlan {
  kind: 'read';
  title: string;
  run: () => Promise<ToolOutcome>;
}

export interface WriteToolPlan {
  kind: 'write';
  title: string;
  toolName: 'edit_file' | 'write_file';
  absPath: string;
  displayPath: string;
  outsideWorkspace: boolean;
  previousContent: string | null;
  newContent: string;
  commit: () => Promise<ToolOutcome>;
}

export interface CommandToolPlan {
  kind: 'command';
  title: string;
  command: string;
  cwd: string;
  outsideWorkspace: boolean;
  run: () => Promise<ToolOutcome>;
}

export type ToolPlan = ReadToolPlan | WriteToolPlan | CommandToolPlan;

// ---------------------------------------------------------------------------
// Tool schemas (OpenAI function-calling format)
// ---------------------------------------------------------------------------

function fn(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
): OpenAIToolDefinition {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: { type: 'object', properties, required, additionalProperties: false },
    },
  } as OpenAIToolDefinition;
}

export const AGENT_TOOL_DEFINITIONS: OpenAIToolDefinition[] = [
  fn(
    'list_directory',
    'List files and folders inside a directory. Works on any drive or absolute path (e.g. "E:\\\\", "D:\\\\My Projects", "src"). Use this first to explore a folder the user mentions.',
    {
      path: {
        type: 'string',
        description: 'Directory path, relative to the working directory or absolute (any drive).',
      },
    },
    ['path'],
  ),
  fn(
    'list_dir',
    'Alias for list_directory. List files and folders inside a directory.',
    {
      path: {
        type: 'string',
        description: 'Directory path, relative to the working directory or absolute.',
      },
    },
    ['path'],
  ),
  fn(
    'read_file',
    'Read a text file. Returns numbered lines. For large files use offset/limit to page through it. Always read a file before editing it.',
    {
      path: { type: 'string', description: 'File path, relative or absolute (any drive).' },
      offset: {
        type: 'integer',
        description: '1-based line number to start reading from (optional).',
      },
      limit: {
        type: 'integer',
        description: 'Maximum number of lines to read (optional, default 2000).',
      },
    },
    ['path'],
  ),
  fn(
    'glob',
    'Find files by glob pattern (e.g. "**/*.ts", "src/**/index.*"). Skips node_modules, .git, dist and similar folders.',
    {
      pattern: { type: 'string', description: 'Glob pattern relative to the search directory.' },
      path: {
        type: 'string',
        description:
          'Directory to search in (optional, defaults to the working directory). Can be on any drive.',
      },
    },
    ['pattern'],
  ),
  fn(
    'grep',
    'Search file contents with a regular expression. Returns matching lines as path:line: text.',
    {
      pattern: { type: 'string', description: 'JavaScript regular expression to search for.' },
      path: {
        type: 'string',
        description:
          'File or directory to search (optional, defaults to the working directory). Can be on any drive.',
      },
      include: {
        type: 'string',
        description: 'Optional glob filter for file names, e.g. "*.ts" or "*.{js,jsx}".',
      },
      case_insensitive: { type: 'boolean', description: 'Case-insensitive search (optional).' },
    },
    ['pattern'],
  ),
  fn(
    'edit_file',
    'Replace an exact string in an existing file. old_string must match the file content exactly (including indentation) and be unique unless replace_all is true. The user reviews a diff and must approve the change.',
    {
      path: { type: 'string', description: 'File path, relative or absolute (any drive).' },
      old_string: {
        type: 'string',
        description: 'Exact text to replace. Include enough surrounding lines to make it unique.',
      },
      new_string: { type: 'string', description: 'Replacement text.' },
      replace_all: {
        type: 'boolean',
        description: 'Replace every occurrence (optional, default false).',
      },
    },
    ['path', 'old_string', 'new_string'],
  ),
  fn(
    'write_file',
    'Create a new file or completely overwrite an existing one with the given content. Prefer edit_file for small changes to existing files. The user reviews a diff and must approve the change.',
    {
      path: {
        type: 'string',
        description:
          'File path, relative or absolute (any drive). Parent folders are created automatically.',
      },
      content: { type: 'string', description: 'Complete file content.' },
    },
    ['path', 'content'],
  ),
  fn(
    'run_command',
    'Run a shell command (PowerShell on Windows, bash elsewhere) and return its output and exit code. Use for builds, tests, git, package managers. The user must approve each command.',
    {
      command: { type: 'string', description: 'The command line to execute.' },
      cwd: {
        type: 'string',
        description:
          'Working directory for the command (optional, defaults to the working directory).',
      },
      timeout_ms: {
        type: 'integer',
        description: 'Timeout in milliseconds (optional, default 60000, max 600000).',
      },
    },
    ['command'],
  ),
  fn(
    'bash',
    'Alias for run_command. Run a shell command (PowerShell on Windows, bash elsewhere) and return its output and exit code.',
    {
      command: { type: 'string', description: 'The command line to execute.' },
      cwd: {
        type: 'string',
        description:
          'Working directory for the command (optional, defaults to the working directory).',
      },
      timeout_ms: {
        type: 'integer',
        description: 'Timeout in milliseconds (optional, default 60000, max 600000).',
      },
    },
    ['command'],
  ),
];

export const READ_ONLY_TOOL_NAMES = new Set([
  'list_directory',
  'list_dir',
  'read_file',
  'glob',
  'grep',
]);

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Resolves a user/model supplied path against the working directory.
 * Accepts absolute paths on any drive, `~` home shortcuts, quoted paths and bare drive letters (`E:`).
 */
export function resolveAnyPath(rawPath: string, cwd: string): string {
  if (typeof rawPath !== 'string' || rawPath.trim().length === 0) {
    throw new ToolError('Path must be a non-empty string.');
  }
  let p = rawPath.trim().replace(/^["'`]|["'`]$/g, '');

  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) {
    p = path.join(os.homedir(), p.slice(1));
  }

  // A bare drive letter like "E:" means the drive root, not "current dir on drive E"
  if (/^[a-zA-Z]:$/.test(p)) {
    p = `${p}${path.sep}`;
  }

  return path.resolve(cwd, p);
}

/** True when `target` is the working directory itself or nested inside it. */
export function isInsideDir(target: string, dir: string): boolean {
  const rel = path.relative(path.resolve(dir), path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Friendly path for display: relative when inside cwd, absolute otherwise. */
export function displayPath(absPath: string, cwd: string): string {
  if (isInsideDir(absPath, cwd)) {
    const rel = path.relative(cwd, absPath);
    return rel === '' ? '.' : rel.split(path.sep).join('/');
  }
  return absPath;
}

function clampOutput(text: string, max = MAX_TOOL_OUTPUT_CHARS): string {
  if (text.length <= max) {
    return text;
  }
  const head = Math.floor(max * 0.2);
  const tail = max - head;
  return `${text.slice(0, head)}\n\n... [${text.length - max} characters truncated] ...\n\n${text.slice(-tail)}`;
}

function looksBinary(buf: Buffer): boolean {
  const len = Math.min(buf.length, 8000);
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) {
      return true;
    }
  }
  return false;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Converts a simple glob (`*`, `**`, `?`, `{a,b}`) into a RegExp.
 */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  let inBraces = false;
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` matches zero or more directories
        if (glob[i + 2] === '/' || glob[i + 2] === '\\') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '{') {
      inBraces = true;
      re += '(?:';
    } else if (c === '}' && inBraces) {
      inBraces = false;
      re += ')';
    } else if (c === ',' && inBraces) {
      re += '|';
    } else if (c === '/' || c === '\\') {
      re += '/';
    } else if ('.+^$()|[]'.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`, process.platform === 'win32' ? 'i' : '');
}

async function* walkFiles(
  root: string,
  signal: AbortSignal | undefined,
  deadline: number,
): AsyncGenerator<string> {
  const stack: string[] = [root];
  while (stack.length > 0) {
    if (signal?.aborted || Date.now() > deadline) {
      return;
    }
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    const subdirs: string[] = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!AGENT_IGNORED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          subdirs.push(full);
        }
      } else if (entry.isFile()) {
        if (!isIgnoredFile(entry.name)) {
          yield full;
        }
      }
    }
    // Push in reverse so traversal stays alphabetical
    for (let i = subdirs.length - 1; i >= 0; i--) {
      stack.push(subdirs[i]);
    }
  }
}

function getArgString(
  args: Record<string, unknown>,
  key: string,
  required = true,
): string | undefined {
  const value = args[key];
  if (value === undefined || value === null || value === '') {
    if (required) {
      throw new ToolError(`Missing required argument "${key}".`);
    }
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ToolError(`Argument "${key}" must be a string.`);
  }
  return value;
}

function getArgInt(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const n = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(n)) {
    throw new ToolError(`Argument "${key}" must be an integer.`);
  }
  return Math.floor(n);
}

function getArgBool(args: Record<string, unknown>, key: string): boolean {
  const value = args[key];
  return value === true || value === 'true';
}

/** Accepts both the documented names and a few common aliases models tend to emit. */
function pathArg(args: Record<string, unknown>, required = true): string | undefined {
  const alias = args.path ?? args.filePath ?? args.file_path ?? args.dirPath ?? args.directory;
  return getArgString({ path: alias }, 'path', required);
}

// ---------------------------------------------------------------------------
// Read-only tools
// ---------------------------------------------------------------------------

async function listDirectory(absPath: string, cwd: string): Promise<ToolOutcome> {
  let stats;
  try {
    stats = await fs.stat(absPath);
  } catch {
    throw new ToolError(`Directory not found: ${absPath}`);
  }
  if (!stats.isDirectory()) {
    throw new ToolError(`Not a directory: ${absPath}. Use read_file to read files.`);
  }

  const entries = await fs.readdir(absPath, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
  const files = entries
    .filter((e) => !e.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));

  const lines: string[] = [];
  const limit = 500;
  for (const d of dirs.slice(0, limit)) {
    lines.push(`[DIR]  ${d.name}/`);
  }
  for (const f of files.slice(0, Math.max(0, limit - dirs.length))) {
    let size = '';
    try {
      size = formatBytes((await fs.stat(path.join(absPath, f.name))).size);
    } catch {
      // Ignore unreadable entries
    }
    lines.push(`[FILE] ${f.name}${size ? `  (${size})` : ''}`);
  }
  if (entries.length > limit) {
    lines.push(`... ${entries.length - limit} more entries not shown`);
  }

  return {
    output: `Directory: ${absPath}\n${lines.join('\n') || '(empty directory)'}`,
    summary: `${dirs.length} klasör, ${files.length} dosya — ${displayPath(absPath, cwd)}`,
  };
}

async function readFileTool(
  absPath: string,
  cwd: string,
  offset?: number,
  limit?: number,
): Promise<ToolOutcome> {
  if (isIgnoredFile(absPath)) {
    throw new ToolError(
      `Access to sensitive file "${path.basename(absPath)}" is blocked by security policy to prevent credential leaks.`,
    );
  }
  let stats;
  try {
    stats = await fs.stat(absPath);
  } catch {
    throw new ToolError(`File not found: ${absPath}`);
  }
  if (stats.isDirectory()) {
    throw new ToolError(`${absPath} is a directory. Use list_directory instead.`);
  }
  if (stats.size > MAX_READ_BYTES) {
    throw new ToolError(
      `File is too large to read (${formatBytes(stats.size)}). Use grep to search it instead.`,
    );
  }

  const buf = await fs.readFile(absPath);
  if (looksBinary(buf)) {
    return {
      output: `${absPath} is a binary file (${formatBytes(stats.size)}); its content cannot be displayed as text.`,
      summary: `binary dosya (${formatBytes(stats.size)})`,
    };
  }

  const allLines = buf.toString('utf-8').split(/\r?\n/);
  if (allLines.length > 1 && allLines[allLines.length - 1] === '') {
    allLines.pop();
  }
  const start = Math.max(1, offset ?? 1);
  const count = Math.max(1, Math.min(limit ?? DEFAULT_READ_LIMIT, 5000));
  const slice = allLines.slice(start - 1, start - 1 + count);
  const width = String(start + slice.length).length;
  const numbered = slice.map((line, i) => {
    const text =
      line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}… [line truncated]` : line;
    return `${String(start + i).padStart(width, ' ')}\t${text}`;
  });

  const end = start + slice.length - 1;
  let footer = '';
  if (end < allLines.length) {
    footer = `\n\n[Showing lines ${start}-${end} of ${allLines.length}. Use offset=${end + 1} to read more.]`;
  }

  return {
    output: clampOutput(`File: ${absPath}\n${numbered.join('\n')}${footer}`, 120000),
    summary:
      slice.length === allLines.length
        ? `${allLines.length} satır okundu`
        : `${start}-${end}. satırlar okundu (toplam ${allLines.length})`,
  };
}

async function globTool(
  pattern: string,
  searchRoot: string,
  cwd: string,
  signal?: AbortSignal,
): Promise<ToolOutcome> {
  try {
    const st = await fs.stat(searchRoot);
    if (!st.isDirectory()) {
      throw new ToolError(`Search path is not a directory: ${searchRoot}`);
    }
  } catch (err) {
    if (err instanceof ToolError) throw err;
    throw new ToolError(`Search directory not found: ${searchRoot}`);
  }

  const normalizedPattern = pattern.replace(/\\/g, '/').replace(/^\.\//, '');
  // Patterns without a slash match file names anywhere (like `**/pattern`)
  const matcher = globToRegExp(
    normalizedPattern.includes('/') ? normalizedPattern : `**/${normalizedPattern}`,
  );
  const deadline = Date.now() + SEARCH_TIME_BUDGET_MS;
  const results: string[] = [];
  let truncated = false;

  for await (const file of walkFiles(searchRoot, signal, deadline)) {
    const rel = path.relative(searchRoot, file).split(path.sep).join('/');
    if (matcher.test(rel)) {
      results.push(file);
      if (results.length >= MAX_GLOB_RESULTS) {
        truncated = true;
        break;
      }
    }
  }
  const timedOut = Date.now() > deadline;

  const shown = results.map((f) => displayPath(f, cwd));
  let output =
    shown.length > 0 ? shown.join('\n') : `No files matched "${pattern}" in ${searchRoot}.`;
  if (truncated) output += `\n[Results limited to ${MAX_GLOB_RESULTS}. Narrow the pattern.]`;
  if (timedOut) output += '\n[Search stopped early: time budget exceeded. Narrow the search path.]';

  return {
    output,
    summary: `${results.length}${truncated ? '+' : ''} dosya bulundu`,
  };
}

async function grepTool(
  pattern: string,
  searchPath: string,
  cwd: string,
  include: string | undefined,
  caseInsensitive: boolean,
  signal?: AbortSignal,
): Promise<ToolOutcome> {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, caseInsensitive ? 'i' : '');
  } catch (err) {
    throw new ToolError(
      `Invalid regular expression: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let stats;
  try {
    stats = await fs.stat(searchPath);
  } catch {
    throw new ToolError(`Search path not found: ${searchPath}`);
  }

  const includeRe = include
    ? globToRegExp(include.includes('/') ? include : `**/${include}`)
    : null;
  const deadline = Date.now() + SEARCH_TIME_BUDGET_MS;
  const matches: string[] = [];
  let filesWithMatches = 0;
  let truncated = false;

  const searchFile = async (file: string, root: string) => {
    if (includeRe) {
      const rel = path.relative(root, file).split(path.sep).join('/') || path.basename(file);
      if (!includeRe.test(rel)) return;
    }
    let buf: Buffer;
    try {
      const st = await fs.stat(file);
      if (st.size > 2 * 1024 * 1024) return;
      buf = await fs.readFile(file);
    } catch {
      return;
    }
    if (looksBinary(buf)) return;
    const lines = buf.toString('utf-8').split(/\r?\n/);
    let fileHit = false;
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        if (!fileHit) {
          fileHit = true;
          filesWithMatches += 1;
        }
        const text = lines[i].length > 300 ? `${lines[i].slice(0, 300)}…` : lines[i];
        matches.push(`${displayPath(file, cwd)}:${i + 1}: ${text.trim()}`);
        if (matches.length >= MAX_GREP_MATCHES) {
          truncated = true;
          return;
        }
      }
    }
  };

  if (stats.isFile()) {
    await searchFile(searchPath, path.dirname(searchPath));
  } else {
    for await (const file of walkFiles(searchPath, signal, deadline)) {
      await searchFile(file, searchPath);
      if (truncated) break;
    }
  }
  const timedOut = Date.now() > deadline;

  let output =
    matches.length > 0 ? matches.join('\n') : `No matches for /${pattern}/ in ${searchPath}.`;
  if (truncated) output += `\n[Results limited to ${MAX_GREP_MATCHES} matches. Narrow the search.]`;
  if (timedOut) output += '\n[Search stopped early: time budget exceeded. Narrow the search path.]';

  return {
    output,
    summary: `${matches.length}${truncated ? '+' : ''} eşleşme, ${filesWithMatches} dosyada`,
  };
}

// ---------------------------------------------------------------------------
// Mutating tools
// ---------------------------------------------------------------------------

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count += 1;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

async function commitWrite(
  absPath: string,
  content: string,
  isNewFile: boolean,
): Promise<ToolOutcome> {
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, content, 'utf-8');
  const bytes = Buffer.byteLength(content, 'utf-8');
  return {
    output: `${isNewFile ? 'Created' : 'Updated'} ${absPath} (${bytes} bytes).`,
    summary: `${isNewFile ? 'Oluşturuldu' : 'Güncellendi'} (${formatBytes(bytes)})`,
    writtenFile: { absPath, bytesWritten: bytes, isNewFile },
  };
}

async function planEdit(args: Record<string, unknown>, ctx: ToolContext): Promise<WriteToolPlan> {
  const absPath = resolveAnyPath(pathArg(args)!, ctx.cwd);
  const oldRaw = args.old_string ?? args.oldString ?? args.old_str;
  const newRaw = args.new_string ?? args.newString ?? args.new_str;
  if (typeof oldRaw !== 'string' || typeof newRaw !== 'string') {
    throw new ToolError('edit_file requires string arguments "old_string" and "new_string".');
  }
  if (oldRaw.length === 0) {
    throw new ToolError(
      'old_string is empty. Use write_file to create a new file or overwrite one.',
    );
  }
  if (oldRaw === newRaw) {
    throw new ToolError('old_string and new_string are identical; nothing to change.');
  }

  let previous: string;
  try {
    previous = await fs.readFile(absPath, 'utf-8');
  } catch {
    throw new ToolError(`File not found: ${absPath}. Use write_file to create it.`);
  }

  let oldStr = oldRaw;
  let newStr = newRaw;
  let occurrences = countOccurrences(previous, oldStr);

  // Models usually send LF; transparently match CRLF files
  if (occurrences === 0 && previous.includes('\r\n') && !oldStr.includes('\r\n')) {
    const crlfOld = oldStr.replace(/\n/g, '\r\n');
    const crlfCount = countOccurrences(previous, crlfOld);
    if (crlfCount > 0) {
      oldStr = crlfOld;
      newStr = newStr.replace(/\r?\n/g, '\r\n');
      occurrences = crlfCount;
    }
  }

  if (occurrences === 0) {
    throw new ToolError(
      `old_string was not found in ${absPath}. Re-read the file with read_file and copy the exact text (including whitespace/indentation).`,
    );
  }
  const replaceAll = getArgBool(args, 'replace_all');
  if (occurrences > 1 && !replaceAll) {
    throw new ToolError(
      `old_string occurs ${occurrences} times in ${absPath}. Include more surrounding context to make it unique, or set replace_all=true.`,
    );
  }

  const next = replaceAll
    ? previous.split(oldStr).join(newStr)
    : previous.replace(oldStr, () => newStr);
  const shown = displayPath(absPath, ctx.cwd);

  return {
    kind: 'write',
    title: shown,
    toolName: 'edit_file',
    absPath,
    displayPath: shown,
    outsideWorkspace: !isInsideDir(absPath, ctx.cwd),
    previousContent: previous,
    newContent: next,
    commit: () => commitWrite(absPath, next, false),
  };
}

async function planWrite(args: Record<string, unknown>, ctx: ToolContext): Promise<WriteToolPlan> {
  const absPath = resolveAnyPath(pathArg(args)!, ctx.cwd);
  const content = args.content ?? args.text;
  if (typeof content !== 'string') {
    throw new ToolError('write_file requires a string "content" argument.');
  }

  let previous: string | null = null;
  try {
    const st = await fs.stat(absPath);
    if (st.isDirectory()) {
      throw new ToolError(`${absPath} is a directory.`);
    }
    previous = await fs.readFile(absPath, 'utf-8');
  } catch (err) {
    if (err instanceof ToolError) throw err;
    previous = null;
  }

  const shown = displayPath(absPath, ctx.cwd);
  const isNewFile = previous === null;
  return {
    kind: 'write',
    title: shown,
    toolName: 'write_file',
    absPath,
    displayPath: shown,
    outsideWorkspace: !isInsideDir(absPath, ctx.cwd),
    previousContent: previous,
    newContent: content,
    commit: () => commitWrite(absPath, content, isNewFile),
  };
}

function killProcessTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      process.kill(-pid, 'SIGTERM');
    }
  } catch {
    // Process already exited
  }
}

export async function runShellCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ToolOutcome> {
  const isWin = process.platform === 'win32';
  const shell = isWin ? 'powershell.exe' : '/bin/bash';
  const shellArgs = isWin
    ? [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $ProgressPreference = 'SilentlyContinue'; ${command}`,
      ]
    : ['-lc', command];

  return new Promise<ToolOutcome>((resolve) => {
    let combined = '';
    let finished = false;
    let timedOut = false;
    let interrupted = false;

    const child = spawn(shell, shellArgs, {
      cwd,
      env: process.env,
      windowsHide: true,
      detached: !isWin,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const append = (chunk: Buffer) => {
      combined += chunk.toString('utf-8');
      // Keep memory bounded for chatty commands
      if (combined.length > MAX_TOOL_OUTPUT_CHARS * 4) {
        combined = combined.slice(-MAX_TOOL_OUTPUT_CHARS * 2);
      }
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child.pid);
    }, timeoutMs);

    const onAbort = () => {
      interrupted = true;
      killProcessTree(child.pid);
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    const done = (code: number | null, spawnError?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);

      const text = combined.replace(/\r\n/g, '\n').trimEnd();
      const lines = text.length > 0 ? text.split('\n') : [];
      const preview = lines.slice(-6);
      let status: string;
      if (spawnError) status = `failed to start: ${spawnError.message}`;
      else if (timedOut) status = `timed out after ${timeoutMs} ms`;
      else if (interrupted) status = 'interrupted by user';
      else status = `exit code ${code ?? 'unknown'}`;

      const isError = Boolean(spawnError) || timedOut || interrupted || (code ?? 1) !== 0;
      resolve({
        output: clampOutput(`$ ${command}\n[${status}]\n${text || '(no output)'}`),
        summary: `${status}${lines.length > 0 ? ` • ${lines.length} satır çıktı` : ''}`,
        preview,
        isError,
      });
    };

    child.on('error', (err) => done(null, err));
    child.on('close', (code) => done(code));
  });
}

async function planCommand(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<CommandToolPlan> {
  const command = getArgString(args, 'command')!.trim();
  const cwdArg = getArgString(args, 'cwd', false);
  const cwd = cwdArg ? resolveAnyPath(cwdArg, ctx.cwd) : ctx.cwd;
  try {
    const st = await fs.stat(cwd);
    if (!st.isDirectory()) {
      throw new ToolError(`cwd is not a directory: ${cwd}`);
    }
  } catch (err) {
    if (err instanceof ToolError) throw err;
    throw new ToolError(`cwd not found: ${cwd}`);
  }
  const requested = getArgInt(args, 'timeout_ms');
  const timeoutMs = Math.min(
    Math.max(requested ?? DEFAULT_COMMAND_TIMEOUT_MS, 1000),
    MAX_COMMAND_TIMEOUT_MS,
  );

  return {
    kind: 'command',
    title: command,
    command,
    cwd,
    outsideWorkspace: !isInsideDir(cwd, ctx.cwd),
    run: () => runShellCommand(command, cwd, timeoutMs, ctx.signal),
  };
}

/**
 * Validates arguments and builds an executable plan for a tool call.
 * Throws `ToolError` for invalid input — callers should report the message back to the model.
 */
export async function planToolCall(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolPlan> {
  switch (name) {
    case 'list_directory':
    case 'list_dir':
    case 'ls': {
      const target = resolveAnyPath(pathArg(args, false) ?? '.', ctx.cwd);
      return {
        kind: 'read',
        title: displayPath(target, ctx.cwd),
        run: () => listDirectory(target, ctx.cwd),
      };
    }
    case 'read_file': {
      const target = resolveAnyPath(pathArg(args)!, ctx.cwd);
      const offset = getArgInt(args, 'offset');
      const limit = getArgInt(args, 'limit');
      return {
        kind: 'read',
        title: displayPath(target, ctx.cwd),
        run: () => readFileTool(target, ctx.cwd, offset, limit),
      };
    }
    case 'glob': {
      const pattern = getArgString(args, 'pattern')!;
      const root = resolveAnyPath(pathArg(args, false) ?? '.', ctx.cwd);
      return {
        kind: 'read',
        title: `${pattern}${root !== ctx.cwd ? ` in ${displayPath(root, ctx.cwd)}` : ''}`,
        run: () => globTool(pattern, root, ctx.cwd, ctx.signal),
      };
    }
    case 'grep': {
      const pattern = getArgString(args, 'pattern')!;
      const target = resolveAnyPath(pathArg(args, false) ?? '.', ctx.cwd);
      const include = getArgString(args, 'include', false);
      const ci = getArgBool(args, 'case_insensitive');
      return {
        kind: 'read',
        title: `/${pattern}/${target !== ctx.cwd ? ` in ${displayPath(target, ctx.cwd)}` : ''}`,
        run: () => grepTool(pattern, target, ctx.cwd, include, ci, ctx.signal),
      };
    }
    case 'edit_file':
      return planEdit(args, ctx);
    case 'write_file':
      return planWrite(args, ctx);
    case 'run_command':
    case 'bash':
    case 'shell':
      return planCommand(args, ctx);
    default:
      throw new ToolError(
        `Unknown tool "${name}". Available tools: ${AGENT_TOOL_DEFINITIONS.map((t) => t.function.name).join(', ')}.`,
      );
  }
}
