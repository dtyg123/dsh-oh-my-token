import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SYSTEM_PROMPT_CHARS, SECTION_NAME, applySystemPrompt, describeRequest, emptySystemPrompt,
  sanitizeSystemPrompt,
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

test('describeRequest reads system messages and tool schemas', () => {
  const snapshot = describeRequest({
    sessionId: 's1',
    messages: [
      { role: 'system', content: [{ type: 'text', text: 'You are helpful.' }] },
      { role: 'system', content: [{ type: 'text', text: 'Second section.' }] },
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    ],
    tools: [{ name: 'bash', description: 'Run a command.', parameters: { type: 'object' } }],
  });
  assert.equal(snapshot.prompt, 'You are helpful.\n\nSecond section.');
  assert.match(snapshot.tools, /## bash/);
  assert.match(snapshot.tools, /Run a command\./);
  assert.match(snapshot.tools, /"type": "object"/);
  assert.ok(typeof snapshot.capturedAt === 'string');
  assert.deepEqual(describeRequest(undefined), undefined);
});

test('describeRequest tolerates a request without system messages or tools', () => {
  const snapshot = describeRequest({ messages: [{ role: 'user', content: [] }] });
  assert.equal(snapshot.prompt, '');
  assert.equal(snapshot.tools, '');
});

test('sanitizing keeps only known modes and bounded text', () => {
  assert.deepEqual(emptySystemPrompt(), { mode: 'append', text: '' });
  assert.deepEqual(sanitizeSystemPrompt({ mode: 'replace', text: 'ok' }), { mode: 'replace', text: 'ok' });
  assert.deepEqual(sanitizeSystemPrompt({ mode: 'bogus', text: 'ok' }), { mode: 'append', text: 'ok' });
  assert.deepEqual(sanitizeSystemPrompt({ text: 5 }), undefined);
  assert.deepEqual(sanitizeSystemPrompt(null), undefined);
  assert.equal(sanitizeSystemPrompt({ text: 'x'.repeat(MAX_SYSTEM_PROMPT_CHARS + 50) }).text.length, MAX_SYSTEM_PROMPT_CHARS);
});
