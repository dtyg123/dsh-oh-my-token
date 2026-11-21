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

test('append keeps the existing sections and adds one literal tail section', () => {
  const input = assembly();
  const out = applySystemPrompt(input, { enabled: true, mode: 'append', text: 'Always answer in Chinese.\nUse {{literal}}.' });
  assert.notEqual(out, input);
  assert.equal(out.sections.length, 2);
  assert.equal(out.sections[0], input.sections[0], 'existing section keeps identity');
  assert.equal(out.sections[1].name, SECTION_NAME);
  assert.equal(out.sections[1].text, 'Always answer in Chinese.\nUse {{literal}}.');
  assert.equal(out.sections[1].interpolate, false, 'braces stay literal');
  assert.ok(out.sections[1].order > 0);
  assert.equal(out.contexts, input.contexts, 'runtime context is untouched');
  assert.equal(out.variables, input.variables);
});

test('replace swaps the whole section list for the custom text', () => {
  const input = assembly();
  const out = applySystemPrompt(input, { enabled: true, mode: 'replace', text: 'Only this.' });
  assert.equal(out.sections.length, 1);
  assert.equal(out.sections[0].text, 'Only this.');
  assert.equal(input.sections.length, 1, 'source assembly is untouched');
});

test('a disabled or empty editor is a no-op', () => {
  const input = assembly();
  assert.equal(applySystemPrompt(input, { enabled: false, mode: 'append', text: 'x' }), input);
  assert.equal(applySystemPrompt(input, { enabled: true, mode: 'append', text: '   \n' }), input);
  assert.equal(applySystemPrompt(input, undefined), input);
});

test('sanitizing keeps only known modes and bounded text', () => {
  assert.deepEqual(emptySystemPrompt(), { mode: 'append', text: '' });
  assert.deepEqual(sanitizeSystemPrompt({ mode: 'replace', text: 'ok' }), { mode: 'replace', text: 'ok' });
  assert.deepEqual(sanitizeSystemPrompt({ mode: 'bogus', text: 'ok' }), { mode: 'append', text: 'ok' });
  assert.deepEqual(sanitizeSystemPrompt({ text: 5 }), undefined);
  assert.deepEqual(sanitizeSystemPrompt(null), undefined);
  assert.equal(sanitizeSystemPrompt({ text: 'x'.repeat(MAX_SYSTEM_PROMPT_CHARS + 50) }).text.length, MAX_SYSTEM_PROMPT_CHARS);
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
