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
 * Render an assemble() result's sections into prompt text for the page. Unlike
 * the request path the sections are not yet interpolated, so known variables
 * are substituted here and unknown `{{name}}` groups stay literal instead of
 * throwing (a preview must never fail because a request-scoped variable,
 * e.g. `{{provider}}`, has no value outside a real turn).
 * @param {object | undefined} assembly - the `system-prompt/assemble` result.
 * @returns {string}
 */
export function renderPreviewPrompt(assembly) {
  if (assembly === null || typeof assembly !== 'object' || !Array.isArray(assembly.sections)) return '';
  const variables = assembly.variables ?? {};
  return assembly.sections
    .map((section) => {
      const text = typeof section?.text === 'string' ? section.text : '';
      if (section?.interpolate === false || text === '') return text;
      return text.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g, (whole, name) =>
        Object.hasOwn(variables, name) && variables[name] !== undefined ? String(variables[name]) : whole);
    })
    .filter((text) => text.length > 0)
    .join('\n\n');
}

/**
 * Build a live prompt snapshot from a freshly assembled prompt: the static
 * sections as registered right now, with no captured request behind them. This
 * is what restore reads so the editor pre-fills the currently effective prompt.
 * @param {object} assembly - the `system-prompt/assemble` result.
 * @returns {{ prompt: string, capturedAt: null, source: 'live' }}
 */
export function describeLiveAssembly(assembly) {
  return { prompt: renderPreviewPrompt(assembly), capturedAt: null, source: 'live' };
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
