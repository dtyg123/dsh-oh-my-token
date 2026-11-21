/**
 * Optional system-prompt editing for `dsh-oh-my-token`.
 *
 * DSH exposes the official `system-prompt/assemble` waterfall at the point
 * where the prompt sections are final. We add one section there:
 *
 * - append (default): the user's text is added after the existing sections;
 * - replace: the section list is swapped for the user's text alone.
 *
 * Runtime context sections are left untouched — this only changes the static
 * prompt, not the per-turn snapshot. `interpolate: false` keeps `{{...}}` in the
 * user's text literal instead of throwing as an unknown prompt variable.
 *
 * @module dsh-oh-my-token/system-prompt
 */

/** Name of the injected section, also its stable identity. */
export const SECTION_NAME = 'oh-my-token/custom';

/** A well-ordered tail section: ordered last, with a stable tiebreak name. */
const SECTION_ORDER = 1000000;

/** Maximum characters accepted from the settings page. */
export const MAX_SYSTEM_PROMPT_CHARS = 8000;

/** The two edit modes the page offers. */
export const SYSTEM_PROMPT_MODES = Object.freeze(['append', 'replace']);

/** A fresh, inactive editor state. */
export function emptySystemPrompt() {
  return { mode: 'append', text: '' };
}

/**
 * Normalize an untrusted system-prompt patch from the page or the state file.
 * @param {unknown} input
 * @returns {{ mode: string, text: string } | undefined}
 */
export function sanitizeSystemPrompt(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const mode = SYSTEM_PROMPT_MODES.includes(input.mode) ? input.mode : undefined;
  if (typeof input.text !== 'string') return undefined;
  const text = input.text.slice(0, MAX_SYSTEM_PROMPT_CHARS);
  return { mode: mode ?? 'append', text };
}

/**
 * Apply the configured edit to one assembled prompt.
 *
 * @param {object} assembly - the `system-prompt/assemble` payload.
 * @param {{ enabled: boolean, mode: string, text: string }} config
 * @returns {object} the same assembly when inactive, else a new one.
 */
export function applySystemPrompt(assembly, config) {
  if (config?.enabled !== true || typeof config.text !== 'string' || config.text.trim() === '') return assembly;
  if (assembly === null || typeof assembly !== 'object' || !Array.isArray(assembly.sections)) return assembly;

  const section = {
    name: SECTION_NAME,
    text: config.text,
    interpolate: false,
    order: SECTION_ORDER,
  };
  const sections = config.mode === 'replace' ? [section] : [...assembly.sections, section];
  return { ...assembly, sections };
}
