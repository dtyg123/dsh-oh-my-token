#!/usr/bin/env node
/**
 * `dsh-oh-my-token` command line: measure before and after, and inspect what the
 * plugin will do to a file.
 *
 * The plugin itself never runs this; it is for the human deciding whether the
 * budgets are right.
 *
 *   dsh-oh-my-token report [dir|file]   bucket a session log by event type and tool
 *   dsh-oh-my-token map <file|dir>      print the symbol outline `read` would get
 *   dsh-oh-my-token lint [config.json]  validate a row config without starting DSH
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { resolveConfig } from '../lib/config.js';
import { extractSymbols, languageOf } from '../lib/retrieval.js';
import { countLines } from '../lib/text.js';
import { findLogs, profileLog, readLog, renderProfile } from '../lib/report.js';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'lib', 'build', 'coverage', '.dsh-oh-my-token']);
const CODE_FILE = /\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|cs|c|h|cpp|hpp|rb|php|sh|ps1)$/i;

function usage() {
  return [
    'dsh-oh-my-token <command>',
    '',
    '  report [dir|file]   bucket a session log (default: $DSH_HOME, ~/.dsh, ./.dsh)',
    '  map <file|dir>      symbol outline of a file, or of every code file under a dir',
    '  lint [config.json]  validate a config mapping (reads stdin when no file is given)',
    '',
    'Nothing here is needed at runtime; the plugin only registers a',
    '`tools/post-execute` listener.',
  ].join('\n');
}

/** Candidate log roots when the caller gives none. */
function defaultRoots() {
  const roots = [];
  if (process.env.DSH_HOME) roots.push(process.env.DSH_HOME);
  roots.push(join(homedir(), '.dsh'), join(process.cwd(), '.dsh'));
  return roots.filter((root) => existsSync(root));
}

function cmdReport(args) {
  const target = args[0];
  if (target !== undefined) {
    const path = resolve(target);
    if (!existsSync(path)) throw new Error(`${path} does not exist`);
    const logs = statSync(path).isDirectory() ? findLogs(path) : [path];
    if (logs.length === 0) throw new Error(`no session*.jsonl under ${path}`);
    for (const log of logs) process.stdout.write(`${renderProfile(profileLog(readLog(log)), log)}\n\n`);
    return;
  }
  const logs = defaultRoots().flatMap(findLogs);
  if (logs.length === 0) {
    process.stdout.write(
      'No session logs found. Pass the path explicitly:\n'
      + '  dsh-oh-my-token report <profile-dir-or-session.jsonl>\n',
    );
    return;
  }
  for (const log of logs) process.stdout.write(`${renderProfile(profileLog(readLog(log)), log)}\n\n`);
}

/** Walk a directory for code files, skipping build output and VCS data. */
function* walk(dir, depth = 0) {
  if (depth > 6) return;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    let info;
    try {
      info = statSync(path);
    } catch {
      continue;
    }
    if (info.isDirectory()) yield* walk(path, depth + 1);
    else if (CODE_FILE.test(name) && info.size < 1024 * 1024) yield path;
  }
}

function outlineFile(path) {
  const text = readFileSync(path, 'utf8');
  const lines = text.split('\n');
  const symbols = extractSymbols(lines, languageOf(path));
  const head = `${path}  ${countLines(text)} lines, ${symbols.length} symbol(s)`;
  if (symbols.length === 0) return head;
  return [head, ...symbols.slice(0, 40).map((symbol) => `  ${symbol.line}: ${symbol.kind} ${symbol.name}`)].join('\n');
}

function cmdMap(args) {
  const target = args[0];
  if (target === undefined) throw new Error('map needs a file or directory');
  const path = resolve(target);
  if (!existsSync(path)) throw new Error(`${path} does not exist`);
  if (statSync(path).isFile()) {
    process.stdout.write(`${outlineFile(path)}\n`);
    return;
  }
  let files = 0;
  for (const file of walk(path)) {
    files += 1;
    process.stdout.write(`${outlineFile(file)}\n`);
  }
  if (files === 0) throw new Error(`no code files under ${path}`);
}

function cmdLint(args) {
  const source = args[0] === undefined ? readFileSync(0, 'utf8') : readFileSync(resolve(args[0]), 'utf8');
  const parsed = source.trim() === '' ? {} : JSON.parse(source);
  const resolved = resolveConfig(parsed);
  process.stdout.write(`ok\n${JSON.stringify(resolved, null, 2)}\n`);
}

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === undefined || command === '-h' || command === '--help' || command === 'help') {
    process.stdout.write(`${usage()}\n`);
  } else if (command === 'report') cmdReport(rest);
  else if (command === 'map') cmdMap(rest);
  else if (command === 'lint') cmdLint(rest);
  else {
    process.stderr.write(`dsh-oh-my-token: unknown command "${command}"\n\n${usage()}\n`);
    process.exitCode = 2;
  }
} catch (error) {
  process.stderr.write(`dsh-oh-my-token: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
