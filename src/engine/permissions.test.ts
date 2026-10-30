import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PermissionManager,
  commandPermissionPrefix,
  type PermissionPrompter,
} from './permissions.js';
import type { WriteToolPlan, CommandToolPlan } from '../tools/agentTools.js';

describe('Permission Manager Suite', () => {
  it('extracts command permission prefixes reliably', () => {
    assert.equal(commandPermissionPrefix('git status'), 'git status');
    assert.equal(commandPermissionPrefix('git commit -m "fix"'), 'git commit');
    assert.equal(commandPermissionPrefix('pnpm test --run'), 'pnpm test');
    assert.equal(commandPermissionPrefix('npm run build'), 'npm run');
    assert.equal(commandPermissionPrefix('cargo build --release'), 'cargo build');
    assert.equal(commandPermissionPrefix('ls -la'), 'ls');
    // Complex compound commands return null so they are always prompted individually
    assert.equal(commandPermissionPrefix('git add . && git commit -m "all"'), null);
    assert.equal(commandPermissionPrefix('echo 1; rm -rf /'), null);
  });

  it('prompts user and respects approval or rejection for file writes', async () => {
    let chosen: 'yes' | 'always' | 'no' = 'yes';
    let feedbackGiven = '';

    const mockPrompter: PermissionPrompter = {
      choose: async (_kind, _opts, _diff) => chosen,
      askFeedback: async () => feedbackGiven,
    };

    const pm = new PermissionManager({
      isAutoApprove: () => false,
      prompter: mockPrompter,
      writeToStdout: false,
    });

    const dummyPlan: WriteToolPlan = {
      kind: 'write',
      title: 'src/index.ts',
      toolName: 'edit_file',
      absPath: '/workspace/src/index.ts',
      displayPath: 'src/index.ts',
      outsideWorkspace: false,
      previousContent: 'const a = 1;',
      newContent: 'const a = 2;',
      commit: async () => ({ output: 'ok', summary: 'ok' }),
    };

    // 1. Approved
    chosen = 'yes';
    const dec1 = await pm.requestWrite(dummyPlan);
    assert.equal(dec1.allowed, true);

    // 2. Rejected with user feedback
    chosen = 'no';
    feedbackGiven = 'Don’t change a to 2, keep 1.';
    const dec2 = await pm.requestWrite(dummyPlan);
    assert.equal(dec2.allowed, false);
    if (!dec2.allowed) {
      assert.equal(dec2.feedback, 'Don’t change a to 2, keep 1.');
    }

    // 3. Always allow edits this session
    chosen = 'always';
    const dec3 = await pm.requestWrite(dummyPlan);
    assert.equal(dec3.allowed, true);
    assert.equal(pm.sessionAllowsAllEdits, true);

    // Subsequent write should now be auto-approved without prompting
    chosen = 'no'; // prompter won't even be called!
    const dec4 = await pm.requestWrite(dummyPlan);
    assert.equal(dec4.allowed, true);

    // Reset clears the permission
    pm.reset();
    assert.equal(pm.sessionAllowsAllEdits, false);
  });

  it('always prompts when writing outside workspace, even if session allows edits', async () => {
    let promptCount = 0;
    const mockPrompter: PermissionPrompter = {
      choose: async () => {
        promptCount++;
        return 'yes';
      },
      askFeedback: async () => '',
    };

    const pm = new PermissionManager({
      isAutoApprove: () => true, // Auto-approve is on!
      prompter: mockPrompter,
      writeToStdout: false,
    });

    const outsidePlan: WriteToolPlan = {
      kind: 'write',
      title: 'E:\\other\\file.txt',
      toolName: 'write_file',
      absPath: 'E:\\other\\file.txt',
      displayPath: 'E:\\other\\file.txt',
      outsideWorkspace: true, // Marked as outside workspace!
      previousContent: null,
      newContent: 'data',
      commit: async () => ({ output: 'ok', summary: 'ok' }),
    };

    const dec = await pm.requestWrite(outsidePlan);
    assert.equal(dec.allowed, true);
    assert.equal(promptCount, 1, 'Should have prompted because file is outside workspace');
  });

  it('prompts user and caches allowed command prefixes', async () => {
    let chosen: 'yes' | 'always' | 'no' = 'yes';

    const mockPrompter: PermissionPrompter = {
      choose: async () => chosen,
      askFeedback: async () => 'Not allowed right now',
    };

    const pm = new PermissionManager({
      isAutoApprove: () => false,
      prompter: mockPrompter,
      writeToStdout: false,
    });

    const testPlan: CommandToolPlan = {
      kind: 'command',
      title: 'pnpm test',
      command: 'pnpm test',
      cwd: '/workspace',
      outsideWorkspace: false,
      run: async () => ({ output: 'test passed', summary: 'exit 0' }),
    };

    // Choose always for pnpm test
    chosen = 'always';
    const dec1 = await pm.requestCommand(testPlan);
    assert.equal(dec1.allowed, true);
    assert.ok(pm.sessionAllowedCommands.includes('pnpm test'));

    // Subsequent command with same prefix is auto-allowed
    chosen = 'no'; // prompter not called
    const dec2 = await pm.requestCommand({
      ...testPlan,
      command: 'pnpm test --filter auth',
    });
    assert.equal(dec2.allowed, true);
  });
});
