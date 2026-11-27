import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MODE_IDS, STATE_FILE, applyConfigOverrides, effectiveConfig, readState, resolveModes,
  sanitizeConfigPatch, sanitizeModePatch, sanitizeScope, stateDirectory, writeState,
} from '../lib/modes.js';
import { resolveConfig } from '../lib/config.js';
import { DEFAULT_POLITE_WORDS } from '../lib/text.js';

test('the row config seeds every switch', () => {
  const row = resolveConfig({ filters: { git: false }, prose: { stripTrailingPeriod: false } });
  const modes = resolveModes(row);
  assert.deepEqual(Object.keys(modes), [...MODE_IDS]);
  assert.equal(modes.git, false);
  assert.equal(modes.proseStrip, false);
  assert.equal(modes.pytest, true);
  assert.equal(modes.readOutline, true);
  assert.equal(modes.rtk, true);
  assert.equal(modes.politenessStrip, true);
});

test('effectiveConfig folds switches without disturbing budgets', () => {
  const row = resolveConfig({ budgets: { read: 20000 } });
  const modes = resolveModes(row);
  const policy = effectiveConfig(row, { modes: { ...modes, git: false, grepCap: false }, proseScope: 'all' });
  assert.equal(policy.budgets.read, 20000);
  assert.equal(policy.filters.git, false);
  assert.equal(policy.retrieval.grepCap, false);
  assert.equal(policy.retrieval.readOutline, true);
  assert.equal(policy.rtk, true);
  assert.equal(policy.prose.stripTrailingPeriod, true);
  assert.equal(policy.prose.stripPoliteness, true);
  assert.equal(policy.prose.scope, 'all');
  assert.equal(policy.prose.politenessWords, DEFAULT_POLITE_WORDS, 'the default word list rides along');
});

test('the politeness switch folds independently of punctuation', () => {
  const row = resolveConfig({ prose: { stripPoliteness: false } });
  const modes = resolveModes(row);
  assert.equal(modes.politenessStrip, false);
  assert.equal(modes.proseStrip, true);
  const policy = effectiveConfig(row, { modes, proseScope: 'all' });
  assert.equal(policy.prose.stripPoliteness, false);
  assert.equal(policy.prose.stripTrailingPeriod, true);
});

test('the RTK switch folds into the effective config', () => {
  const row = resolveConfig({});
  const modes = resolveModes(row);
  assert.equal(resolveModes(resolveConfig({ rtk: false })).rtk, false);
  assert.equal(effectiveConfig(row, { modes: { ...modes, rtk: false }, proseScope: 'filtered' }).rtk, false);
});

test('untrusted switch patches keep only known booleans', () => {
  assert.deepEqual(
    sanitizeModePatch({ git: false, nonsense: true, pytest: 'yes', tsc: true }),
    { git: false, tsc: true },
  );
  assert.deepEqual(sanitizeModePatch(null), {});
});

test('only the three scopes are accepted', () => {
  assert.equal(sanitizeScope('all'), 'all');
  assert.equal(sanitizeScope('everything'), undefined);
  assert.equal(sanitizeScope(undefined), undefined);
});

test('stateDirectory prefers the advertised profile dir', () => {
  assert.equal(stateDirectory({ DSH_PROFILE_DIR: 'C:/p/web' }, 'C:/home'), 'C:/p/web');
  assert.equal(stateDirectory({ DSH_HOME: 'C:/dsh', DSH_PROFILE: 'tui' }, 'C:/home'), join('C:/dsh', 'profiles', 'tui'));
  assert.equal(stateDirectory({ DSH_HOME: 'C:/dsh' }, 'C:/home'), join('C:/dsh', 'profiles', 'default'));
});

test('stateDirectory falls back to the profile carrying the package', () => {
  const home = mkdtempSync(join(tmpdir(), 'oh-my-token-home-'));
  mkdirSync(join(home, 'profiles', 'web', 'node_modules', 'dsh-oh-my-token'), { recursive: true });
  mkdirSync(join(home, 'profiles', 'tui'), { recursive: true });
  assert.equal(stateDirectory({}, home), join(home, 'profiles', 'web'));
});

test('two candidate profiles mean no directory at all', () => {
  const home = mkdtempSync(join(tmpdir(), 'oh-my-token-home-'));
  for (const profile of ['web', 'tui']) {
    mkdirSync(join(home, 'profiles', profile, 'node_modules', 'dsh-oh-my-token'), { recursive: true });
  }
  assert.equal(stateDirectory({}, home), undefined);
});

test('state round-trips through the profile directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oh-my-token-state-'));
  assert.equal(readState(dir), undefined);
  const state = {
    modes: { git: false, proseStrip: true },
    proseScope: 'all',
    systemPrompt: { segments: [{ text: 'First.' }, { id: 'k', text: 'Second.' }] },
  };
  const path = writeState(dir, state);
  assert.equal(path, join(dir, STATE_FILE));
  assert.deepEqual(readState(dir), state);
});

test('the old { mode, text } editor state migrates to segments on write and read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oh-my-token-state-'));
  writeState(dir, { modes: {}, systemPrompt: { mode: 'append', text: 'Old text.' } });
  assert.deepEqual(readState(dir).systemPrompt, { segments: [{ text: 'Old text.' }] });
});

test('a state file from another version is ignored, not guessed at', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oh-my-token-state-'));
  writeFileSync(join(dir, STATE_FILE), JSON.stringify({ version: 99, modes: { git: false } }));
  assert.equal(readState(dir), undefined);
});

test('config patches keep valid numbers and drop bad ones', () => {
  assert.deepEqual(sanitizeConfigPatch({
    budgets: { default: 7000, read: -1, errorFactor: 2.5 },
    minChars: 900,
    minGain: 0.1,
    retrieval: { maxGrepMatches: 80 },
    recovery: 'rerun',
    logEvery: 10,
  }), {
    budgets: { default: 7000, errorFactor: 2.5 },
    minChars: 900,
    minGain: 0.1,
    retrieval: { maxGrepMatches: 80 },
    recovery: 'rerun',
    logEvery: 10,
  });
  assert.deepEqual(sanitizeConfigPatch({ recovery: 'magic', minGain: 2, minChars: 1.5 }), {});
  assert.deepEqual(sanitizeConfigPatch(null), {});
});

test('config overrides merge nested maps without dropping siblings', () => {
  const row = resolveConfig({ budgets: { default: 6000, read: 12000 } });
  const merged = applyConfigOverrides(row, { budgets: { default: 7000 }, minChars: 900 });
  assert.equal(merged.budgets.default, 7000);
  assert.equal(merged.budgets.read, 12000);
  assert.equal(merged.minChars, 900);
  assert.equal(applyConfigOverrides(row, undefined), row);
});

test('state round-trips the master switch and config overrides', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oh-my-token-state-'));
  const state = {
    enabled: false,
    modes: { git: false },
    proseScope: 'all',
    config: { budgets: { default: 7000 }, recovery: 'rerun', logEvery: 5 },
    systemPrompt: { segments: [] },
  };
  writeState(dir, state);
  const read = readState(dir);
  assert.equal(read.enabled, false);
  assert.deepEqual(read.config, state.config);
  assert.equal(read.modes.git, false);
});
