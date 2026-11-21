/**
 * Session-log profiler: what the prompt actually spends tokens on.
 *
 * The plugin's claim is measurable, so it ships the measurement. This reads the
 * Harness session log (`session*.jsonl`, optionally zstd-compressed) and buckets
 * characters by event type; it never runs inside the agent loop.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import zlib from 'node:zlib';import { join } from 'node:path';
import { CHARS_PER_TOKEN } from './text.js';

const BUCKETS = ['user/message', 'assistant/message', 'tool/call', 'tool/result', 'other'];

/** Read a log file, inflating a single zstd frame when that is what it is. */
function readLog(path) {
  const bytes = readFileSync(path);
  if (!path.endsWith('.zstd') && !path.endsWith('.zst')) return bytes.toString('utf8');
  const inflate = zlib.zstdDecompressSync;
  if (typeof inflate !== 'function') {
    throw new Error(`${path}: this Node has no zstd support; pass the plain .jsonl instead`);
  }
  try {
    return inflate(bytes).toString('utf8');
  } catch (error) {
    throw new Error(`${path}: zstd decompression failed (${String(error)}); pass the plain .jsonl instead`);
  }
}

/** Longest text carried by one message or result. */
function lengthOf(event) {
  const data = event?.data ?? {};
  const blocks = data.message?.content
    ?? data.result?.content
    ?? data.content;
  if (Array.isArray(blocks)) {
    return blocks.reduce((sum, block) => sum + (typeof block?.text === 'string' ? block.text.length : 0), 0);
  }
  const text = data.text ?? data.message?.text;
  return typeof text === 'string' ? text.length : 0;
}

/** The tool name a `tool/result` event answers, when the log recorded it. */
function toolNameOf(event) {
  return event?.data?.name ?? event?.data?.toolName ?? event?.data?.message?.toolName;
}

/**
 * Parse a session log and bucket it.
 * @param {string} text - the log contents.
 * @returns {{ total: number, buckets: Record<string, number>, tools: Array<{ name: string, chars: number, calls: number }>, largest: Array<{ seq: number, name: string, chars: number }> }}
 */
export function profileLog(text) {
  const buckets = Object.fromEntries(BUCKETS.map((bucket) => [bucket, 0]));
  const tools = new Map();
  const largest = [];
  let total = 0;

  for (const line of String(text).split('\n')) {
    if (line.trim() === '') continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const type = typeof event?.type === 'string' ? event.type : 'other';
    const chars = lengthOf(event);
    if (chars === 0) continue;
    const bucket = BUCKETS.includes(type) ? type : 'other';
    buckets[bucket] += chars;
    total += chars;

    if (bucket === 'tool/result') {
      const name = toolNameOf(event) ?? 'unknown';
      const entry = tools.get(name) ?? { name, chars: 0, calls: 0 };
      entry.chars += chars;
      entry.calls += 1;
      tools.set(name, entry);
      largest.push({ seq: event.seq ?? -1, name, chars });
    }
  }

  largest.sort((a, b) => b.chars - a.chars);
  return {
    total,
    buckets,
    tools: [...tools.values()].sort((a, b) => b.chars - a.chars),
    largest: largest.slice(0, 20),
  };
}

/** Every `session*.jsonl` under a directory, shallow. */
export function findLogs(root) {
  if (!existsSync(root)) return [];
  const out = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    let info;
    try {
      info = statSync(path);
    } catch {
      continue;
    }
    if (info.isFile() && /^session.*\.jsonl(\.zstd|\.zst)?$/.test(name)) out.push(path);
    else if (info.isDirectory()) {
      for (const inner of readdirSync(path)) {
        if (/^session.*\.jsonl(\.zstd|\.zst)?$/.test(inner)) out.push(join(path, inner));
      }
    }
  }
  return out;
}

/** Render the profile as a human report. */
export function renderProfile(profile, label) {
  const lines = [];
  const tokens = Math.ceil(profile.total / CHARS_PER_TOKEN);
  lines.push(`${label}: ${profile.total} chars ≈ ${tokens} tokens`);
  lines.push('');
  for (const bucket of BUCKETS) {
    const chars = profile.buckets[bucket];
    if (chars === 0) continue;
    const share = profile.total === 0 ? 0 : (100 * chars / profile.total).toFixed(1);
    lines.push(`  ${bucket.padEnd(12)} ${String(chars).padStart(10)}  ${share.padStart(5)}%`);
  }
  if (profile.tools.length > 0) {
    lines.push('');
    lines.push('tool results by tool:');
    for (const tool of profile.tools.slice(0, 20)) {
      lines.push(`  ${tool.name.padEnd(20)} ${String(tool.chars).padStart(10)}  ${tool.calls} call(s)`);
    }
  }
  if (profile.largest.length > 0) {
    lines.push('');
    lines.push('largest single results:');
    for (const item of profile.largest) {
      lines.push(`  seq ${String(item.seq).padStart(6)}  ${item.name.padEnd(20)} ${item.chars}`);
    }
  }
  return lines.join('\n');
}

export { readLog };
