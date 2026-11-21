/**
 * The admission gate: decide what part of a tool result enters the session.
 *
 * Runs inside `tools/post-execute`, before the result is logged, so the model
 * and the durable log see the same bytes. It never rewrites arguments and never
 * touches history.
 */

import {
  collapseBlankLines,
  resolveCarriageReturns,
  stripAnsi,
  stripTrailingPeriods,
  truncateMiddle,
} from './text.js';
import { applyCommandFilters, genericClean, splitExit, SHELL_TOOLS } from './filters.js';
import { extractReadPath, outlineRead, capSearch } from './retrieval.js';
import { rtkCompress } from './rtk.js';

const SEARCH_TOOLS = new Set(['grep', 'rg', 'search', 'search_files']);
const READ_TOOLS = new Set(['read', 'read_file']);

/** Repair a waterfall decision: a sibling listener may resolve `undefined`. */
export function normalizeDecision(value) {
  if (value === null || typeof value !== 'object') return { kind: 'accept' };
  return typeof value.kind === 'string' ? value : { ...value, kind: 'accept' };
}

export function isShellTool(name) {
  return SHELL_TOOLS.has(name) || /shell|bash|pwsh/i.test(String(name));
}

export function isSearchTool(name) {
  return SEARCH_TOOLS.has(name);
}

export function isReadTool(name) {
  return READ_TOOLS.has(name);
}

/** ANSI, carriage-return and blank-line cleanup shared by every branch. */
function cleanText(text) {
  return collapseBlankLines(resolveCarriageReturns(stripAnsi(text)));
}

/** Pick the character budget for this call. */
export function budgetFor(exec, result, config) {
  const base = config.budgets[exec.name]
    ?? (isShellTool(exec.name) ? config.budgets.bash : undefined)
    ?? config.budgets.default;
  return result.isError ? Math.round(base * config.budgets.errorFactor) : base;
}

/**
 * A recovery instruction for elided text, or `undefined` when no safe recovery
 * exists (in which case the gate refuses to elide).
 */
export async function recoveryHint(exec, originalText, config, ctx) {
  if (config.recovery === 'none') return undefined;

  const command = String(exec.arguments?.command ?? '').trim();
  const rerun = isShellTool(exec.name) && command !== ''
    ? `re-run \`${command}\``
    : `re-run ${exec.name}`;

  if (isReadTool(exec.name)) {
    const path = extractReadPath(originalText);
    return path === undefined ? 're-read the file with offset/limit' : `re-read ${path} with offset/limit`;
  }
  if (isSearchTool(exec.name)) return 'narrow with path/glob';
  if (config.recovery === 'rerun') return rerun;

  const store = typeof ctx?.get === 'function' ? ctx.get('spillStore') : undefined;
  const sessionId = exec.agent?.session?.header?.id ?? exec.agent?.id;
  if (store?.saveText !== undefined && sessionId !== undefined) {
    try {
      exec.signal?.throwIfAborted?.();
      const ref = await store.saveText({
        owner: { sessionId },
        source: { kind: 'tool', toolName: exec.name, callId: exec.callId, label: 'oh-my-token' },
        suggestedName: `${exec.name}.txt`,
        content: originalText,
      });
      exec.signal?.throwIfAborted?.();
      return `full text at ${ref.locator}${ref.retrievalHint ? `: ${ref.retrievalHint}` : ''}`;
    } catch (error) {
      ctx?.logger?.warn?.(`dsh-oh-my-token: spill of ${exec.name} failed (${String(error)}); keeping a re-run hint`);
    }
  }
  return rerun;
}

function shouldPunctuate(config, info) {
  if (!config.prose.stripTrailingPeriod || config.prose.scope === 'off') return false;
  return config.prose.scope === 'all' || info.prose === true;
}

/**
 * Compress the text blocks of one accepted result.
 *
 * @param {object} exec - immutable execution (name, arguments, agent, signal).
 * @param {object} result - normalized outcome (`isError`, `content`, ...).
 * @param {Array<object>} blocks - model-facing content blocks.
 * @param {object} config - resolved plugin config.
 * @param {object} ctx - plugin context (for `spillStore` and a logger).
 * @returns {Promise<Array<object> | undefined>} replacement blocks, or undefined.
 */
export async function compressToolResult(exec, result, blocks, config, ctx) {
  if (!Array.isArray(blocks) || blocks.length === 0) return undefined;
  const out = [];
  let changed = false;

  for (const block of blocks) {
    if (block?.type !== 'text' || typeof block.text !== 'string') {
      out.push(block);
      continue;
    }
    const original = block.text;
    if (original.length < config.minChars) {
      out.push(block);
      continue;
    }

    let text = cleanText(original);
    let info = { id: 'none', prose: false };

    try {
      if (isShellTool(exec?.name)) {
        const split = splitExit(text);
        text = split.body;
        const command = String(exec.arguments?.command ?? '');
        info = applyCommandFilters(command, text, {
          isError: result?.isError === true,
          exitCode: split.exitCode,
          signal: split.signal,
          config,
        });
        text = info.text;
        // Keep the shell tool's exit marker when a filter replaced the body.
        if ((split.exitCode !== undefined || split.signal !== undefined)
          && !/\[(?:exit code:|killed by signal:)/.test(text)) {
          text += split.signal !== undefined
            ? `\n[killed by signal: ${split.signal}]`
            : `\n[exit code: ${split.exitCode}]`;
        }
      } else if (isReadTool(exec?.name) && result?.isError !== true && config.retrieval.readOutline !== false) {
        const outline = outlineRead(text, {
          threshold: config.retrieval.readOutlineOverLines,
          maxSymbols: config.retrieval.maxOutlineSymbols,
        });
        if (outline !== undefined) {
          text = outline;
          info = { id: 'read-outline', prose: false };
        }
      } else if (isSearchTool(exec?.name) && result?.isError !== true && config.retrieval.grepCap !== false) {
        const capped = capSearch(text, { maxMatches: config.retrieval.maxGrepMatches });
        if (capped !== undefined) {
          text = capped;
          info = { id: 'grep-cap', prose: false };
        }
      } else if (config.filters.generic !== false) {
        text = genericClean(text);
        info = { id: 'generic', prose: false };
      }
    } catch (error) {
      ctx?.logger?.warn?.(`dsh-oh-my-token: ${exec?.name} filter skipped (${String(error)})`);
      out.push(block);
      continue;
    }

    let punctuated = false;
    if (shouldPunctuate(config, info)) {
      const next = stripTrailingPeriods(text);
      punctuated = next !== text;
      text = next;
    }

    // RTK-style structural compaction is the content fallback: it runs only
    // when no command-aware filter already claimed this result (`generic` or
    // `none`), and only when it makes the text strictly smaller. The budget
    // cap below still applies to whatever it produces.
    if (config.rtk !== false && (info.id === 'generic' || info.id === 'none')) {
      const step = rtkCompress(text);
      if (step !== null) {
        text = step.text;
        info = { id: step.id, prose: false };
      }
    }

    const budget = budgetFor(exec, result, config);
    if (text.length > budget) {
      const hint = await recoveryHint(exec, original, config, ctx);
      if (hint !== undefined) {
        const next = truncateMiddle(text, budget, hint);
        if (next.length < text.length) text = next;
      }
    }

    const saved = original.length - text.length;
    const gain = saved / original.length;
    if (saved <= 0 || (gain < config.minGain && !punctuated)) {
      out.push(block);
      continue;
    }
    out.push({ ...block, text });
    changed = true;
  }

  return changed ? out : undefined;
}
