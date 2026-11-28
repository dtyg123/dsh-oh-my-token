/**
 * `dsh-oh-my-token` — keep tool output out of the prompt unless the agent
 * needs it.
 *
 * One extension point for the work, `tools/post-execute`, so the replacement is
 * what gets logged and what the model reads: by construction they are the same
 * bytes, and history stays append-only (the prefix cache is never invalidated).
 *
 * What it does, in order of how much it usually saves:
 *
 * 1. Command filters — the command the model already ran is parsed and the
 *    verdict plus failure detail are kept instead of the progress log. This is
 *    the *idea* behind RTK, reimplemented in-process: no binary, no wrapper, no
 *    command rewriting.
 * 2. Retrieval-shaped reads — a large un-ranged `read` becomes a symbol
 *    outline, and a huge `grep` is capped. The codegraph principle without the
 *    graph database: spend a call on the map, then another on a range.
 * 3. `spillStore` elision for anything still too large, so full text is
 *    recoverable rather than gone.
 * 4. Conservative prose trimming: a sentence-final `.` / `。` on a line that is
 *    provably prose. Code, diffs, paths, URLs and versions are never touched.
 *
 * Two exact HTTP routes back the settings page: the switch state and the
 * savings record. They are the bridge a profile-installed bundle can actually
 * use, since `host.call` belongs to the sandboxed dynamic-package mechanism.
 *
 * The module imports nothing but Node builtins and its own files: a
 * profile-installed bundle resolves from the profile's `node_modules`, where
 * `@deepseek-ai/*` does not exist.
 *
 * @module dsh-oh-my-token
 */

import { readFileSync } from 'node:fs';
import { resolveConfig } from './lib/config.js';
import { compressToolResult, normalizeDecision } from './lib/gate.js';
import { stripAssistantStream, stripClaimedMessages, stripHistoryMessages } from './lib/messages.js';
import { describeLiveAssembly } from './lib/system-prompt.js';
import {
  MODE_IDS, PROSE_SCOPES, applyConfigOverrides, effectiveConfig, mergeConfigPatch, readState,
  resolveModes, sanitizeConfigPatch, sanitizeEdits, sanitizeModePatch, sanitizeRecent, sanitizeScope,
  stateDirectory, writeState,
} from './lib/modes.js';
import { describeProseChange, diffWords } from './lib/text.js';
import {
  emptyStats, readStats, recordCall, recordMessageStrip, recordRewrite, summarize, writeStats,
} from './lib/stats.js';

/** Cordis plugin identity. */
export const name = 'oh-my-token';
/** The repository the About card links to. */
const REPOSITORY = 'https://github.com/dtyg123/dsh-oh-my-token';
/** This package's own version, for the About card; empty when unreadable. */
const VERSION = (() => {
  try {
    return String(JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version ?? '');
  } catch {
    return '';
  }
})();
/** The tool registry, plus the optional web server for the settings page. */
export const inject = ['tools'];
/** How long statistics may sit unsaved after the last change. */
const FLUSH_MS = 1000;

/** A JSON response, mirroring the shape the shipped routes use. */
function sendJson(response, status, body) {
  const payload = `${JSON.stringify(body)}\n`;
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  response.end(payload);
}

/** Read a bounded JSON request body. */
async function readJsonBody(request, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error('request body too large');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/**
 * Mount the plugin.
 * @param {object} ctx - plugin context with `tools` injected.
 * @param {unknown} config - the loader row's `config`, validated here.
 */
export function apply(ctx, config) {
  const row = resolveConfig(config);
  if (!row.enabled) return;

  const profileDir = stateDirectory();
  const persisted = readState(profileDir);
  const state = {
    enabled: typeof persisted?.enabled === 'boolean' ? persisted.enabled : row.enabled,
    modes: { ...resolveModes(row), ...(persisted?.modes ?? {}) },
    proseScope: persisted?.proseScope ?? row.prose.scope,
    config: persisted?.config ?? {},
    edits: sanitizeEdits(persisted?.edits) ?? [],
    // The change record survives a restart, so the page is not blank every time
    // the app is reopened.
    recent: sanitizeRecent(persisted?.recent) ?? [],
  };
  // A single object the gate reads on every call; a switch replaces its
  // contents rather than rebuilding the listener.
  const policy = effectiveConfig(applyConfigOverrides(row, state.config), state);
  // User-rewritten conversation text: message id -> replacement. The Map is
  // mutated in place so listeners that captured it (the deriveMessages patch)
  // always see the current edits. Applied to the derived copy only.
  const editsMap = new Map(state.edits.filter((item) => typeof item.id === 'string').map((item) => [item.id, item.text]));
  // Chat-made edits name the text they replace, so they apply even when the host
  // has not seen this session yet (a restart before the first request).
  const editsByText = new Map(state.edits.filter((item) => typeof item.from === 'string').map((item) => [item.from, item.text]));

  /** What the prose step removed/added, newest last; the page shows the tail. */
  const recordProseNote = (label, before, after) => {
    const diff = diffWords(before, after);
    const notes = describeProseChange(before, after, policy.prose?.politenessWords);
    if (notes.length === 0 && !diff.some((segment) => segment.kind !== 'keep')) return;
    // `after` is what the chat shows for that message, so the client can find
    // this record again and draw the removals where they used to be.
    state.recent.push({
      at: Date.now(),
      label,
      notes,
      diff,
      after: after.length > 400 ? after.slice(0, 400) : after,
    });
    if (state.recent.length > 50) state.recent.shift();
    scheduleFlush();
  };

  const session = emptyStats();
  let cumulative = readStats(profileDir);
  // The prompt that was actually used. Reading it live from the HTTP route
  // deadlocks inside the host, so the assemble waterfall records a snapshot
  // instead — and that is the honest source anyway: it is the prompt a request
  // carried, including every section other plugins injected.
  let lastPrompt = null;
  let timer;
  const flush = () => {
    writeStats(profileDir, cumulative);
    // The change record lives in the same file as the switches, so a note is
    // persisted by the debounced flush that follows it.
    writeState(profileDir, state);
  };
  const scheduleFlush = () => {
    if (profileDir === undefined || timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      flush();
    }, FLUSH_MS);
    timer.unref?.();
  };
  ctx.effect(() => () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    flush();
  });

  /**
   * The chat-written edits as diffs, so the message they will replace can show
   * the removed words in red and the new ones in green right away. Capped: a
   * pair larger than this is simply not previewed.
   */
  const editDiffs = () => state.edits
    .filter((entry) => typeof entry.from === 'string' && entry.from.length + entry.text.length <= 4000)
    .map((entry) => ({ from: entry.from, segments: diffWords(entry.from, entry.text) }));

  /** The state the settings page renders. */
  const statePayload = () => ({
    enabled: state.enabled,
    modes: MODE_IDS.map((id) => ({ id, on: state.modes[id] !== false })),
    proseScope: state.proseScope,
    scopes: PROSE_SCOPES,
    config: applyConfigOverrides(row, state.config),
    recent: state.recent.slice(-50).reverse(),
    editDiffs: editDiffs(),
    version: VERSION,
    repo: REPOSITORY,
    profileDir: profileDir ?? null,
    session: summarize(session),
    cumulative: summarize(cumulative),
    generatedAt: new Date().toISOString(),
  });

  ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = normalizeDecision(await next());
    // A non-accept decision, or a value replacement, belongs to another
    // listener or to the definition that owns the projection: leave it alone.
    if (!state.enabled || decision.kind !== 'accept' || Object.hasOwn(decision, 'value')) return decision;

    const content = decision.content ?? result?.content;
    if (!Array.isArray(content) || content.length === 0) return decision;

    recordCall(session, exec?.name ?? 'unknown');
    recordCall(cumulative, exec?.name ?? 'unknown');
    try {
      const blocks = await compressToolResult(exec, result ?? {}, content, policy, ctx,
        (before, after) => recordProseNote(String(exec?.name ?? 'tool'), before, after));
      if (blocks === undefined) return decision;

      const after = blocks.reduce((sum, block) => sum + (block?.type === 'text' ? block.text.length : 0), 0);
      const before = content.reduce((sum, block) => sum + (block?.type === 'text' ? block.text.length : 0), 0);
      if (after >= before) return decision;

      recordRewrite(session, exec?.name ?? 'unknown', before, after);
      recordRewrite(cumulative, exec?.name ?? 'unknown', before, after);
      scheduleFlush();
      if (row.logEvery > 0 && session.rewritten % row.logEvery === 0) {
        const saved = session.before - session.after;
        ctx.logger.debug(
          `oh-my-token: ${session.rewritten}/${session.calls} results rewritten, `
          + `${saved} chars saved (${(100 * saved / session.before).toFixed(1)}%)`,
        );
      }
      return {
        kind: 'accept',
        content: blocks,
        ...(Array.isArray(decision.additionalContexts) && decision.additionalContexts.length > 0
          ? { additionalContexts: decision.additionalContexts }
          : {}),
      };
    } catch (error) {
      // A compression fault must never turn a successful tool call into an
      // error, so the original decision is returned untouched.
      ctx.logger.warn(`oh-my-token: ${exec?.name} compression skipped (${String(error)})`);
      return decision;
    }
  });

  // A chat strip counts like a tool rewrite in the savings panel, but has no
  // tool name; it is tracked separately (`messages`) as well.
  const countStrip = (_id, before, after) => {
    if (after >= before) return;
    recordMessageStrip(session, before, after);
    recordMessageStrip(cumulative, before, after);
    scheduleFlush();
  };

  // `deriveMessages()` is the source of every model request. Wrapping it once
  // per session rewrites past turns (periods, words, and user edits) upstream
  // without touching the durable log. The options object is rebuilt on every
  // call, so switches and edits take effect without repatching.
  const patchedSessions = new WeakSet();
  const countedHistory = new Set();
  let latestSession = null;
  const countHistoryStrip = (id, before, after) => {
    if (id !== undefined) {
      if (countedHistory.has(id)) return;
      if (countedHistory.size > 20000) countedHistory.clear();
      countedHistory.add(id);
    }
    countStrip(id, before, after);
  };
  const liveHistoryOptions = () => ({
    punctuation: state.modes.proseStrip !== false,
    politeness: policy.prose?.stripPoliteness !== false,
    rtk: state.modes.rtk !== false,
    words: policy.prose?.politenessWords,
    edits: editsMap,
    editsByText,
  });

  /**
   * The last thirty user/assistant text messages of the most recent session,
   * newest first, for the conversation-edit list. Reads the raw log when the
   * session exposes it, else the derived copy (which is what the model reads).
   */
  function readRecentMessages() {
    const source = latestSession;
    if (source === null) return [];
    const raw = Array.isArray(source.messages)
      ? source.messages
      : typeof source.deriveMessages === 'function' ? source.deriveMessages()
      : [];
    const items = [];
    for (let i = raw.length - 1; i >= 0 && items.length < 30; i -= 1) {
      const message = raw[i];
      if (message === null || typeof message !== 'object') continue;
      if (message.role === 'user' && message.source?.kind !== 'user') continue;
      if (message.role !== 'user' && message.role !== 'assistant') continue;
      if (typeof message.id !== 'string' || message.id === '') continue;
      const text = Array.isArray(message.content)
        ? message.content
          .filter((block) => block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string')
          .map((block) => block.text)
          .join('\n')
        : '';
      if (text === '') continue;
      const id = message.id;
      items.push({
        id,
        role: message.role,
        snippet: text.length > 120 ? `${text.slice(0, 120)}…` : text,
        edited: editsMap.has(id),
        text: editsMap.get(id) ?? text,
      });
    }
    return items;
  }

  // The claimed messages become both the durable `user/message` append and the
  // model request (which is derived from the session log), so stripping here
  // keeps the record and the bytes the model reads identical.
  ctx.on('agent/pre-step', async (payload, next) => {
    if (!state.enabled) return next();
    const sessionObject = payload?.agent?.session;
    if (sessionObject !== null && typeof sessionObject === 'object') {
      latestSession = sessionObject;
      if (!patchedSessions.has(sessionObject) && typeof sessionObject.deriveMessages === 'function') {
        const derive = sessionObject.deriveMessages.bind(sessionObject);
        sessionObject.deriveMessages = () => stripHistoryMessages(
          derive(),
          countHistoryStrip,
          liveHistoryOptions(),
        );
        patchedSessions.add(sessionObject);
      }
    }
    const decision = await next();
    if (decision?.kind !== 'enter') return decision;
    const wantPunctuation = state.modes.proseStrip !== false;
    const wantPoliteness = policy.prose?.stripPoliteness !== false;
    // Edits apply even with every prose switch off: they are the user's own
    // words, not a transform.
    if (!wantPunctuation && !wantPoliteness && editsMap.size === 0 && editsByText.size === 0) return decision;
    const messages = stripClaimedMessages(decision.messages, payload?.messages, countStrip, {
      punctuation: wantPunctuation,
      politeness: wantPoliteness,
      words: policy.prose?.politenessWords,
      edits: editsMap.size > 0 ? editsMap : undefined,
      editsByText: editsByText.size > 0 ? editsByText : undefined,
      onProse: (before, after) => recordProseNote('user message', before, after),
    });
    return messages === decision.messages ? decision : { ...decision, messages };
  });

  // Observe the composed system prompt (never edit it): the waterfall is the
  // point where every section is final, so the snapshot is byte-for-byte what
  // the request carries.
  ctx.on('system-prompt/assemble', async (assembly, _context, next) => {
    const result = await next();
    try {
      lastPrompt = { ...describeLiveAssembly(result), at: Date.now() };
    } catch (error) {
      ctx.logger?.warn?.(`oh-my-token: prompt snapshot failed (${String(error?.message ?? error)})`);
    }
    return result;
  });

  // Wrap the LLM chunk stream at the outermost waterfall position. The
  // `block-end` text is what the assembler uses for the assistant message and
  // what the durable stream records, so rewriting it here covers both.
  ctx.on('llm/stream', (options, next) => {
    const stream = next();
    const punctuation = state.modes.proseStrip !== false;
    const politeness = policy.prose?.stripPoliteness !== false;
    if (!state.enabled || (!punctuation && !politeness)) return stream;
    return stripAssistantStream(stream, countStrip, {
      punctuation,
      politeness,
      words: policy.prose?.politenessWords,
      onProse: (before, after) => recordProseNote('assistant reply', before, after),
    });
  }, { prepend: true });

  // -------------------------------------------------------------------------
  // The settings-page bridge
  // -------------------------------------------------------------------------
  // Registered through `ctx.inject` rather than a one-shot `ctx.get`: this row
  // activates as soon as `tools` is available, which can be before the web
  // server finishes listening.
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: '/dsh-oh-my-token/state',
      handler: async (request, response) => {
        try {
          if (request.method === 'GET') {
            sendJson(response, 200, statePayload());
            return;
          }
          if (request.method !== 'POST') {
            response.writeHead(405, { allow: 'GET, POST' });
            response.end();
            return;
          }
          const body = await readJsonBody(request);
          const patch = sanitizeModePatch(body?.modes);
          const scope = sanitizeScope(body?.proseScope);
          const configPatch = sanitizeConfigPatch(body?.config);
          const enabled = typeof body?.enabled === 'boolean' ? body.enabled : undefined;
          if (Object.keys(patch).length === 0 && scope === undefined
            && Object.keys(configPatch).length === 0 && enabled === undefined) {
            sendJson(response, 400, { error: 'no valid switch values, proseScope, config or enabled' });
            return;
          }
          Object.assign(state.modes, patch);
          if (scope !== undefined) state.proseScope = scope;
          if (enabled !== undefined) state.enabled = enabled;
          if (Object.keys(configPatch).length > 0) state.config = mergeConfigPatch(state.config, configPatch);
          Object.assign(policy, effectiveConfig(applyConfigOverrides(row, state.config), state));
          const path = writeState(profileDir, state);
          ctx.logger.info(
            `oh-my-token: settings changed (${Object.entries(patch).map(([key, on]) => `${key}=${on}`).join(' ') || 'no switch change'}`
            + `${scope === undefined ? '' : ` proseScope=${scope}`}`
            + `${enabled === undefined ? '' : ` enabled=${enabled}`}`
            + `${Object.keys(configPatch).length === 0 ? '' : ` config=${Object.keys(configPatch).join(',')}`}), `
            + `${path === undefined ? 'NOT persisted (no profile directory)' : `persisted to ${path}`}`,
          );
          sendJson(response, 200, { ...statePayload(), saved: path ?? null });
        } catch (error) {
          sendJson(response, 400, { error: String(error?.message ?? error) });
        }
      },
    }), 'oh-my-token: state route');

    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: '/dsh-oh-my-token/stats',
      handler: async (request, response) => {
        try {
          if (request.method === 'GET') {
            sendJson(response, 200, {
              session: summarize(session),
              cumulative: summarize(cumulative),
              generatedAt: new Date().toISOString(),
            });
            return;
          }
          if (request.method !== 'POST') {
            response.writeHead(405, { allow: 'GET, POST' });
            response.end();
            return;
          }
          const body = await readJsonBody(request);
          if (body?.reset !== true) {
            sendJson(response, 400, { error: 'send {"reset": true} to clear the all-time record' });
            return;
          }
          cumulative = emptyStats();
          const path = writeStats(profileDir, cumulative);
          sendJson(response, 200, {
            session: summarize(session),
            cumulative: summarize(cumulative),
            generatedAt: new Date().toISOString(),
            reset: true,
            saved: path ?? null,
          });
        } catch (error) {
          sendJson(response, 400, { error: String(error?.message ?? error) });
        }
      },
    }), 'oh-my-token: stats route');

    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: '/dsh-oh-my-token/prompt',
      handler: async (request, response) => {
        if (request.method !== 'GET') {
          response.writeHead(405, { allow: 'GET' });
          response.end();
          return;
        }
        // The snapshot the last request actually carried: every registered
        // section, including the ones other plugins injected.
        sendJson(response, 200, lastPrompt
          ?? { prompt: '', capturedAt: null, source: 'none', sections: 0 });
      },
    }), 'oh-my-token: prompt route');

    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: '/dsh-oh-my-token/edit',
      handler: async (request, response) => {
        try {
          if (request.method === 'GET') {
            sendJson(response, 200, { items: readRecentMessages(), generatedAt: new Date().toISOString() });
            return;
          }
          if (request.method !== 'POST') {
            response.writeHead(405, { allow: 'GET, POST' });
            response.end();
            return;
          }
          const body = await readJsonBody(request);
          const updates = Array.isArray(body?.items) ? body.items : [];
          const next = state.edits.slice();
          for (const item of updates) {
            if (item === null || typeof item !== 'object') continue;
            // Two keys: the message id (the settings list knows it) or the text
            // being replaced (the chat does not need to know it).
            const hasId = typeof item.id === 'string' && item.id !== '';
            const hasFrom = typeof item.from === 'string' && item.from !== '';
            if (!hasId && !hasFrom) continue;
            const at = next.findIndex((entry) => (hasId ? entry.id === item.id : entry.from === item.from));
            if (item.text === null) {
              if (at !== -1) next.splice(at, 1);
              continue;
            }
            if (typeof item.text !== 'string' || item.text.length === 0 || item.text.length > 20000) continue;
            const entry = hasId ? { id: item.id, text: item.text } : { from: item.from, text: item.text };
            if (at !== -1) next[at] = entry;
            else next.push(entry);
          }
          if (next.length > 50) next.splice(0, next.length - 50);
          state.edits = next;
          editsMap.clear();
          editsByText.clear();
          for (const entry of next) {
            if (typeof entry.id === 'string') editsMap.set(entry.id, entry.text);
            else if (typeof entry.from === 'string') editsByText.set(entry.from, entry.text);
          }
          const path = writeState(profileDir, state);
          ctx.logger.info(
            `oh-my-token: ${next.length} conversation edit(s) `
            + `${path === undefined ? 'NOT persisted (no profile directory)' : `persisted to ${path}`}`,
          );
          sendJson(response, 200, { items: readRecentMessages(), editDiffs: editDiffs(), saved: path ?? null });
        } catch (error) {
          sendJson(response, 400, { error: String(error?.message ?? error) });
        }
      },
    }), 'oh-my-token: edit route');
  });

  ctx.logger.info(
    `oh-my-token: ready (budgets default=${row.budgets.default} read=${row.budgets.read} `
    + `minChars=${row.minChars} recovery=${row.recovery} prose=${state.modes.proseStrip ? state.proseScope : 'off'} `
    + `profile=${profileDir ?? 'not found'})`,
  );
}
