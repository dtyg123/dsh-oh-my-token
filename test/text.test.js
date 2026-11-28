import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collapseBlankLines,
  collapseRepeatedLines,
  countLines,
  diffWords,
  headLines,
  isProseLine,
  resolveCarriageReturns,
  stripAnsi,
  stripProgressLines,
  stripTrailingPeriods,
  tailLines,
  tidyPunctuation,
  truncateMiddle,
} from '../lib/text.js';

test('stripTrailingPeriods removes only sentence-final marks on prose lines', () => {
  const input = [
    'Updated the parser to handle empty input.',
    '这是中文句子。',
    'const value = readFileSync(path);',
    'src/index.ts.',
    'https://example.com/docs.',
    'version 2.2.0.',
    '  - a list item.',
    '3.14 and 2.718',
  ].join('\n');

  const out = stripTrailingPeriods(input).split('\n');
  assert.equal(out[0], 'Updated the parser to handle empty input');
  assert.equal(out[1], '这是中文句子');
  // Code, paths, URLs, versions and figures keep their last character.
  assert.equal(out[2], 'const value = readFileSync(path);');
  assert.equal(out[3], 'src/index.ts.');
  assert.equal(out[4], 'https://example.com/docs.');
  assert.equal(out[5], 'version 2.2.0.');
  assert.equal(out[6], '  - a list item.');
  assert.equal(out[7], '3.14 and 2.718');
});

test('isProseLine rejects fenced blocks, diffs and inline code', () => {
  for (const line of ['```ts', '+ added line.', '- removed line.', 'a.b.c.', 'foo@bar.com.', '[link](x).']) {
    assert.equal(isProseLine(line), false, line);
  }
  assert.equal(isProseLine('A plain sentence.'), true);
});

test('trailing whitespace survives period removal', () => {
  assert.equal(stripTrailingPeriods('Done.  '), 'Done  ');
});

test('every trailing sentence mark is removed, not just one', () => {
  assert.equal(stripTrailingPeriods('Done..'), 'Done');
  assert.equal(stripTrailingPeriods('你好。。。'), '你好');
  assert.equal(stripTrailingPeriods('Really...'), 'Really...', 'an ASCII ellipsis is kept');
});

test('politeness words and trailing commas are removed with the period', () => {
  assert.equal(stripTrailingPeriods('谢谢，请稍等。'), '稍等');
  assert.equal(stripTrailingPeriods('请更新配置。'), '更新配置');
  assert.equal(stripTrailingPeriods('Please fix the bug,'), 'fix the bug');
  assert.equal(stripTrailingPeriods('Thank you, done.'), 'done');
});

test('politeness removal does not corrupt compounds or code', () => {
  assert.equal(stripTrailingPeriods('请求已发送。'), '请求已发送');
  assert.equal(stripTrailingPeriods("const msg = '谢谢'"), "const msg = '谢谢'");
  assert.equal(stripTrailingPeriods('const x = 1,'), 'const x = 1,');
});

test('politeness and punctuation trim independently', () => {
  assert.equal(stripTrailingPeriods('谢谢，请稍等。', { politeness: false }), '谢谢，请稍等');
  assert.equal(stripTrailingPeriods('谢谢，请稍等。', { punctuation: false }), '稍等。');
  assert.equal(stripTrailingPeriods('谢谢，请稍等。', { politeness: false, punctuation: false }), '谢谢，请稍等。');
});

test('a custom word list replaces instead of deleting', () => {
  const words = [{ word: '请', replace: '拜托' }, { word: '谢谢', replace: '' }];
  assert.equal(
    stripTrailingPeriods('谢谢，请帮我更新。', { words }),
    '拜托帮我更新',
  );
});

test('automatic word replacement runs before punctuation tidy', () => {
  assert.equal(
    stripTrailingPeriods('请', { words: [{ word: '请', replace: '谢谢。' }], keepWholeLine: false }),
    '谢谢',
  );
});

test('word matching keeps compounds and code safe', () => {
  const words = [{ word: '请', replace: '' }];
  assert.equal(stripTrailingPeriods('请求已发送。', { words }), '请求已发送');
  assert.equal(
    stripTrailingPeriods("const msg = '谢谢'", { words: [{ word: '谢谢', replace: 'bye' }] }),
    "const msg = '谢谢'",
    'a quoted word inside a code line is not prose',
  );
});

test('ASCII words match whole words only', () => {
  const words = [{ word: 'please', replace: '' }];
  assert.equal(stripTrailingPeriods('Please wait.', { words }), 'wait');
  assert.equal(stripTrailingPeriods('pleaseable traits.', { words }), 'pleaseable traits');
});

test('consecutive punctuation collapses, the sentence-final mark wins', () => {
  assert.equal(stripTrailingPeriods('text。，text'), 'text。text', 'comma + period keeps the period');
  assert.equal(stripTrailingPeriods('text。！text'), 'text！text');
  assert.equal(stripTrailingPeriods('text！，text'), 'text！text');
  assert.equal(stripTrailingPeriods('text，，text'), 'text，text');
});

test('a paragraph-opening punctuation is dropped', () => {
  assert.equal(stripTrailingPeriods('。下一段结束。'), '下一段结束');
});

test('an ASCII ellipsis is never collapsed or stripped', () => {
  assert.equal(stripTrailingPeriods('...继续说。'), '...继续说');
  assert.equal(tidyPunctuation('wait... then go.'), 'wait... then go');
  assert.equal(tidyPunctuation('wait…… then go.'), 'wait… then go');
});

test('the word step is a byte-identical no-op when nothing matches', () => {
  assert.equal(stripTrailingPeriods('nothing to see here', { words: [{ word: 'please' }] }), 'nothing to see here');
});

test('built-in particles are deleted only at a phrase boundary', () => {
  assert.equal(stripTrailingPeriods('好的。'), '好的', 'a line made up of one configured word is kept');
  assert.equal(stripTrailingPeriods('好的呀。'), '', 'words in a phrase are still removed');
  assert.equal(stripTrailingPeriods('走吧！'), '走！');
  assert.equal(stripTrailingPeriods('真的嘛，那行。'), '真的，那行');
  // A particle inside a word keeps the word intact.
  assert.equal(stripTrailingPeriods('酒吧。'), '酒吧');
  assert.equal(stripTrailingPeriods('我去网吧。'), '我去网吧');
  assert.equal(stripTrailingPeriods('这件是毛呢。'), '这件是毛呢');
  assert.equal(stripTrailingPeriods('哗啦。'), '哗啦');
  // Interjections that open a sentence go with their comma.
  assert.equal(stripTrailingPeriods('哎呀，算了。'), '算了');
});

test('custom words keep a whole-line match when configured', () => {
  const words = [{ word: '保留', replace: 'changed' }];
  assert.equal(stripTrailingPeriods('保留。', { words }), '保留');
  assert.equal(stripTrailingPeriods('保留。', { words, keepWholeLine: false }), 'changed');
  assert.equal(stripTrailingPeriods('请保留。', { words }), '请changed');
});

test('custom word rules never rewrite URL, path or link lines', () => {
  const words = [{ word: 'token', replace: '' }];
  for (const line of [
    'https://example.com/token.',
    'www.example.com/token.',
    '[token](https://example.com/token).',
    'run `token` after this step.',
    'C:\\work\\token\\file.txt.',
    './token/file.txt.',
  ]) {
    assert.equal(stripTrailingPeriods(line, { words }), line);
  }
});

test('a changed line is recorded as a word diff', () => {
  const diff = diffWords('谢谢，请稍等。', '稍等');
  const deleted = diff.filter((segment) => segment.kind === 'del').map((segment) => segment.text).join('');
  assert.ok(deleted.includes('谢谢'), deleted);
  assert.ok(deleted.includes('请'), deleted);
  assert.equal(diff.filter((segment) => segment.kind === 'add').length, 0);
  assert.ok(diff.some((segment) => segment.kind === 'keep' && segment.text.includes('稍等')));
});

test('a replacement shows the new word as an addition', () => {
  const diff = diffWords('请更新', '拜托更新');
  assert.ok(diff.some((segment) => segment.kind === 'del' && segment.text.includes('请')));
  assert.ok(diff.some((segment) => segment.kind === 'add' && segment.text.includes('拜托')));
});

test('an unchanged line is a single keep segment', () => {
  assert.deepEqual(diffWords('same text', 'same text'), [{ kind: 'keep', text: 'same text' }]);
});

test('the prose step reports one diff line per changed line', () => {
  const pairs = [];
  stripTrailingPeriods('谢谢，请稍等。\nsrc/index.ts.\n。下一段。', {
    onLine: (before, after) => pairs.push([before, after]),
  });
  assert.deepEqual(pairs, [['谢谢，请稍等。', '稍等'], ['。下一段。', '下一段']]);
});

test('stripAnsi and carriage-return repaints', () => {
  assert.equal(stripAnsi('\u001b[31mred\u001b[0m'), 'red');
  assert.equal(resolveCarriageReturns('10%\r50%\r100%'), '100%');
});

test('repeated lines fold, but blank lines do not', () => {
  assert.equal(collapseRepeatedLines('a\na\na\nb'), 'a (×3)\nb');
  assert.equal(collapseRepeatedLines('\n\n\n'), '\n\n\n');
});

test('progress lines drop, summaries survive', () => {
  const text = ['  42%', '[#####   ]', 'added 42 packages in 3s'].join('\n');
  assert.equal(stripProgressLines(text), 'added 42 packages in 3s');
});

test('blank-line collapse and line helpers', () => {
  assert.equal(collapseBlankLines('a\n\n\n\nb'), 'a\n\nb');
  assert.equal(countLines('a\nb\n'), 2);
  assert.equal(headLines('a\nb\nc', 2), 'a\nb');
  assert.equal(tailLines('a\nb\nc', 2), 'b\nc');
});

test('truncateMiddle keeps both ends and the failure line', () => {
  const lines = [];
  for (let i = 0; i < 400; i += 1) lines.push(`line ${i} ${'x'.repeat(40)}`);
  lines[200] = 'ERROR: the thing broke at line 200';
  const text = lines.join('\n');
  const out = truncateMiddle(text, 900, 're-run the command');
  assert.ok(out.length <= 900, `${out.length} > 900`);
  assert.ok(out.startsWith('line 0 '));
  assert.ok(out.includes('ERROR: the thing broke at line 200'));
  assert.ok(out.includes('re-run the command'));
  assert.ok(out.trimEnd().endsWith(lines[399]));
});

test('truncateMiddle is the identity under budget', () => {
  assert.equal(truncateMiddle('short', 100, 'hint'), 'short');
});
