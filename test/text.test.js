import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collapseBlankLines,
  collapseRepeatedLines,
  countLines,
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
