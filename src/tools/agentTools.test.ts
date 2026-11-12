import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { planToolCall, resolveAnyPath, globToRegExp, isInsideDir } from './agentTools.js';

describe('Agent Tools Suite', () => {
  it('resolveAnyPath handles relative, absolute, home and bare drive letters', () => {
    const cwd = process.platform === 'win32' ? 'D:\\My Projects' : '/home/user/projects';

    // Relative path
    const rel = resolveAnyPath('src/index.ts', cwd);
    assert.equal(rel, path.resolve(cwd, 'src/index.ts'));

    // Bare drive letter on Windows
    if (process.platform === 'win32') {
      const bareE = resolveAnyPath('E:', cwd);
      assert.equal(bareE, 'E:\\');

      const absoluteE = resolveAnyPath('E:\\University\\Year 1', cwd);
      assert.equal(absoluteE, 'E:\\University\\Year 1');
    }

    // Home directory
    const home = resolveAnyPath('~/test.txt', cwd);
    assert.equal(home, path.join(os.homedir(), 'test.txt'));
  });

  it('globToRegExp matches simple patterns and recursive patterns', () => {
    const re1 = globToRegExp('**/*.ts');
    assert.ok(re1.test('src/index.ts'));
    assert.ok(re1.test('src/engine/agentLoop.ts'));
    assert.ok(!re1.test('src/index.js'));

    const re2 = globToRegExp('*.{js,ts}');
    assert.ok(re2.test('file.js'));
    assert.ok(re2.test('file.ts'));
    assert.ok(!re2.test('file.py'));
  });

  it('isInsideDir correctly identifies paths inside or outside workspace', () => {
    const ws = path.resolve('/workspace/project');
    assert.ok(isInsideDir(path.resolve('/workspace/project/src/index.ts'), ws));
    assert.ok(isInsideDir(ws, ws));
    assert.ok(!isInsideDir(path.resolve('/other/folder'), ws));
    assert.ok(!isInsideDir(path.resolve('/workspace/other'), ws));
  });

  it('executes list_directory, read_file, glob, and grep', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-tools-test-'));
    try {
      await fs.mkdir(path.join(tmp, 'src', 'utils'), { recursive: true });
      await fs.writeFile(
        path.join(tmp, 'src', 'index.ts'),
        'export const hello = "world";\n',
        'utf-8',
      );
      await fs.writeFile(
        path.join(tmp, 'src', 'utils', 'math.ts'),
        'export function add(a: number, b: number) { return a + b; }\n',
        'utf-8',
      );

      // 1. list_directory
      const listPlan = await planToolCall('list_directory', { path: 'src' }, { cwd: tmp });
      assert.equal(listPlan.kind, 'read');
      if (listPlan.kind === 'read') {
        const listOut = await listPlan.run();
        assert.ok(listOut.output.includes('index.ts'));
        assert.ok(listOut.output.includes('utils/'));
      }

      // 2. read_file with offset and limit
      const readPlan = await planToolCall(
        'read_file',
        { path: 'src/index.ts', offset: 1, limit: 10 },
        { cwd: tmp },
      );
      assert.equal(readPlan.kind, 'read');
      if (readPlan.kind === 'read') {
        const readOut = await readPlan.run();
        assert.ok(readOut.output.includes('export const hello = "world";'));
      }

      // 3. glob
      const globPlan = await planToolCall('glob', { pattern: '**/*.ts' }, { cwd: tmp });
      assert.equal(globPlan.kind, 'read');
      if (globPlan.kind === 'read') {
        const globOut = await globPlan.run();
        assert.ok(globOut.output.includes('src/index.ts') || globOut.output.includes('index.ts'));
        assert.ok(globOut.output.includes('math.ts'));
      }

      // 4. grep
      const grepPlan = await planToolCall('grep', { pattern: 'function add' }, { cwd: tmp });
      assert.equal(grepPlan.kind, 'read');
      if (grepPlan.kind === 'read') {
        const grepOut = await grepPlan.run();
        assert.ok(grepOut.output.includes('function add'));
      }
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('plans edit_file and write_file with accurate diff previews', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-tools-edit-'));
    try {
      const filePath = path.join(tmp, 'test.txt');
      await fs.writeFile(filePath, 'line 1\nline 2\nline 3\n', 'utf-8');

      // edit_file plan
      const editPlan = await planToolCall(
        'edit_file',
        {
          path: 'test.txt',
          old_string: 'line 2',
          new_string: 'line 2 (modified)',
        },
        { cwd: tmp },
      );

      assert.equal(editPlan.kind, 'write');
      if (editPlan.kind === 'write') {
        assert.equal(editPlan.previousContent, 'line 1\nline 2\nline 3\n');
        assert.equal(editPlan.newContent, 'line 1\nline 2 (modified)\nline 3\n');
        assert.equal(editPlan.outsideWorkspace, false);

        // Commit change
        const outcome = await editPlan.commit();
        assert.ok(outcome.writtenFile);
        const onDisk = await fs.readFile(filePath, 'utf-8');
        assert.equal(onDisk, 'line 1\nline 2 (modified)\nline 3\n');
      }

      // write_file plan for new file
      const writePlan = await planToolCall(
        'write_file',
        {
          path: 'sub/new.txt',
          content: 'brand new file',
        },
        { cwd: tmp },
      );

      assert.equal(writePlan.kind, 'write');
      if (writePlan.kind === 'write') {
        assert.equal(writePlan.previousContent, null);
        assert.equal(writePlan.newContent, 'brand new file');
        await writePlan.commit();
        const created = await fs.readFile(path.join(tmp, 'sub', 'new.txt'), 'utf-8');
        assert.equal(created, 'brand new file');
      }
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('runs shell commands with timeout protection', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-tools-cmd-'));
    try {
      const isWin = process.platform === 'win32';
      const cmd = isWin ? 'Write-Output "agent-cmd-success"' : 'echo "agent-cmd-success"';

      const cmdPlan = await planToolCall('run_command', { command: cmd }, { cwd: tmp });

      assert.equal(cmdPlan.kind, 'command');
      if (cmdPlan.kind === 'command') {
        const out = await cmdPlan.run();
        assert.ok(out.output.includes('agent-cmd-success'));
        assert.equal(out.isError, false);
      }
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('applies unified diff patches via apply_diff tool', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-tools-diff-'));
    try {
      const targetFile = path.join(tmp, 'app.ts');
      await fs.writeFile(
        targetFile,
        'export function run() {\n  const x = 1;\n  return x;\n}\n',
        'utf-8',
      );

      const diffPatch = `@@ -1,4 +1,4 @@
 export function run() {
-  const x = 1;
+  const x = 999;
   return x;
 }`;

      const diffPlan = await planToolCall(
        'apply_diff',
        { path: 'app.ts', diff: diffPatch },
        { cwd: tmp },
      );

      assert.equal(diffPlan.kind, 'write');
      if (diffPlan.kind === 'write') {
        assert.ok(diffPlan.newContent.includes('const x = 999;'));
        await diffPlan.commit();
        const updated = await fs.readFile(targetFile, 'utf-8');
        assert.ok(updated.includes('const x = 999;'));
      }
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('falls back to fuzzy matching in edit_file when whitespace has minor discrepancy', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-tools-fuzzy-'));
    try {
      const targetFile = path.join(tmp, 'service.ts');
      // Has trailing spaces on second line
      await fs.writeFile(
        targetFile,
        'export class Service {\n  connect() {   \n    return true;\n  }\n}\n',
        'utf-8',
      );

      // Model sends without trailing spaces
      const editPlan = await planToolCall(
        'edit_file',
        {
          path: 'service.ts',
          old_string: '  connect() {\n    return true;\n  }',
          new_string: '  connect() {\n    return false;\n  }',
        },
        { cwd: tmp },
      );

      assert.equal(editPlan.kind, 'write');
      if (editPlan.kind === 'write') {
        assert.ok(editPlan.newContent.includes('return false;'));
        await editPlan.commit();
        const updated = await fs.readFile(targetFile, 'utf-8');
        assert.ok(updated.includes('return false;'));
      }
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
