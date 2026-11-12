import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SnapshotManager } from './snapshotManager.js';

describe('SnapshotManager Suite', () => {
  it('records snapshots and maintains chronological order', () => {
    const manager = new SnapshotManager();
    assert.strictEqual(manager.count(), 0);

    const s1 = manager.record({
      file: 'app.ts',
      previousContent: 'const x = 1;',
    });
    const s2 = manager.record({
      file: 'index.ts',
      previousContent: 'export {};',
    });

    assert.strictEqual(manager.count(), 2);
    assert.ok(s1.id);
    assert.ok(s2.id);
    assert.strictEqual(manager.list()[0].file, 'app.ts');
    assert.strictEqual(manager.list()[1].file, 'index.ts');
  });

  it('undoLast reverts the most recently modified file', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'snap-test-'));
    try {
      const target = path.join(tmp, 'code.ts');
      await fs.writeFile(target, 'initial content', 'utf-8');

      const manager = new SnapshotManager();
      manager.record({
        file: target,
        previousContent: 'initial content',
      });

      // AI writes mutation
      await fs.writeFile(target, 'ai modified', 'utf-8');
      assert.strictEqual(await fs.readFile(target, 'utf-8'), 'ai modified');

      // Undo
      const res = await manager.undoLast(tmp);
      assert.ok(res);
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.action, 'reverted');
      assert.strictEqual(await fs.readFile(target, 'utf-8'), 'initial content');
      assert.strictEqual(manager.count(), 0);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('undoLast removes newly created files when previousContent is __FILE_DID_NOT_EXIST__', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'snap-test-new-'));
    try {
      const target = path.join(tmp, 'newfile.ts');
      await fs.writeFile(target, 'ai created content', 'utf-8');

      const manager = new SnapshotManager();
      manager.record({
        file: target,
        previousContent: '__FILE_DID_NOT_EXIST__',
      });

      const res = await manager.undoLast(tmp);
      assert.ok(res);
      assert.strictEqual(res.action, 'removed');
      const exists = await fs
        .stat(target)
        .then(() => true)
        .catch(() => false);
      assert.strictEqual(exists, false);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('undoFile reverts a specific file back to its initial state across multiple edits', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'snap-test-file-'));
    try {
      const targetA = path.join(tmp, 'a.txt');
      const targetB = path.join(tmp, 'b.txt');
      await fs.writeFile(targetA, 'initial A', 'utf-8');
      await fs.writeFile(targetB, 'initial B', 'utf-8');

      const manager = new SnapshotManager();
      manager.record({ file: targetA, previousContent: 'initial A' });
      await fs.writeFile(targetA, 'edit 1 of A', 'utf-8');

      manager.record({ file: targetB, previousContent: 'initial B' });
      await fs.writeFile(targetB, 'edit 1 of B', 'utf-8');

      manager.record({ file: targetA, previousContent: 'edit 1 of A' });
      await fs.writeFile(targetA, 'edit 2 of A', 'utf-8');

      assert.strictEqual(manager.count(), 3);

      // Revert only A
      const resA = await manager.undoFile(targetA, tmp);
      assert.ok(resA);
      assert.strictEqual(resA.success, true);
      assert.strictEqual(await fs.readFile(targetA, 'utf-8'), 'initial A');
      assert.strictEqual(await fs.readFile(targetB, 'utf-8'), 'edit 1 of B');

      // Remaining snapshot in manager is B
      assert.strictEqual(manager.count(), 1);
      assert.strictEqual(manager.list()[0].file, targetB);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('undoAll reverts all files in reverse chronological order', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'snap-test-all-'));
    try {
      const target1 = path.join(tmp, 'one.txt');
      const target2 = path.join(tmp, 'two.txt');
      await fs.writeFile(target1, 'start 1', 'utf-8');
      await fs.writeFile(target2, 'start 2', 'utf-8');

      const manager = new SnapshotManager();
      manager.record({ file: target1, previousContent: 'start 1' });
      await fs.writeFile(target1, 'modified 1', 'utf-8');

      manager.record({ file: target2, previousContent: 'start 2' });
      await fs.writeFile(target2, 'modified 2', 'utf-8');

      const reverted = await manager.undoAll(tmp);
      assert.strictEqual(reverted.length, 2);
      assert.strictEqual(await fs.readFile(target1, 'utf-8'), 'start 1');
      assert.strictEqual(await fs.readFile(target2, 'utf-8'), 'start 2');
      assert.strictEqual(manager.count(), 0);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
