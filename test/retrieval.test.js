import test from 'node:test';
import assert from 'node:assert/strict';
import { capSearch, extractReadPath, extractSymbols, languageOf, outlineRead } from '../lib/retrieval.js';

/** A readable file with more than `threshold` lines. */
function bigFile(extra = '') {
  const lines = ['<path>src/app.ts</path>'];
  for (let i = 0; i < 40; i += 1) {
    lines.push(`export function fn${i}(input: string): string {`);
    for (let j = 0; j < 10; j += 1) lines.push(`  return input + ${j};`);
    lines.push('}');
  }
  return lines.join('\n') + extra;
}

test('languageOf maps the common extensions', () => {
  assert.equal(languageOf('a/b/c.ts'), 'js');
  assert.equal(languageOf('x.py'), 'py');
  assert.equal(languageOf('x.go'), 'go');
  assert.equal(languageOf('x.rs'), 'rust');
  assert.equal(languageOf('x.java'), 'jvm');
  assert.equal(languageOf('x.c'), 'c');
  assert.equal(languageOf('x.rb'), 'ruby');
  assert.equal(languageOf('x.ps1'), 'shell');
  assert.equal(languageOf('README.md'), 'generic');
});

test('extractSymbols reads top-level declarations only', () => {
  const lines = [
    'import x from "y"',
    'export class Alpha {',
    '  method() {}',
    '}',
    'export async function beta() {}',
    'const gamma = 1',
    'type Delta = string',
  ];
  const symbols = extractSymbols(lines, 'js').map((symbol) => `${symbol.kind} ${symbol.name}@${symbol.line}`);
  assert.deepEqual(symbols, ['class Alpha@2', 'function beta@5', 'const gamma@6', 'type Delta@7']);
});

test('extractSymbols handles python and go', () => {
  assert.deepEqual(
    extractSymbols(['class A:', '    def m(self):', 'def top():'], 'py').map((s) => s.name),
    ['A', 'top'],
  );
  assert.deepEqual(
    extractSymbols(['func Top() {}', 'func (r R) Method() {}', 'type Thing struct {}'], 'go').map((s) => s.name),
    ['Top', 'Method', 'Thing'],
  );
});

test('extractReadPath unwraps the read envelope', () => {
  assert.equal(extractReadPath('<path>a/b.ts</path>\n1: x'), 'a/b.ts');
  assert.equal(extractReadPath('no envelope'), undefined);
});

test('outlineRead replaces a large un-ranged read', () => {
  const text = bigFile();
  const out = outlineRead(text, { threshold: 400, maxSymbols: 60 });
  assert.ok(out !== undefined);
  assert.ok(out.length < text.length);
  assert.ok(out.includes('<path>src/app.ts</path>'));
  assert.ok(out.includes('480 lines; outline only'));
  assert.ok(!out.includes('return input'), 'body must be gone');
  assert.ok(out.includes('1: function fn0'));
  assert.ok(out.includes('Re-read src/app.ts with offset/limit'));
});

test('outlineRead leaves small files and JSON alone', () => {
  const small = `${'<path>a.ts</path>\n'}${'const a = 1;\n'.repeat(20)}`;
  assert.equal(outlineRead(small, { threshold: 400, maxSymbols: 60 }), undefined);
  assert.equal(outlineRead(bigFile(), { threshold: 4000, maxSymbols: 60 }), undefined);
  const json = `<path>package.json</path>\n${'x'.repeat(9000)}`;
  assert.equal(outlineRead(json, { threshold: 400, maxSymbols: 60 }), undefined);
});

test('outlineRead refuses when it would not be shorter', () => {
  const name = 'a'.repeat(300);
  const text = `<path>a.ts</path>\n${`export const ${name} = 1\n`.repeat(10)}`;
  assert.equal(outlineRead(text, { threshold: 5, maxSymbols: 60 }), undefined);
});

test('capSearch keeps the first matches and says how many were cut', () => {
  const lines = [];
  for (let i = 0; i < 120; i += 1) lines.push(`src/f${i}.ts:${i}: hit ${i}`);
  const out = capSearch(lines.join('\n'), { maxMatches: 50 });
  assert.ok(out !== undefined);
  assert.equal(out.split('\n').filter((line) => /:\d+:/.test(line)).length, 50);
  assert.ok(out.includes('70 more matches'));
});

test('capSearch leaves small results and non-matching text alone', () => {
  assert.equal(capSearch('a.ts:1: x', { maxMatches: 50 }), undefined);
  assert.equal(capSearch('line one\nline two', { maxMatches: 50 }), undefined);
});

test('capSearch keeps header lines around the matches', () => {
  const lines = ['Search results:', ...Array.from({ length: 60 }, (_, i) => `a.ts:${i}: hit`), 'done'];
  const out = capSearch(lines.join('\n'), { maxMatches: 10 });
  assert.ok(out.startsWith('Search results:'));
  assert.ok(out.includes('50 more matches'));
});
