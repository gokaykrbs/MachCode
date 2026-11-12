import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fastSearchCode } from './fastSearch.js';

describe('FastSearch Engine Suite', () => {
  it('locates matching text and line numbers across files', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fastsearch-test-'));
    try {
      await fs.writeFile(
        path.join(tmp, 'app.ts'),
        'const port = 3000;\nconst server = createServer();\nserver.listen(port);',
        'utf-8',
      );
      await fs.writeFile(
        path.join(tmp, 'config.ts'),
        'const DEFAULT_PORT = 3000;\nconst TIMEOUT = 5000;',
        'utf-8',
      );

      const res = await fastSearchCode({
        query: 'port',
        baseDir: tmp,
        caseSensitive: false,
      });

      assert.strictEqual(res.matches.length, 3);
      assert.strictEqual(res.matches[0].displayPath, 'app.ts');
      assert.strictEqual(res.matches[0].lineNumber, 1);
      assert.strictEqual(res.matches[1].lineNumber, 3);
      assert.strictEqual(res.matches[2].displayPath, 'config.ts');
      assert.strictEqual(res.matches[2].lineNumber, 1);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('supports regex search with context lines', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fastsearch-ctx-'));
    try {
      await fs.writeFile(
        path.join(tmp, 'user.ts'),
        '// user header\nfunction getUser(id: string) {\n  return db.find(id);\n}\n// user footer',
        'utf-8',
      );

      const res = await fastSearchCode({
        query: 'function\\s+getUser',
        baseDir: tmp,
        isRegex: true,
        contextLinesBefore: 1,
        contextLinesAfter: 1,
      });

      assert.strictEqual(res.matches.length, 1);
      const match = res.matches[0];
      assert.strictEqual(match.lineNumber, 2);
      assert.strictEqual(match.beforeContext?.length, 1);
      assert.strictEqual(match.beforeContext?.[0], '// user header');
      assert.strictEqual(match.afterContext?.length, 1);
      assert.strictEqual(match.afterContext?.[0], '  return db.find(id);');
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('filters by file pattern and skips sensitive files', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fastsearch-filter-'));
    try {
      await fs.writeFile(path.join(tmp, 'secret.env'), 'SECRET_TOKEN=xyz123', 'utf-8');
      await fs.writeFile(path.join(tmp, 'readme.md'), 'Token is safe', 'utf-8');
      await fs.writeFile(path.join(tmp, 'main.ts'), 'const token = "xyz123";', 'utf-8');

      // Only search *.ts files
      const res = await fastSearchCode({
        query: 'xyz123',
        baseDir: tmp,
        filePattern: '*.ts',
      });

      assert.strictEqual(res.matches.length, 1);
      assert.strictEqual(res.matches[0].displayPath, 'main.ts');
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
