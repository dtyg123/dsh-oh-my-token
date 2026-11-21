/**
 * Text utilities shared by the filters, the gate, and the CLI.
 *
 * Everything here is deterministic and allocation-light: the gate runs on every
 * accepted tool result.
 */

const ANSI_CSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const ANSI_OSC = /\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g;

/** Remove terminal control sequences. */
export function stripAnsi(text) {
  return String(text).replace(ANSI_OSC, '').replace(ANSI_CSI, '');
}

/**
 * Apply carriage-return repaints: keep the last frame of each line.
 * A progress bar written as `10%\r20%\r30%` becomes `30%`.
 */
export function resolveCarriageReturns(text) {
  return String(text)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => {
      if (!line.includes('\r')) return line;
      const frames = line.split('\r').filter((frame) => frame.length > 0);
      return frames.length === 0 ? '' : frames[frames.length - 1];
    })
    .join('\n');
}

/** Collapse three or more newlines to one blank line. */
export function collapseBlankLines(text) {
  return String(text).replace(/\n{3,}/g, '\n\n');
}

/**
 * Fold consecutive identical non-empty lines into `line (×N)`.
 * Three identical lines become one, so a repeated log line stops paying rent.
 */
export function collapseRepeatedLines(text, minRun = 3) {
  const lines = String(text).split('\n');
  const out = [];
  for (let i = 0; i < lines.length;) {
    let j = i + 1;
    while (j < lines.length && lines[j] === lines[i]) j += 1;
    const run = j - i;
    if (run >= minRun && lines[i].trim() !== '') out.push(`${lines[i]} (×${run})`);
    else for (let k = i; k < j; k += 1) out.push(lines[k]);
    i = j;
  }
  return out.join('\n');
}

/**
 * Drop progress/status lines that carry no decision.
 * Deliberately narrow: summaries such as `added 42 packages in 3s` survive.
 */
export function stripProgressLines(text) {
  const patterns = [
    /^\s*\d{1,3}%\s*$/,
    /^\s*\[[#=.>\-\s]{8,}\]\s*$/,
    /^\s*[#=]{8,}\s*$/,
    /^\s*(?:Downloading|Collecting|Installing|Building|Compiling|Fetching|Resolving)\b.*\b\d{1,3}%\s*$/i,
  ];
  return String(text)
    .split('\n')
    .filter((line) => !patterns.some((pattern) => pattern.test(line)))
    .join('\n');
}

/** Line count of a text, counting a trailing newline as no extra line. */
export function countLines(text) {
  if (text === '') return 0;
  const lines = String(text).split('\n');
  return lines.length > 0 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
}

/**
 * Chars per token used by the Harness when it reports context usage. Every
 * number this plugin shows is priced with the same heuristic.
 */
export const CHARS_PER_TOKEN = 4;

/** Rough token estimate for reports only; never used for a hard decision. */
export function estimateTokens(text) {
  return Math.ceil(String(text).length / CHARS_PER_TOKEN);
}

/** Keep the first N lines. */
export function headLines(text, n) {
  return String(text).split('\n').slice(0, n).join('\n');
}

/** Keep the last N lines. */
export function tailLines(text, n) {
  const lines = String(text).split('\n');
  return lines.slice(Math.max(0, lines.length - n)).join('\n');
}

/** Accumulate whole lines until the character cap is reached. */
function takeHeadChars(text, maxChars) {
  const lines = String(text).split('\n');
  const out = [];
  let used = 0;
  for (const line of lines) {
    const cost = line.length + (out.length > 0 ? 1 : 0);
    if (used + cost > maxChars) break;
    out.push(line);
    used += cost;
  }
  return out.join('\n');
}

/** Accumulate whole lines from the end until the character cap is reached. */
function takeTailChars(text, maxChars) {
  const lines = String(text).split('\n');
  const out = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const cost = lines[i].length + (out.length > 0 ? 1 : 0);
    if (used + cost > maxChars) break;
    out.unshift(lines[i]);
    used += cost;
  }
  return out.join('\n');
}

const ERROR_LINE = /\b(?:error|failed|failure|traceback|assert|exception|denied|fatal)\b/i;

/**
 * Head + tail + a recovery marker. Error-bearing middle lines are kept when
 * they fit, so a failure hidden in the middle is not silently dropped.
 *
 * @param {string} text
 * @param {number} budget - maximum characters in the result.
 * @param {string} hint - how to get the full text back.
 * @returns {string}
 */
export function truncateMiddle(text, budget, hint) {
  const source = String(text);
  if (source.length <= budget) return source;
  const lines = source.split('\n');
  const markerBase = `\n… ${lines.length} lines (${source.length} chars) elided; ${hint}\n`;
  let available = Math.max(0, budget - markerBase.length);
  if (available < 200) return source.slice(0, Math.max(0, budget - markerBase.length)) + markerBase;

  const headBudget = Math.floor(available * 0.55);
  const tailBudget = Math.floor(available * 0.45);
  let head = takeHeadChars(source, headBudget);
  let tail = takeTailChars(source, tailBudget);

  // Keep a bounded set of error lines from the middle, but only if the marker
  // and the kept ends still fit.
  const headCount = head === '' ? 0 : head.split('\n').length;
  const tailCount = tail === '' ? 0 : tail.split('\n').length;
  const middle = lines.slice(headCount, Math.max(headCount, lines.length - tailCount));
  const errors = middle.filter((line) => ERROR_LINE.test(line)).slice(0, 10);
  let errorBlock = '';
  if (errors.length > 0 && markerBase.length + head.length + tail.length + errors.join('\n').length + 8 <= budget) {
    errorBlock = `${errors.join('\n')}\n`;
  }

  let result = `${head}${markerBase}${errorBlock}${tail}`;
  if (result.length > budget) {
    // Trim the head first; the tail carries the final verdict.
    const excess = result.length - budget;
    const nextHead = takeHeadChars(head, Math.max(0, head.length - excess));
    head = nextHead;
    result = `${head}${markerBase}${errorBlock}${tail}`;
  }
  if (result.length >= source.length) {
    // Never return something larger than the input.
    return `${takeHeadChars(source, Math.max(0, budget - markerBase.length))}${markerBase}`;
  }
  return result;
}

const DIFF_LINE = /^[+-](?![+-])/;
const FILE_EXTENSION = /\.(?:md|markdown|txt|log|json|jsonl|ya?ml|toml|ini|lock|ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|kts|cs|c|h|cpp|hpp|cc|rb|php|sh|bash|ps1|bat|cmd|html|htm|css|scss|sass|xml|sql|proto|vue|svelte|swift|dart|lua|r|scala|ex|exs|erl|hs|clj)$/i;
const URL = /(?:https?|ftp):\/\//i;
const VERSION = /\b(?:v|version\s*)?\d+\.\d+(?:\.\d+)*\b/i;
const EMAIL = /^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/;
const CODE_END = /[;{},=]$/;
const CODE_START = /^(?:[{[]|<\/?[A-Za-z])/;

/**
 * Whether a line is prose that can safely lose one sentence-final mark.
 * The guards are intentionally paranoid: a wrong deletion corrupts a filename,
 * a URL, a version, or a line of code, which costs far more than one token.
 */
export function isProseLine(line) {
  const value = String(line);
  const trimmed = value.trim();
  if (trimmed === '') return false;
  if (/^(?:```|~~~)/.test(trimmed)) return false;
  if (DIFF_LINE.test(trimmed)) return false;
  if (CODE_START.test(trimmed)) return false;
  if (CODE_END.test(trimmed)) return false;
  if (URL.test(trimmed)) return false;
  // A path, address or identifier that ends in a period is not a sentence:
  // the guards must look past the final mark to recognise it.
  const marked = trimmed.replace(/[.。]$/, '');
  if (EMAIL.test(marked)) return false;
  if (FILE_EXTENSION.test(marked)) return false;
  if (VERSION.test(trimmed)) return false;
  if (/^[\w.-]+:\d+/.test(trimmed)) return false;
  if (/^\s*[+*]\s/.test(trimmed)) return false;
  if (trimmed.endsWith('...') || trimmed.endsWith('…')) return false;
  if (/(?:\be\.g\.|\bi\.e\.)$/i.test(trimmed)) return false;
  if (!/[A-Za-z\u4e00-\u9fff]/.test(trimmed)) return false;
  return /[.。]\s*$/.test(value);
}

/**
 * Drop the run of sentence-final `.` / `。` marks from prose lines.
 * This is the only character-level transform in the plugin, and it is scoped:
 * code, diffs, paths, URLs, versions and decimals are skipped by `isProseLine`.
 * A line that closes with several marks (`Done..`, `你好。。。`) loses all of
 * them; an ASCII ellipsis (`...`) is excluded upstream and kept.
 */
export function stripTrailingPeriods(text) {
  return String(text)
    .split('\n')
    .map((line) => (isProseLine(line) ? line.replace(/[.。]+(\s*)$/, '$1') : line))
    .join('\n');
}
