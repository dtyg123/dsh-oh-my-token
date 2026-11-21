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

import { resolveConfig } from './lib/config.js';
import { compressToolResult, normalizeDecision } from './lib/gate.js';
import { stripAssistantStream, stripClaimedMessages, stripHistoryMessages } from './lib/messages.js';
import {
  applySystemPrompt, describeLiveAssembly, describeRequest, emptySystemPrompt,
  sanitizeSystemPrompt,
} from './lib/system-prompt.js';
import {
  MODE_IDS, PROSE_SCOPES, effectiveConfig, readState, resolveModes, sanitizeModePatch,
  sanitizeScope, stateDirectory, writeState,
} from './lib/modes.js';
import {
  emptyStats, readStats, recordCall, recordMessageStrip, recordRewrite, summarize, writeStats,
} from './lib/stats.js';

/** Cordis plugin identity. */
export const name = 'oh-my-token';
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
    modes: { ...resolveModes(row), ...(persisted?.modes ?? {}) },
    proseScope: persisted?.proseScope ?? row.prose.scope,
    systemPrompt: persisted?.systemPrompt ?? emptySystemPrompt(),
  };
  // A single object the gate reads on every call; a switch replaces its
  // contents rather than rebuilding the listener.
  const policy = effectiveConfig(row, state);

  const session = emptyStats();
  let cumulative = readStats(profileDir);
  // Read-only snapshot of the latest agent request, for the settings page.
  let lastRequest;
  // Live assembly fallback: on first launch there is no captured request yet,
  // so read the currently registered sections instead. `preview` also keeps
  // our own system-prompt edit from showing up as if it were original.
  const previewPrompt = async () => {
    try {
      const assemble = ctx.get?.('systemPrompt')?.assemble?.bind(ctx.get('systemPrompt'));
      if (typeof assemble !== 'function') return undefined;
      return describeLiveAssembly(await assemble({ preview: true }));
    } catch (error) {
      ctx.logger?.warn?.(`oh-my-token: live prompt preview failed (${String(error?.message ?? error)})`);
      return undefined;
    }
  };
  let timer;
  const flush = () => writeStats(profileDir, cumulative);
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

  /** The state the settings page renders. */
  const statePayload = () => ({
    modes: MODE_IDS.map((id) => ({ id, on: state.modes[id] !== false })),
    proseScope: state.proseScope,
    scopes: PROSE_SCOPES,
    systemPrompt: state.systemPrompt,
    profileDir: profileDir ?? null,
    session: summarize(session),
    cumulative: summarize(cumulative),
    generatedAt: new Date().toISOString(),
  });

  ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = normalizeDecision(await next());
    // A non-accept decision, or a value replacement, belongs to another
    // listener or to the definition that owns the projection: leave it alone.
    if (decision.kind !== 'accept' || Object.hasOwn(decision, 'value')) return decision;

    const content = decision.content ?? result?.content;
    if (!Array.isArray(content) || content.length === 0) return decision;

    recordCall(session, exec?.name ?? 'unknown');
    recordCall(cumulative, exec?.name ?? 'unknown');
    try {
      const blocks = await compressToolResult(exec, result ?? {}, content, policy, ctx);
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
  // per session removes periods from past turns upstream without touching the
  // durable log. Count each historical message only once, not every step.
  const patchedSessions = new WeakSet();
  const countedHistory = new Set();
  const countHistoryStrip = (id, before, after) => {
    if (id !== undefined) {
      if (countedHistory.has(id)) return;
      if (countedHistory.size > 20000) countedHistory.clear();
      countedHistory.add(id);
    }
    countStrip(id, before, after);
  };

  // The claimed messages become both the durable `user/message` append and the
  // model request (which is derived from the session log), so stripping here
  // keeps the record and the bytes the model reads identical.
  ctx.on('agent/pre-step', async (payload, next) => {
    const sessionObject = payload?.agent?.session;
    if (state.modes.proseStrip !== false && sessionObject && !patchedSessions.has(sessionObject)
      && typeof sessionObject.deriveMessages === 'function') {
      const derive = sessionObject.deriveMessages.bind(sessionObject);
      sessionObject.deriveMessages = () => stripHistoryMessages(derive(), countHistoryStrip);
      patchedSessions.add(sessionObject);
    }
    const decision = await next();
    if (state.modes.proseStrip === false || decision?.kind !== 'enter') return decision;
    const messages = stripClaimedMessages(decision.messages, payload?.messages, countStrip);
    return messages === decision.messages ? decision : { ...decision, messages };
  });

  // The official prompt seam: one extra section appended to, or replacing,
  // the assembled system prompt. Context sections are left alone. A `preview`
  // assembly (the settings page reading the original prompt) skips the edit.
  ctx.on('system-prompt/assemble', async (assembly, _context, next) => {
    const result = await next();
    if (state.modes.systemPrompt !== true || _context?.preview) return result;
    return applySystemPrompt(result, { enabled: true, ...state.systemPrompt });
  });

  // Wrap the LLM chunk stream at the outermost waterfall position. The
  // `block-end` text is what the assembler uses for the assistant message and
  // what the durable stream records, so rewriting it here covers both.
  ctx.on('llm/stream', (options, next) => {
    if (options?.sessionId !== undefined) lastRequest = describeRequest(options);
    const stream = next();
    return state.modes.proseStrip === false ? stream : stripAssistantStream(stream, countStrip);
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
          const systemPrompt = sanitizeSystemPrompt(body?.systemPrompt);
          if (Object.keys(patch).length === 0 && scope === undefined && systemPrompt === undefined) {
            sendJson(response, 400, { error: 'no valid switch values in "modes", no "proseScope" and no "systemPrompt"' });
            return;
          }
          Object.assign(state.modes, patch);
          if (scope !== undefined) state.proseScope = scope;
          if (systemPrompt !== undefined) state.systemPrompt = systemPrompt;
          Object.assign(policy, effectiveConfig(row, state));
          const path = writeState(profileDir, state);
          ctx.logger.info(
            `oh-my-token: settings changed (${Object.entries(patch).map(([key, on]) => `${key}=${on}`).join(' ') || 'no switch change'}`
            + `${scope === undefined ? '' : ` proseScope=${scope}`}), `
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
        // A captured request is the truth: read it verbatim. Before the first
        // request exists, assemble the currently registered sections live so
        // the page works from the first launch; `preview` keeps the edit off.
        const snapshot = lastRequest ?? await previewPrompt();
        sendJson(response, 200, snapshot ?? { prompt: '', tools: '', capturedAt: null, source: 'empty' });
      },
    }), 'oh-my-token: prompt route');
  });

  ctx.logger.info(
    `oh-my-token: ready (budgets default=${row.budgets.default} read=${row.budgets.read} `
    + `minChars=${row.minChars} recovery=${row.recovery} prose=${state.modes.proseStrip ? state.proseScope : 'off'} `
    + `profile=${profileDir ?? 'not found'})`,
  );
}
