import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, resolveConfig } from '../lib/config.js';

test('an empty config resolves to the defaults', () => {
  assert.deepEqual(resolveConfig(), resolveConfig({}));
  assert.equal(resolveConfig(undefined).budgets.read, DEFAULT_CONFIG.budgets.read);
});

test('a supplied value overrides one field without dropping siblings', () => {
  const resolved = resolveConfig({ budgets: { read: 20000 } });
  assert.equal(resolved.budgets.read, 20000);
  assert.equal(resolved.budgets.default, DEFAULT_CONFIG.budgets.default);
});

test('an unknown top-level field fails activation', () => {
  assert.throws(() => resolveConfig({ budget: 1 }), /unknown config field "budget"/);
});

test('an unknown nested field fails activation', () => {
  assert.throws(() => resolveConfig({ prose: { strip: true } }), /prose\.strip is not a setting/);
});

test('type and range checks reject silently wrong values', () => {
  assert.throws(() => resolveConfig({ minGain: 1 }), /minGain must be a number in/);
  assert.throws(() => resolveConfig({ minChars: -1 }), /minChars must be an integer/);
  assert.throws(() => resolveConfig({ recovery: 'magic' }), /recovery must be one of/);
  assert.throws(() => resolveConfig({ filters: { pytest: 'yes' } }), /filters\.pytest must be true or false/);
  assert.throws(() => resolveConfig([]), /config must be a mapping/);
});

test('RTK compaction is on by default and can be switched off', () => {
  assert.equal(DEFAULT_CONFIG.rtk, true);
  assert.equal(resolveConfig({}).rtk, true);
  assert.equal(resolveConfig({ rtk: false }).rtk, false);
  assert.throws(() => resolveConfig({ rtk: 'yes' }), /rtk must be true or false/);
});

test('the default prose word list carries politeness words and particles', () => {
  const words = resolveConfig({}).prose.politenessWords.map((entry) => entry.word);
  for (const word of ['谢谢', '好的', '多谢', '感谢', '请问', '麻烦您', '麻烦', '劳驾', '拜托', '辛苦', '请', 'please', 'thanks', 'thank you', 'kindly']) {
    assert.ok(words.includes(word), word);
  }
  for (const particle of ['啊', '呀', '吧', '呢', '嘛', '哦']) {
    assert.ok(words.includes(particle), particle);
  }
});

test('a custom politeness word list is validated', () => {
  const words = [{ word: '谢谢', replace: '' }, { word: 'please', replace: 'please ' }];
  const resolved = resolveConfig({ prose: { politenessWords: words } });
  assert.deepEqual(resolved.prose.politenessWords, words);
  assert.throws(() => resolveConfig({ prose: { politenessWords: 'no' } }), /must be an array/);
  assert.throws(() => resolveConfig({ prose: { politenessWords: [{ word: '' }] } }), /word must be a 1-40 character string/);
  assert.throws(() => resolveConfig({ prose: { politenessWords: [{ word: 'a', replace: 3 }] } }), /replace must be a string/);
  assert.throws(() => resolveConfig({ prose: { politenessWords: [{ word: 'a', bogus: 1 }] } }), /only set "word" and "replace"/);
  // An empty list is valid: it turns the word step off.
  assert.deepEqual(resolveConfig({ prose: { politenessWords: [] } }).prose.politenessWords, []);
  assert.equal(resolveConfig({ prose: { keepWholeLine: false } }).prose.keepWholeLine, false);
});
