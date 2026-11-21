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

/** Rebuild one message's text blocks; non-text blocks and unchanged text keep identity. */
function stripTextBlocks(message, onStrip) {
  let changed = false;
  let before = 0;
  let after = 0;
  const blocks = message.content.map((block) => {
    if (block === null || typeof block !== 'object' || block.type !== 'text' || typeof block.text !== 'string') return block;
    const text = stripTrailingPeriods(block.text);
    if (text === block.text) return block;
    changed = true;
    before += block.text.length;
    after += text.length;
    return { ...block, text };
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
export function stripUserMessage(message, onStrip) {
  if (message === null || typeof message !== 'object') return message;
  if (message.role !== 'user' || message.source?.kind !== 'user') return message;
  if (!Array.isArray(message.content)) return message;
  return stripTextBlocks(message, onStrip);
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
export function stripClaimedMessages(messages, claimed, onStrip) {
  if (!Array.isArray(messages) || !Array.isArray(claimed)) return messages;
  let changed = false;
  const out = messages.map((message) => {
    if (!claimed.includes(message)) return message;
    const stripped = stripUserMessage(message, onStrip);
    if (stripped !== message) changed = true;
    return stripped;
  });
  return changed ? out : messages;
}

/**
 * Strip one message of a derived history snapshot. Covers both the user's own
 * prompts and the assistant's past replies; system/developer/tool messages are
 * left alone.
 */
function stripHistoryMessage(message, onStrip) {
  if (message === null || typeof message !== 'object') return message;
  if (message.role === 'user' && message.source?.kind !== 'user') return message;
  if (message.role !== 'user' && message.role !== 'assistant') return message;
  if (!Array.isArray(message.content)) return message;
  return stripTextBlocks(message, onStrip);
}

/**
 * Strip trailing periods from every user/assistant message in a derived history
 * snapshot. `session.deriveMessages()` is the source of the model request, so
 * this removes old periods upstream without changing the durable record.
 *
 * @param {unknown[]} messages - the derived messages.
 * @param {(id: unknown, before: number, after: number) => void} [onStrip]
 * @returns {unknown[]} the original array when nothing changed, else a new one.
 */
export function stripHistoryMessages(messages, onStrip) {
  if (!Array.isArray(messages)) return messages;
  let changed = false;
  const out = messages.map((message) => {
    const stripped = stripHistoryMessage(message, onStrip);
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
 * @returns {AsyncGenerator<object>} the rewritten stream.
 */
export async function* stripAssistantStream(stream, onStrip) {
  for await (const chunk of stream) {
    if (chunk?.type === 'block-end' && chunk.block?.type === 'text' && typeof chunk.block.text === 'string') {
      const text = stripTrailingPeriods(chunk.block.text);
      if (text !== chunk.block.text) {
        if (typeof onStrip === 'function') onStrip(undefined, chunk.block.text.length, text.length);
        yield { ...chunk, block: { ...chunk.block, text } };
        continue;
      }
    }
    yield chunk;
  }
}
