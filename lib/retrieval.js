/**
 * Retrieval-style transforms: outline a large file instead of pasting it, and
 * cap a search result set at the point where more matches stop changing the
 * next action.
 *
 * This is the native equivalent of the codegraph principle (symbols before
 * files, matches before matches-plus-context), not a symbol database. The
 * outline is regex-based so it works without an LSP and without a build step.
 */

import { countLines } from './text.js';

const READ_PATH = /^<path>([\s\S]*?)<\/path>/;
const JSON_EXT = /\.(?:json|jsonl|ndjson|lock|map)$/i;

/** Extract the `<path>…</path>` envelope the read tool writes. */
export function extractReadPath(text) {
  return READ_PATH.exec(String(text))?.[1];
}

/** Read one line's existing `12: ` / `12| ` number, or fall back to position. */
function numbered(line, index) {
  const match = /^\s*(\d+)[|:]\s?/.exec(line);
  if (match === null) return { number: index + 1, text: line };
  return { number: Number(match[1]), text: line.slice(match[0].length) };
}

/** Map a path to a symbol grammar. */
export function languageOf(path) {
  const lower = String(path ?? '').toLowerCase();
  if (/\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/.test(lower)) return 'js';
  if (/\.py$/.test(lower)) return 'py';
  if (/\.go$/.test(lower)) return 'go';
  if (/\.rs$/.test(lower)) return 'rust';
  if (/\.(?:java|kt|kts|scala|cs)$/.test(lower)) return 'jvm';
  if (/\.(?:c|h|cc|cpp|cxx|hpp|hh)$/.test(lower)) return 'c';
  if (/\.rb$/.test(lower)) return 'ruby';
  if (/\.php$/.test(lower)) return 'php';
  if (/\.(?:sh|bash|zsh|ps1)$/.test(lower)) return 'shell';
  return 'generic';
}

/**
 * Extract top-level symbols with line numbers.
 * The goal is a usable map, not a parser: a missed symbol is cheaper than a
 * wrong tree, so only declarations anchored at column 0 (except JVM types,
 * which may sit inside a namespace) are reported.
 */
export function extractSymbols(lines, language) {
  const symbols = [];
  for (let i = 0; i < lines.length; i += 1) {
    const { number, text } = numbered(lines[i], i);
    if (text.trim() === '') continue;
    const indented = /^\s/.test(text);
    if (indented && language !== 'jvm' && language !== 'php') continue;

    let match;
    let kind;
    let name;

    if (language === 'js') {
      match = text.match(/^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?(function|class|interface|type|enum|const|let|var|namespace)\s+([A-Za-z_$][\w$]*)/);
      if (match !== null) [, kind, name] = match;
    } else if (language === 'py') {
      match = text.match(/^(?:async\s+)?def\s+([A-Za-z_]\w*)/) ?? text.match(/^class\s+([A-Za-z_]\w*)/);
      if (match !== null) {
        kind = /^\s*class\b/.test(text) ? 'class' : 'def';
        name = match[1];
      }
    } else if (language === 'go') {
      match = text.match(/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/) ?? text.match(/^type\s+([A-Za-z_]\w*)/);
      if (match !== null) {
        kind = /^func\b/.test(text) ? 'func' : 'type';
        name = match[1];
      }
    } else if (language === 'rust') {
      match = text.match(/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(fn|struct|enum|trait|impl|mod)\s+(?:<[^>]*>\s*)?([A-Za-z_]\w*)/);
      if (match !== null) [, kind, name] = match;
    } else if (language === 'jvm') {
      match = text.match(/^(?:(?:public|private|protected|internal|static|final|abstract|sealed|open|data|partial|inline|suspend)\s+)*(class|interface|enum|record|struct)\s+([A-Za-z_]\w*)/)
        ?? text.match(/^(?:(?:public|private|protected|internal|suspend|inline|operator|open)\s+)*fun\s+([A-Za-z_]\w*)/);
      if (match !== null) {
        kind = match.length === 3 ? match[1] : 'fun';
        name = match.length === 3 ? match[2] : match[1];
      }
    } else if (language === 'c') {
      const candidate = text.match(/^(?:[\w:*&<>,.\s]+?)\b([A-Za-z_]\w*)\s*\([^;]*\)\s*(?:const\s*)?\{?\s*$/);
      if (candidate !== null && !/^(?:if|for|while|switch|return|else|do|case|sizeof)$/.test(candidate[1])) {
        kind = 'function';
        name = candidate[1];
      }
    } else if (language === 'ruby') {
      match = text.match(/^(class|module|def)\s+([A-Za-z_]\w*[!?=]?)/);
      if (match !== null) [, kind, name] = match;
    } else if (language === 'php') {
      match = text.match(/^(?:abstract\s+|final\s+)?(class|interface|trait|function)\s+([A-Za-z_]\w*)/);
      if (match !== null) [, kind, name] = match;
    } else if (language === 'shell') {
      match = text.match(/^(?:function\s+)?([A-Za-z_]\w*)\s*\(\s*\)\s*\{/) ?? text.match(/^function\s+([A-Za-z_]\w*)/);
      if (match !== null) {
        kind = 'function';
        name = match[1];
      }
    } else {
      match = text.match(/^(?:export\s+)?(?:function|class|def|func|fn|struct|interface|type|enum)\s+([A-Za-z_]\w*)/);
      if (match !== null) {
        kind = 'symbol';
        name = match[1];
      }
    }

    if (name !== undefined && name !== '') symbols.push({ line: number, kind, name });
  }
  return symbols;
}

/**
 * Replace a large, un-ranged read with a symbol outline.
 * Returns `undefined` when the file has no usable outline, when the model asked
 * for a range, or when the outline would not actually be shorter.
 */
export function outlineRead(text, { threshold, maxSymbols }) {
  const source = String(text);
  const path = extractReadPath(source);
  if (path === undefined || JSON_EXT.test(path)) return undefined;

  const close = source.indexOf('</path>');
  if (close < 0) return undefined;
  const body = source.slice(close + '</path>'.length).replace(/^\n/, '');
  if (countLines(body) < threshold) return undefined;

  const symbols = extractSymbols(body.split('\n'), languageOf(path));
  if (symbols.length < 3) return undefined;

  const shown = symbols.slice(0, maxSymbols);
  const omitted = symbols.length - shown.length;
  const lines = [];
  lines.push(`<path>${path}</path>`);
  lines.push(`${countLines(body)} lines; outline only (no offset/limit was given):`);
  for (const symbol of shown) lines.push(`  ${symbol.line}: ${symbol.kind} ${symbol.name}`);
  if (omitted > 0) lines.push(`  … ${omitted} more symbols`);
  lines.push(`Re-read ${path} with offset/limit to load a range.`);
  const out = lines.join('\n');
  return out.length < source.length ? out : undefined;
}

/** Count `path:line:` / `path-line-` matches, tolerating Windows drive letters. */
function isMatchLine(line) {
  return /^.*?:\d+[:|-]/.test(line) && !/^\s*$/.test(line);
}

/**
 * Cap a search result at the point of diminishing returns, keeping any header
 * and a narrow hint. Returns `undefined` when the result is already small.
 */
export function capSearch(text, { maxMatches }) {
  const source = String(text);
  const lines = source.split('\n');
  const total = lines.filter(isMatchLine).length;
  if (total <= maxMatches) return undefined;

  const kept = [];
  let matches = 0;
  for (const line of lines) {
    if (isMatchLine(line)) {
      if (matches < maxMatches) {
        kept.push(line);
        matches += 1;
      }
    } else {
      kept.push(line);
    }
  }
  const out = `${kept.join('\n')}\n… ${total - matches} more matches; narrow with path/glob.`;
  return out.length < source.length ? out : undefined;
}
