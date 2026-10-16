import fs from 'node:fs/promises';
import path from 'node:path';
import {
  getNvidiaSkillTools,
  loadNvidiaSkill,
  syncNvidiaSkills,
  type OpenAIToolDefinition,
} from './nvidiaSkills.js';

export type { OpenAIToolDefinition };

export interface WriteFileResult {
  filePath: string;
  relativePath: string;
  bytesWritten: number;
}

/**
 * Strict OpenAI Tool Calling JSON Schema for `read_file`.
 */
export const READ_FILE_TOOL: OpenAIToolDefinition = {
  type: 'function',
  function: {
    name: 'read_file',
    description: 'Reads the full UTF-8 text content of a file from the local workspace directory.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Relative or absolute path to the file to read.',
        },
      },
      required: ['filePath'],
      additionalProperties: false,
    },
  },
};

/**
 * Strict OpenAI Tool Calling JSON Schema for `write_file`.
 */
export const WRITE_FILE_TOOL: OpenAIToolDefinition = {
  type: 'function',
  function: {
    name: 'write_file',
    description:
      'Overwrites a file at the specified path with the given UTF-8 content, creating parent directories if needed.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Relative or absolute path to the target file to overwrite.',
        },
        content: {
          type: 'string',
          description: 'Complete UTF-8 source code or text content to write to the file.',
        },
      },
      required: ['filePath', 'content'],
      additionalProperties: false,
    },
  },
};

/**
 * Core local filesystem tools.
 */
export const CORE_LOCAL_TOOLS: OpenAIToolDefinition[] = [READ_FILE_TOOL, WRITE_FILE_TOOL];

/**
 * Default combined tool array with core local tools and official NVIDIA Agent Skills integrated automatically.
 */
export const ALL_TOOLS: OpenAIToolDefinition[] = [...CORE_LOCAL_TOOLS, ...getNvidiaSkillTools()];

/**
 * Resolves a target file path safely within the workspace directory, preventing unsafe directory traversal.
 */
export function resolveWorkspacePath(filePath: string, baseDir: string = process.cwd()): string {
  if (!filePath || filePath.trim().length === 0) {
    throw new Error('File path cannot be empty.');
  }

  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, filePath.trim());

  const relative = path.relative(resolvedBase, resolvedTarget);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(
      `Security violation: Path "${filePath}" resolves outside the workspace directory "${resolvedBase}".`,
    );
  }

  return resolvedTarget;
}

/**
 * Reads a file from the user's local directory.
 */
export async function read_file(
  filePath: string,
  baseDir: string = process.cwd(),
): Promise<string> {
  const resolvedPath = resolveWorkspacePath(filePath, baseDir);
  return fs.readFile(resolvedPath, 'utf-8');
}

/**
 * Overwrites a file in the user's local directory, creating parent directories if necessary.
 */
export async function write_file(
  filePath: string,
  content: string,
  baseDir: string = process.cwd(),
): Promise<WriteFileResult> {
  const resolvedPath = resolveWorkspacePath(filePath, baseDir);
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
  await fs.writeFile(resolvedPath, content, 'utf-8');

  const relativePath =
    path.relative(path.resolve(baseDir), resolvedPath) || path.basename(resolvedPath);
  const bytesWritten = Buffer.byteLength(content, 'utf-8');

  return {
    filePath: resolvedPath,
    relativePath,
    bytesWritten,
  };
}

/**
 * Returns the full array of OpenAI Tool Calling definitions, automatically syncing
 * and integrating official NVIDIA Agent Skills (`NVIDIA/skills`) alongside local tools.
 */
export async function getIntegratedTools(options?: {
  cacheDir?: string;
  fetchImpl?: typeof fetch;
}): Promise<OpenAIToolDefinition[]> {
  const catalog = await syncNvidiaSkills(options);
  return [...CORE_LOCAL_TOOLS, ...getNvidiaSkillTools(catalog)];
}

/**
 * Executes a tool call requested by the LLM (`read_file`, `write_file`, or `load_nvidia_skill`).
 */
export async function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  baseDir: string = process.cwd(),
): Promise<string> {
  switch (toolName) {
    case 'read_file': {
      const filePath = args.filePath;
      if (typeof filePath !== 'string') {
        throw new Error('Invalid argument for read_file: "filePath" must be a string.');
      }
      return read_file(filePath, baseDir);
    }

    case 'write_file': {
      const filePath = args.filePath;
      const content = args.content;
      if (typeof filePath !== 'string' || typeof content !== 'string') {
        throw new Error(
          'Invalid arguments for write_file: "filePath" and "content" must be strings.',
        );
      }
      const result = await write_file(filePath, content, baseDir);
      return JSON.stringify(result);
    }

    case 'load_nvidia_skill': {
      const skillName = args.skillName;
      if (typeof skillName !== 'string') {
        throw new Error('Invalid argument for load_nvidia_skill: "skillName" must be a string.');
      }
      const skill = await loadNvidiaSkill(skillName);
      return skill.content;
    }

    default:
      throw new Error(`Unknown tool "${toolName}".`);
  }
}
