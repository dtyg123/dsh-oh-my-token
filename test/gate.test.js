import test from 'node:test';
import assert from 'node:assert/strict';
import { budgetFor, compressToolResult, normalizeDecision, recoveryHint } from '../lib/gate.js';
import { resolveConfig } from '../lib/config.js';

const config = resolveConfig({ minChars: 10, prose: { scope: 'all' } });

/** A context stub: no spill store unless a test installs one. */
function ctxWith(store) {
  const warnings = [];
  return {
    warnings,
    get: (service) => (service === 'spillStore' ? store : undefined),
    logger: { warn: (message) => warnings.push(message) },
  };
}

function exec(name, args = {}) {
  return { name, arguments: args, callId: 'call-1', signal: undefined };
}

const textBlocks = (text) => [{ type: 'text', text }];

test('normalizeDecision repairs a missing waterfall value', () => {
  assert.deepEqual(normalizeDecision(undefined), { kind: 'accept' });
  assert.deepEqual(normalizeDecision({ content: [] }), { kind: 'accept', content: [] });
  assert.deepEqual(normalizeDecision({ kind: 'reject' }), { kind: 'reject' });
});

test('budget increases for errors', () => {
  const resolved = resolveConfig({ budgets: { bash: 1000, errorFactor: 2 } });
  assert.equal(budgetFor(exec('bash'), { isError: false }, resolved), 1000);
  assert.equal(budgetFor(exec('bash'), { isError: true }, resolved), 2000);
  assert.equal(budgetFor(exec('unknown'), { isError: false }, resolved), resolved.budgets.default);
});

test('small results are left alone', async () => {
  const blocks = textBlocks('tiny');
  assert.equal(await compressToolResult(exec('bash'), {}, blocks, config, ctxWith()), undefined);
});

test('a shell result keeps its exit marker after filtering', async () => {
  const body = 'test_a.py ..\n\n===== 42 passed in 1.23s =====\n[exit code: 0]';
  const out = await compressToolResult(exec('bash', { command: 'pytest -q' }), { isError: false }, textBlocks(body), config, ctxWith());
  assert.ok(out !== undefined);
  assert.equal(out[0].text, '✓ 42 passed in 1.23s\n[exit code: 0]');
});

test('a non-text block is carried through untouched', async () => {
  const image = { type: 'image', data: 'abc' };
  const out = await compressToolResult(
    exec('bash', { command: 'pytest' }),
    {},
    [image, ...textBlocks('a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\nm\nn')],
    config,
    ctxWith(),
  );
  assert.equal(out[0], image);
});

test('a large read becomes an outline', async () => {
  const lines = ['<path>src/big.ts</path>'];
  for (let i = 0; i < 500; i += 1) lines.push(`export function f${i}() { return ${i} }`);
  const out = await compressToolResult(
    exec('read', { path: 'src/big.ts' }),
    { isError: false },
    textBlocks(lines.join('\n')),
    resolveConfig({ minChars: 100 }),
    ctxWith(),
  );
  assert.ok(out !== undefined);
  assert.ok(out[0].text.includes('outline only'));
  assert.ok(out[0].text.includes('Re-read src/big.ts'));
});

test('a read under the outline threshold is not outlined', async () => {
  const lines = ['<path>src/small.ts</path>'];
  for (let i = 0; i < 100; i += 1) lines.push(`export function f${i}() { return ${i} }`);
  const out = await compressToolResult(
    exec('read', { path: 'src/small.ts' }),
    { isError: false },
    textBlocks(lines.join('\n')),
    resolveConfig({ minChars: 100, filters: { generic: false } }),
    ctxWith(),
  );
  assert.equal(out, undefined);
});

test('an error read is never outlined', async () => {
  const lines = ['<path>src/big.ts</path>'];
  for (let i = 0; i < 500; i += 1) lines.push(`export function f${i}() { return ${i} }`);
  const blocks = textBlocks(lines.join('\n'));
  const out = await compressToolResult(exec('read'), { isError: true }, blocks, resolveConfig({ minChars: 100 }), ctxWith());
  assert.equal(out, undefined);
});

test('a huge grep is capped', async () => {
  const lines = Array.from({ length: 200 }, (_, i) => `src/f${i}.ts:${i}: match ${i}`);
  const out = await compressToolResult(exec('grep'), { isError: false }, textBlocks(lines.join('\n')), resolveConfig({ minChars: 100 }), ctxWith());
  assert.ok(out !== undefined);
  assert.ok(out[0].text.includes('more matches'));
});

test('prose punctuation is applied to git log output', async () => {
  const log = Array.from({ length: 30 }, (_, i) => `commit ${i} — Fixed the thing number ${i}.`);
  const out = await compressToolResult(
    exec('bash', { command: 'git log --oneline -30' }),
    { isError: false },
    textBlocks(log.join('\n')),
    resolveConfig({ minChars: 10, prose: { scope: 'filtered' }, filters: { generic: false } }),
    ctxWith(),
  );
  assert.ok(out !== undefined);
  assert.ok(out[0].text.includes('Fixed the thing number 0\n'));
  assert.ok(!/\d\.\n/.test(out[0].text));
});

test('an over-budget result elides through the spill store', async () => {
  const saved = [];
  const store = {
    saveText: async (request) => {
      saved.push(request);
      return { locator: 'spill://abc', retrievalHint: 'read it' };
    },
  };
  const blocks = textBlocks(`start\n${'x'.repeat(9000)}\nend`);
  const call = { ...exec('bash', { command: 'node dump.js' }), agent: { session: { header: { id: 'ses-1' } } } };
  const out = await compressToolResult(
    call,
    { isError: false },
    blocks,
    resolveConfig({ minChars: 10, budgets: { bash: 600 }, filters: { generic: false } }),
    ctxWith(store),
  );
  assert.ok(out !== undefined);
  assert.ok(out[0].text.length <= 600, `${out[0].text.length} > 600`);
  assert.ok(out[0].text.includes('spill://abc'));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].owner.sessionId, 'ses-1');
});

test('a failed spill falls back to a re-run hint and still elides', async () => {
  const store = { saveText: async () => { throw new Error('disk full'); } };
  const context = ctxWith(store);
  const blocks = textBlocks(`start\n${'x'.repeat(9000)}\nend`);
  const call = { ...exec('bash', { command: 'node dump.js' }), agent: { session: { header: { id: 'ses-1' } } } };
  const out = await compressToolResult(
    call,
    { isError: false },
    blocks,
    resolveConfig({ minChars: 10, budgets: { bash: 600 }, filters: { generic: false } }),
    context,
  );
  assert.ok(out !== undefined);
  assert.ok(out[0].text.includes('re-run `node dump.js`'));
  assert.equal(context.warnings.length, 1);
});

test('recoveryHint refuses when recovery is none', async () => {
  const resolved = resolveConfig({ recovery: 'none' });
  assert.equal(await recoveryHint(exec('bash', { command: 'x' }), 'text', resolved, ctxWith()), undefined);
});

test('recoveryHint points at a read range even without a spill store', async () => {
  const resolved = resolveConfig({});
  assert.equal(
    await recoveryHint(exec('read'), '<path>a.ts</path>\nx', resolved, ctxWith()),
    're-read a.ts with offset/limit',
  );
});

test('a filter fault leaves the original block in place', async () => {
  const context = ctxWith();
  // A shell exec whose command getter throws: `String(exec.arguments.command)`
  // fails, so the gate must return the untouched blocks.
  const broken = { name: 'bash', get arguments() { throw new Error('nope'); }, callId: 'x' };
  const blocks = textBlocks('x'.repeat(50));
  const out = await compressToolResult(broken, {}, blocks, config, context);
  assert.equal(out, undefined);
  assert.equal(context.warnings.length, 1);
});

/** A realistic `ls -la` body that the command-aware filters do not claim. */
function lsBody() {
  const rows = ['total 40', 'drwxr-xr-x 2 user group 4096 Jan 10 10:00 src'];
  for (let i = 0; i < 30; i += 1) rows.push(`-rw-r--r-- 1 user group ${1000 + i} Jan 10 10:00 file${i}.ts`);
  return rows.join('\n');
}

test('RTK compacts an unclaimed long output when enabled', async () => {
  const out = await compressToolResult(
    exec('bash', { command: 'ls -la' }),
    { isError: false },
    textBlocks(lsBody()),
    resolveConfig({ minChars: 10 }),
    ctxWith(),
  );
  assert.ok(out !== undefined);
  assert.ok(out[0].text.includes('Summary:'));
});

test('RTK is skipped when the switch is off', async () => {
  const out = await compressToolResult(
    exec('bash', { command: 'ls -la' }),
    { isError: false },
    textBlocks(lsBody()),
    resolveConfig({ minChars: 10, rtk: false }),
    ctxWith(),
  );
  assert.equal(out, undefined);
});
