import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCommandFilters,
  genericClean,
  parseCommand,
  selectFilter,
  splitExit,
  splitSegments,
  tokenize,
} from '../lib/filters.js';
import { DEFAULT_CONFIG } from '../lib/config.js';

const config = DEFAULT_CONFIG;

test('splitSegments respects quotes and splits pipelines', () => {
  assert.deepEqual(splitSegments('git add . && git commit -m "a && b"'), ['git add .', 'git commit -m "a && b"']);
  assert.deepEqual(splitSegments('pytest -q | tail -5'), ['pytest -q', 'tail -5']);
});

test('tokenize keeps quoted strings intact', () => {
  assert.deepEqual(tokenize('git commit -m "hello world"'), ['git', 'commit', '-m', 'hello world']);
});

test('parser strips env assignments and runners', () => {
  assert.equal(parseCommand('CI=1 pnpm exec tsc --noEmit').tokenSegments[0][0], 'tsc');
  assert.equal(parseCommand('npx --yes pytest -q').tokenSegments[0][0], 'pytest');
  assert.equal(parseCommand('uv run pytest').tokenSegments[0][0], 'pytest');
});

test('selectFilter picks the producer of a pipeline', () => {
  assert.equal(selectFilter('pytest -q | tail -20').id, 'pytest');
  assert.equal(selectFilter('git status --porcelain').id, 'git');
  assert.equal(selectFilter('npm install').id, 'packageManager');
  assert.equal(selectFilter('node scripts/build.js').id, undefined);
});

test('pytest pass collapses to a verdict', () => {
  const text = 'test_a.py ..\ntest_b.py ..\n\n===== 42 passed in 1.23s =====\n';
  const out = applyCommandFilters('pytest', text, { isError: false, exitCode: 0, config });
  assert.equal(out.id, 'pytest');
  assert.equal(out.text, '✓ 42 passed in 1.23s');
});

test('pytest failure keeps FAILED lines, assertion and summary', () => {
  const text = [
    '============================= test session starts ==============================',
    'collected 3 items',
    'tests/test_x.py F..',
    '=================================== FAILURES ===================================',
    '_______________________________ test_alpha ___________________________________',
    '    def test_alpha():',
    '>       assert 1 == 2',
    'E       assert 1 == 2',
    'FAILED tests/test_x.py::test_alpha - assert 1 == 2',
    '=========================== 1 failed, 2 passed in 0.42s ===========================',
  ].join('\n');
  const out = applyCommandFilters('pytest', text, { isError: true, exitCode: 1, config });
  assert.ok(out.text.includes('✗ 1 failed, 2 passed in 0.42s'));
  assert.ok(out.text.includes('FAILED tests/test_x.py::test_alpha'));
  assert.ok(out.text.includes('E       assert 1 == 2'));
  assert.ok(!out.text.includes('collected 3 items'));
});

test('git status clean collapses', () => {
  const out = applyCommandFilters('git status', 'On branch main\nnothing to commit, working tree clean\n', {
    isError: false, exitCode: 0, config,
  });
  assert.equal(out.text, 'clean');
});

test('git diff above the budget keeps headers and changed lines', () => {
  const body = [];
  body.push('diff --git a/x.ts b/x.ts', 'index 111..222 100644', '--- a/x.ts', '+++ b/x.ts', '@@ -1,3 +1,3 @@');
  for (let i = 0; i < 300; i += 1) body.push(`+const line${i} = ${i};`);
  const text = body.join('\n');
  const out = applyCommandFilters('git diff', text, { isError: false, exitCode: 0, config });
  assert.ok(out.text.includes('diff --git a/x.ts b/x.ts'));
  assert.ok(out.text.includes('changed lines elided'));
});

test('tsc keeps only TS errors, with a count', () => {
  const text = [
    'src/a.ts(1,2): error TS2322: Type string is not assignable to type number.',
    'src/b.ts(3,4): error TS1005: ; expected.',
    'src/c.ts(5,6): warning TS9999: ignore me.',
  ].join('\n');
  const out = applyCommandFilters('tsc --noEmit', text, { isError: true, exitCode: 2, config });
  assert.equal(out.text.split('\n').length, 3);
  assert.ok(out.text.includes('error TS2322'));
  assert.ok(!out.text.includes('warning TS9999'));
  assert.ok(out.text.endsWith('Found 2 error(s)'));
});

test('tsc clean run says so', () => {
  const out = applyCommandFilters('tsc --noEmit', '', { isError: false, exitCode: 0, config });
  assert.equal(out.text, '✓ tsc: no errors');
});

test('tsc that fails without an error TS line keeps the message', () => {
  const text = "error TS5058: The specified path does not exist: 'tsconfig.json'.\n";
  const out = applyCommandFilters('tsc --noEmit', text, { isError: false, exitCode: 1, config });
  assert.ok(out.text.includes('TS5058'));
  assert.ok(!out.text.includes('no errors'));
});

test('install success keeps the summary, not the tree', () => {
  const text = [
    'npm WARN deprecated foo@1.0.0',
    'added 137 packages, and audited 138 packages in 4s',
    'found 0 vulnerabilities',
  ].join('\n');
  const out = applyCommandFilters('npm install', text, { isError: false, exitCode: 0, config });
  assert.equal(out.text, 'added 137 packages, and audited 138 packages in 4s');
  assert.ok(!out.text.includes('deprecated'));
});

test('install failure keeps the error lines', () => {
  const text = [
    'npm ERR! code ERESOLVE',
    'npm ERR! ERESOLVE unable to resolve dependency tree',
    'npm notice a long unrelated wall of text',
  ].join('\n');
  const out = applyCommandFilters('npm install', text, { isError: true, exitCode: 1, config });
  assert.ok(out.text.includes('npm ERR! code ERESOLVE'));
  assert.ok(!out.text.includes('unrelated wall'));
});

test('an install that exits nonzero without isError is still read as a failure', () => {
  const text = 'Progress: resolved 12, reused 3\nERR_PNPM_FETCH_404  GET https://registry.npmjs.org/nope: Not Found';
  const out = applyCommandFilters('pnpm add nope', text, { isError: false, exitCode: 1, config });
  assert.ok(out.text.includes('ERR_PNPM_FETCH_404'));
  assert.ok(!out.text.includes('✓'));
});

test('unknown commands get only lossless cleanup', () => {
  const text = 'a\na\na\n\n\n\nb';
  assert.equal(applyCommandFilters('node build.js', text, { isError: false, exitCode: 0, config }).text, 'a (×3)\n\nb');
  assert.equal(genericClean(text), 'a (×3)\n\nb');
});

test('a throwing filter never escapes', () => {
  const out = applyCommandFilters('pytest', null, { isError: false, config: { filters: { pytest: true } } });
  assert.equal(typeof out.text, 'string');
});

test('splitExit separates the tool marker', () => {
  assert.deepEqual(splitExit('boom\n[exit code: 2]'), { body: 'boom', exitCode: 2, signal: undefined });
  assert.deepEqual(splitExit('x\n[killed by signal: SIGKILL]'), { body: 'x', exitCode: undefined, signal: 'SIGKILL' });
  assert.deepEqual(splitExit('plain'), { body: 'plain', exitCode: undefined, signal: undefined });
});
