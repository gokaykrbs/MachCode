import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import type readline from 'node:readline/promises';
import { listThemes, setActiveTheme, getActiveTheme } from '../ui/theme.js';
import { getGitBranch, formatTokenCount, renderStatusBar } from '../ui/statusBar.js';
import { parseAndExpandMentions, getWorkspaceFileCandidates } from '../utils/mentionParser.js';
import { createDefaultCommandRegistry, type CommandContext } from '../commands/index.js';
import { buildAutocompleteItems, filterAutocompleteItems } from '../ui/autocomplete.js';

describe('Phase 3: Terminal Experience, Status Bar, @ Mentions & Themes', () => {
  test('Theme System: lists themes and updates active theme palettes', () => {
    const themes = listThemes();
    assert.ok(themes.length >= 7, 'Should register at least 7 high-fidelity themes');

    const themeNames = themes.map((t) => t.name);
    assert.ok(themeNames.includes('default'));
    assert.ok(themeNames.includes('tokyo-night'));
    assert.ok(themeNames.includes('dracula'));
    assert.ok(themeNames.includes('matrix'));
    assert.ok(themeNames.includes('monokai'));
    assert.ok(themeNames.includes('cyberpunk'));
    assert.ok(themeNames.includes('minimal'));

    // Switch theme
    const switched = setActiveTheme('dracula');
    assert.equal(switched, true);
    const active = getActiveTheme();
    assert.equal(active.name, 'dracula');
    assert.ok(active.formatPrompt('build').includes('machcode'));

    // Switch back to default
    setActiveTheme('default');
    assert.equal(getActiveTheme().name, 'default');
  });

  test('Status Bar: git branch discovery, token formatting, and responsive rendering', () => {
    // 1. Git branch discovery
    const branch = getGitBranch(process.cwd());
    assert.ok(branch !== null, 'Should detect git branch in workspace');
    assert.equal(typeof branch, 'string');

    // 2. Token formatting
    assert.equal(formatTokenCount(450), '450');
    assert.equal(formatTokenCount(1500), '1.5k');
    assert.equal(formatTokenCount(2500000), '2.5M');

    // 3. Status bar line rendering
    const sb = renderStatusBar({
      mode: 'build',
      baseDir: process.cwd(),
      strongPoolCount: 57,
      activeModel: 'qwen/qwen2.5-coder-32b-instruct',
      gitBranch: branch ?? 'main',
      totalTokens: 1850,
      autoApprove: false,
      themeName: 'default',
    });

    assert.ok(sb.includes('BUILD'));
    assert.ok(sb.includes('57 models'));
    assert.ok(sb.includes('1.9k tokens') || sb.includes('tokens'));
    assert.ok(sb.includes('ask'));
  });

  test('@ Mentions: safely expands file references and ignores email addresses', async () => {
    const workspaceRoot = process.cwd();

    // Prompt containing both an email address and a valid @file mention
    const prompt = 'Please review contact@company.com and check @package.json for dependencies';
    const result = await parseAndExpandMentions(prompt, workspaceRoot);

    // Email should NOT be treated as a file mention
    assert.ok(!result.mentionedFiles.some((f) => f.mentionText.includes('contact@company.com')));

    // package.json SHOULD be resolved and expanded
    const pkgMention = result.mentionedFiles.find((f) => f.mentionText === '@package.json');
    assert.ok(pkgMention, 'Should detect @package.json');
    assert.ok(pkgMention.lineCount > 5, 'Should count lines in package.json');
    assert.ok(
      pkgMention.content.includes('"name": "machcode"'),
      'Should read package.json contents',
    );
    assert.ok(result.augmentedContext.includes('--- File Context (@package.json) ---'));

    // Test file candidate discovery for autocomplete
    const candidates = await getWorkspaceFileCandidates('@pack', workspaceRoot);
    assert.ok(candidates.some((c) => c.includes('package.json')));
  });

  test('Slash Commands: /theme, /model, /status, and /mode are registered and dispatched', async () => {
    const registry = createDefaultCommandRegistry();

    assert.ok(registry.getCommand('theme'), '/theme should be registered');
    assert.ok(registry.getCommand('model'), '/model should be registered');
    assert.ok(registry.getCommand('status'), '/status should be registered');
    assert.ok(registry.getCommand('mode'), '/mode should be registered');

    let currentMode: 'build' | 'plan' = 'build';
    let pinnedModel: string | undefined = undefined;

    const dummyContext: CommandContext = {
      baseDir: process.cwd(),
      lightModel: 'meta/llama-3.3-70b-instruct',
      heavyModel: 'qwen/qwen2.5-coder-32b-instruct',
      strongPool: ['qwen/qwen2.5-coder-32b-instruct', 'google/gemma-2-27b-it'],
      weakPool: ['meta/llama-3.3-70b-instruct'],
      handoffWindowMs: 3000,
      sessionHistory: [],
      addedContextFiles: new Set<string>(),
      fileSnapshots: [],
      tokenStats: { estimatedPromptTokens: 100, estimatedCompletionTokens: 200, totalTurns: 1 },
      rl: {} as unknown as readline.Interface,
      shouldExit: false,
      mode: currentMode,
      setMode: (m) => {
        currentMode = m;
      },
      pinnedModel,
      setPinnedModel: (m) => {
        pinnedModel = m;
      },
      runMachCode: async () => ({
        raceResult: {
          winnerModel: 'mock',
          winnerRole: 'heavy',
          handoffOccurred: false,
          handoffElapsedMs: null,
          lightAborted: false,
          heavyAborted: false,
          finalTerminalOutput: '',
          parseResult: {
            plan: '',
            extractedCode: '',
            codeBlocks: [],
            visibleOutput: '',
            question: null,
            isHalted: false,
          },
        },
        executionSummary: {
          createdFiles: [],
          modifiedFiles: [],
          errorFiles: [],
          skipped: false,
          formattedSummary: '',
        },
        toolsLoaded: [],
        questionRounds: 0,
      }),
    };

    // 1. /theme dispatch
    const handledTheme = await registry.dispatch('/theme tokyo-night', dummyContext);
    assert.equal(handledTheme, true);
    assert.equal(getActiveTheme().name, 'tokyo-night');
    setActiveTheme('default'); // reset

    // 2. /mode toggle dispatch
    const handledMode = await registry.dispatch('/mode plan', dummyContext);
    assert.equal(handledMode, true);
    assert.equal(currentMode, 'plan');

    // 3. /model pin dispatch
    const handledModel = await registry.dispatch('/model qwen', dummyContext);
    assert.equal(handledModel, true);
    assert.ok(pinnedModel !== undefined && (pinnedModel as string).includes('qwen'));

    // 4. /model reset dispatch
    await registry.dispatch('/model reset', dummyContext);
    assert.equal(pinnedModel, undefined);

    // 5. /status dispatch
    const handledStatus = await registry.dispatch('/status', dummyContext);
    assert.equal(handledStatus, true);
  });

  test('Autocomplete: filters slash commands, skills, and @ file mentions', () => {
    const items = buildAutocompleteItems(undefined, process.cwd());

    // Check command items
    assert.ok(items.some((i) => i.prefix === '/theme'));
    assert.ok(items.some((i) => i.prefix === '/status'));
    assert.ok(items.some((i) => i.prefix === '/model'));

    // Check file mention items
    assert.ok(items.some((i) => i.category === 'File' && i.prefix.includes('package.json')));

    // Filter by /theme
    const themeMatches = filterAutocompleteItems('/th', items);
    assert.ok(themeMatches.some((m) => m.prefix === '/theme'));

    // Filter by @pack
    const fileMatches = filterAutocompleteItems('@pack', items);
    assert.ok(fileMatches.some((m) => m.prefix.includes('package.json')));
  });
});
