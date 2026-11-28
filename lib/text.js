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
const FILE_EXTENSION = /\.(?:md|markdown|txt|log|json|jsonl|ya?ml|toml|ini|lock|ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|kts|cs|c|h|cpp|hpp|cc|rb|php|sh|bash|ps1|bat|cmd|html|htm|css|scss|sass|xml|sql|proto|vue|svelte|swift|dart|lua|r|scala|ex|exs|erl|hs|clj)(?=$|[\s).,;!?])/i;
const URL = /(?:\b(?:https?|ftp):\/\/|\bwww\.|\b(?:[\w-]+\.)+[A-Za-z]{2,}(?:\/[^\s]*)?)/i;
const MARKDOWN_LINK = /!?\[[^\]]*\]\([^)]+\)/;
const PATH = /(?:[A-Za-z]:[\\/]|(?:^|[\s("'`])(?:\.{1,2}[\\/]|\/)|\b[\w.-]+[\\/][\w./\\-]+)/;
const VERSION = /\b(?:v|version\s*)?\d+\.\d+(?:\.\d+)*\b/i;
const EMAIL = /^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/;
const CODE_END = /[;{}=]$/;
const CODE_START = /^(?:[{[]|<\/?[A-Za-z])/;

/**
 * The shape guards shared by period, comma and politeness trimming.
 *
 * A line that fails any guard is never rewritten: code, diffs, paths, URLs,
 * versions and identifiers are copied through byte-for-byte.
 */
function proseGuards(line) {
  const value = String(line);
  const trimmed = value.trim();
  if (trimmed === '') return false;
  if (/^(?:```|~~~)/.test(trimmed)) return false;
  if (/`[^`]*`/.test(trimmed)) return false;
  if (DIFF_LINE.test(trimmed)) return false;
  if (CODE_START.test(trimmed)) return false;
  if (CODE_END.test(trimmed)) return false;
  if (URL.test(trimmed) || MARKDOWN_LINK.test(trimmed) || PATH.test(trimmed)) return false;
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
  // A comma on a line carrying code punctuation is code, not prose.
  if (/[，,]\s*$/.test(value) && /[=();{}[\]]/.test(trimmed)) return false;
  return true;
}

/**
 * Whether a line is prose that can safely lose a sentence-final mark.
 * The guards are intentionally paranoid: a wrong deletion corrupts a filename,
 * a URL, a version, or a line of code, which costs far more than one token.
 */
export function isProseLine(line) {
  const value = String(line);
  return proseGuards(value) && /[.。]\s*$/.test(value);
}

/** An assignment or statement is not prose, even without a trailing mark. */
function looksLikeCode(text) {
  const trimmed = text.trim();
  if (/[=;{}]/.test(trimmed)) return true;
  return /^(?:const|let|var|function|class|import|export|return|if|for|while|switch|def|fn|public|private|protected|package|#include)\b/.test(trimmed);
}

/** Prose that may lose politeness words, a trailing comma or a period. */
function isProseCandidate(line) {
  return proseGuards(line) && !looksLikeCode(line);
}

// ── Word delete / replace ───────────────────────────────────────────────────
//
// The old "ban word" list is now a configurable word transform: every entry is
// `{ word, replace? }` — `replace` empty (or omitted) deletes the word, a
// non-empty `replace` swaps it for that text instead.

/** `请` is skipped inside compounds such as 请求 / 申请 / 邀请. */
const QING_GUARDED = '(?<!申|邀|聘|提|呈|报|敬|恭|恳|函|回|奏|咨|声|争|催|敦|籲|吁|要|寻|约|宴|延)请(?!求|示|教|假|柬|帖|缨|战|命|辞|罪|愿|客)';

// ── Speech particles ────────────────────────────────────────────────────────
//
/** Particle entries use the same editable table, with an extra phrase-boundary guard. */
const PARTICLE_WORDS = new Set([
  '啊', '呀', '吧', '呢', '嘛', '哦', '噢', '喔', '唉', '哎', '哟', '咯', '啦', '嘞', '呐', '哇',
  '哎呀', '哎哟', '唉呀', '啊呀',
]);

/** Words whose last character is a particle but is part of the word. */
const PARTICLE_GUARD = {
  吧: '(?<!酒|网|贴|水|氧|陶|书)',
  呢: '(?<!毛)',
  啦: '(?<!哗)',
};

/** A particle may end the phrase only before punctuation, space or line end. */
const PARTICLE_TAIL = '(?=[\\s,，.。!！?？;；:：…、)）」』】]|$)';

/** The built-in editable word list, used when no `prose.politenessWords` is configured. */
export const DEFAULT_POLITE_WORDS = Object.freeze([
  { word: '谢谢' },
  { word: '好的' },
  { word: '多谢' },
  { word: '感谢' },
  { word: '请问' },
  { word: '麻烦您' },
  { word: '麻烦' },
  { word: '劳驾' },
  { word: '拜托' },
  { word: '辛苦' },
  { word: '请' },
  { word: 'please' },
  { word: 'thanks' },
  { word: 'thank you' },
  { word: 'kindly' },
  ...[...PARTICLE_WORDS].map((word) => ({ word })),
]);

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** One word's pattern: ASCII words match whole words; `请` keeps its guard. */
function wordPattern(word) {
  if (word === '请') return QING_GUARDED;
  if (PARTICLE_WORDS.has(word)) {
    return `${PARTICLE_GUARD[word] ?? ''}${escapeRegExp(word)}${PARTICLE_TAIL}`;
  }
  if (/^[\x20-\x7e]+$/.test(word)) return `(?<![A-Za-z0-9_])${escapeRegExp(word)}(?![A-Za-z0-9_])`;
  return escapeRegExp(word);
}

/**
 * Compile a word list into a per-line transform. Longer words match first so
 * `麻烦您` never leaves a `您` behind; an untouched line is returned
 * byte-for-byte, so trailing whitespace survives.
 *
 * @param {Array<{ word: string, replace?: string }> | undefined} [entries]
 * @returns {(line: string) => string}
 */
export function compileWordTrimmer(entries) {
  const list = (Array.isArray(entries) ? entries : DEFAULT_POLITE_WORDS)
    .filter((entry) => entry !== null && typeof entry === 'object'
      && typeof entry.word === 'string' && entry.word !== '');
  if (list.length === 0) return (line) => String(line);
  const replaceOf = new Map();
  for (const entry of list) {
    const replacement = typeof entry.replace === 'string' ? entry.replace : '';
    replaceOf.set(entry.word, replacement);
    if (/^[\x20-\x7e]+$/.test(entry.word)) replaceOf.set(entry.word.toLowerCase(), replacement);
  }
  const words = [...new Set(list.map((entry) => entry.word))].sort((a, b) => b.length - a.length);
  const re = new RegExp(`(?:${words.map(wordPattern).join('|')})`, 'gi');
  return (line) => {
    const source = String(line);
    let text = source.replace(re, (match) => replaceOf.get(match) ?? replaceOf.get(match.toLowerCase()) ?? '');
    if (text === source) return source;
    return text
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/^[ \t]+/, '')
      .replace(/^[ \t]*[，,、]+[ \t]*/, '')
      .replace(/[，,、]+[ \t]*$/, '');
  };
}

/**
 * Remove spoken politeness from one prose line with the default word list,
 * tidying the punctuation it leaves behind (`谢谢，请稍等。` -> `稍等。`).
 */
export function stripPoliteness(line) {
  return compileWordTrimmer()(line);
}

// ── Punctuation tidy ────────────────────────────────────────────────────────
//
// Three rules, all on provably-prose lines only:
// 1. a punctuation mark opening a paragraph (line) is dropped;
// 2. two marks stuck together collapse to one: the sentence-final mark wins
//    (`，。` → `。`, `！，` → `！`, a tie keeps the right one);
// 3. the old rule — every trailing `.` / `。` / `,` / `，` is dropped.
// An ASCII ellipsis (`...`) is never collapsed or stripped.

const PUNCT_LEAD = /^[.。,，、;；!！？?…]+/;
const PUNCT_RUN = /[.。,，、;；!！？?…]{2,}/g;
const PUNCT_TRAIL = /[.。,，]+(\s*)$/;
const PUNCT_STRONG = /[.。!！？?…]/;

/** One tidy pass over a single line; the input is assumed prose-safe. */
export function tidyPunctuation(line) {
  let next = String(line);
  const lead = PUNCT_LEAD.exec(next);
  // `...` at the start of a line is an ellipsis, not a stray mark.
  if (lead !== null && !/^\.{3,}$/.test(lead[0])) next = next.slice(lead[0].length);
  next = next.replace(PUNCT_RUN, (run) => {
    if (/^\.{2,}$/.test(run)) return run;
    const chars = [...run];
    const strong = chars.filter((char) => PUNCT_STRONG.test(char));
    return strong.length > 0 ? strong[strong.length - 1] : chars[chars.length - 1];
  });
  return next.replace(PUNCT_TRAIL, '$1');
}

/**
 * What a prose change removed/added, as short labels for the page's
 * "what was auto-removed" record. Counts are the before/after difference, so a
 * word that survives on both sides contributes nothing.
 *
 * @param {string} before - the text before the prose step.
 * @param {string} after - the text after it.
 * @param {Array<{ word: string, replace?: string }>} [words]
 * @returns {string[]} labels like `删「谢谢」×1`, `加「拜托」×1`, `标点×2`.
 */
export function describeProseChange(before, after, words) {
  const source = String(before);
  const result = String(after);
  const notes = [];
  const seen = new Set();
  const entries = Array.isArray(words) ? words : DEFAULT_POLITE_WORDS;
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object' || typeof entry.word !== 'string' || entry.word === '') continue;
    if (seen.has(entry.word)) continue;
    seen.add(entry.word);
    const removed = source.split(entry.word).length - result.split(entry.word).length;
    if (removed > 0) notes.push(removed === 1 ? `删「${entry.word}」` : `删「${entry.word}」×${removed}`);
    const replacement = entry.replace;
    if (typeof replacement === 'string' && replacement !== '') {
      const added = result.split(replacement).length - source.split(replacement).length;
      if (added > 0) notes.push(added === 1 ? `加「${replacement}」` : `加「${replacement}」×${added}`);
    }
  }
  const punctCount = (text) => text.split('。').length - 1 + (text.match(/[.,，、;；!！？…]/g) ?? []).length;
  const punctRemoved = punctCount(source) - punctCount(result);
  if (punctRemoved > 0) notes.push(punctRemoved === 1 ? '标点×1' : `标点×${punctRemoved}`);
  return notes;
}

/** Keep a line that consists only of one configured word, including its ending punctuation. */
function matchesWholeLineRule(line, entries) {
  const trimmed = String(line).trim();
  const bare = trimmed.replace(/[.。,，!！?？;；:：、]+$/, '').trim();
  if (bare === '') return false;
  return entries.some((entry) => {
    if (entry === null || typeof entry !== 'object' || typeof entry.word !== 'string') return false;
    const word = entry.word.trim();
    if (word === '') return false;
    const same = (value) => value === word
      || (/^[\x20-\x7e]+$/.test(word) && value.toLowerCase() === word.toLowerCase());
    return same(trimmed) || same(bare);
  });
}

/**
 * Trim prose: optionally apply the word transform (`谢谢`, `请`, `please`, …
 * or a custom delete/replace list) and optionally tidy punctuation (leading
 * marks, consecutive marks and trailing `.` / `。` / `,` / `，`). The two
 * transforms are independent; each defaults on when no option is given.
 *
 * This is the plugin's only character-level transform, and it is scoped: code,
 * diffs, paths, URLs, versions and decimals are skipped by the guards above.
 *
 * @param {string} text
 * @param {{ politeness?: boolean, punctuation?: boolean, keepWholeLine?: boolean, words?: Array<{ word: string, replace?: string }>, onLine?: (before: string, after: string) => void }} [options]
 * @returns {string}
 */
export function stripTrailingPeriods(text, options = {}) {
  const politeness = options.politeness !== false;
  const punctuation = options.punctuation !== false;
  if (!politeness && !punctuation) return String(text);
  const entries = Array.isArray(options.words) ? options.words : DEFAULT_POLITE_WORDS;
  const keepWholeLine = options.keepWholeLine !== false;
  const trim = politeness ? compileWordTrimmer(entries) : null;
  const onLine = typeof options.onLine === 'function' ? options.onLine : null;
  return String(text)
    .split('\n')
    .map((line) => {
      if (!isProseCandidate(line)) return line;
      // Apply word deletion/replacement first; punctuation tidy must see its result.
      let next = line;
      if (trim !== null && !(keepWholeLine && matchesWholeLineRule(line, entries))) next = trim(line);
      if (punctuation) next = tidyPunctuation(next);
      if (next !== line && onLine !== null) onLine(line, next);
      return next;
    })
    .join('\n');
}

// ── Word diff for the page's change list ────────────────────────────────────
//
// The settings page shows each automatic change the way a Git diff shows a
// changed line: removed text struck through in red, added text in green.
// Tokens keep every CJK character apart, so a deleted Chinese word reads as a
// word rather than taking the whole sentence with it.

const DIFF_TOKEN = /[A-Za-z0-9_]+|\s+|[\s\S]/gu;
const DIFF_MAX_TOKENS = 1200;

function pushSegment(segments, kind, text) {
  if (text === '') return;
  const last = segments[segments.length - 1];
  if (last !== undefined && last.kind === kind) last.text += text;
  else segments.push({ kind, text });
}

/** Longest common subsequence over two token arrays, as keep/del/add segments. */
function lcsSegments(a, b) {
  const cols = b.length + 1;
  const table = new Uint16Array((a.length + 1) * cols);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * cols + j] = a[i] === b[j]
        ? table[(i + 1) * cols + j + 1] + 1
        : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pushSegment(out, 'keep', a[i]);
      i += 1;
      j += 1;
    } else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) {
      pushSegment(out, 'del', a[i]);
      i += 1;
    } else {
      pushSegment(out, 'add', b[j]);
      j += 1;
    }
  }
  while (i < a.length) { pushSegment(out, 'del', a[i]); i += 1; }
  while (j < b.length) { pushSegment(out, 'add', b[j]); j += 1; }
  return out;
}

/**
 * A word-level diff of one changed line, for the page's change list.
 *
 * Common prefix and suffix are trimmed before the LCS, so a one-word change in
 * a long line costs one comparison rather than a square of it. A middle far
 * larger than any prose line becomes a single delete + insert pair instead of
 * an expensive alignment.
 *
 * @param {string} before
 * @param {string} after
 * @returns {Array<{ kind: 'keep' | 'del' | 'add', text: string }>}
 */
export function diffWords(before, after) {
  const a = String(before).match(DIFF_TOKEN) ?? [];
  const b = String(after).match(DIFF_TOKEN) ?? [];
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA -= 1;
    endB -= 1;
  }
  const segments = [];
  pushSegment(segments, 'keep', a.slice(0, start).join(''));
  const midA = a.slice(start, endA + 1);
  const midB = b.slice(start, endB + 1);
  if (midA.length + midB.length > DIFF_MAX_TOKENS) {
    pushSegment(segments, 'del', midA.join(''));
    pushSegment(segments, 'add', midB.join(''));
  } else {
    for (const segment of lcsSegments(midA, midB)) pushSegment(segments, segment.kind, segment.text);
  }
  pushSegment(segments, 'keep', a.slice(endA + 1).join(''));
  return segments;
}
