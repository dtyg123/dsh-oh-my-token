/**
 * The switch registry behind the settings page.
 *
 * A "mode" is one transform the user can turn on or off by hand. The row's
 * `config` seeds the initial state; the page overrides it at runtime and
 * persists the choice next to the profile, so a toggle never has to rewrite
 * the user's `cordis.patch.yml`.
 *
 * @module dsh-oh-my-token/modes
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { emptySystemPrompt, sanitizeSystemPrompt } from './system-prompt.js';

/** This package's name, as it appears in a profile's `node_modules`. */
const PACKAGE_NAME = 'dsh-oh-my-token';

/** Every switch the page offers, in display order. */
export const MODE_IDS = Object.freeze([
  'pytest',
  'git',
  'tsc',
  'packageManager',
  'generic',
  'rtk',
  'readOutline',
  'grepCap',
  'proseStrip',
  'politenessStrip',
  'systemPrompt',
]);

/** The sentence-final punctuation scopes the page offers. */
export const PROSE_SCOPES = Object.freeze(['off', 'filtered', 'all']);

const RECOVERY_MODES = new Set(['spill', 'rerun', 'none']);
const isMap = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isInt = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
const isNumber = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

/** State-file schema version. */
export const STATE_VERSION = 1;

/** Name of the state file inside the profile (or DSH home) directory. */
export const STATE_FILE = 'dsh-oh-my-token.state.json';

/**
 * The switch state implied by a row config.
 * @param {object} row - the resolved row config.
 * @returns {Record<string, boolean>}
 */
export function resolveModes(row) {
  return {
    pytest: row.filters.pytest !== false,
    git: row.filters.git !== false,
    tsc: row.filters.tsc !== false,
    packageManager: row.filters.packageManager !== false,
    generic: row.filters.generic !== false,
    rtk: row.rtk !== false,
    readOutline: true,
    grepCap: true,
    proseStrip: row.prose.stripTrailingPeriod !== false,
    politenessStrip: row.prose.stripPoliteness !== false,
    systemPrompt: false,
  };
}

/**
 * Fold the switches into the config the gate consumes, leaving every other
 * field (budgets, thresholds, recovery) as the row configured it.
 *
 * @param {object} row - the resolved row config.
 * @param {{ modes: Record<string, boolean>, proseScope: string }} state
 * @returns {object} the effective config passed to `compressToolResult`.
 */
export function effectiveConfig(row, state) {
  const modes = state.modes;
  return {
    ...row,
    rtk: modes.rtk,
    filters: {
      pytest: modes.pytest,
      git: modes.git,
      tsc: modes.tsc,
      packageManager: modes.packageManager,
      generic: modes.generic,
    },
    retrieval: { ...row.retrieval, readOutline: modes.readOutline, grepCap: modes.grepCap },
    prose: { stripTrailingPeriod: modes.proseStrip, stripPoliteness: modes.politenessStrip, scope: state.proseScope, politenessWords: row.prose?.politenessWords },
  };
}

/**
 * Normalize an untrusted switch patch from the page or the state file.
 * @param {unknown} input - a partial mode map.
 * @returns {Record<string, boolean>} the accepted booleans only.
 */
export function sanitizeModePatch(input) {
  const out = {};
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return out;
  for (const [key, value] of Object.entries(input)) {
    if (!MODE_IDS.includes(key)) continue;
    if (typeof value !== 'boolean') continue;
    out[key] = value;
  }
  return out;
}

/** Reject any scope the gate does not know. */
export function sanitizeScope(value) {
  return PROSE_SCOPES.includes(value) ? value : undefined;
}

/**
 * Normalize an untrusted word delete/replace list. Bad entries are dropped,
 * never guessed at; an empty list is valid (it turns the word step off).
 * @param {unknown} input
 * @returns {Array<{ word: string, replace?: string }> | undefined}
 */
export function sanitizeProseWords(input) {
  if (!Array.isArray(input)) return undefined;
  const out = [];
  const seen = new Set();
  for (const entry of input) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
    if (typeof entry.word !== 'string' || entry.word.length === 0 || entry.word.length > 40) continue;
    if (seen.has(entry.word)) continue;
    seen.add(entry.word);
    if (entry.replace !== undefined) {
      if (typeof entry.replace !== 'string' || entry.replace.length > 60) continue;
      out.push({ word: entry.word, replace: entry.replace });
    } else {
      out.push({ word: entry.word });
    }
    if (out.length >= 100) break;
  }
  return out;
}

/**
 * Normalize an untrusted list of conversation edits: one user-rewritten text
 * per message id. Capped so a hostile page cannot bloat the state file.
 * @param {unknown} input
 * @returns {Array<{ id: string, text: string }> | undefined}
 */
export function sanitizeEdits(input) {
  if (!Array.isArray(input)) return undefined;
  const out = [];
  const seen = new Set();
  for (const item of input) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
    if (typeof item.id !== 'string' || item.id === '' || item.id.length > 128) continue;
    if (typeof item.text !== 'string' || item.text.length === 0 || item.text.length > 20000) continue;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push({ id: item.id, text: item.text });
    if (out.length >= 50) break;
  }
  return out;
}

/**
 * Normalize an untrusted numeric/config patch from the page or the state file.
 * Invalid values are dropped; the caller merges the accepted subset over the
 * row config, so a bad field can never change policy on its own.
 *
 * @param {unknown} input
 * @returns {object} the accepted fields only.
 */
export function sanitizeConfigPatch(input) {
  const out = {};
  if (!isMap(input)) return out;
  if (isMap(input.budgets)) {
    const budgets = {};
    for (const key of ['default', 'read', 'grep', 'bash']) {
      if (isInt(input.budgets[key])) budgets[key] = input.budgets[key];
    }
    if (isNumber(input.budgets.errorFactor, 1, 100)) budgets.errorFactor = input.budgets.errorFactor;
    if (Object.keys(budgets).length > 0) out.budgets = budgets;
  }
  if (isInt(input.minChars)) out.minChars = input.minChars;
  if (isNumber(input.minGain, 0, 0.99)) out.minGain = input.minGain;
  if (isMap(input.retrieval)) {
    const retrieval = {};
    for (const key of ['readOutlineOverLines', 'maxOutlineSymbols', 'maxGrepMatches']) {
      if (isInt(input.retrieval[key], 1)) retrieval[key] = input.retrieval[key];
    }
    if (Object.keys(retrieval).length > 0) out.retrieval = retrieval;
  }
  if (RECOVERY_MODES.has(input.recovery)) out.recovery = input.recovery;
  if (isMap(input.prose)) {
    const prose = {};
    if (Array.isArray(input.prose.politenessWords)) {
      const words = sanitizeProseWords(input.prose.politenessWords);
      if (words !== undefined) prose.politenessWords = words;
    }
    if (Object.keys(prose).length > 0) out.prose = prose;
  }
  if (isInt(input.logEvery)) out.logEvery = input.logEvery;
  return out;
}

/** Deep-merge a validated config patch into the stored override object. */
export function mergeConfigPatch(current, patch) {
  const next = { ...(current ?? {}), ...patch };
  if (patch.budgets !== undefined) next.budgets = { ...(current?.budgets ?? {}), ...patch.budgets };
  if (patch.retrieval !== undefined) next.retrieval = { ...(current?.retrieval ?? {}), ...patch.retrieval };
  if (patch.prose !== undefined) next.prose = { ...(current?.prose ?? {}), ...patch.prose };
  return next;
}

/** Fold stored overrides over the row config; nested maps are merged. */
export function applyConfigOverrides(base, overrides) {
  if (overrides === undefined) return base;
  return {
    ...base,
    ...overrides,
    budgets: { ...base.budgets, ...(overrides.budgets ?? {}) },
    retrieval: { ...base.retrieval, ...(overrides.retrieval ?? {}) },
    prose: { ...base.prose, ...(overrides.prose ?? {}) },
  };
}

/**
 * Discover the profile directory that owns this plugin's state.
 *
 * The Harness advertises the profile through `DSH_PROFILE_DIR`, or through
 * `DSH_HOME` plus `DSH_PROFILE`. When it advertises neither — the app process
 * exports none of them, though the tool calls it spawns do — the profile is
 * found by evidence: the one that carries this package or a file it wrote.
 * Two candidates mean no directory, because scattering state is worse than not
 * persisting it.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [home] - the `~/.dsh` fallback, for tests.
 * @returns {string | undefined}
 */
export function stateDirectory(env = process.env, home = join(homedir(), '.dsh')) {
  const fromProfile = env.DSH_PROFILE_DIR;
  if (typeof fromProfile === 'string' && fromProfile !== '') return fromProfile;
  const advertised = env.DSH_HOME;
  if (typeof advertised === 'string' && advertised !== '') {
    return join(advertised, 'profiles', env.DSH_PROFILE ?? 'default');
  }
  let entries;
  try {
    entries = readdirSync(join(home, 'profiles'), { withFileTypes: true });
  } catch {
    return undefined;
  }
  const found = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(home, 'profiles', entry.name))
    .filter((dir) => existsSync(join(dir, 'node_modules', PACKAGE_NAME))
      || existsSync(join(dir, STATE_FILE)));
  return found.length === 1 ? found[0] : undefined;
}

/**
 * Read the persisted switch state. A missing, unreadable or mismatched file
 * yields nothing rather than a guess, so a corrupt file cannot change policy.
 * @param {string | undefined} dir
 * @returns {{ modes: Record<string, boolean>, proseScope: string, systemPrompt: { mode: string, text: string } } | undefined}
 */
export function readState(dir) {
  if (dir === undefined) return undefined;
  try {
    const path = join(dir, STATE_FILE);
    if (!existsSync(path)) return undefined;
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (parsed?.version !== STATE_VERSION) return undefined;
    const modes = sanitizeModePatch(parsed.modes);
    const proseScope = sanitizeScope(parsed.proseScope);
    const systemPrompt = sanitizeSystemPrompt(parsed.systemPrompt) ?? emptySystemPrompt();
    const enabled = typeof parsed.enabled === 'boolean' ? parsed.enabled : undefined;
    const config = sanitizeConfigPatch(parsed.config);
    const edits = sanitizeEdits(parsed.edits);
    if (Object.keys(modes).length === 0 && proseScope === undefined && parsed.systemPrompt === undefined
      && enabled === undefined && Object.keys(config).length === 0 && edits === undefined) return undefined;
    const result = { modes, proseScope, systemPrompt };
    if (enabled !== undefined) result.enabled = enabled;
    if (Object.keys(config).length > 0) result.config = config;
    if (edits !== undefined) result.edits = edits;
    return result;
  } catch {
    return undefined;
  }
}

/**
 * Persist the switch state atomically: a temporary file and a rename, so an
 * interrupted write cannot leave half a policy behind.
 * @param {string | undefined} dir
 * @param {{ modes: Record<string, boolean>, proseScope: string, systemPrompt?: { mode: string, text: string } }} state
 * @returns {string | undefined} the path written.
 */
export function writeState(dir, state) {
  if (dir === undefined) return undefined;
  const path = join(dir, STATE_FILE);
  const payload = `${JSON.stringify({
    version: STATE_VERSION,
    enabled: typeof state.enabled === 'boolean' ? state.enabled : undefined,
    modes: sanitizeModePatch(state.modes),
    proseScope: sanitizeScope(state.proseScope),
    config: sanitizeConfigPatch(state.config),
    edits: sanitizeEdits(state.edits),
    systemPrompt: sanitizeSystemPrompt(state.systemPrompt) ?? emptySystemPrompt(),
  }, null, 2)}\n`;
  const temporary = `${path}.tmp`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(temporary, payload);
  renameSync(temporary, path);
  return path;
}
