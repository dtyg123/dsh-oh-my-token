import test from 'node:test';
import assert from 'node:assert/strict';
import { autoDetectFilter, readNumbered, rtkCompress } from '../lib/rtk.js';

const rep = (line, count) => Array.from({ length: count }, () => line).join('\n');

test('a git diff keeps file names and change counts', () => {
  const body = [
    'diff --git a/src/a.ts b/src/a.ts',
    'index 000..111',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,150 +1,150 @@',
    ...Array.from({ length: 150 }, (_, i) => `-old ${i}`),
    ...Array.from({ length: 150 }, (_, i) => `+new ${i}`),
  ].join('\n');
  const out = rtkCompress(body);
  assert.ok(out !== null);
  assert.equal(out.id, 'git-diff');
  assert.ok(out.text.includes('src/a.ts'));
  assert.ok(out.text.includes('+150 -150'));
  assert.ok(out.text.length < body.length);
});

test('git status reports counts, not every path', () => {
  const body = ['## main', ...Array.from({ length: 30 }, (_, i) => ` M src/f${i}.ts`), ...Array.from({ length: 30 }, (_, i) => `?? new${i}.txt`)].join('\n');
  const out = rtkCompress(body);
  assert.ok(out !== null);
  assert.equal(out.id, 'git-status');
  assert.ok(out.text.includes('* main'));
  assert.ok(out.text.includes('~ Modified: 30 files'));
  assert.ok(out.text.includes('? Untracked: 30 files'));
});

test('git log keeps the sha, subject and stat line', () => {
  const block = [
    'commit 0123456789abcdef0123',
    'Author: someone <a@b.c>',
    'Date: Fri Nov 20 12:00:00 2026 +0000',
    '',
    '    Fix the thing that was broken.',
    '',
    ...Array.from({ length: 10 }, (_, i) => `    This is body line ${i} explaining the change in detail.`),
    '',
    ' 1 file changed, 1 insertion(+)',
  ].join('\n');
  const body = rep(block, 20);
  const out = rtkCompress(body);
  assert.ok(out !== null);
  assert.equal(out.id, 'git-log');
  assert.ok(out.text.includes('Subject: Fix the thing that was broken'));
  assert.ok(out.text.includes('1 file changed'));
});

test('build output keeps errors and the summary, counts progress', () => {
  const body = [
    ...Array.from({ length: 100 }, (_, i) => `   Compiling crate${i} v0.1.0`),
    'npm ERR! code ERESOLVE',
    'npm ERR! Could not resolve dependency',
    'added 1 package in 2s',
  ].join('\n');
  const out = rtkCompress(body);
  assert.ok(out !== null);
  assert.equal(out.id, 'build-output');
  assert.ok(out.text.includes('Compiled 100 packages'));
  assert.ok(out.text.includes('npm ERR! code ERESOLVE'));
  assert.ok(out.text.includes('added 1 package in 2s'));
});

test('grep groups hits by file and caps repeats', () => {
  const body = Array.from({ length: 40 }, (_, i) => `src/file${i % 4}.ts:${i + 1}: const value${i} = ${i}`).join('\n');
  const out = rtkCompress(body);
  assert.ok(out !== null);
  assert.equal(out.id, 'grep');
  assert.ok(out.text.includes('40 matches in 4F:'));
  assert.ok(out.text.includes('[file] src/file0.ts (10)'));
});

test('find groups paths by directory', () => {
  const body = Array.from({ length: 40 }, (_, i) => `src/dir${i % 3}/file${i}.ts`).join('\n');
  const out = rtkCompress(body);
  assert.ok(out !== null);
  assert.equal(out.id, 'find');
  assert.ok(out.text.includes('40 files in 3 dirs:'));
  assert.ok(out.text.includes('src/dir0/  ('));
});

test('dedup log collapses a repeated run', () => {
  const body = [
    ...Array.from({ length: 30 }, () => 'processing event from the worker queue item'),
    ...Array.from({ length: 5 }, (_, i) => `distinct line ${i}`),
  ].join('\n');
  const out = rtkCompress(body);
  assert.ok(out !== null);
  assert.equal(out.id, 'dedup-log');
  assert.ok(out.text.includes('duplicate lines'));
  assert.ok(out.text.length < body.length);
});

test('ls summarizes files, dirs and extensions', () => {
  const rows = Array.from({ length: 30 }, (_, i) => `-rw-r--r-- 1 user group ${1000 + i} Jan 10 10:00 file${i}.ts`);
  const body = ['total 40', 'drwxr-xr-x 2 user group 4096 Jan 10 10:00 src', ...rows].join('\n');
  const out = rtkCompress(body);
  assert.ok(out !== null);
  assert.equal(out.id, 'ls');
  assert.ok(out.text.includes('Summary: 30 files, 1 dirs'));
  assert.ok(out.text.includes('.ts'));
});

test('tree drops the trailing directory/file summary', () => {
  const body = [
    ...Array.from({ length: 60 }, (_, i) => `├── file${i}.ts`),
    '2 directories, 60 files',
  ].join('\n');
  const out = rtkCompress(body);
  assert.ok(out !== null);
  assert.equal(out.id, 'tree');
  assert.ok(!out.text.includes('directories,'));
  assert.ok(out.text.includes('file0.ts'));
});

test('a long unstructured blob keeps head and tail', () => {
  const lines = Array.from({ length: 300 }, () => '');
  for (let i = 0; i < 4; i += 1) lines[i] = String.fromCharCode(65 + i).repeat(200);
  const body = lines.join('\n');
  const out = rtkCompress(body);
  assert.ok(out !== null);
  assert.equal(out.id, 'smart-truncate');
  assert.ok(out.text.includes('120 lines truncated'));
});

test('a numbered file dump keeps its line numbers', () => {
  const body = Array.from({ length: 300 }, (_, i) => `${i + 1}| const value${i} = ${i};`).join('\n');
  const out = readNumbered(body);
  assert.ok(out.includes('(file continues)'));
  assert.ok(out.length < body.length);
});

test('a search result list groups by directory', () => {
  const body = [
    "Result of search in 'G:/project' (total 40 files):",
    ...Array.from({ length: 40 }, (_, i) => `- src/dir${i % 4}/file${i}.ts`),
  ].join('\n');
  const out = rtkCompress(body);
  assert.ok(out !== null);
  assert.equal(out.id, 'search-list');
  assert.ok(out.text.includes('40 files in 4 dirs:'));
});

test('autoDetectFilter refuses prose and short input', () => {
  assert.equal(autoDetectFilter('A short ordinary sentence about the weather.'), null);
  assert.equal(rtkCompress('too short'), null);
  assert.equal(rtkCompress(''), null);
});

test('eslint compact-formatter output groups by file', () => {
  const body = [
    'src/a.ts:3:10:  \'x\' is defined but never used.  no-unused-vars',
    'src/a.ts:7:2:   Trailing spaces found.  eol-last',
    'src/b.ts:1:1:   Unexpected semicolon.  no-extra-semi',
    'src/b.ts:9:4:   Use of eval is strongly discouraged.  no-eval',
    'src/b.ts:12:4:  \'y\' is defined but never used.  no-unused-vars',
    ...Array.from({ length: 30 }, (_, i) => `src/c.ts:${i + 1}:1:  More lint findings number ${i}.  rule-${i}`),
    '',
    '✖ 35 problems (30 errors, 5 warnings)',
  ].join('\n');
  const out = rtkCompress(body);
  assert.ok(out !== null);
  assert.equal(out.id, 'eslint');
  assert.ok(out.text.includes('35 problem(s) in 3 file(s):'));
  assert.ok(out.text.includes('[file] src/c.ts (30):'));
  assert.ok(out.text.includes('+25 more'));
  assert.ok(out.text.length < body.length);
});

test('cargo build output counts the progress and keeps the verdicts', () => {
  const body = [
    ...Array.from({ length: 40 }, (_, i) => `   Compiling crate${i} v0.1.0`),
    'error[E0599]: no method named `fetch` found',
    "  --> src/main.rs:12:5",
    '   = help: items from traits can only be used if some trait is in scope',
    'error: could not compile `demo` (bin)',
  ].join('\n');
  const out = rtkCompress(body);
  assert.ok(out !== null);
  assert.equal(out.id, 'cargo');
  assert.ok(out.text.includes('Compiled 40 crate(s)'));
  assert.ok(out.text.includes('error[E0599]'));
  assert.ok(!out.text.includes('Compiling crate1'));
});

test('go test folds passing packages into one verdict line', () => {
  const body = [
    ...Array.from({ length: 30 }, (_, i) => `ok  \tservice/pkg${i}\t0.${i}1s`),
    '?   \tservice/empty\t[no test files]',
  ].join('\n');
  const out = rtkCompress(body);
  assert.ok(out !== null);
  assert.equal(out.id, 'go-test');
  assert.ok(out.text.startsWith('✓ go test: 30 package(s) passed; 1 without tests'));
  assert.equal(out.text.split('\n').length, 1);
});

test('go test failure keeps the detail from the first failure on', () => {
  const body = [
    'ok  \talpha\t0.1s',
    'FAIL\tbeta\t0.2s',
    '--- FAIL: TestThing (0.01s)',
    '\t    thing_test.go:10: got 2, want 1',
    ...Array.from({ length: 200 }, (_, i) => `\tgoroutine ${i + 1} [running]:`),
    'FAIL',
  ].join('\n');
  const out = rtkCompress(body);
  assert.ok(out !== null);
  assert.equal(out.id, 'go-test');
  assert.ok(out.text.includes('--- FAIL: TestThing'));
  assert.ok(out.text.includes('got 2, want 1'));
  assert.ok(out.text.length < body.length);
});

test('rtkCompress returns null when there is no gain', () => {
  const prose = `A paragraph of ordinary prose. ${'More words that are not a tool shape. '.repeat(20)}`;
  assert.equal(rtkCompress(prose), null);
});
