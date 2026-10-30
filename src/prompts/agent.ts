import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let cachedDrives: string[] | null = null;

/**
 * Lists mounted drive roots on Windows (C:\, D:\, E:\ ...). Cached for the process lifetime.
 */
export function detectDrives(): string[] {
  if (process.platform !== 'win32') {
    return ['/'];
  }
  if (cachedDrives) {
    return cachedDrives;
  }
  const drives: string[] = [];
  for (let code = 'C'.charCodeAt(0); code <= 'Z'.charCodeAt(0); code++) {
    const root = `${String.fromCharCode(code)}:\\`;
    try {
      fs.statSync(root);
      drives.push(root);
    } catch {
      // Drive not mounted
    }
  }
  cachedDrives = drives;
  return drives;
}

const PROJECT_INSTRUCTION_FILES = ['MACHCODE.md', 'AGENTS.md', 'CLAUDE.md'];

/**
 * Loads project-specific agent instructions (like CLAUDE.md) from the working directory.
 */
export function loadProjectInstructions(cwd: string): { file: string; content: string } | null {
  for (const name of PROJECT_INSTRUCTION_FILES) {
    const full = path.join(cwd, name);
    try {
      const content = fs.readFileSync(full, 'utf-8');
      const clipped = content.length > 8000 ? `${content.slice(0, 8000)}\n... (truncated)` : content;
      return { file: name, content: clipped };
    } catch {
      // Not present
    }
  }
  return null;
}

export interface AgentPromptOptions {
  cwd: string;
  /** Files the user pinned with /add (relative to cwd or absolute). */
  pinnedFiles?: string[];
  /** Restrict to read-only tools (/ask, /plan, /review). */
  readOnly?: boolean;
  /** Tools are unavailable for the winning model: fall back to file-header code blocks. */
  toolsUnavailable?: boolean;
}

/**
 * Builds the system prompt for the tool-calling agent loop.
 */
export function buildAgentSystemPrompt(options: AgentPromptOptions): string {
  const isWin = process.platform === 'win32';
  const shell = isWin ? 'PowerShell (Windows)' : 'bash';
  const drives = detectDrives();
  const now = new Date();

  const sections: string[] = [];

  sections.push(`You are MachCode, an interactive AI coding agent running in the user's terminal on their own computer.
You help with software engineering tasks: exploring projects, answering questions about code, fixing bugs, adding features, refactoring, running builds and tests.
Always reply in the same language the user writes in (e.g. Turkish if the user writes Turkish).`);

  sections.push(`# Environment
- Operating system: ${os.type()} ${os.release()} (${process.platform})
- Shell for run_command: ${shell}
- Working directory: ${options.cwd}
- Available drives: ${drives.join(', ')}
- Home directory: ${os.homedir()}
- Date: ${now.toISOString().slice(0, 10)}`);

  if (options.toolsUnavailable) {
    sections.push(`# Output format (tools unavailable)
Tool calling is not available in this session. To create or modify a file, output the COMPLETE file content in a fenced code block whose first line is a path comment, e.g.:
\`\`\`ts
// file: src/example.ts
...complete file content...
\`\`\`
The user will review a diff and approve each file. Never use placeholders like "// ... existing code ...". For explanations or example snippets, omit the path comment.`);
  } else {
    sections.push(`# Tools and file system access
You have FULL access to the user's file system through tools. The user can point you at ANY folder on ANY drive (for example "E:\\Projects", "D:\\My Projects\\App", "C:\\Users\\...").
- Never say you cannot access a folder or drive. Use the tools to look.
- When the user mentions a folder, drive or project, explore it with list_directory, then glob/grep to locate relevant files, and read_file to inspect them.
- Paths may be absolute (any drive) or relative to the working directory.
- Do not guess file contents, APIs or project structure. Read them first.
- Prefer several focused tool calls over guessing. You may call multiple read-only tools in one step.`);

    if (options.readOnly) {
      sections.push(`# Read-only mode
This request is READ-ONLY. Only list_directory, read_file, glob and grep are available. Do not attempt to modify files or run commands. Answer from what you read.`);
    } else {
      sections.push(`# Making changes
- Always read a file before editing it.
- Use edit_file for targeted changes: old_string must match the file exactly (including indentation) and be unique. Include a few surrounding lines for uniqueness.
- Use write_file only for new files or complete rewrites. Always write complete content, with no placeholders like "// ... existing code ...".
- Every edit, write and command is shown to the user for approval. If the user rejects an action, do NOT retry the same action. Follow their feedback, or ask what they want instead.
- Use run_command to run builds, tests, linters, git, and package managers, and to verify your changes. Use ${shell} syntax${isWin ? ' (e.g. Get-ChildItem, Select-String; chain with ";")' : ''}.
- Avoid destructive commands (deleting files, force-pushing, resetting git history) unless the user explicitly asks for them.
- Keep changes minimal and focused on the request. Match the existing code style.`);
    }
  }

  sections.push(`# Response style
- Be concise and direct. Use Markdown. No filler like "Sure!" or "Great question".
- While working, you may briefly say what you are about to do before calling tools.
- When finished, give a short summary of what you found or changed (file paths and key points). Do not paste whole files back unless asked.
- If the request is ambiguous and exploring cannot resolve it, ask one clear question and stop.`);

  if (options.pinnedFiles && options.pinnedFiles.length > 0) {
    const list = options.pinnedFiles.slice(0, 50).map((f) => `- ${f}`).join('\n');
    sections.push(`# Files pinned by the user (/add)
The user explicitly added these files to the context. Read them with read_file when relevant:
${list}`);
  }

  const instructions = loadProjectInstructions(options.cwd);
  if (instructions) {
    sections.push(`# Project instructions (${instructions.file})
${instructions.content}`);
  }

  return sections.join('\n\n');
}
