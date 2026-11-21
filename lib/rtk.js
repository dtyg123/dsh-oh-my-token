/**
 * RTK-style structural compaction — an independent implementation.
 *
 * The behaviour follows the RTK tool (https://github.com/rtk-ai/rtk,
 * Apache-2.0): recognise a tool-result shape, keep the information the next
 * action needs, and replace the repetition with an explicit count. The code
 * here is written from the behaviour, not copied from another JavaScript port.
 * It only ever returns the original text or a strictly smaller one.
 *
 * @module dsh-oh-my-token/rtk
 */

const CAP = 10 * 1024 * 1024;
const MIN = 500;
const PEEK = 1024;
const HUNK_LINES = 100;
const LOG_LINES = 200;
const DEDUP_LINES = 2000;
const GREP_PER_FILE = 10;
const FIND_PER_DIR = 10;
const FIND_DIRS = 20;
const STATUS_FILES = 10;
const STATUS_UNTRACKED = 10;
const LS_TOP_EXT = 5;
const TREE_LINES = 200;
const SEARCH_PER_DIR = 10;
const SEARCH_DIRS = 20;
const WINDOW_HEAD = 120;
const WINDOW_TAIL = 60;
const WINDOW_MIN = 250;
const NOISE_DIRS = new Set([
  'node_modules', '.git', 'target', '__pycache__', '.next', 'dist', 'build',
  '.cache', '.turbo', '.vercel', '.pytest_cache', '.mypy_cache', '.tox',
  '.venv', 'venv', 'env', 'coverage', '.nyc_output', '.DS_Store', 'Thumbs.db',
  '.idea', '.vscode', '.vs', '*.egg-info', '.eggs',
]);

const linesOf = (text) => String(text).split('\n');
const isBlank = (line) => line.trim() === '';

/** Group rows by a key, preserving first-seen order. */
function groupBy(rows, keyOf) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

/** `N units` for a count; RTK's `F` suffix means files. */
const filesLabel = (count) => `${count}F`;

// ── diff ─────────────────────────────────────────────────────────────────────

function compactDiff(input, maxLines = 500) {
  const out = [];
  let file = '';
  let plus = 0;
  let minus = 0;
  let hunk = false;
  let shown = 0;
  let dropped = 0;
  let clipped = false;

  const flushDropped = () => {
    if (dropped === 0) return;
    out.push(`  ... (${dropped} lines truncated)`);
    dropped = 0;
    clipped = true;
  };

  for (const row of linesOf(input)) {
    if (row.startsWith('diff --git')) {
      flushDropped();
      if (file !== '' && (plus > 0 || minus > 0)) out.push(`  +${plus} -${minus}`);
      const marker = row.indexOf(' b/');
      file = marker === -1 ? 'unknown' : row.slice(marker + 3);
      out.push(`\n${file}`);
      plus = 0;
      minus = 0;
      hunk = false;
      shown = 0;
    } else if (row.startsWith('@@')) {
      flushDropped();
      hunk = true;
      shown = 0;
      out.push(`  ${row}`);
    } else if (hunk) {
      const added = row.startsWith('+') && !row.startsWith('+++');
      const removed = row.startsWith('-') && !row.startsWith('---');
      if (added) plus += 1;
      if (removed) minus += 1;
      if (added || removed) {
        if (shown < HUNK_LINES) { out.push(`  ${row}`); shown += 1; }
        else dropped += 1;
      } else if (shown > 0 && shown < HUNK_LINES && !row.startsWith('\\')) {
        out.push(`  ${row}`);
        shown += 1;
      }
    }
    if (out.length >= maxLines) {
      out.push('\n... (more changes truncated)');
      clipped = true;
      break;
    }
  }

  flushDropped();
  if (file !== '' && (plus > 0 || minus > 0)) out.push(`  +${plus} -${minus}`);
  if (clipped) out.push('[full diff elided; re-run the diff command for the complete patch]');
  return out.join('\n');
}

// ── status ───────────────────────────────────────────────────────────────────

function compactStatus(input) {
  const rows = linesOf(input);
  let branch = '';
  const staged = [];
  const modified = [];
  const untracked = [];
  let conflicts = 0;

  for (const row of rows) {
    if (isBlank(row)) continue;
    const onBranch = /^On branch (\S+)/.exec(row);
    if (onBranch !== null) { branch = onBranch[1]; continue; }
    if (row.startsWith('##')) { branch = row.slice(2).trim(); continue; }

    if (row.length >= 3 && /^[ MADRCU?!][ MADRCU?!] \S/.test(row)) {
      const x = row[0];
      const y = row[1];
      const path = row.slice(3);
      if (row.startsWith('??')) { untracked.push(path); continue; }
      if ('MADRC'.includes(x)) staged.push(path);
      else if (x === 'U') conflicts += 1;
      if (y === 'M' || y === 'D') modified.push(path);
      continue;
    }

    const long = /^\s*(modified|new file|deleted|renamed|both modified):\s+(.+)$/.exec(row);
    if (long !== null) {
      const kind = long[1];
      const path = long[2].trim();
      if (kind === 'both modified') conflicts += 1;
      else if (kind === 'modified' || kind === 'deleted') modified.push(path);
      else staged.push(path);
    }
  }

  const section = (label, paths, limit) => {
    if (paths.length === 0) return '';
    const shown = paths.slice(0, limit);
    const more = paths.length > limit ? `   ... +${paths.length - limit} more\n` : '';
    return `${label}: ${paths.length} files\n${shown.map((p) => `   ${p}\n`).join('')}${more}`;
  };

  let out = branch === '' ? '' : `* ${branch}\n`;
  out += section('+ Staged', staged, STATUS_FILES);
  out += section('~ Modified', modified, STATUS_FILES);
  out += section('? Untracked', untracked, STATUS_UNTRACKED);
  if (conflicts > 0) out += `conflicts: ${conflicts} files\n`;
  if (staged.length + modified.length + untracked.length + conflicts === 0) {
    out += 'clean — nothing to commit\n';
  }
  return out.replace(/\n+$/, '');
}

// ── log ──────────────────────────────────────────────────────────────────────

function compactLog(input, maxLines = LOG_LINES) {
  if (!input) return '';
  const out = [];
  let skipped = 0;
  let inCommit = false;
  let subject = false;

  const push = (line) => {
    if (out.length < maxLines) out.push(line);
    else skipped += 1;
  };

  for (const raw of linesOf(input)) {
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (/^commit [0-9a-f]{7,40}$/i.test(trimmed) || /^[*|/\\ ]+commit [0-9a-f]{7,40}/i.test(trimmed)) {
      inCommit = true;
      subject = false;
      push(line);
      continue;
    }

    if (inCommit) {
      if (/^[*|/\\ ]*(Author|Date):/i.test(trimmed)) { push(trimmed); continue; }
      if (trimmed === '') continue;
      if (!subject && /^[*|/\\ ]*    \S/.test(line)) { push(`  Subject: ${trimmed}`); subject = true; continue; }
      if (/^\d+ file\w* changed/.test(trimmed)) { push(`  ${trimmed}`); continue; }
      if (trimmed.startsWith('diff --git ')) { push('  ... diff body omitted'); continue; }
      continue;
    }

    const graph = trimmed.match(/^[*|/\\ ]+([0-9a-f]{7,40}\s+.+)/i);
    if (graph !== null) { push(graph[1]); continue; }
    if (/^[0-9a-f]{7,40}\s+/.test(trimmed)) { push(trimmed); continue; }
    if (/^[*|/\\ ]+$/.test(trimmed) && /[*|/\\]/.test(trimmed)) continue;
    push(trimmed);
  }

  if (skipped > 0) out.push(`... (${skipped} more lines)`);
  const result = out.join('\n');
  if (result === '' && input) return input;
  return result.length > input.length ? input : result;
}

// ── build output ─────────────────────────────────────────────────────────────

const SUMMARY_LINE = /^(?:added|removed|changed|audited|installed)\s+\d+\s+package|^\s*Finished\s+|^BUILD SUCCESS|^\d+\s+(?:vulnerabilities|packages?|warnings?|errors?)|^Successfully (?:installed|built)|^To address .* issues|^Run `npm (?:audit|fund)`|packages are looking for funding/i;

function compactBuild(input) {
  const errors = [];
  const warnings = [];
  const deprecated = [];
  const summaries = [];
  let warningCount = 0;
  let deprecatedCount = 0;
  let compiling = 0;
  let downloading = 0;
  let inError = false;

  for (const line of linesOf(input)) {
    const trimmed = line.trim();
    if (inError) {
      if (trimmed === '') { inError = false; continue; }
      if (/^\s*(?:-->|\||\d+\s*\||=)/.test(line)) { errors.push(line); continue; }
      inError = false;
    }
    if (trimmed === '') continue;

    if (/^npm (?:ERR!|error)/i.test(trimmed) || /^yarn error/i.test(trimmed)) { errors.push(line); continue; }
    if (/^npm warn deprecated/i.test(trimmed)) {
      deprecatedCount += 1;
      if (deprecated.length < 3) deprecated.push(line);
      continue;
    }
    if (/^npm warn/i.test(trimmed) || /^yarn warn/i.test(trimmed)) {
      warningCount += 1;
      if (warnings.length < 5) warnings.push(line);
      continue;
    }
    if (/^error(?:\[|:)/i.test(trimmed) || trimmed.startsWith('error -->')) { errors.push(line); inError = true; continue; }
    if (/^warning(?:\[|:)/i.test(trimmed) || trimmed.startsWith('warning -->')) {
      warningCount += 1;
      if (warnings.length < 5) warnings.push(line);
      inError = true;
      continue;
    }
    if (/^ERROR:/i.test(trimmed) || /^\[ERROR\]/i.test(trimmed) || /^BUILD FAILED/i.test(trimmed)) { errors.push(line); continue; }
    if (/^\[WARNING\]/i.test(trimmed)) {
      warningCount += 1;
      if (warnings.length < 5) warnings.push(line);
      continue;
    }
    if (/^\s*Compiling\s+\S+/i.test(trimmed)) { compiling += 1; continue; }
    if (/^\s*Downloading\s+\S+/i.test(trimmed) || /^Fetching\s+/i.test(trimmed)) { downloading += 1; continue; }
    if (SUMMARY_LINE.test(trimmed)) summaries.push(line);
  }

  const out = [];
  out.push(...deprecated);
  if (deprecatedCount > 3) out.push(`... +${deprecatedCount - 3} more deprecated packages`);
  if (compiling > 0) out.push(`Compiled ${compiling} packages`);
  if (downloading > 0) out.push(`Downloaded ${downloading} packages`);
  out.push(...errors);
  out.push(...warnings);
  if (warningCount > 5) out.push(`... +${warningCount - 5} more warnings`);
  out.push(...summaries);
  const result = out.join('\n');
  return result === '' ? input : result;
}

// ── search hits ──────────────────────────────────────────────────────────────

function splitHit(line) {
  const from = /^[A-Za-z]:[\\/]/.test(line) ? 2 : 0;
  const first = line.indexOf(':', from);
  if (first === -1) return null;
  const second = line.indexOf(':', first + 1);
  if (second === -1) return null;
  return { file: line.slice(0, first), line: line.slice(first + 1, second), content: line.slice(second + 1) };
}

function plausibleHit(line) {
  const hit = splitHit(line);
  if (hit === null) return false;
  if (!/^\d+$/.test(hit.line)) return false;
  if (hit.file === '' || /\s/.test(hit.file)) return false;
  return /[\\/.]/.test(hit.file);
}

function parseHits(text) {
  const hits = [];
  for (const row of linesOf(text)) {
    if (isBlank(row)) continue;
    const hit = splitHit(row);
    if (hit === null || hit.file.trim() === '' || !/^\d+$/.test(hit.line)) return null;
    hits.push(hit);
  }
  return hits.length > 0 ? hits : null;
}

function compactGrep(input) {
  const hits = parseHits(input);
  if (hits === null) return input;
  const groups = groupBy(hits, (hit) => hit.file);
  let out = `${hits.length} matches in ${filesLabel(groups.size)}:\n\n`;
  for (const file of [...groups.keys()].sort()) {
    const rows = groups.get(file);
    out += `[file] ${file} (${rows.length}):\n`;
    for (const hit of rows.slice(0, GREP_PER_FILE)) {
      out += `  ${hit.line.padStart(4)}: ${hit.content.trim()}\n`;
    }
    if (rows.length > GREP_PER_FILE) out += `  +${rows.length - GREP_PER_FILE}\n`;
    out += '\n';
  }
  return out;
}

// ── find / search list ───────────────────────────────────────────────────────

function compactFind(input) {
  const rows = linesOf(input).filter((line) => !isBlank(line));
  if (rows.length === 0) return input;
  const groups = groupBy(rows, (path) => {
    const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    return cut === -1 ? '.' : path.slice(0, cut) || '/';
  });
  const dirs = [...groups.keys()].sort();
  let out = `${rows.length} files in ${dirs.length} dirs:\n\n`;
  for (const dir of dirs.slice(0, FIND_DIRS)) {
    const files = groups.get(dir);
    out += `${dir.replace(/\\/g, '/')}/  (${files.length})\n`;
    for (const path of files.slice(0, FIND_PER_DIR)) out += `  ${path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)}\n`;
    if (files.length > FIND_PER_DIR) out += `  +${files.length - FIND_PER_DIR}\n`;
  }
  if (dirs.length > FIND_DIRS) out += `\n+${dirs.length - FIND_DIRS} more dirs\n`;
  return out;
}

const SEARCH_HEADER = /^Result of search in '[^']*' \(total (\d+) files?\):/;

function compactSearchList(input) {
  const rows = linesOf(input);
  if (rows.length === 0) return input;
  const header = rows[0];
  const paths = rows.slice(1).map((row) => row.trim()).filter((row) => row.startsWith('- ')).map((row) => row.slice(2));
  if (paths.length === 0) return input;
  const groups = groupBy(paths, (path) => {
    const cut = path.lastIndexOf('/');
    return cut === -1 ? '.' : path.slice(0, cut) || '/';
  });
  const dirs = [...groups.keys()].sort();
  let out = `${header}\n${paths.length} files in ${dirs.length} dirs:\n\n`;
  for (const dir of dirs.slice(0, SEARCH_DIRS)) {
    const names = groups.get(dir);
    out += `${dir}/ (${names.length}):\n`;
    for (const path of names.slice(0, SEARCH_PER_DIR)) out += `  ${path.slice(path.lastIndexOf('/') + 1)}\n`;
    if (names.length > SEARCH_PER_DIR) out += `  +${names.length - SEARCH_PER_DIR}\n`;
    out += '\n';
  }
  if (dirs.length > SEARCH_DIRS) out += `+${dirs.length - SEARCH_DIRS} more dirs\n`;
  return out.replace(/\n+$/, '');
}

// ── dedup ────────────────────────────────────────────────────────────────────

function compactDedup(input) {
  const out = [];
  let previous = null;
  let run = 0;
  let blanks = 0;
  const flush = () => {
    if (previous !== null && run > 1) out.push(`  ... (${run - 1} duplicate lines)`);
  };
  for (const line of linesOf(input)) {
    if (isBlank(line)) {
      if (blanks < 1) out.push(line);
      blanks += 1;
      flush();
      previous = null;
      run = 0;
      continue;
    }
    blanks = 0;
    if (line === previous) { run += 1; continue; }
    flush();
    out.push(line);
    previous = line;
    run = 1;
    if (out.length >= DEDUP_LINES) { out.push(`... (truncated at ${DEDUP_LINES} lines)`); break; }
  }
  flush();
  return out.join('\n');
}

// ── ls ───────────────────────────────────────────────────────────────────────

const LS_DATE = /\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+(?:\d{4}|\d{2}:\d{2})\s+/;

function compactLs(input) {
  const dirs = [];
  const files = [];
  const extensions = new Map();
  for (const row of linesOf(input)) {
    if (row.startsWith('total ') || row === '') continue;
    const date = LS_DATE.exec(row);
    if (date === null) continue;
    const name = row.slice(date.index + date[0].length);
    const cols = row.slice(0, date.index).trim().split(/\s+/);
    if (cols.length < 4 || name === '.' || name === '..' || NOISE_DIRS.has(name)) continue;
    const kind = cols[0][0];
    if (kind === 'd') { dirs.push(name); continue; }
    if (kind !== '-' && kind !== 'l') continue;
    let bytes = 0;
    for (let i = cols.length - 1; i >= 0; i -= 1) {
      if (/^\d+$/.test(cols[i])) { bytes = Number(cols[i]); break; }
    }
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 ? name.slice(dot) : 'no ext';
    extensions.set(ext, (extensions.get(ext) || 0) + 1);
    files.push([name, bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)}M` : bytes >= 1024 ? `${(bytes / 1024).toFixed(1)}K` : `${bytes}B`]);
  }
  if (dirs.length === 0 && files.length === 0) return input;
  let out = dirs.map((dir) => `${dir}/\n`).join('') + files.map(([name, size]) => `${name}  ${size}\n`).join('');
  let summary = `\nSummary: ${files.length} files, ${dirs.length} dirs`;
  if (extensions.size > 0) {
    const ranked = [...extensions.entries()].sort((a, b) => b[1] - a[1]);
    const labels = ranked.slice(0, LS_TOP_EXT).map(([ext, count]) => `${count} ${ext}`);
    if (ranked.length > LS_TOP_EXT) labels.push(`+${ranked.length - LS_TOP_EXT} more`);
    summary += ` (${labels.join(', ')})`;
  }
  return out + summary;
}

// ── tree / windows ───────────────────────────────────────────────────────────

function compactTree(input) {
  const kept = [];
  for (const row of linesOf(input)) {
    if (row.includes('director') && row.includes('file')) continue;
    if (isBlank(row) && kept.length === 0) continue;
    kept.push(row);
  }
  while (kept.length > 0 && isBlank(kept[kept.length - 1])) kept.pop();
  if (kept.length > TREE_LINES) {
    const cut = kept.length - TREE_LINES;
    return `${kept.slice(0, TREE_LINES).join('\n')}\n... +${cut} more lines`;
  }
  return kept.join('\n');
}

function windowed(input, suffix) {
  const rows = linesOf(input);
  if (rows.length < WINDOW_MIN) return input;
  const head = rows.slice(0, WINDOW_HEAD);
  const tail = rows.slice(rows.length - WINDOW_TAIL);
  const cut = rows.length - head.length - tail.length;
  return [...head, `... +${cut} lines truncated${suffix}`, ...tail].join('\n');
}

const compactSmartTruncate = (input) => windowed(input, '');
const compactReadNumbered = (input) => windowed(input, ' (file continues)');

// ── detection ────────────────────────────────────────────────────────────────

function isPorcelainDense(head) {
  const rows = linesOf(head).filter((row) => row.trim() !== '');
  if (rows.length < 3) return false;
  const hits = rows.filter((row) => /^(?!  )[ MADRCU?!][ MADRCU?!] \S/.test(row)).length;
  return hits / rows.length >= 0.6;
}

function looksNumbered(rows) {
  let hits = 0;
  let considered = 0;
  for (const row of rows.slice(0, 100)) {
    if (row.length === 0) continue;
    considered += 1;
    if (/^\s*\d+\|/.test(row)) hits += 1;
  }
  return considered >= 5 && hits / considered >= 0.7;
}

/**
 * Pick a compactor by the shape of a blob. The order is the algorithm:
 * specific git/build/pytest/tsc shapes win over generic fallbacks.
 *
 * @param {string} text
 * @returns {Function | null}
 */
export function autoDetectFilter(text) {
  const head = text.slice(0, PEEK);
  if (/^[*|/\\ ]*commit [0-9a-f]{7,40}$/m.test(head)) return compactLog;
  if (/^(?:diff --git |@@ )/m.test(head)) return compactDiff;
  if (/^(?:On branch |nothing to commit|Changes (?:not |to be )|Untracked files:)/m.test(head)) return compactStatus;
  if (/^(?:npm (?:warn|error|ERR!)|yarn (?:warn|error)|\s*Compiling\s+\S+|\s*Downloading\s+\S+|added \d+ package|\[ERROR\]|BUILD (?:SUCCESS|FAILED)|\s*Finished\s+|Successfully (?:installed|built)|ERROR:)/im.test(head)) return compactBuild;
  if (/^(?:=+ .*\b\d+ (?:passed|failed|error|errors|skipped)[^=\n]* in [\d.]+s.*=+|(?:FAILED|ERROR) \S+)/m.test(text)) return compactPytest;
  if (/error TS\d+:/m.test(head)) return compactTsc;
  if (isPorcelainDense(head)) return compactStatus;

  const rows = linesOf(head);
  const body = rows.filter((row) => row.trim() !== '');
  const first = [];
  for (let start = 0; start < text.length && first.length < 5;) {
    const end = text.indexOf('\n', start);
    const stop = end === -1 ? text.length : end;
    const row = text.slice(start, stop);
    if (row.trim() !== '') first.push(row);
    start = stop + 1;
  }
  if (first.some((row) => {
    const hit = splitHit(row);
    return hit !== null && /^\d+$/.test(hit.line);
  })) {
    return first.some(plausibleHit) && parseHits(text) !== null ? compactGrep : null;
  }

  if (body.length >= 3 && body.every((row) => {
    const t = row.trim();
    if (/^[A-Za-z]:[\\/]/.test(t)) return true;
    if (t.includes(':')) return false;
    return t.startsWith('.') || t.startsWith('/') || t.includes('/');
  })) return compactFind;

  if (/[├└]──|│  /.test(head)) return compactTree;
  if (/^total \d+$/m.test(head) || rows.filter((row) => /^[-dlbcps][rwx-]{9}/.test(row)).length >= 3) return compactLs;
  if (SEARCH_HEADER.test(head)) return compactSearchList;
  if (rows.length >= WINDOW_MIN && looksNumbered(rows)) return compactReadNumbered;
  if (body.length >= 5) return compactDedup;
  if (linesOf(text).length >= WINDOW_MIN) return compactSmartTruncate;
  return null;
}

// ── pytest / tsc ─────────────────────────────────────────────────────────────

const PYTEST_SUMMARY = /^[=\s]*(\d+\s+(?:passed|failed|error|errors|skipped|xfailed|xpassed)[^=\n]*?\bin\s+[\d.]+s)[=\s]*$/im;
const PYTEST_LOOSE = /(\d+\s+(?:passed|failed|error|errors|skipped)[^\n]*?in\s+[\d.]+s)/i;
const PYTEST_KEEP = /^(?:FAILED|ERROR)\b|^E\s+|^_{3,}\s|^=+\s*FAILURES\s*=+|^File "|^assert\b|^>\s+/;

function compactPytest(input) {
  const summary = (PYTEST_SUMMARY.exec(input)?.[1] ?? PYTEST_LOOSE.exec(input)?.[1])?.trim();
  const failed = /\b(?:failed|error|errors)\b/i.test(summary ?? '') || /^(?:FAILED|ERROR)\b/m.test(input);
  if (!failed) return summary === undefined ? input : `✓ ${summary}`;
  const kept = linesOf(input).filter((row) => PYTEST_KEEP.test(row.trim()) || (summary !== undefined && row.includes(summary)));
  const body = kept.slice(0, 120).join('\n');
  const out = `${summary === undefined ? '' : `✗ ${summary}\n`}${body}`.trim();
  return out === '' ? input : out;
}

const TSC_ERROR = /error TS\d+:/;

function compactTsc(input) {
  const errors = linesOf(input).filter((row) => TSC_ERROR.test(row));
  if (errors.length === 0) return input;
  const kept = errors.slice(0, 100);
  const more = errors.length > kept.length ? `\n... +${errors.length - kept.length} more errors` : '';
  return `${kept.join('\n')}${more}\nFound ${errors.length} error(s)`;
}

// ── entry point ──────────────────────────────────────────────────────────────

compactDiff.filterName = 'git-diff';
compactStatus.filterName = 'git-status';
compactLog.filterName = 'git-log';
compactBuild.filterName = 'build-output';
compactGrep.filterName = 'grep';
compactFind.filterName = 'find';
compactSearchList.filterName = 'search-list';
compactDedup.filterName = 'dedup-log';
compactLs.filterName = 'ls';
compactTree.filterName = 'tree';
compactSmartTruncate.filterName = 'smart-truncate';
compactReadNumbered.filterName = 'read-numbered';
compactPytest.filterName = 'pytest';
compactTsc.filterName = 'tsc';

/**
 * Compact one blob with the compactor its shape selects.
 * Returns `null` when the blob is too small/large, unrecognised, or when the
 * result would not be strictly smaller — callers then send the original.
 *
 * @param {string} text
 * @returns {{ text: string, id: string, saved: number } | null}
 */
export function rtkCompress(text) {
  const input = typeof text === 'string' ? text : '';
  if (input.length < MIN || input.length > CAP) return null;
  const compactor = autoDetectFilter(input);
  if (compactor === null) return null;
  let candidate;
  try {
    candidate = compactor(input);
  } catch {
    return null;
  }
  if (typeof candidate !== 'string' || candidate.length === 0 || candidate.length >= input.length) return null;
  return { text: candidate, id: compactor.filterName ?? 'anonymous', saved: input.length - candidate.length };
}

export { compactReadNumbered as readNumbered };
