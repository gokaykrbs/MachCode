import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseUnifiedDiff, applyUnifiedDiff, fuzzyReplace } from './diffApplier.js';

describe('Unified Diff & Fuzzy Patch Applicator', () => {
  it('parses unified diff hunks correctly', () => {
    const diff = `--- a/file.ts
+++ b/file.ts
@@ -10,4 +10,5 @@
 const a = 1;
-const b = 2;
+const b = 20;
+const c = 30;
 return a + b;
`;
    const parsed = parseUnifiedDiff(diff);
    assert.strictEqual(parsed.oldPath, 'file.ts');
    assert.strictEqual(parsed.newPath, 'file.ts');
    assert.strictEqual(parsed.hunks.length, 1);
    assert.strictEqual(parsed.hunks[0].oldStart, 10);
    assert.strictEqual(parsed.hunks[0].newLines, 5);
  });

  it('applies unified diff hunks to matching content', () => {
    const original = `function test() {
  const a = 1;
  const b = 2;
  return a + b;
}`;

    const diff = `@@ -1,5 +1,6 @@
 function test() {
   const a = 1;
-  const b = 2;
+  const b = 20;
+  const c = 30;
   return a + b;
 }`;

    const result = applyUnifiedDiff(original, diff);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.appliedHunks, 1);
    assert.ok(result.content.includes('const b = 20;'));
    assert.ok(result.content.includes('const c = 30;'));
    assert.ok(!result.content.includes('const b = 2;'));
  });

  it('applies hunks with line number shifts (offset tolerance)', () => {
    const original = `// extra header line 1
// extra header line 2
// extra header line 3
function calculate() {
  const x = 10;
  return x * 2;
}`;

    // Diff says line 1, but actual function is at line 4
    const diff = `@@ -1,4 +1,4 @@
 function calculate() {
-  const x = 10;
+  const x = 42;
   return x * 2;
 }`;

    const result = applyUnifiedDiff(original, diff);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.appliedHunks, 1);
    assert.ok(result.content.includes('const x = 42;'));
  });

  it('handles fuzzyReplace with trailing space differences', () => {
    const original = `function hello() {\n  const greeting = "hi";   \n  return greeting;\n}`;
    const oldStr = `  const greeting = "hi";\n  return greeting;`;
    const newStr = `  const greeting = "hello world";\n  return greeting;`;

    const res = fuzzyReplace(original, oldStr, newStr);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.matchType, 'trimmed');
    assert.ok(res.result.includes('"hello world"'));
  });

  it('handles fuzzyReplace CRLF transparently', () => {
    const original = `line 1\r\nline 2\r\nline 3\r\n`;
    const oldStr = `line 2\n`;
    const newStr = `line 2 replaced\n`;

    const res = fuzzyReplace(original, oldStr, newStr);
    assert.strictEqual(res.success, true);
    assert.ok(res.result.includes('line 2 replaced'));
    assert.ok(res.result.includes('\r\n'));
  });
});
