import test from 'node:test';
import assert from 'node:assert/strict';
import { describeLiveAssembly, renderAssembly } from '../lib/system-prompt.js';

test('renderAssembly joins every section, interpolating known variables only', () => {
  const assembly = {
    variables: { provider: 'deepseek', model: 'v4' },
    sections: [
      { text: 'You are an AI agent.' },
      { text: 'Provider {{provider}} model {{model}}.' },
      { text: 'Literal {{unknown}} stays.' },
      { text: 'No interpolation {{provider}}.', interpolate: false },
      { text: '' },
    ],
  };
  assert.equal(
    renderAssembly(assembly),
    'You are an AI agent.\n\nProvider deepseek model v4.\n\nLiteral {{unknown}} stays.\n\nNo interpolation {{provider}}.',
  );
  assert.equal(renderAssembly(undefined), '');
  assert.equal(renderAssembly({}), '');
});

test('renderAssembly includes sections other plugins injected', () => {
  // The host hands us every registered section, so a plugin-provided one is
  // part of the text the next request carries.
  const assembly = {
    sections: [
      { text: 'core prompt' },
      { name: 'other-plugin/context', text: 'project memory: use pnpm' },
    ],
  };
  assert.match(renderAssembly(assembly), /project memory: use pnpm/);
});

test('describeLiveAssembly reports the prompt, its section count and no capture time', () => {
  const live = describeLiveAssembly({
    sections: [{ text: 'one' }, { text: 'two' }],
    variables: {},
  });
  assert.deepEqual(live, { prompt: 'one\n\ntwo', capturedAt: null, source: 'live', sections: 2 });
  assert.equal(describeLiveAssembly(undefined).prompt, '');
});
