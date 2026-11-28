/**
 * Reading the system prompt that is actually in use.
 *
 * DSH exposes the official `system-prompt/assemble` waterfall at the point
 * where every section is final — the core prompt, the registered context
 * producers, and whatever other plugins injected. The settings page shows that
 * result verbatim, so what you read is what the next request carries.
 *
 * This module never edits the prompt: it only renders the assembled sections
 * into text a person can read.
 *
 * @module dsh-oh-my-token/system-prompt
 */

/**
 * Replace known `{{name}}` prompt variables, keeping unknown ones literal.
 * Known but valueless variables (e.g. a model not chosen yet) also stay
 * literal, so reading the prompt never throws.
 * @param {string} text
 * @param {Record<string, unknown>} variables
 * @returns {string}
 */
function interpolate(text, variables) {
  return text.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g, (whole, name) =>
    Object.hasOwn(variables, name) && variables[name] !== undefined ? String(variables[name]) : whole);
}

/**
 * Render an `assemble()` result's sections into prompt text.
 *
 * The sections are not yet interpolated at this point, so known variables are
 * substituted here and unknown `{{name}}` groups stay literal instead of
 * throwing (a read must never fail because a request-scoped variable, e.g.
 * `{{provider}}`, has no value outside a real turn).
 *
 * @param {object | undefined} assembly - the `system-prompt/assemble` result.
 * @returns {string}
 */
export function renderAssembly(assembly) {
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
 * Build a snapshot of the prompt in use from a freshly assembled prompt.
 * @param {object} assembly - the `system-prompt/assemble` result.
 * @returns {{ prompt: string, capturedAt: null, source: 'live', sections: number }}
 */
export function describeLiveAssembly(assembly) {
  const prompt = renderAssembly(assembly);
  return {
    prompt,
    capturedAt: null,
    source: 'live',
    sections: Array.isArray(assembly?.sections) ? assembly.sections.length : 0,
  };
}
