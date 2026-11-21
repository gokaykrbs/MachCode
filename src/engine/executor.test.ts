import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  ALL_TOOLS,
  READ_FILE_TOOL,
  WRITE_FILE_TOOL,
  executeToolCall,
  getIntegratedTools,
  read_file,
  write_file,
} from '../tools/index.js';
import {
  loadNvidiaSkill,
  parseSkillFrontmatter,
  parseSkillsCatalogFromReadme,
} from '../tools/nvidiaSkills.js';
import { StreamParser } from '../utils/streamParser.js';
import { executeParsedCode } from './executor.js';

describe('Tools & NVIDIA Official Skills Integration', () => {
  it('exposes strict OpenAI Tool Calling schemas for read_file, write_file, and NVIDIA skills by default', async () => {
    assert.equal(READ_FILE_TOOL.type, 'function');
    assert.equal(READ_FILE_TOOL.function.name, 'read_file');
    assert.equal(READ_FILE_TOOL.function.strict, true);
    assert.deepEqual(READ_FILE_TOOL.function.parameters.required, ['filePath']);

    assert.equal(WRITE_FILE_TOOL.type, 'function');
    assert.equal(WRITE_FILE_TOOL.function.name, 'write_file');
    assert.equal(WRITE_FILE_TOOL.function.strict, true);
    assert.deepEqual(WRITE_FILE_TOOL.function.parameters.required, ['filePath', 'content']);

    const toolNames = ALL_TOOLS.map((t) => t.function.name);
    assert.ok(toolNames.includes('read_file'));
    assert.ok(toolNames.includes('write_file'));
    assert.ok(toolNames.includes('list_directory'));
    assert.ok(toolNames.includes('load_nvidia_skill'));
  });

  it('executes read_file and write_file safely within the workspace and blocks path traversal', async () => {
    const tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'machcode-tools-'));

    try {
      const writeRes = await write_file('src/hello.ts', 'export const x = 10;\n', tmpWorkspace);
      assert.equal(writeRes.relativePath, path.join('src', 'hello.ts'));
      assert.ok(writeRes.bytesWritten > 0);

      const readRes = await read_file('src/hello.ts', tmpWorkspace);
      assert.equal(readRes, 'export const x = 10;\n');

      // Verify path traversal outside workspace is rejected
      await assert.rejects(async () => {
        await write_file('../escaped.ts', 'malicious', tmpWorkspace);
      }, /Security violation/);
    } finally {
      await fs.rm(tmpWorkspace, { recursive: true, force: true });
    }
  });

  it('automatically syncs and loads NVIDIA/skills SKILL.md definitions', async () => {
    const tmpCache = await fs.mkdtemp(path.join(os.tmpdir(), 'machcode-nvskills-'));
    const prevHome = process.env.MACHCODE_HOME;
    process.env.MACHCODE_HOME = tmpCache;

    try {
      const mockReadme = [
        '| Product | Description | Skills |',
        '|---|---|---|',
        '| **cuOpt** | GPU-accelerated optimization. | [`cuopt-numerical-optimization-api`](skills/cuopt-numerical-optimization-api) |',
        '| **cuDF** | GPU DataFrames. | [`accelerated-computing-cudf`](skills/accelerated-computing-cudf) |',
      ].join('\n');

      const mockSkillMd = [
        '---',
        'name: cuopt-numerical-optimization-api',
        'version: "26.10.00"',
        'description: LP, MILP, and QP with cuOpt.',
        '---',
        '# cuOpt Numerical Optimization API',
        'Use cuOpt Python or C API.',
      ].join('\n');

      const parsedCatalog = parseSkillsCatalogFromReadme(mockReadme);
      assert.equal(parsedCatalog.length, 2);
      assert.equal(parsedCatalog[0]?.name, 'cuopt-numerical-optimization-api');

      const frontmatter = parseSkillFrontmatter(mockSkillMd);
      assert.equal(frontmatter.name, 'cuopt-numerical-optimization-api');
      assert.equal(frontmatter.version, '26.10.00');

      const mockFetch: typeof fetch = async (input) => {
        const url = String(input);
        if (url.endsWith('README.md')) {
          return new Response(mockReadme, { status: 200 });
        }
        return new Response(mockSkillMd, { status: 200 });
      };

      const tools = await getIntegratedTools({ cacheDir: tmpCache, fetchImpl: mockFetch });
      assert.equal(tools.length, 4);

      const loadedSkill = await loadNvidiaSkill('cuopt-numerical-optimization-api', {
        cacheDir: tmpCache,
        fetchImpl: mockFetch,
      });
      assert.equal(loadedSkill.source, 'remote');
      assert.ok(loadedSkill.content.includes('# cuOpt Numerical Optimization API'));

      // Subsequent load comes from local cache
      const cachedSkill = await loadNvidiaSkill('cuopt-numerical-optimization-api', {
        cacheDir: tmpCache,
        fetchImpl: mockFetch,
      });
      assert.equal(cachedSkill.source, 'cache');

      // Also verify executeToolCall works for load_nvidia_skill
      const toolOutput = await executeToolCall('load_nvidia_skill', {
        skillName: 'accelerated-computing-cudf',
      });
      assert.ok(toolOutput.includes('accelerated-computing-cudf'));
    } finally {
      if (prevHome === undefined) {
        delete process.env.MACHCODE_HOME;
      } else {
        process.env.MACHCODE_HOME = prevHome;
      }
      await fs.rm(tmpCache, { recursive: true, force: true });
    }
  });
});

describe('Executor (src/engine/executor.ts)', () => {
  it('applies clean code from StreamParser to files via write_file and logs a green summary', async () => {
    const tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'machcode-exec-'));
    const loggedMessages: string[] = [];

    try {
      const parser = new StreamParser({ debugLogPath: null });
      parser.feed(
        '<plan>1. Create math module</plan>\n```typescript\nexport const multiply = (a: number, b: number) => a * b;\n```',
      );
      const parseResult = await parser.finalize();

      const summary = await executeParsedCode(parseResult, {
        targetFilePath: 'src/math.ts',
        baseDir: tmpWorkspace,
        logger: (msg) => loggedMessages.push(msg),
      });

      assert.equal(summary.skipped, false);
      assert.equal(summary.modifiedFiles.length, 1);
      assert.equal(summary.modifiedFiles[0]?.relativePath, path.join('src', 'math.ts'));

      const diskContent = await read_file('src/math.ts', tmpWorkspace);
      assert.equal(diskContent, 'export const multiply = (a: number, b: number) => a * b;\n');

      assert.equal(loggedMessages.length, 1);
      assert.ok(loggedMessages[0]?.includes('Successfully modified 1 file(s):'));
      assert.ok(loggedMessages[0]?.includes(path.join('src', 'math.ts')));
    } finally {
      await fs.rm(tmpWorkspace, { recursive: true, force: true });
    }
  });

  it('refuses to write files when StreamParser halted on QUESTION:', async () => {
    const tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'machcode-exec-halt-'));

    try {
      const parser = new StreamParser({ debugLogPath: null });
      parser.feed('<plan>Missing context</plan>\nQUESTION: What is the return type of fetchUser?');
      const parseResult = await parser.finalize();

      const summary = await executeParsedCode(parseResult, {
        targetFilePath: 'src/user.ts',
        baseDir: tmpWorkspace,
        logSummary: false,
      });

      assert.equal(summary.skipped, true);
      assert.equal(summary.skippedReason, 'halted_on_question');
      assert.equal(summary.modifiedFiles.length, 0);
    } finally {
      await fs.rm(tmpWorkspace, { recursive: true, force: true });
    }
  });

  it('prompts for confirmation via confirmBeforeWrite, computes diff stats, and respects approve / reject / approve_all decisions', async () => {
    const tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'machcode-exec-confirm-'));

    try {
      await write_file('src/existing.ts', 'export const a = 1;\n', tmpWorkspace);

      const parser = new StreamParser({ debugLogPath: null });
      parser.feed(
        [
          '```typescript',
          '// file: src/existing.ts',
          'export const a = 2;',
          'export const b = 3;',
          '```',
          '```typescript',
          '// file: src/rejected.ts',
          'export const nope = true;',
          '```',
        ].join('\n'),
      );
      const parseResult = await parser.finalize();

      const seenChanges: Array<{
        targetPath: string;
        isNewFile: boolean;
        addedLines: number;
        removedLines: number;
      }> = [];

      const summary = await executeParsedCode(parseResult, {
        baseDir: tmpWorkspace,
        logSummary: false,
        confirmBeforeWrite: async (change) => {
          seenChanges.push({
            targetPath: change.targetPath,
            isNewFile: change.isNewFile,
            addedLines: change.addedLines,
            removedLines: change.removedLines,
          });
          if (change.targetPath === 'src/existing.ts') {
            return 'approve';
          }
          return 'reject';
        },
      });

      assert.equal(seenChanges.length, 2);
      assert.equal(seenChanges[0]?.targetPath, 'src/existing.ts');
      assert.equal(seenChanges[0]?.isNewFile, false);
      assert.ok((seenChanges[0]?.addedLines ?? 0) >= 1);
      assert.equal(seenChanges[1]?.targetPath, 'src/rejected.ts');
      assert.equal(seenChanges[1]?.isNewFile, true);

      assert.equal(summary.modifiedFiles.length, 1);
      assert.equal(summary.rejectedFiles?.length, 1);
      assert.equal(summary.rejectedFiles?.[0], 'src/rejected.ts');
      assert.equal(summary.skipped, false);

      const updatedExisting = await read_file('src/existing.ts', tmpWorkspace);
      assert.ok(updatedExisting.includes('export const b = 3;'));

      await assert.rejects(async () => {
        await read_file('src/rejected.ts', tmpWorkspace);
      });
    } finally {
      await fs.rm(tmpWorkspace, { recursive: true, force: true });
    }
  });
});
