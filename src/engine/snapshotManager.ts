import fs from 'node:fs/promises';
import path from 'node:path';

export interface FileSnapshot {
  id?: string;
  file: string;
  previousContent: string | '__FILE_DID_NOT_EXIST__';
  newContent?: string;
  timestamp: number;
  step?: number;
}

export interface RevertOutcome {
  success: boolean;
  file: string;
  action: 'reverted' | 'removed';
  error?: string;
}

/**
 * Manages in-memory snapshots of files modified by MachCode AI,
 * enabling single-step, per-file, or complete rollbacks.
 */
export class SnapshotManager {
  private snapshots: FileSnapshot[] = [];
  private counter = 0;

  /**
   * Records a file state prior to AI mutation.
   */
  record(snapshot: Omit<FileSnapshot, 'id' | 'timestamp'> & { timestamp?: number }): FileSnapshot {
    this.counter++;
    const fullSnapshot: FileSnapshot = {
      id: `snap_${Date.now()}_${this.counter}`,
      timestamp: snapshot.timestamp ?? Date.now(),
      ...snapshot,
    };
    this.snapshots.push(fullSnapshot);
    return fullSnapshot;
  }

  /**
   * Returns all recorded snapshots (oldest to newest).
   */
  list(): readonly FileSnapshot[] {
    return [...this.snapshots];
  }

  /**
   * Returns the total number of snapshots.
   */
  count(): number {
    return this.snapshots.length;
  }

  /**
   * Reverts the most recent snapshot in history.
   */
  async undoLast(baseDir: string): Promise<RevertOutcome | null> {
    if (this.snapshots.length === 0) return null;
    const snap = this.snapshots.pop()!;
    return this.applyRevert(snap, baseDir);
  }

  /**
   * Reverts all mutations for a specific file path back to its original state.
   */
  async undoFile(filePath: string, baseDir: string): Promise<RevertOutcome | null> {
    const normalizedTarget = path.normalize(filePath).toLowerCase();
    // Find matching snapshots from newest to oldest
    const indices: number[] = [];
    for (let i = this.snapshots.length - 1; i >= 0; i--) {
      if (path.normalize(this.snapshots[i].file).toLowerCase() === normalizedTarget) {
        indices.push(i);
      }
    }

    if (indices.length === 0) return null;

    // The oldest snapshot for this file holds the true initial state
    const oldestIdx = indices[indices.length - 1];
    const originalSnap = this.snapshots[oldestIdx];

    // Remove all matched snapshots for this file from the stack
    for (const idx of indices) {
      this.snapshots.splice(idx, 1);
    }

    return this.applyRevert(originalSnap, baseDir);
  }

  /**
   * Reverts all modified files back to their starting state in reverse order.
   */
  async undoAll(baseDir: string): Promise<RevertOutcome[]> {
    const results: RevertOutcome[] = [];
    while (this.snapshots.length > 0) {
      const snap = this.snapshots.pop()!;
      const res = await this.applyRevert(snap, baseDir);
      results.push(res);
    }
    return results;
  }

  /**
   * Clears all snapshot history.
   */
  clear(): void {
    this.snapshots = [];
  }

  private async applyRevert(snap: FileSnapshot, baseDir: string): Promise<RevertOutcome> {
    const targetPath = path.isAbsolute(snap.file) ? snap.file : path.resolve(baseDir, snap.file);

    try {
      if (snap.previousContent === '__FILE_DID_NOT_EXIST__') {
        await fs.rm(targetPath, { force: true });
        return { success: true, file: snap.file, action: 'removed' };
      }

      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, snap.previousContent, 'utf-8');
      return { success: true, file: snap.file, action: 'reverted' };
    } catch (err) {
      return {
        success: false,
        file: snap.file,
        action: 'reverted',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
