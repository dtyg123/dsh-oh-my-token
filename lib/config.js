/**
 * Defaults and validation for `dsh-oh-my-token`.
 *
 * This plugin is installed from a profile, where `@deepseek-ai/*` packages do
 * not resolve, so it validates its own row config instead of importing a
 * schema library.
 */

import { DEFAULT_POLITE_WORDS } from './text.js';

export const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  budgets: Object.freeze({
    default: 6000,
    read: 12000,
    grep: 6000,
    bash: 4000,
    errorFactor: 2,
  }),
  minChars: 800,
  minGain: 0.05,
  filters: Object.freeze({
    pytest: true,
    git: true,
    tsc: true,
    packageManager: true,
    generic: true,
  }),
  rtk: true,
  retrieval: Object.freeze({
    readOutlineOverLines: 400,
    maxOutlineSymbols: 60,
    maxGrepMatches: 50,
  }),
  prose: Object.freeze({
    stripTrailingPeriod: true,
    stripPoliteness: true,
    // Legacy input remains accepted; matching a whole line is always protected.
    keepWholeLine: true,
    scope: 'filtered',
    /** Word rules; the built-in set, including context guards, when unset. */
    politenessWords: DEFAULT_POLITE_WORDS,
  }),
  recovery: 'spill',
  logEvery: 0,
});

const TOP_KEYS = new Set(Object.keys(DEFAULT_CONFIG));
const RECOVERY = new Set(['spill', 'rerun', 'none']);
const PROSE_SCOPES = new Set(['filtered', 'all', 'off']);

function fail(message) {
  throw new Error(`dsh-oh-my-token: ${message}`);
}

function isMap(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function checkMap(value, label, keys) {
  if (!isMap(value)) fail(`${label} must be a mapping`);
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) fail(`${label}.${key} is not a setting (known: ${keys.join(', ')})`);
  }
  return value;
}

function checkBool(value, label) {
  if (typeof value !== 'boolean') fail(`${label} must be true or false`);
  return value;
}

function checkInt(value, label, min = 0) {
  if (!Number.isSafeInteger(value) || value < min) fail(`${label} must be an integer >= ${min}`);
  return value;
}

function checkNumber(value, label, min = 0, max = Infinity) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail(`${label} must be a number in [${min}, ${max}]`);
  }
  return value;
}

function checkEnum(value, label, allowed) {
  if (!allowed.has(value)) fail(`${label} must be one of ${[...allowed].join(', ')}`);
  return value;
}

function mergeBudgets(input) {
  checkMap(input, 'budgets', ['default', 'read', 'grep', 'bash', 'errorFactor']);
  const out = { ...DEFAULT_CONFIG.budgets };
  for (const [key, value] of Object.entries(input)) {
    if (key === 'errorFactor') out[key] = checkNumber(value, 'budgets.errorFactor', 1);
    else out[key] = checkInt(value, `budgets.${key}`);
  }
  return out;
}

function mergeBoolMap(input, label, keys) {
  checkMap(input, label, keys);
  const out = { ...DEFAULT_CONFIG[label] };
  for (const [key, value] of Object.entries(input)) out[key] = checkBool(value, `${label}.${key}`);
  return out;
}

function mergeRetrieval(input) {
  checkMap(input, 'retrieval', Object.keys(DEFAULT_CONFIG.retrieval));
  const out = { ...DEFAULT_CONFIG.retrieval };
  for (const [key, value] of Object.entries(input)) out[key] = checkInt(value, `retrieval.${key}`, 1);
  return out;
}

function checkProseWords(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array of word rules`);
  const out = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) fail(`${label} entries must be word rule objects`);
    for (const key of Object.keys(entry)) {
      if (!['word', 'replace', 'unlessBefore', 'unlessAfter'].includes(key)) fail(`${label} entries may only set "word", "replace", "unlessBefore" and "unlessAfter"`);
    }
    if (typeof entry.word !== 'string' || entry.word.length === 0 || entry.word.length > 40) {
      fail(`${label}.word must be a 1-40 character string`);
    }
    const rule = { word: entry.word };
    if (entry.replace !== undefined) {
      if (typeof entry.replace !== 'string' || entry.replace.length > 60) fail(`${label}.replace must be a string of at most 60 characters`);
      rule.replace = entry.replace;
    }
    for (const side of ['unlessBefore', 'unlessAfter']) {
      if (entry[side] === undefined) continue;
      if (!Array.isArray(entry[side]) || entry[side].length > 40
        || entry[side].some((context) => typeof context !== 'string' || context.length === 0 || context.length > 40)) {
        fail(`${label}.${side} must be an array of 1-40 character strings (up to 40 entries)`);
      }
      rule[side] = entry[side];
    }
    out.push(rule);
  }
  return out;
}

function mergeProse(input) {
  checkMap(input, 'prose', Object.keys(DEFAULT_CONFIG.prose));
  const out = { ...DEFAULT_CONFIG.prose };
  for (const [key, value] of Object.entries(input)) {
    if (key === 'scope') out[key] = checkEnum(value, 'prose.scope', PROSE_SCOPES);
    else if (key === 'politenessWords') out[key] = checkProseWords(value, 'prose.politenessWords');
    else out[key] = checkBool(value, `prose.${key}`);
  }
  return out;
}

/**
 * Merge a row config over the defaults and validate every field.
 * An unknown key is an error rather than a silent no-op, so a typo fails the
 * row at activation instead of changing nothing.
 *
 * @param {unknown} config - the loader row's `config`, if any.
 * @returns {ReturnType<typeof resolveConfig>}
 */
export function resolveConfig(config) {
  const supplied = config ?? {};
  if (!isMap(supplied)) fail('config must be a mapping of field names to values');
  for (const key of Object.keys(supplied)) {
    if (!TOP_KEYS.has(key)) fail(`unknown config field "${key}" (known: ${[...TOP_KEYS].join(', ')})`);
  }

  const out = {
    enabled: DEFAULT_CONFIG.enabled,
    budgets: { ...DEFAULT_CONFIG.budgets },
    minChars: DEFAULT_CONFIG.minChars,
    minGain: DEFAULT_CONFIG.minGain,
    filters: { ...DEFAULT_CONFIG.filters },
    rtk: DEFAULT_CONFIG.rtk,
    retrieval: { ...DEFAULT_CONFIG.retrieval },
    prose: { ...DEFAULT_CONFIG.prose },
    recovery: DEFAULT_CONFIG.recovery,
    logEvery: DEFAULT_CONFIG.logEvery,
  };

  for (const [key, value] of Object.entries(supplied)) {
    switch (key) {
      case 'enabled':
        out.enabled = checkBool(value, key);
        break;
      case 'budgets':
        out.budgets = mergeBudgets(value);
        break;
      case 'minChars':
        out.minChars = checkInt(value, key);
        break;
      case 'minGain':
        out.minGain = checkNumber(value, key, 0, 0.99);
        break;
      case 'filters':
        out.filters = mergeBoolMap(value, 'filters', Object.keys(DEFAULT_CONFIG.filters));
        break;
      case 'rtk':
        out.rtk = checkBool(value, key);
        break;
      case 'retrieval':
        out.retrieval = mergeRetrieval(value);
        break;
      case 'prose':
        out.prose = mergeProse(value);
        break;
      case 'recovery':
        out.recovery = checkEnum(value, key, RECOVERY);
        break;
      case 'logEvery':
        out.logEvery = checkInt(value, key);
        break;
      default:
        fail(`unknown config field "${key}"`);
    }
  }

  return out;
}
