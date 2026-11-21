import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findLogs, profileLog, renderProfile } from '../lib/report.js';

const LOG = [
  { seq: 1, type: 'user/message', data: { message: { content: [{ type: 'text', text: 'x'.repeat(100) }] } } },
  { seq: 2, type: 'tool/call', data: { name: 'bash', arguments: { command: 'ls' } } },
  { seq: 3, type: 'tool/result', data: { name: 'bash', message: { content: [{ type: 'text', text: 'y'.repeat(900) }] } } },
  { seq: 4, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'z'.repeat(50) }] } } },
  { seq: 5, type: 'tool/result', data: { name: 'read', message: { content: [{ type: 'text', text: 'w'.repeat(300) }] } } },
].map((event) => JSON.stringify(event)).join('\n');

test('profileLog buckets by event type and tool', () => {
  const profile = profileLog(LOG);
  assert.equal(profile.total, 1350);
  assert.equal(profile.buckets['tool/result'], 1200);
  assert.equal(profile.buckets['user/message'], 100);
  assert.equal(profile.buckets['assistant/message'], 50);
  assert.equal(profile.buckets['tool/call'], 0);
  assert.deepEqual(profile.tools.map((tool) => [tool.name, tool.chars, tool.calls]), [
    ['bash', 900, 1],
    ['read', 300, 1],
  ]);
  assert.deepEqual(profile.largest[0], { seq: 3, name: 'bash', chars: 900 });
});

test('profileLog survives a malformed line', () => {
  assert.equal(profileLog(`not json\n${LOG}`).total, 1350);
});

test('renderProfile names the buckets it measured', () => {
  const out = renderProfile(profileLog(LOG), 'session.jsonl');
  assert.ok(out.includes('session.jsonl: 1350 chars'));
  assert.ok(out.includes('tool/result'));
  assert.ok(out.includes('bash'));
});

test('findLogs picks up session logs one level deep', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-oh-my-token-'));
  writeFileSync(join(dir, 'session.jsonl'), LOG);
  writeFileSync(join(dir, 'notes.txt'), 'x');
  assert.equal(findLogs(dir).length, 1);
});
