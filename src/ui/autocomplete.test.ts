import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildAutocompleteItems, filterAutocompleteItems } from './autocomplete.js';
import { resolveSkillByName } from '../commands/skills.js';

describe('Autocomplete & Skills Suggestion System', () => {
  it('builds comprehensive list of slash commands and official NVIDIA Agent Skills', () => {
    const items = buildAutocompleteItems();
    assert.ok(items.length >= 25, `Expected at least 25 autocomplete items, got ${items.length}`);

    // Verify key commands exist
    const prefixes = items.map((i) => i.prefix);
    assert.ok(prefixes.includes('/ask'));
    assert.ok(prefixes.includes('/approve'));
    assert.ok(prefixes.includes('/plan'));
    assert.ok(prefixes.includes('/skills'));
    assert.ok(prefixes.includes('/race'));

    // Verify key skills exist
    assert.ok(prefixes.includes('/skill cuopt'));
    assert.ok(prefixes.includes('/skill cudf'));
    assert.ok(prefixes.includes('/skill cudaq'));
    assert.ok(prefixes.includes('/cuopt'));
    assert.ok(prefixes.includes('/cudf'));
  });

  it('filters autocomplete items in real time when typing /', () => {
    const items = buildAutocompleteItems();

    // Typing "/" returns all slash command suggestions
    const slashOnly = filterAutocompleteItems('/', items);
    const expectedSlashCount = items.filter((i) => i.prefix.startsWith('/')).length;
    assert.equal(slashOnly.length, expectedSlashCount);
    assert.ok(slashOnly.length >= 25);

    // Typing non-slash returns empty
    const nonSlash = filterAutocompleteItems('hello world', items);
    assert.equal(nonSlash.length, 0);

    // Typing "/cu" matches cuOpt, cuDF, CUDA-Q, commit, etc.
    const cuMatches = filterAutocompleteItems('/cu', items);
    assert.ok(cuMatches.length >= 3);
    const cuPrefixes = cuMatches.map((m) => m.prefix);
    assert.ok(cuPrefixes.some((p) => p.includes('cuopt')));
    assert.ok(cuPrefixes.some((p) => p.includes('cudf')));

    // Typing "/sk" matches /skills and /skill ...
    const skMatches = filterAutocompleteItems('/sk', items);
    assert.ok(skMatches.length >= 5);
    assert.ok(skMatches.some((m) => m.prefix === '/skills'));
  });

  it('resolves official NVIDIA skills by name, product or alias', () => {
    const cuopt = resolveSkillByName('cuopt');
    assert.ok(cuopt);
    assert.equal(cuopt.product, 'cuOpt');

    const cudf = resolveSkillByName('cudf');
    assert.ok(cudf);
    assert.equal(cudf.product, 'cuDF');

    const cudaq = resolveSkillByName('cudaq');
    assert.ok(cudaq);
    assert.equal(cudaq.product, 'CUDA-Q');

    const deepstream = resolveSkillByName('deepstream');
    assert.ok(deepstream);
    assert.equal(deepstream.product, 'DeepStream');

    assert.equal(resolveSkillByName('unknown_fake_skill'), null);
  });
});
