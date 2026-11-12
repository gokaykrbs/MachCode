import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  type SubagentDefinition,
  getAllSubagents,
  getSubagent,
  parseSubagentFromInput,
  selectBestNvidiaModel,
} from './registry.js';
import { agentCommand } from '../commands/agent.js';
import type { CommandContext } from '../commands/types.js';
import { buildAutocompleteItems, filterAutocompleteItems } from '../ui/autocomplete.js';
import { buildAgentSystemPrompt } from '../prompts/agent.js';
import { buildSniperSystemPrompt } from '../prompts/sniper.js';

describe('NVIDIA NIM Subagents Suite', () => {
  it('registers all 5 official NVIDIA NIM subagents', () => {
    const subagents = getAllSubagents();
    assert.strictEqual(subagents.length, 5);

    const ids = subagents.map((s) => s.id);
    assert.ok(ids.includes('architect'));
    assert.ok(ids.includes('coder'));
    assert.ok(ids.includes('tester'));
    assert.ok(ids.includes('reviewer'));
    assert.ok(ids.includes('nvidia'));
  });

  it('resolves subagents by ID or @mention trigger with case-insensitivity', () => {
    const archById = getSubagent('architect');
    assert.ok(archById);
    assert.strictEqual(archById.id, 'architect');
    assert.strictEqual(archById.mention, '@architect');

    const archByMention = getSubagent('@Architect');
    assert.ok(archByMention);
    assert.strictEqual(archByMention.id, 'architect');

    const coder = getSubagent('CODER');
    assert.ok(coder);
    assert.strictEqual(coder.id, 'coder');

    const unknown = getSubagent('nonexistent');
    assert.strictEqual(unknown, undefined);
  });

  it('parses subagent mentions at the start of a prompt', () => {
    const r1 = parseSubagentFromInput('@architect how should we structure the database schema?');
    assert.ok(r1.subagent);
    assert.strictEqual(r1.subagent.id, 'architect');
    assert.strictEqual(r1.cleanedPrompt, 'how should we structure the database schema?');

    const r2 = parseSubagentFromInput('@coder fix the regex parsing issue');
    assert.ok(r2.subagent);
    assert.strictEqual(r2.subagent.id, 'coder');
    assert.strictEqual(r2.cleanedPrompt, 'fix the regex parsing issue');

    const r3 = parseSubagentFromInput('Ordinary prompt without subagent mention');
    assert.strictEqual(r3.subagent, undefined);
    assert.strictEqual(r3.cleanedPrompt, 'Ordinary prompt without subagent mention');

    // File mentions should not be recognized as subagents
    const r4 = parseSubagentFromInput('@src/index.ts review this file');
    assert.strictEqual(r4.subagent, undefined);
  });

  it('selects the optimal model from NVIDIA pool based on subagent preferences', () => {
    const coder = getSubagent('coder')!;
    const pool = [
      'meta/llama-3.1-70b-instruct',
      'qwen/qwen2.5-coder-32b-instruct',
      'deepseek-ai/deepseek-r1',
    ];

    const selectedCoderModel = selectBestNvidiaModel(coder, pool, 'meta/llama-3.1-70b-instruct');
    assert.strictEqual(selectedCoderModel, 'qwen/qwen2.5-coder-32b-instruct');

    const architect = getSubagent('architect')!;
    const selectedArchModel = selectBestNvidiaModel(architect, pool, 'meta/llama-3.1-70b-instruct');
    assert.strictEqual(selectedArchModel, 'deepseek-ai/deepseek-r1');

    // Falls back to fallbackModel if no preference matches
    const unmatchingPool = ['random-provider/model-alpha', 'other-provider/model-beta'];
    const fallback = selectBestNvidiaModel(coder, unmatchingPool, 'default-model');
    assert.strictEqual(fallback, 'default-model');
  });

  it('executes /agent command to list, pin, and reset subagents', async () => {
    let activeMode: 'build' | 'plan' = 'build';
    const state: { currentSubagent?: SubagentDefinition } = {};
    const mockContext: Partial<CommandContext> = {
      baseDir: process.cwd(),
      mode: 'build',
      setMode: (m) => {
        activeMode = m;
      },
      get activeSubagent() {
        return state.currentSubagent;
      },
      set activeSubagent(sa) {
        state.currentSubagent = sa;
      },
      setActiveSubagent: (sa) => {
        state.currentSubagent = sa;
      },
    };

    // 1. List subagents
    await agentCommand.execute('list', mockContext as CommandContext);
    assert.strictEqual(Boolean(state.currentSubagent), false);

    // 2. Pin architect (which defaults to plan mode)
    await agentCommand.execute('architect', mockContext as CommandContext);
    assert.strictEqual(Boolean(state.currentSubagent), true);
    assert.strictEqual(state.currentSubagent?.id, 'architect');
    assert.strictEqual(activeMode, 'plan');

    // 3. Reset subagent
    await agentCommand.execute('reset', mockContext as CommandContext);
    assert.strictEqual(Boolean(state.currentSubagent), false);
  });

  it('suggests subagents during @ autocomplete typing', () => {
    const items = buildAutocompleteItems(undefined, process.cwd());
    const subagentItems = items.filter((i) => i.category === 'Subagent');
    assert.strictEqual(subagentItems.length, 5);

    const filtered = filterAutocompleteItems('@arch', items);
    assert.ok(filtered.some((i) => i.prefix === '@architect'));

    const filteredNvidia = filterAutocompleteItems('@nvid', items);
    assert.ok(filteredNvidia.some((i) => i.prefix === '@nvidia'));
  });

  it('injects subagent persona into buildAgentSystemPrompt and buildSniperSystemPrompt', () => {
    const architect = getSubagent('architect')!;

    const agentPrompt = buildAgentSystemPrompt({
      cwd: process.cwd(),
      subagent: architect,
    });
    assert.ok(agentPrompt.includes('ACTIVE SPECIALIZED SUBAGENT: Architect (@architect)'));
    assert.ok(agentPrompt.includes('ARCHITECT subagent in MachCode'));

    const sniperPrompt = buildSniperSystemPrompt('## context', architect);
    assert.ok(sniperPrompt.includes('ACTIVE SPECIALIZED SUBAGENT: Architect (@architect)'));
    assert.ok(sniperPrompt.includes('Sniper') || sniperPrompt.includes('SNIPER'));
  });
});
