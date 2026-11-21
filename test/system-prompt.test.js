import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SYSTEM_PROMPT_CHARS, SECTION_NAME, applySystemPrompt, describeLiveAssembly,
  emptySystemPrompt, renderPreviewPrompt, sanitizeSystemPrompt,
} from '../lib/system-prompt.js';

const assembly = () => ({
  sections: [{ name: 'persona', text: 'You are helpful.' }],
  contexts: [{ name: 'runtime', text: 'cwd = /x' }],
  variables: { x: '1' },
});

test('segments append one literal tail section per card, in order', () => {
  const input = assembly();
  const out = applySystemPrompt(input, {
    enabled: true,
    segments: [{ text: 'Be brief.' }, { text: 'Use {{literal}}.' }],
  });
  assert.notEqual(out, input);
  assert.equal(out.sections.length, 3);
  assert.equal(out.sections[0], input.sections[0], 'existing section keeps identity');
  assert.equal(out.sections[1].name, SECTION_NAME + '#0');
  assert.equal(out.sections[1].text, 'Be brief.');
  assert.equal(out.sections[1].interpolate, false, 'braces stay literal');
  assert.ok(out.sections[2].order > out.sections[1].order, 'card order mirrors prompt order');
  assert.equal(out.sections[2].text, 'Use {{literal}}.');
  assert.equal(out.contexts, input.contexts, 'runtime context is untouched');
  assert.equal(out.variables, input.variables);
});

test('empty, whitespace-only, or missing segments are skipped', () => {
  const input = assembly();
  const out = applySystemPrompt(input, {
    enabled: true,
    segments: [{ text: 'Keep.' }, { text: '   \n' }, undefined, { id: 'x', text: '' }],
  });
  assert.equal(out.sections.length, 2);
  assert.equal(out.sections[1].text, 'Keep.');
});

test('a disabled or empty editor is a no-op', () => {
  const input = assembly();
  assert.equal(applySystemPrompt(input, { enabled: false, segments: [{ text: 'x' }] }), input);
  assert.equal(applySystemPrompt(input, { enabled: true, segments: [] }), input);
  assert.equal(applySystemPrompt(input, undefined), input);
});

test('sanitizing accepts segments and migrates the old { mode, text } shape', () => {
  assert.deepEqual(emptySystemPrompt(), { segments: [] });
  assert.deepEqual(sanitizeSystemPrompt({ segments: [{ text: 'a' }, { id: 'k', text: 'b' }] }),
    { segments: [{ text: 'a' }, { id: 'k', text: 'b' }] });
  assert.deepEqual(sanitizeSystemPrompt({ mode: 'replace', text: 'Only this.' }), { segments: [{ text: 'Only this.' }] });
  assert.deepEqual(sanitizeSystemPrompt({ mode: 'bogus', text: 'ok' }), { segments: [{ text: 'ok' }] });
  assert.deepEqual(sanitizeSystemPrompt({ segments: [{ text: 5 }, null, { id: '', text: 'x' }] }),
    { segments: [{ text: '' }, { text: 'x' }] });
  assert.deepEqual(sanitizeSystemPrompt({ text: 5 }), undefined);
  assert.deepEqual(sanitizeSystemPrompt(null), undefined);
  const long = sanitizeSystemPrompt({ segments: [{ text: 'x'.repeat(MAX_SYSTEM_PROMPT_CHARS + 50) }] });
  assert.equal(long.segments[0].text.length, MAX_SYSTEM_PROMPT_CHARS);
});

test('renderPreviewPrompt interpolates known variables and keeps unknown ones literal', () => {
  const assembly = {
    sections: [
      { name: 'a', text: 'Hi {{provider}} and {{unknown}}.', interpolate: true },
      { name: 'b', text: 'World.', interpolate: false },
    ],
    variables: { provider: 'deepseek' },
  };
  assert.equal(renderPreviewPrompt(assembly), 'Hi deepseek and {{unknown}}.\n\nWorld.');
  assert.equal(renderPreviewPrompt(undefined), '');
  assert.equal(renderPreviewPrompt({}), '');
});

test('describeLiveAssembly renders sections into a prompt snapshot', () => {
  const live = describeLiveAssembly({
    sections: [{ name: 'a', text: 'Be brief.', interpolate: true }],
    variables: {},
  });
  assert.equal(live.prompt, 'Be brief.');
  assert.equal(live.capturedAt, null);
  assert.equal(live.source, 'live');
});
