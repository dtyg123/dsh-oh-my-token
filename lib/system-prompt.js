/**
 * Optional system-prompt editing for `dsh-oh-my-token`.
 *
 * DSH exposes the official `system-prompt/assemble` waterfall at the point
 * where the prompt sections are final. We add the user's segments there, in
 * order, after the existing sections — one `interpolate: false` section per
 * card, so `{{...}}` in the text stays literal instead of throwing as an
 * unknown prompt variable.
 *
 * Runtime context sections are left untouched — this only changes the static
 * prompt, not the per-turn snapshot.
 *
 * @module dsh-oh-my-token/system-prompt
 */

/** Prefix for the injected section names, each segment gets its own suffix. */
export const SECTION_NAME = 'oh-my-token/custom';

/** A well-ordered tail section: ordered last, with a stable tiebreak name. */
const SECTION_ORDER = 1000000;

/** Maximum characters accepted per segment from the settings page. */
export const MAX_SYSTEM_PROMPT_CHARS = 8000;

/** A fresh, inactive editor state. */
export function emptySystemPrompt() {
  return { segments: [] };
}

/**
 * Normalize an untrusted system-prompt patch from the page or the state file.
 * Accepts the current card shape `{ segments: [{ id?, text }] }` and migrates
 * the pre-modular `{ mode, text }` shape into a single segment.
 * @param {unknown} input
 * @returns {{ segments: Array<{ id?: string, text: string }> } | undefined}
 */
export function sanitizeSystemPrompt(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return undefined;
  let segments;
  if (Array.isArray(input.segments)) {
    segments = input.segments
      .filter((segment) => segment !== null && typeof segment === 'object')
      .map((segment) => ({
        ...(typeof segment.id === 'string' && segment.id !== '' ? { id: segment.id } : {}),
        text: typeof segment.text === 'string' ? segment.text.slice(0, MAX_SYSTEM_PROMPT_CHARS) : '',
      }));
  } else if (typeof input.text === 'string') {
    // Migrate the old { mode, text } editor state into one card.
    segments = [{ text: input.text.slice(0, MAX_SYSTEM_PROMPT_CHARS) }];
  } else {
    return undefined;
  }
  return { segments };
}

/**
 * Replace known `{{name}}` prompt variables, keeping unknown ones literal.
 * Known but valueless variables (e.g. a preview with no model selection) also
 * stay literal, so no reference ever throws.
 * @param {string} text
 * @param {Record<string, unknown>} variables
 * @returns {string}
 */
function interpolate(text, variables) {
  return text.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g, (whole, name) =>
    Object.hasOwn(variables, name) && variables[name] !== undefined ? String(variables[name]) : whole);
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
      return interpolate(text, variables);
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
 * Apply the configured segments to one assembled prompt. Each card becomes one
 * `interpolate: false` section appended in order after the existing sections,
 * with an incrementing `order` so card order and prompt order agree. Known
 * `{{name}}` variables are replaced here from the assembly's own variable map;
 * unknown ones stay literal (and `interpolate: false` stops a second pass).
 *
 * @param {object} assembly - the `system-prompt/assemble` payload.
 * @param {{ enabled: boolean, segments: Array<{ id?: string, text: string }> }} config
 * @returns {object} the same assembly when inactive, else a new one.
 */
export function applySystemPrompt(assembly, config) {
  if (config?.enabled !== true) return assembly;
  const segments = (Array.isArray(config.segments) ? config.segments : [])
    .filter((segment) => typeof segment?.text === 'string' && segment.text.trim() !== '');
  if (segments.length === 0) return assembly;
  if (assembly === null || typeof assembly !== 'object' || !Array.isArray(assembly.sections)) return assembly;

  const variables = assembly.variables ?? {};
  const sections = [...assembly.sections, ...segments.map((segment, index) => ({
    name: `${SECTION_NAME}#${index}`,
    text: interpolate(segment.text, variables),
    interpolate: false,
    order: SECTION_ORDER + index,
  }))];
  return { ...assembly, sections };
}
