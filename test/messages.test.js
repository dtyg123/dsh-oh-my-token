import test from 'node:test';
import assert from 'node:assert/strict';
import {
  stripAssistantStream, stripClaimedMessages, stripHistoryMessages, stripUserMessage,
} from '../lib/messages.js';

const userMessage = (text, extra = {}) => ({
  id: 'm1',
  role: 'user',
  source: { kind: 'user' },
  content: [{ type: 'text', text }],
  ...extra,
});

const collect = async (chunks) => {
  const out = [];
  for await (const chunk of chunks) out.push(chunk);
  return out;
};

test('a user prompt loses only its prose-line trailing periods', () => {
  const msg = userMessage('Please fix the bug.\nThen ship it.\n');
  const stripped = stripUserMessage(msg);
  assert.notEqual(stripped, msg, 'messages are frozen, so a copy is returned');
  assert.equal(stripped.id, msg.id);
  assert.equal(stripped.role, msg.role);
  assert.equal(stripped.source, msg.source);
  assert.equal(stripped.content[0].text, 'fix the bug\nThen ship it\n');
  // The original is untouched.
  assert.equal(msg.content[0].text, 'Please fix the bug.\nThen ship it.\n');
});

test('politeness and punctuation can be disabled independently', () => {
  const msg = userMessage('谢谢，请稍等。');
  assert.equal(stripUserMessage(msg, undefined, { politeness: false }).content[0].text, '谢谢，请稍等');
  assert.equal(stripUserMessage(msg, undefined, { punctuation: false }).content[0].text, '稍等。');
  assert.equal(stripUserMessage(msg, undefined, { politeness: false, punctuation: false }), msg);
});

test('a filename or code-like line keeps its period', () => {
  const msg = userMessage('Edit main.js.');
  assert.equal(stripUserMessage(msg), msg, 'the filename guard rejects the line');
});

test('non-text blocks and identifiers survive stripping', () => {
  const image = { type: 'image', data: 'abc' };
  const msg = userMessage('Looks good.', { content: [image, { type: 'text', text: 'Ship it.' }] });
  const stripped = stripUserMessage(msg);
  assert.equal(stripped.content[0], image, 'other block types keep identity');
  assert.equal(stripped.content[1].text, 'Ship it');
});

test('only genuine user prompts are touched', () => {
  const ctx = { role: 'user', source: { kind: 'runtime-context' }, content: [{ type: 'text', text: 'Context.' }] };
  const assistant = { role: 'assistant', content: [{ type: 'text', text: 'Hi.' }] };
  assert.equal(stripUserMessage(ctx), ctx);
  assert.equal(stripUserMessage(assistant), assistant);
  assert.equal(stripUserMessage(null), null);
});

test('no change means the original object is returned', () => {
  const msg = userMessage('no trailing mark');
  assert.equal(stripUserMessage(msg), msg);
});

test('strip accounting reports the characters removed', () => {
  const calls = [];
  stripUserMessage(userMessage('One. Two.'), (_id, before, after) => calls.push([before, after]));
  // One sentence-final period per line: 'One. Two.' -> 'One. Two'.
  assert.deepEqual(calls, [[9, 8]]);
});

test('claim stripping leaves injected context by identity', () => {
  const claimed = [userMessage('Hello.')];
  const injected = { role: 'user', source: { kind: 'runtime-context' }, content: [{ type: 'text', text: 'Rules.' }] };
  const decision = [claimed[0], injected];
  const out = stripClaimedMessages(decision, claimed);
  assert.notEqual(out, decision);
  assert.notEqual(out[0], claimed[0]);
  assert.equal(out[1], injected);
  assert.equal(out[0].content[0].text, 'Hello');
});

test('claim stripping is a no-op without claimed messages', () => {
  const decision = [userMessage('Hello.')];
  assert.equal(stripClaimedMessages(decision, undefined), decision);
});

test('history stripping covers past user and assistant messages only', () => {
  const oldUser = userMessage('Old question.');
  const oldReply = {
    id: 'a1', role: 'assistant', source: { kind: 'model' },
    content: [{ type: 'text', text: 'Old answer.\nAnother line.' }],
  };
  const system = { id: 's1', role: 'system', content: [{ type: 'text', text: 'Be brief.' }] };
  const tool = { id: 't1', role: 'user', source: { kind: 'tool' }, content: [{ type: 'text', text: 'done.' }] };
  const calls = [];
  const out = stripHistoryMessages([oldUser, oldReply, system, tool], (...args) => calls.push(args));

  assert.equal(out[0].content[0].text, 'Old question');
  assert.equal(out[1].content[0].text, 'Old answer\nAnother line');
  assert.equal(out[2], system, 'system messages keep identity');
  assert.equal(out[3], tool, 'tool results keep identity');
  assert.equal(oldUser.content[0].text, 'Old question.', 'source message is untouched');
  assert.deepEqual(calls.map((call) => call.slice(1)), [[13, 12], [25, 23]]);
});

test('history stripping is a no-op when nothing ends in a prose period', () => {
  const history = [{ id: 'a', role: 'assistant', content: [{ type: 'text', text: 'no mark' }] }];
  assert.equal(stripHistoryMessages(history), history);
});

test('the stream transform rewrites text block-end chunks and counts savings', async () => {
  const delta = { type: 'text-delta', index: 0, text: 'Done.' };
  const blockEnd = { type: 'block-end', index: 0, block: { type: 'text', text: 'All done.\nNext step.' } };
  const usage = { type: 'usage', usage: { inputTokens: 1 } };
  const chunks = [delta, blockEnd, usage];
  const calls = [];

  const out = await collect(stripAssistantStream((async function* () { yield* chunks; })(), (_id, a, b) => calls.push([a, b])));

  assert.equal(out[0], delta, 'deltas pass through by identity');
  assert.equal(out[1].index, 0);
  assert.equal(out[1].block.text, 'All done\nNext step');
  assert.notEqual(out[1], blockEnd, 'a rewritten chunk is a copy');
  assert.equal(out[2], usage);
  assert.deepEqual(calls, [[20, 18]]);
});

test('the stream transform skips non-text block-end and untouched text', async () => {
  const toolEnd = { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'c', name: 'x', arguments: '{}' } };
  const plain = { type: 'block-end', index: 1, block: { type: 'text', text: 'no mark' } };
  const out = await collect(stripAssistantStream((async function* () { yield toolEnd; yield plain; })()));
  assert.equal(out[0], toolEnd);
  assert.equal(out[1], plain);
});

/** A long `ls -la` tool result, which the RTK filter recognises. */
function toolBody() {
  const rows = ['total 40', 'drwxr-xr-x 2 user group 4096 Jan 10 10:00 src'];
  for (let i = 0; i < 30; i += 1) rows.push(`-rw-r--r-- 1 user group ${1000 + i} Jan 10 10:00 file${i}.ts`);
  return rows.join('\n');
}

test('old tool results are compacted on the derived copy only', () => {
  const tool = { id: 't1', role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: toolBody() }] };
  const calls = [];
  const out = stripHistoryMessages([tool], (...args) => calls.push(args), { rtk: true, prose: false });
  assert.notEqual(out[0], tool);
  assert.ok(out[0].content[0].text.includes('Summary:'));
  assert.ok(tool.content[0].text.includes('total 40'), 'the durable record is untouched');
  assert.equal(calls.length, 1);
});

test('tool results are left alone when RTK is off', () => {
  const tool = { id: 't1', role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: toolBody() }] };
  assert.equal(stripHistoryMessages([tool], undefined, { rtk: false })[0], tool);
});
