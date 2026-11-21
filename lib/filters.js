/**
 * Command-aware output filters.
 *
 * These are a native reimplementation of the *idea* behind RTK: parse the
 * command the model already ran, then keep the verdict and the failure detail
 * instead of the progress log. No external binary is spawned, no command is
 * rewritten, and anything the parser is not sure about passes through.
 */

import {
  collapseBlankLines,
  collapseRepeatedLines,
  stripProgressLines,
  headLines,
  tailLines,
  countLines,
} from './text.js';

const SHELL_TOOLS = new Set(['bash', 'pwsh', 'shell', 'sh', 'zsh']);
const GIT_SUBCOMMANDS = new Set(['status', 'diff', 'log', 'show']);
const INSTALL_COMMANDS = new Set(['install', 'i', 'add', 'ci', 'update']);

const ENV_ASSIGN = /^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s]+)\s+)+/;
const WRAPPERS = new Set(['sudo', 'time', 'command', 'env', 'nohup', 'nice']);

/** Remove `.exe` / `.cmd` so a Windows command matches its POSIX name. */
function bare(token) {
  return String(token ?? '').replace(/\.(?:exe|cmd|bat|ps1)$/i, '').toLowerCase();
}

/** Split a shell command on `&&`, `||`, `;` and `|`, respecting quotes. */
export function splitSegments(command) {
  const source = String(command ?? '');
  const out = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quote !== null) {
      current += char;
      if (char === quote && source[i - 1] !== '\\') quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if ((char === '&' && source[i + 1] === '&') || (char === '|' && source[i + 1] === '|')) {
      if (current.trim() !== '') out.push(current.trim());
      current = '';
      i += 1;
      continue;
    }
    if (char === ';' || char === '|') {
      if (current.trim() !== '') out.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim() !== '') out.push(current.trim());
  return out;
}

/** Tokenize one segment, keeping quoted strings as single tokens. */
export function tokenize(segment) {
  const tokens = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = pattern.exec(String(segment))) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  return tokens;
}

/** Drop known runner prefixes such as `npx`, `pnpm exec`, `uv run`. */
export function stripRunner(tokens) {
  const out = [...tokens];
  for (let i = 0; i < 8; i += 1) {
    const first = bare(out[0]);
    if (first === 'npx' || first === 'bunx') {
      out.shift();
      while (out[0]?.startsWith('-')) out.shift();
      continue;
    }
    if (first === 'pnpm' && ['exec', 'dlx'].includes(bare(out[1]))) {
      out.splice(0, 2);
      while (out[0] === '--') out.shift();
      continue;
    }
    if (first === 'yarn' && bare(out[1]) === 'exec') {
      out.splice(0, 2);
      continue;
    }
    if ((first === 'uv' || first === 'poetry' || first === 'pipenv') && bare(out[1]) === 'run') {
      out.splice(0, 2);
      continue;
    }
    break;
  }
  return out;
}

/**
 * Parse a command into segments and a token view with wrappers removed.
 * @param {string} command
 */
export function parseCommand(command) {
  let rest = String(command ?? '').trim();
  for (let i = 0; i < 8; i += 1) {
    const before = rest;
    rest = rest.replace(ENV_ASSIGN, '');
    const wrapper = rest.match(/^(\S+)\s+/);
    if (wrapper !== null && WRAPPERS.has(bare(wrapper[1]))) {
      rest = rest.slice(wrapper[0].length).replace(/^(?:-\S+\s+)+/, '');
    }
    if (rest === before) break;
  }
  const segments = splitSegments(rest);
  return {
    raw: String(command ?? ''),
    command: rest,
    segments,
    tokenSegments: segments.map((segment) => stripRunner(tokenize(segment))),
  };
}

function matchPytest(tokens) {
  const first = bare(tokens[0]);
  if (first === 'pytest' || first === 'py.test') return true;
  return /^python(?:\d+(?:\.\d+)?)?$/.test(first)
    && tokens.some((token, index) => token === '-m' && bare(tokens[index + 1]) === 'pytest');
}

function gitSubcommand(tokens) {
  if (bare(tokens[0]) !== 'git') return undefined;
  return tokens.slice(1).map(bare).find((token) => GIT_SUBCOMMANDS.has(token));
}

function matchTsc(tokens) {
  const first = bare(tokens[0]);
  return first === 'tsc' || first === 'typescript';
}

function matchPackageManager(tokens) {
  const first = bare(tokens[0]);
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(first)) {
    return tokens.slice(1).map(bare).some((token) => INSTALL_COMMANDS.has(token));
  }
  if (['pip', 'pip3'].includes(first)) return bare(tokens[1]) === 'install';
  if (first === 'uv') return bare(tokens[1]) === 'sync' || (bare(tokens[1]) === 'pip' && bare(tokens[2]) === 'install');
  if (first === 'poetry') return bare(tokens[1]) === 'install';
  return false;
}

/**
 * Pick the first known filter in the command. A pipeline is matched by its
 * producer (`pytest ... | tail` filters as pytest), which is the part that
 * generated the tokens.
 */
export function selectFilter(command) {
  const parsed = parseCommand(command);
  for (const tokens of parsed.tokenSegments) {
    if (tokens.length === 0) continue;
    if (matchPytest(tokens)) return { id: 'pytest', tokens, parsed };
    if (gitSubcommand(tokens) !== undefined) return { id: 'git', tokens, parsed, subcommand: gitSubcommand(tokens) };
    if (matchTsc(tokens)) return { id: 'tsc', tokens, parsed };
    if (matchPackageManager(tokens)) return { id: 'packageManager', tokens, parsed };
  }
  return { id: undefined, tokens: [], parsed };
}

/** Keep the last summary line of a pytest run. */
function pytestSummary(text) {
  const explicit = text.match(/^\s*=*\s*([^\n=]*?\b\d+\s+(?:passed|failed|error|errors|skipped|xfailed|xpassed)[^\n=]*?\bin\s+[\d.]+s[^\n=]*?)\s*=*\s*$/im);
  if (explicit !== null) return explicit[1].trim();
  const loose = text.match(/(\d+\s+(?:passed|failed|error|errors|skipped)[^\n]*?in\s+[\d.]+s)/i);
  return loose === null ? undefined : loose[1].trim();
}

function pytestFilter(text, { isError, exitCode }) {
  const failed = isError || (exitCode !== undefined && exitCode !== 0);
  const summary = pytestSummary(text);
  if (!failed) return { text: `✓ ${summary ?? 'pytest passed'}`, prose: false };

  const lines = text.split('\n');
  const keep = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (summary !== undefined && line.includes(summary)) { keep.push(line); continue; }
    if (/^(?:FAILED|ERROR)\b/.test(trimmed)) { keep.push(line); continue; }
    if (/^E\s+/.test(line)) { keep.push(line); continue; }
    if (/^_{3,}\s/.test(trimmed) || /^=+\s*FAILURES\s*=+/.test(trimmed)) { keep.push(line); continue; }
    if (/^File "/.test(trimmed) || /^assert\b/i.test(trimmed)) { keep.push(line); continue; }
    if (/^\s*>\s+/.test(line)) { keep.push(line); continue; }
  }
  const body = keep.length > 0 ? keep.slice(0, 120).join('\n') : headLines(text, 60);
  return { text: `✗ ${summary ?? 'pytest failed'}\n${body}`, prose: false };
}

function gitFilter(text, { subcommand }) {
  if (subcommand === 'status') {
    if (text.trim() === '' || /nothing to commit, working tree clean/i.test(text)) return { text: 'clean', prose: false };
    return { text: headLines(text, 40), prose: false };
  }
  if (subcommand === 'diff') {
    const files = (text.match(/^diff --git /gm) ?? []).length;
    const changes = text.split('\n').filter((line) => /^[+-](?![+-])/.test(line) && line.slice(1).trim() !== '');
    if (files > 0 && changes.length === 0) return { text: `${files} file(s), whitespace-only`, prose: false };
    if (text.length <= 4000) return { text, prose: false };
    const headers = text.split('\n').filter((line) => /^(diff --git |index |--- |\+\+\+ |@@ )/.test(line));
    const kept = changes.slice(0, 160);
    return {
      text: `${headers.slice(0, 40).join('\n')}\n${kept.join('\n')}\n… ${Math.max(0, changes.length - kept.length)} changed lines elided; re-run git diff for the full patch`,
      prose: false,
    };
  }
  if (subcommand === 'log') return { text: headLines(text, 40), prose: true };
  if (subcommand === 'show') return { text: headLines(text, 100), prose: false };
  return { text, prose: false };
}

function tscFilter(text, { isError, exitCode }) {
  const errors = text.split('\n').filter((line) => /error TS\d+:/.test(line));
  const failed = isError || (exitCode !== undefined && exitCode !== 0);
  if (errors.length === 0) {
    return { text: failed ? headLines(text, 40) : '✓ tsc: no errors', prose: false };
  }
  const kept = errors.slice(0, 100);
  const more = errors.length > kept.length ? `\n… ${errors.length - kept.length} more errors` : '';
  return { text: `${kept.join('\n')}${more}\nFound ${errors.length} error(s)`, prose: false };
}

const INSTALL_OK = /(?:added|removed|changed|audited|installed|up to date|packages? in|Successfully installed|Requirement already satisfied|resolved \d+ packages)/i;
const INSTALL_ERR = /(?:npm ERR!|ERROR:|error\b|Could not|failed|not found|EACCES|ERESOLVE|Traceback|No matching distribution)/i;

function packageFilter(text, { isError, exitCode, tokens }) {
  if (!isError && (exitCode === undefined || exitCode === 0)) {
    const summary = text.split('\n').filter((line) => INSTALL_OK.test(line)).slice(-4);
    return { text: summary.length > 0 ? summary.join('\n') : `✓ ${tokens.join(' ')}`, prose: true };
  }
  const kept = text.split('\n').filter((line) => INSTALL_ERR.test(line)).slice(0, 80);
  return { text: kept.length > 0 ? kept.join('\n') : tailLines(text, 30), prose: false };
}

/** ANSI/CR/progress/repeat cleanup that is safe for any command. */
export function genericClean(text) {
  return stripProgressLines(collapseBlankLines(collapseRepeatedLines(text)));
}

/**
 * Split the shell tool's exit marker off the rendered result.
 * `dsh-tool-bash` appends `[exit code: N]` or `[killed by signal: X]`.
 */
export function splitExit(text) {
  const match = String(text).match(/\n?\[(?:exit code: (-?\d+)|killed by signal: ([^\]\n]+))\]\s*$/);
  if (match === null) return { body: String(text), exitCode: undefined, signal: undefined };
  return {
    body: String(text).slice(0, match.index).replace(/\s+$/, ''),
    exitCode: match[1] === undefined ? undefined : Number(match[1]),
    signal: match[2],
  };
}

/**
 * Apply the first matching command filter, or the generic cleanup.
 * A throwing filter falls back to the generic path; a tool result is never
 * allowed to fail because of this plugin.
 *
 * @param {string} command
 * @param {string} text
 * @param {{ isError: boolean, exitCode?: number, signal?: string, config: object }} context
 * @returns {{ id: string, text: string, prose: boolean }}
 */
export function applyCommandFilters(command, text, context) {
  const selected = selectFilter(command);
  const filters = context.config?.filters ?? {};
  try {
    if (selected.id === 'pytest' && filters.pytest !== false) {
      return { id: 'pytest', ...pytestFilter(text, context) };
    }
    if (selected.id === 'git' && filters.git !== false) {
      return { id: 'git', ...gitFilter(text, { ...context, subcommand: selected.subcommand }) };
    }
    if (selected.id === 'tsc' && filters.tsc !== false) {
      return { id: 'tsc', ...tscFilter(text, context) };
    }
    if (selected.id === 'packageManager' && filters.packageManager !== false) {
      return { id: 'packageManager', ...packageFilter(text, { ...context, tokens: selected.tokens }) };
    }
  } catch {
    // Fall through to the generic path.
  }
  if (filters.generic === false) return { id: 'none', text, prose: false };
  return { id: 'generic', text: genericClean(text), prose: false };
}

export { SHELL_TOOLS };
