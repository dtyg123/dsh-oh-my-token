/**
 * What the plugin saved, measured at the only place the number is exact: the
 * bytes it removed before they were logged.
 *
 * Two records are kept — this process and everything before it — so the page
 * can show "fresh install, nothing yet" separately from "this has been running
 * for a month".
 *
 * @module dsh-oh-my-token/stats
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CHARS_PER_TOKEN } from './text.js';

/** Name of the cumulative record inside the profile directory. */
export const STATS_FILE = 'dsh-oh-my-token.stats.json';

/** A fresh record. */
export function emptyStats() {
  return { calls: 0, rewritten: 0, before: 0, after: 0, messages: 0, byTool: {} };
}

/** Count one inspected result. */
export function recordCall(stats, tool) {
  stats.calls += 1;
  const row = stats.byTool[tool] ?? (stats.byTool[tool] = { calls: 0, rewritten: 0, before: 0, after: 0 });
  row.calls += 1;
}

/** Count one result that actually got smaller. */
export function recordRewrite(stats, tool, before, after) {
  stats.rewritten += 1;
  stats.before += before;
  stats.after += after;
  const row = stats.byTool[tool] ?? (stats.byTool[tool] = { calls: 0, rewritten: 0, before: 0, after: 0 });
  row.rewritten += 1;
  row.before += before;
  row.after += after;
}

/** Count one chat message or reply whose text got smaller. */
export function recordMessageStrip(stats, before, after) {
  stats.messages += 1;
  stats.rewritten += 1;
  stats.before += before;
  stats.after += after;
}

const ratio = (after, before) => (before === 0 ? 0 : 1 - after / before);
// Ceil so a sub-token saving (e.g. one period) still reads as 1 token.
const tokens = (chars) => Math.ceil(chars / CHARS_PER_TOKEN);

/**
 * Render one record for the page.
 * @param {ReturnType<typeof emptyStats>} stats
 */
export function summarize(stats) {
  const savedChars = stats.before - stats.after;
  return {
    calls: stats.calls,
    rewritten: stats.rewritten,
    messages: stats.messages,
    before: stats.before,
    after: stats.after,
    savedChars,
    savedTokens: tokens(savedChars),
    savedRatio: ratio(stats.after, stats.before),
    tools: Object.entries(stats.byTool)
      .map(([tool, row]) => ({
        tool,
        calls: row.calls,
        rewritten: row.rewritten,
        savedChars: row.before - row.after,
        savedTokens: tokens(row.before - row.after),
        savedRatio: ratio(row.after, row.before),
      }))
      .filter((row) => row.savedChars > 0)
      .sort((a, b) => b.savedChars - a.savedChars),
  };
}

/**
 * Read the cumulative record, discarding anything malformed.
 * @param {string | undefined} dir
 */
export function readStats(dir) {
  if (dir === undefined) return emptyStats();
  try {
    const path = join(dir, STATS_FILE);
    if (!existsSync(path)) return emptyStats();
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (parsed?.version !== 1) return emptyStats();
    const stats = emptyStats();
    for (const key of ['calls', 'rewritten', 'before', 'after', 'messages']) {
      const value = parsed[key];
      stats[key] = Number.isFinite(value) && value >= 0 ? value : 0;
    }
    if (typeof parsed.byTool === 'object' && parsed.byTool !== null) {
      for (const [tool, row] of Object.entries(parsed.byTool)) {
        if (row === null || typeof row !== 'object') continue;
        stats.byTool[tool] = {
          calls: Number.isFinite(row.calls) && row.calls >= 0 ? row.calls : 0,
          rewritten: Number.isFinite(row.rewritten) && row.rewritten >= 0 ? row.rewritten : 0,
          before: Number.isFinite(row.before) && row.before >= 0 ? row.before : 0,
          after: Number.isFinite(row.after) && row.after >= 0 ? row.after : 0,
        };
      }
    }
    return stats;
  } catch {
    return emptyStats();
  }
}

/**
 * Persist the cumulative record atomically.
 * @param {string | undefined} dir
 * @param {ReturnType<typeof emptyStats>} stats
 * @returns {string | undefined} the path written.
 */
export function writeStats(dir, stats) {
  if (dir === undefined) return undefined;
  const path = join(dir, STATS_FILE);
  const temporary = `${path}.tmp`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(temporary, `${JSON.stringify({ version: 1, ...stats }, null, 2)}\n`);
  renameSync(temporary, path);
  return path;
}
