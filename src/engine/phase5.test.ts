import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

describe('Phase 5: Packaging, Binary Entrypoints & Cross-Project Distribution', () => {
  const rootDir = process.cwd();

  test('Package Configuration: package.json has valid bin, files, scripts, and exports', async () => {
    const pkgPath = path.join(rootDir, 'package.json');
    assert.ok(fsSync.existsSync(pkgPath), 'package.json must exist');

    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));

    // 1. Bin fields (normalized npm standard format)
    assert.ok(pkg.bin, 'package.json must declare bin entries');
    assert.equal(pkg.bin.mach, 'dist/bin/machcode.js');
    assert.equal(pkg.bin.machcode, 'dist/bin/machcode.js');

    // 2. Main and types
    assert.equal(pkg.main, './dist/src/index.js');
    assert.equal(pkg.types, './dist/src/index.d.ts');

    // 3. Scripts
    assert.ok(pkg.scripts.build, 'build script must exist');
    assert.ok(pkg.scripts.test, 'test script must exist');

    // 4. Files whitelist
    assert.ok(pkg.files.includes('dist'), 'dist folder must be whitelisted in files');
  });

  test('CLI Binary: bin/machcode.ts has shebang and compiles to valid executable bundle', async () => {
    const srcBinPath = path.join(rootDir, 'bin', 'machcode.ts');
    assert.ok(fsSync.existsSync(srcBinPath), 'bin/machcode.ts source must exist');

    const srcContent = await fs.readFile(srcBinPath, 'utf-8');
    assert.ok(
      srcContent.startsWith('#!/usr/bin/env node'),
      'bin/machcode.ts must begin with node shebang',
    );

    const distBinPath = path.join(rootDir, 'dist', 'bin', 'machcode.js');
    assert.ok(fsSync.existsSync(distBinPath), 'dist/bin/machcode.js must exist after build');

    const distContent = await fs.readFile(distBinPath, 'utf-8');
    assert.ok(
      distContent.startsWith('#!/usr/bin/env node'),
      'dist/bin/machcode.js must retain node shebang for direct shell execution',
    );
  });

  test('Module Exports: library exports all core engines, tools, commands, and UI helpers', async () => {
    const mod = await import('../index.js');

    // Engines
    assert.equal(typeof mod.runMachCode, 'function');
    assert.equal(typeof mod.startRepl, 'function');
    assert.equal(typeof mod.raceModels, 'function');
    assert.equal(typeof mod.runAgentLoop, 'function');

    // Sessions & Context
    assert.equal(typeof mod.saveSession, 'function');
    assert.equal(typeof mod.loadSession, 'function');
    assert.equal(typeof mod.listSessions, 'function');
    assert.equal(typeof mod.summarizeOldestTurns, 'function');

    // UI & Themes
    assert.equal(typeof mod.getActiveTheme, 'function');
    assert.equal(typeof mod.setActiveTheme, 'function');
    assert.equal(typeof mod.renderStatusBar, 'function');
    assert.equal(typeof mod.parseAndExpandMentions, 'function');

    // Commands & Autocomplete
    assert.equal(typeof mod.createDefaultCommandRegistry, 'function');
    assert.equal(typeof mod.buildAutocompleteItems, 'function');
  });
});
