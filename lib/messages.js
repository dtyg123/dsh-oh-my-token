/**
 * Chat-message trimming for `dsh-oh-my-token`.
 *
 * The tool-result gate owns its bytes at `tools/post-execute`. Chat text needs
 * two other seams so the durable record and the model request stay identical:
 *
 * - User prompts: `agent/pre-step` returns the message array that is both
 *   appended to the session and read back to build the next request.
 * - Assistant replies: the `llm/stream` waterfall wraps the chunk stream that
 *   feeds the durable compact stream *and* the message assembler. The DeepSeek
 *   adapter's `block-end` carries the complete text block, and the assembler
 *   prefers it over the deltas, so rewriting that one chunk is enough — every
 *   consumer derives the same stripped text, with no streaming delay.
 *
 * Both are gated by the same `proseStrip` switch as the tool-output trimmer.
 *
 * @module dsh-oh-my-token/messages
 */

import { stripTrailingPeriods } from './text.js';
import { rtkCompress } from './rtk.js';

/**
 * Rebuild one message's text blocks; non-text blocks and unchanged text keep identity.
 *
 * `options.edits` is a Map of message id to the user's rewritten text: the first
 * text block of a matched message is replaced with the edit before the prose
 * step runs, so the user's words are what the next request carries while the
 * durable record keeps the original.
 */
function stripTextBlocks(message, onStrip, options = {}) {
  const edits = options.edits;
  const byId = edits !== undefined && typeof edits.get === 'function' && typeof message.id !== 'undefined'
    ? edits.get(message.id)
    : undefined;
  // An edit made from the chat is keyed by the text it replaces, so it needs no
  // session and no message id: the first block whose text matches is rewritten,
  // and it lands in the next request only.
  const byText = options.editsByText !== undefined && typeof options.editsByText.get === 'function'
    ? options.editsByText
    : undefined;
  let editApplied = false;
  let changed = false;
  let before = 0;
  let after = 0;
  const blocks = message.content.map((block) => {
    if (block === null || typeof block !== 'object' || block.type !== 'text' || typeof block.text !== 'string') return block;
    let source = block.text;
    if (byId !== undefined && !editApplied) {
      source = byId;
      editApplied = true;
    } else if (byText !== undefined) {
      const replaced = byText.get(block.text);
      if (replaced !== undefined) source = replaced;
    }
    let next = source;
    next = stripTrailingPeriods(next, {
      ...options,
      onLine: typeof options.onProse === 'function' ? options.onProse : options.onLine,
    });
    if (next === block.text) return block;
    changed = true;
    before += block.text.length;
    after += next.length;
    return { ...block, text: next };
  });
  if (!changed) return message;
  if (typeof onStrip === 'function') onStrip(message.id, before, after);
  return { ...message, content: blocks };
}

/**
 * Rebuild one user prompt with its prose text blocks stripped.
 *
 * Messages are deep-frozen by the runtime, so this returns a new object rather
 * than editing in place. Identity is preserved for messages that do not change
 * (and for non-text blocks), which keeps listeners that match claimed messages
 * by reference working.
 *
 * @param {unknown} message
 * @param {(id: unknown, before: number, after: number) => void} [onStrip]
 * @returns {unknown} the same object when nothing changed, else a stripped copy.
 */
export function stripUserMessage(message, onStrip, options = {}) {
  if (message === null || typeof message !== 'object') return message;
  if (message.role !== 'user' || message.source?.kind !== 'user') return message;
  if (!Array.isArray(message.content)) return message;
  return stripTextBlocks(message, onStrip, options);
}

/**
 * Strip only the messages the agent claimed for this step. Other messages in
 * the decision (injected context, for example) are left by identity.
 *
 * @param {unknown[]} messages - the decision's message array.
 * @param {unknown[]} claimed - the original payload messages.
 * @param {(id: unknown, before: number, after: number) => void} [onStrip]
 * @returns {unknown[]} the original array when nothing changed, else a new one.
 */
export function stripClaimedMessages(messages, claimed, onStrip, options = {}) {
  if (!Array.isArray(messages) || !Array.isArray(claimed)) return messages;
  let changed = false;
  const out = messages.map((message) => {
    if (!claimed.includes(message)) return message;
    const stripped = stripUserMessage(message, onStrip, options);
    if (stripped !== message) changed = true;
    return stripped;
  });
  return changed ? out : messages;
}

/**
 * Compress one tool result's text blocks with RTK. Non-text and unchanged
 * blocks keep identity so claimed-message matching keeps working.
 */
function compressToolBlocks(message, onStrip) {
  if (!Array.isArray(message.content)) return message;
  let changed = false;
  let before = 0;
  let after = 0;
  const blocks = message.content.map((block) => {
    if (block === null || typeof block !== 'object' || block.type !== 'text' || typeof block.text !== 'string') return block;
    const step = rtkCompress(block.text);
    if (step === null) return block;
    changed = true;
    before += block.text.length;
    after += step.text.length;
    return { ...block, text: step.text };
  });
  if (!changed) return message;
  if (typeof onStrip === 'function') onStrip(message.id, before, after);
  return { ...message, content: blocks };
}

/**
 * Strip one message of a derived history snapshot. Tool results are compacted
 * on the model's copy only (the durable log is never rewritten); user and
 * assistant text lose sentence-final marks when the prose switch is on.
 */
function stripHistoryMessage(message, onStrip, options) {
  if (message === null || typeof message !== 'object') return message;
  if (message.role === 'tool') {
    return options.rtk === true ? compressToolBlocks(message, onStrip) : message;
  }
  const byId = options.edits !== undefined && typeof options.edits.get === 'function' && options.edits.has(message.id);
  const byText = options.editsByText !== undefined && Array.isArray(message.content)
    && message.content.some((block) => block !== null && typeof block === 'object'
      && block.type === 'text' && options.editsByText.has(block.text));
  const hasEdits = byId || byText;
  if (options.prosePunctuation === false && options.prosePoliteness === false && !hasEdits) return message;
  if (message.role === 'user' && message.source?.kind !== 'user') return message;
  if (message.role !== 'user' && message.role !== 'assistant') return message;
  if (!Array.isArray(message.content)) return message;
  return stripTextBlocks(message, onStrip, {
    punctuation: options.prosePunctuation,
    politeness: options.prosePoliteness,
    words: options.words,
    edits: hasEdits ? options.edits : undefined,
    editsByText: hasEdits ? options.editsByText : undefined,
  });
}

/**
 * Rewrite a derived history snapshot without touching the durable record.
 *
 * - old tool results (`role: "tool"`) are compacted with the RTK filters;
 * - user/assistant prose loses its sentence-final marks.
 *
 * Both are opt-in through `options`, and both return the original array/object
 * when nothing changed. `onStrip` receives the message id and the character
 * counts so the caller can count a saving once per message.
 *
 * @param {unknown[]} messages - the derived messages.
 * @param {(id: unknown, before: number, after: number) => void} [onStrip]
 * @param {{ prose?: boolean, punctuation?: boolean, politeness?: boolean, rtk?: boolean, words?: Array<{ word: string, replace?: string, unlessBefore?: string[], unlessAfter?: string[] }>, edits?: Map<string, string>, editsByText?: Map<string, string> }} [options]
 * @returns {unknown[]} the original array when nothing changed, else a new one.
 */
export function stripHistoryMessages(messages, onStrip, options = {}) {
  if (!Array.isArray(messages)) return messages;
  const effective = {
    prosePunctuation: options.punctuation !== false && options.prose !== false,
    prosePoliteness: options.politeness !== false && options.prose !== false,
    rtk: options.rtk === true,
    words: options.words,
    edits: options.edits,
    editsByText: options.editsByText,
  };
  let changed = false;
  const out = messages.map((message) => {
    const stripped = stripHistoryMessage(message, onStrip, effective);
    if (stripped !== message) changed = true;
    return stripped;
  });
  return changed ? out : messages;
}

/**
 * Wrap an LLM chunk stream so completed text blocks lose sentence-final marks.
 *
 * Only `block-end` with a text block is touched: deltas stay byte-for-byte so
 * live streaming is unchanged, while the assembled message — which the
 * assembler takes from `block-end` — and the durable stream both carry the
 * stripped text.
 *
 * @param {AsyncIterable<object>} stream - the downstream chunk stream.
 * @param {(id: unknown, before: number, after: number) => void} [onStrip]
 * @param {{ punctuation?: boolean, politeness?: boolean, words?: Array<{ word: string, replace?: string, unlessBefore?: string[], unlessAfter?: string[] }>, onProse?: (before: string, after: string) => void }} [options]
 * @returns {AsyncGenerator<object>} the rewritten stream.
 */
export async function* stripAssistantStream(stream, onStrip, options = {}) {
  const punctuation = options.punctuation !== false;
  const politeness = options.politeness !== false;
  if (!punctuation && !politeness) {
    yield* stream;
    return;
  }
  for await (const chunk of stream) {
    if (chunk?.type === 'block-end' && chunk.block?.type === 'text' && typeof chunk.block.text === 'string') {
      const text = stripTrailingPeriods(chunk.block.text, {
        punctuation,
        politeness,
        words: options.words,
        onLine: options.onProse,
      });
      if (text !== chunk.block.text) {
        if (typeof onStrip === 'function') onStrip(undefined, chunk.block.text.length, text.length);
        yield { ...chunk, block: { ...chunk.block, text } };
        continue;
      }
    }
    yield chunk;
  }
}
