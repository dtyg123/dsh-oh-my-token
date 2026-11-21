import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  STATS_FILE, emptyStats, readStats, recordCall, recordMessageStrip, recordRewrite, summarize, writeStats,
} from '../lib/stats.js';

test('an empty record summarizes to zeroes, not NaN', () => {
  const summary = summarize(emptyStats());
  assert.equal(summary.savedChars, 0);
  assert.equal(summary.savedTokens, 0);
  assert.equal(summary.savedRatio, 0);
  assert.deepEqual(summary.tools, []);
});

test('rewrites accumulate per tool and keep calls that changed nothing', () => {
  const stats = emptyStats();
  recordCall(stats, 'bash');
  recordRewrite(stats, 'bash', 1000, 400);
  recordCall(stats, 'read');
  const summary = summarize(stats);
  assert.equal(summary.calls, 2);
  assert.equal(summary.rewritten, 1);
  assert.equal(summary.before, 1000);
  assert.equal(summary.after, 400);
  assert.equal(summary.savedChars, 600);
  // 4 characters per token, the Harness estimate.
  assert.equal(summary.savedTokens, 150);
  assert.equal(summary.savedRatio.toFixed(1), '0.6');
  assert.deepEqual(summary.tools.map((row) => row.tool), ['bash']);
});

test('message strips count toward the same savings without a tool row', () => {
  const stats = emptyStats();
  recordMessageStrip(stats, 9, 7);
  recordMessageStrip(stats, 21, 19);
  const summary = summarize(stats);
  assert.equal(summary.messages, 2);
  assert.equal(summary.rewritten, 2);
  assert.equal(summary.savedChars, 4);
  assert.equal(summary.savedTokens, 1);
  assert.deepEqual(summary.tools, []);
});

test('tools with no saving are not listed', () => {
  const stats = emptyStats();
  recordCall(stats, 'read');
  assert.deepEqual(summarize(stats).tools, []);
});

test('the cumulative record round-trips', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oh-my-token-stats-'));
  assert.deepEqual(readStats(dir), emptyStats());
  const stats = emptyStats();
  recordCall(stats, 'bash');
  recordRewrite(stats, 'bash', 800, 300);
  assert.equal(writeStats(dir, stats), join(dir, STATS_FILE));
  assert.deepEqual(readStats(dir), stats);
});

test('a corrupt or foreign record is discarded', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oh-my-token-stats-'));
  writeFileSync(join(dir, STATS_FILE), 'not json');
  assert.deepEqual(readStats(dir), emptyStats());
  writeFileSync(join(dir, STATS_FILE), JSON.stringify({ version: 2, calls: 99 }));
  assert.deepEqual(readStats(dir), emptyStats());
});
