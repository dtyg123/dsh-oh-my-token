import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply, inject, name } from '../index.js';

/** A response object that records what the handler wrote. */
function fakeResponse() {
  return {
    status: 0,
    headers: null,
    payload: '',
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(payload) {
      this.payload = payload ?? '';
    },
    json() {
      return JSON.parse(this.payload);
    },
  };
}

/** A request body as an async iterable, like an IncomingMessage. */
async function* body(value) {
  yield Buffer.from(JSON.stringify(value));
}

/** A POST request carrying one JSON value. */
function postReq(payload) {
  return { method: 'POST', [Symbol.asyncIterator]: () => body(payload)[Symbol.asyncIterator]() };
}

/** Mount the plugin against a fake context and capture its listeners and routes. */
function mount(config, { webServer, profileDir, services } = {}) {
  const listeners = new Map();
  const routes = new Map();
  const infos = [];
  const warnings = [];
  // Never let a test write to the real profile: `apply` resolves the state
  // directory from the environment, so one is supplied for its duration.
  const previous = process.env.DSH_PROFILE_DIR;
  if (profileDir === undefined) process.env.DSH_PROFILE_DIR = mkdtempSync(join(tmpdir(), 'oh-my-token-mount-'));
  else process.env.DSH_PROFILE_DIR = profileDir;
  const server = webServer ?? {
    register: (route) => {
      routes.set(route.path, route);
      return () => routes.delete(route.path);
    },
  };
  const ctx = {
    on: (event, handler) => listeners.set(event, handler),
    effect: (factory) => factory(),
    inject: (_deps, callback) => {
      if (server !== undefined) callback({ webServer: server, effect: (factory) => factory() });
    },
    logger: {
      info: (message) => infos.push(message),
      debug: () => {},
      warn: (message) => warnings.push(message),
    },
    get: (service) => services?.[service],
  };
  try {
    apply(ctx, config);
  } finally {
    if (previous === undefined) delete process.env.DSH_PROFILE_DIR;
    else process.env.DSH_PROFILE_DIR = previous;
  }
  return { listeners, routes, infos, warnings, ctx };
}

const pytest = {
  name: 'bash',
  arguments: { command: 'pytest -q' },
  callId: 'c1',
  signal: undefined,
};

const text = (value) => [{ type: 'text', text: value }];
const accept = (content) => ({ kind: 'accept', content });
const PYTEST_BODY = 'test_a.py ..\n\n===== 42 passed in 1.23s =====\n[exit code: 0]';

test('identity', () => {
  assert.equal(name, 'oh-my-token');
  assert.deepEqual(inject, ['tools']);
});

test('registers its four listeners and three routes', () => {
  const { listeners, routes, infos } = mount({});
  assert.deepEqual([...listeners.keys()], ['tools/post-execute', 'agent/pre-step', 'system-prompt/assemble', 'llm/stream']);
  assert.deepEqual([...routes.keys()], ['/dsh-oh-my-token/state', '/dsh-oh-my-token/stats', '/dsh-oh-my-token/prompt']);
  assert.equal(infos.length, 1);
});

test('disabled registers nothing', () => {
  const { listeners, routes } = mount({ enabled: false });
  assert.equal(listeners.size, 0);
  assert.equal(routes.size, 0);
});

test('a smaller result replaces the content it was given', async () => {
  const { listeners } = mount({ minChars: 10 });
  const handler = listeners.get('tools/post-execute');
  const decision = await handler(pytest, { isError: false }, async () => accept(text(PYTEST_BODY)));
  assert.equal(decision.kind, 'accept');
  assert.equal(decision.content[0].text, '✓ 42 passed in 1.23s\n[exit code: 0]');
});

test('additionalContexts survive a rewrite', async () => {
  const { listeners } = mount({ minChars: 10 });
  const handler = listeners.get('tools/post-execute');
  const decision = await handler(pytest, { isError: false }, async () => ({
    kind: 'accept',
    content: text('===== 1 passed in 0.01s ====='),
    additionalContexts: [{ type: 'text', text: 'note' }],
  }));
  assert.deepEqual(decision.additionalContexts, [{ type: 'text', text: 'note' }]);
});

test('a reject decision is passed through untouched', async () => {
  const { listeners } = mount({});
  const handler = listeners.get('tools/post-execute');
  const rejection = { kind: 'reject', reason: 'user said no' };
  assert.equal(await handler(pytest, {}, async () => rejection), rejection);
});

test('a value replacement is left to its owner', async () => {
  const { listeners } = mount({ minChars: 10 });
  const handler = listeners.get('tools/post-execute');
  const replacement = { kind: 'accept', value: { structured: true }, content: text('x'.repeat(50)) };
  assert.equal(await handler(pytest, {}, async () => replacement), replacement);
});

test('a listener that resolves nothing is repaired, not crashed on', async () => {
  const { listeners } = mount({ minChars: 10 });
  const handler = listeners.get('tools/post-execute');
  const decision = await handler({ name: 'bash', arguments: { command: 'pytest' } }, {}, async () => undefined);
  assert.equal(decision.kind, 'accept');
});

test('an unshrinkable result is returned unchanged', async () => {
  const { listeners } = mount({ minChars: 10 });
  const handler = listeners.get('tools/post-execute');
  const original = accept(text('short'));
  assert.deepEqual(await handler({ name: 'bash', arguments: { command: 'pytest' } }, {}, async () => original), original);
});

test('GET state lists every switch and the prose scope', async () => {
  const { routes } = mount({});
  const response = fakeResponse();
  await routes.get('/dsh-oh-my-token/state').handler({ method: 'GET' }, response);
  const state = response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(state.modes.map((mode) => mode.id), [
    'pytest', 'git', 'tsc', 'packageManager', 'generic', 'readOutline', 'grepCap', 'proseStrip', 'systemPrompt',
  ]);
  assert.ok(state.modes.filter((mode) => mode.id !== 'systemPrompt').every((mode) => mode.on === true));
  assert.equal(state.modes.find((mode) => mode.id === 'systemPrompt').on, false);
  assert.equal(state.proseScope, 'filtered');
  assert.deepEqual(state.scopes, ['off', 'filtered', 'all']);
  assert.deepEqual(state.systemPrompt, { segments: [] });
  assert.equal(state.cumulative.savedChars, 0);
});

test('turning pytest off lets its output through unfiltered', async () => {
  const { listeners, routes } = mount({ minChars: 10 });
  const response = fakeResponse();
  await routes.get('/dsh-oh-my-token/state').handler(
    postReq({ modes: { pytest: false, generic: false } }),
    response,
  );
  assert.equal(response.status, 200);
  const handler = listeners.get('tools/post-execute');
  const decision = await handler(pytest, { isError: false }, async () => accept(text(PYTEST_BODY)));
  assert.equal(decision.content[0].text, PYTEST_BODY);
});

test('a bad switch patch is rejected with 400', async () => {
  const { routes } = mount({});
  const response = fakeResponse();
  await routes.get('/dsh-oh-my-token/state').handler(
    postReq({ modes: { nonsense: true } }),
    response,
  );
  assert.equal(response.status, 400);
  assert.match(response.json().error, /no valid switch values/);
});

test('an unknown method is refused', async () => {
  const { routes } = mount({});
  const response = fakeResponse();
  await routes.get('/dsh-oh-my-token/state').handler({ method: 'PUT' }, response);
  assert.equal(response.status, 405);
});

test('stats report what was removed, per tool', async () => {
  const { listeners, routes } = mount({ minChars: 10 });
  const handler = listeners.get('tools/post-execute');
  await handler(pytest, { isError: false }, async () => accept(text(PYTEST_BODY)));
  const response = fakeResponse();
  await routes.get('/dsh-oh-my-token/stats').handler({ method: 'GET' }, response);
  const stats = response.json();
  assert.equal(stats.session.calls, 1);
  assert.equal(stats.session.rewritten, 1);
  assert.ok(stats.session.savedChars > 0);
  assert.equal(stats.session.tools[0].tool, 'bash');
});

test('resetting the cumulative record empties it', async () => {
  const { routes } = mount({});
  const response = fakeResponse();
  await routes.get('/dsh-oh-my-token/stats').handler(
    postReq({ reset: true }),
    response,
  );
  assert.equal(response.status, 200);
  assert.equal(response.json().cumulative.savedChars, 0);
});

test('switch choices are persisted to the profile directory', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'oh-my-token-'));
  const { routes } = mount({}, { profileDir: dir });
  const response = fakeResponse();
  await routes.get('/dsh-oh-my-token/state').handler(
    postReq({ modes: { git: false }, proseScope: 'all' }),
    response,
  );
  assert.equal(response.status, 200);
  const written = JSON.parse(readFileSync(join(dir, 'dsh-oh-my-token.state.json'), 'utf8'));
  assert.equal(written.modes.git, false);
  assert.equal(written.proseScope, 'all');
  const reloaded = mount({}, { profileDir: dir });
  const state = fakeResponse();
  await reloaded.routes.get('/dsh-oh-my-token/state').handler({ method: 'GET' }, state);
  assert.equal(state.json().modes.find((mode) => mode.id === 'git').on, false);
  assert.equal(state.json().proseScope, 'all');
});

test('agent/pre-step strips claimed prompts and records the savings', async () => {
  const { listeners, routes } = mount({});
  const claim = { id: 'u1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Hello.' }] };
  const context = { id: 'u2', role: 'user', source: { kind: 'runtime-context' }, content: [{ type: 'text', text: 'Rules.' }] };
  const decision = await listeners.get('agent/pre-step')(
    { messages: [claim] },
    async () => ({ kind: 'enter', messages: [claim, context] }),
  );
  assert.equal(decision.kind, 'enter');
  assert.equal(decision.messages[0].content[0].text, 'Hello');
  assert.equal(decision.messages[1], context);
  const response = fakeResponse();
  await routes.get('/dsh-oh-my-token/stats').handler({ method: 'GET' }, response);
  assert.equal(response.json().session.messages, 1);
  assert.equal(response.json().session.savedChars, 1);
});

test('agent/pre-step wraps deriveMessages so past history is stripped for the model', async () => {
  const { listeners, routes } = mount({});
  const history = [
    { id: 'h1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Old question.' }] },
    { id: 'h2', role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text: 'Old answer.' }] },
  ];
  const session = { deriveMessages: () => history };
  const claim = { id: 'u1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'New.' }] };
  await listeners.get('agent/pre-step')(
    { agent: { session }, messages: [claim] },
    async () => ({ kind: 'enter', messages: [claim] }),
  );

  const derived = session.deriveMessages();
  assert.equal(derived[0].content[0].text, 'Old question');
  assert.equal(derived[1].content[0].text, 'Old answer');
  assert.equal(history[0].content[0].text, 'Old question.', 'the durable record is untouched');

  const response = fakeResponse();
  await routes.get('/dsh-oh-my-token/stats').handler({ method: 'GET' }, response);
  // The new claim plus the two old turns.
  assert.equal(response.json().session.messages, 3);
  // The same history is re-derived on every step; it must not be counted twice.
  session.deriveMessages();
  await routes.get('/dsh-oh-my-token/stats').handler({ method: 'GET' }, response);
  assert.equal(response.json().session.messages, 3);
});

test('turning proseStrip off leaves chat text untouched', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'oh-my-token-'));
  const { routes, listeners } = mount({}, { profileDir: dir });
  const off = fakeResponse();
  await routes.get('/dsh-oh-my-token/state').handler(postReq({ modes: { proseStrip: false } }), off);
  const claim = { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Hello.' }] };
  const decision = await listeners.get('agent/pre-step')(
    { messages: [claim] },
    async () => ({ kind: 'enter', messages: [claim] }),
  );
  assert.equal(decision.messages[0], claim);
});

test('llm/stream strips the reply block-end and records the savings', async () => {
  const { listeners, routes } = mount({});
  const chunks = [
    { type: 'text-delta', index: 0, text: 'Reply.' },
    { type: 'block-end', index: 0, block: { type: 'text', text: 'All set.' } },
  ];
  const stream = (async function* () { yield* chunks; })();
  const wrapped = listeners.get('llm/stream')({}, () => stream);
  const out = [];
  for await (const chunk of wrapped) out.push(chunk);
  assert.equal(out[0], chunks[0]);
  assert.equal(out[1].block.text, 'All set');
  const response = fakeResponse();
  await routes.get('/dsh-oh-my-token/stats').handler({ method: 'GET' }, response);
  assert.equal(response.json().session.messages, 1);
  assert.equal(response.json().session.savedChars, 1);
});

test('system-prompt/assemble appends the segments in order once the switch is on', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'oh-my-token-'));
  const { listeners, routes } = mount({}, { profileDir: dir });
  const handler = listeners.get('system-prompt/assemble');
  const assembly = { sections: [{ name: 'persona', text: 'Be brief.' }], contexts: [], variables: {} };
  const assembled = (input) => handler(input, {}, async () => input);

  assert.equal(await assembled(assembly), assembly, 'off by default');
  const response = fakeResponse();
  await routes.get('/dsh-oh-my-token/state').handler(postReq({
    modes: { systemPrompt: true },
    systemPrompt: { segments: [{ id: 'a', text: 'First.' }, { text: 'Second.' }] },
  }), response);
  assert.equal(response.status, 200);

  const appended = await assembled(assembly);
  assert.equal(appended.sections.length, 3);
  assert.equal(appended.sections[1].text, 'First.');
  assert.equal(appended.sections[2].text, 'Second.');
  assert.ok(appended.sections[1].order < appended.sections[2].order);
  assert.equal(appended.sections[1].interpolate, false);

  const written = JSON.parse(readFileSync(join(dir, 'dsh-oh-my-token.state.json'), 'utf8'));
  assert.deepEqual(written.systemPrompt, { segments: [{ id: 'a', text: 'First.' }, { text: 'Second.' }] });
});

test('an empty patch is rejected when it carries no systemPrompt either', async () => {
  const { routes } = mount({});
  const response = fakeResponse();
  await routes.get('/dsh-oh-my-token/state').handler(postReq({ modes: {} }), response);
  assert.equal(response.status, 400);
});

test('the prompt route live-assembles the current prompt for restore', async () => {
  const systemPrompt = {
    assemble: async (context) => {
      assert.equal(context?.preview, true, 'restore assembly is marked preview');
      return {
        sections: [{ name: 'a', text: 'Default prompt.', interpolate: true }],
        contexts: [],
        variables: {},
      };
    },
  };
  const { routes } = mount({}, { services: { systemPrompt } });
  const response = fakeResponse();
  await routes.get('/dsh-oh-my-token/prompt').handler({ method: 'GET' }, response);
  assert.equal(response.status, 200);
  const body = response.json();
  assert.equal(body.prompt, 'Default prompt.');
  assert.equal(body.source, 'live');
  assert.equal(body.capturedAt, null);
});

test('the prompt route stays quiet when the services are missing', async () => {
  const { routes } = mount({});
  const response = fakeResponse();
  await routes.get('/dsh-oh-my-token/prompt').handler({ method: 'GET' }, response);
  assert.equal(response.status, 200);
  assert.deepEqual(response.json(), { prompt: '', capturedAt: null, source: 'empty' });
});

test('the system-prompt/assemble listener skips its edit for preview assemblies', async () => {
  const { listeners, routes } = mount({});
  const handler = listeners.get('system-prompt/assemble');
  const assembly = { sections: [{ name: 'persona', text: 'Be brief.' }], contexts: [], variables: {} };
  await routes.get('/dsh-oh-my-token/state').handler(postReq({
    modes: { systemPrompt: true },
    systemPrompt: { segments: [{ text: 'Only this.' }] },
  }), fakeResponse());
  assert.equal(await handler(assembly, { preview: true }, async () => assembly), assembly);
  const appended = await handler(assembly, {}, async () => assembly);
  assert.equal(appended.sections.length, 2);
  assert.equal(appended.sections[1].text, 'Only this.');
});
