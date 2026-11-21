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

test('rtkCompress returns null when there is no gain', () => {
  const prose = `A paragraph of ordinary prose. ${'More words that are not a tool shape. '.repeat(20)}`;
  assert.equal(rtkCompress(prose), null);
});
