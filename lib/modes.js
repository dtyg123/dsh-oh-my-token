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

/** This package's name, as it appears in a profile's `node_modules`. */
const PACKAGE_NAME = 'dsh-oh-my-token';

/** Every switch the page offers, in display order. */
export const MODE_IDS = Object.freeze([
  'pytest',
  'git',
  'tsc',
  'packageManager',
  'generic',
  'readOutline',
  'grepCap',
  'proseStrip',
]);

/** The sentence-final punctuation scopes the page offers. */
export const PROSE_SCOPES = Object.freeze(['off', 'filtered', 'all']);

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
    readOutline: true,
    grepCap: true,
    proseStrip: row.prose.stripTrailingPeriod !== false,
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
    filters: {
      pytest: modes.pytest,
      git: modes.git,
      tsc: modes.tsc,
      packageManager: modes.packageManager,
      generic: modes.generic,
    },
    retrieval: { ...row.retrieval, readOutline: modes.readOutline, grepCap: modes.grepCap },
    prose: { stripTrailingPeriod: modes.proseStrip, scope: state.proseScope },
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
 * @returns {{ modes: Record<string, boolean>, proseScope: string } | undefined}
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
    if (Object.keys(modes).length === 0 && proseScope === undefined) return undefined;
    return { modes, proseScope };
  } catch {
    return undefined;
  }
}

/**
 * Persist the switch state atomically: a temporary file and a rename, so an
 * interrupted write cannot leave half a policy behind.
 * @param {string | undefined} dir
 * @param {{ modes: Record<string, boolean>, proseScope: string }} state
 * @returns {string | undefined} the path written.
 */
export function writeState(dir, state) {
  if (dir === undefined) return undefined;
  const path = join(dir, STATE_FILE);
  const payload = `${JSON.stringify({
    version: STATE_VERSION,
    modes: sanitizeModePatch(state.modes),
    proseScope: sanitizeScope(state.proseScope),
  }, null, 2)}\n`;
  const temporary = `${path}.tmp`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(temporary, payload);
  renameSync(temporary, path);
  return path;
}
