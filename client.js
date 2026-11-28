/**
 * Client half of `dsh-oh-my-token`: the savings page inside Settings.
 *
 * The browser artifact is a lazy factory whose id equals the package name, so
 * the page's module table hands it React and nothing else. It mounts into
 * `settings.section` ("one settings page per list entry") and talks to the Host
 * half over the exact HTTP routes the Host half registers — the bridge a
 * profile-installed bundle can actually use.
 *
 * Every colour is a `--dsw-alias-*` theme token, so light and dark both read
 * correctly without a second stylesheet.
 *
 * This file holds Chinese literals. Edit it with a Unicode-safe tool and keep
 * it UTF-8 without a BOM.
 */
window.__ModuleLoader__.load({
  id: 'dsh-oh-my-token',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** The Host half's routes; kept in one place so both halves agree. */
    const STATE_ENDPOINT = '/dsh-oh-my-token/state';
    const STATS_ENDPOINT = '/dsh-oh-my-token/stats';
    const PROMPT_ENDPOINT = '/dsh-oh-my-token/prompt';
    const EDIT_ENDPOINT = '/dsh-oh-my-token/edit';

    // ── In-chat change marks ──────────────────────────────────────────────
    //
    // The model never reads the words the prose step removes, but the person
    // should still see what was cut. Every request's record carries the text it
    // produced; the same text is what the chat displays, so a message can be
    // matched back to its record and the removed words drawn where they were:
    // red and struck through, with any replacement in green.

    /** Text produced by a recorded change -> its diff segments. */
    const diffByText = new Map();

    /** Set by `apply`: re-registers the rule so rendered messages re-evaluate. */
    let nudgeDiffRules = null;

    /** Memoized removals per message text; cleared when the record grows. */
    const removalCache = new Map();

    /** @returns {boolean} whether anything new was remembered. */
    function rememberDiffs(recent) {
      if (!Array.isArray(recent)) return false;
      let added = false;
      for (const entry of recent) {
        if (typeof entry?.after !== 'string' || entry.after === '') continue;
        if (!Array.isArray(entry.diff)) continue;
        if (diffByText.has(entry.after)) continue;
        diffByText.set(entry.after, entry.diff);
        added = true;
      }
      // A long-lived tab would otherwise keep every message it ever saw.
      while (diffByText.size > 400) diffByText.delete(diffByText.keys().next().value);
      if (added) removalCache.clear();
      return added;
    }

    /**
     * Where the automatic step cut words out of a message.
     *
     * A record is one changed line, so a message is scanned for every recorded
     * line it contains and each removal is moved to its place in the message.
     * Each removal then hangs on the character next to it, because a node must
     * cover at least one character and this keeps reference chips intact.
     */
    function removalsOf(text) {
      const cached = removalCache.get(text);
      if (cached !== undefined) return cached;
      const out = [];
      for (const [shown, segments] of diffByText) {
        const at = text.indexOf(shown);
        if (at < 0) continue;
        let offset = at;
        let pending = null;
        for (const segment of segments) {
          const value = typeof segment?.text === 'string' ? segment.text : '';
          if (segment?.kind === 'del') {
            if (pending === null) pending = { removed: value, added: '', start: offset };
            else pending.removed += value;
            continue;
          }
          if (segment?.kind === 'add') {
            if (pending !== null) pending.added += value;
            continue;
          }
          if (value === '') continue;
          if (pending !== null) {
            pending.start = offset;
            out.push(pending);
            pending = null;
          }
          offset += value.length;
        }
        if (pending !== null) {
          // A removal at the very end hangs on the character before it.
          pending.start = Math.max(at, offset - 1);
          pending.trailing = true;
          out.push(pending);
        }
      }
      if (out.length === 0) {
        removalCache.set(text, null);
        return null;
      }
      out.sort((left, right) => left.start - right.start);
      removalCache.set(text, out);
      while (removalCache.size > 200) removalCache.delete(removalCache.keys().next().value);
      return out;
    }

    const DIFF_RULE_ID = 'oh-my-token';

    /** The user-message rule: one node per removal, so it renders where it was. */
    const diffRule = {
      id: DIFF_RULE_ID,
      order: 50,
      match(text, from) {
        if (!liveTextsNow.has(text) && !liveTextsNow.has(text.trim())) return undefined;
        const removals = removalsOf(String(text));
        if (removals === null) return undefined;
        for (const removal of removals) {
          if (removal.start < from) continue;
          return {
            id: DIFF_RULE_ID,
            start: removal.start,
            end: removal.start + 1,
            data: {
              removed: removal.removed,
              added: removal.added,
              trailing: removal.trailing === true,
            },
          };
        }
        return undefined;
      },
    };

    /**
     * A reply's body is rendered as markdown by the harness, so it has no text
     * hook. Its finished DOM is decorated instead: the words the request drops
     * are put back where they were, red and struck through. A re-render
     * replaces that DOM, and the observer decorates the new copy.
     */
    const MARK_ATTR = 'data-oh-my-token-mark';
    const MARKED_ATTR = 'data-oh-my-token-marked';
    const RED_CSS = 'color:var(--dsw-alias-state-error-primary);text-decoration:line-through;background:rgba(239,68,68,.16);border-radius:3px';
    const GREEN_CSS = 'color:var(--dsw-alias-state-success-primary);font-weight:600;background:rgba(34,197,94,.18);border-radius:3px';

    /** The body's text and each text node's offset in it. */
    function bodyText(root) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => (node.parentElement?.closest(`[${MARK_ATTR}]`) !== null
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT),
      });
      const nodes = [];
      let text = '';
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const value = node.nodeValue ?? '';
        if (value === '') continue;
        nodes.push({ node, start: text.length });
        text += value;
      }
      return { text, nodes };
    }

    /** One text node rebuilt with its removals marked. */
    function markedFragment(value, removals) {
      const fragment = document.createDocumentFragment();
      let cursor = 0;
      for (const removal of removals) {
        if (removal.local < cursor) continue;
        if (removal.local > cursor) fragment.appendChild(document.createTextNode(value.slice(cursor, removal.local)));
        const anchor = value.slice(removal.local, removal.local + 1);
        const removed = document.createElement('span');
        removed.setAttribute(MARK_ATTR, '1');
        removed.style.cssText = RED_CSS;
        removed.textContent = removal.removed;
        if (removal.trailing === true) {
          fragment.appendChild(document.createTextNode(anchor));
          fragment.appendChild(removed);
        } else {
          fragment.appendChild(removed);
          if (removal.added !== '') {
            const added = document.createElement('span');
            added.setAttribute(MARK_ATTR, '1');
            added.style.cssText = GREEN_CSS;
            added.textContent = removal.added;
            fragment.appendChild(added);
          }
          fragment.appendChild(document.createTextNode(anchor));
        }
        cursor = removal.local + 1;
      }
      if (cursor < value.length) fragment.appendChild(document.createTextNode(value.slice(cursor)));
      return fragment;
    }

    /** The text the live turn shows; the rule marks nothing outside it. */
    let liveTextsNow = new Set();
    /** A signature of that set, so a turn change re-registers the rule once. */
    let liveSignature = '';

    /** The flow items of the newest turn — the part that is still live. */
    function liveItems() {
      const items = [...document.querySelectorAll('[data-chat-flow-key]')];
      let best = -1;
      for (const item of items) {
        const turn = Number(item.getAttribute('data-chat-turn'));
        if (Number.isFinite(turn) && turn > best) best = turn;
      }
      if (best < 0) return [];
      return items.filter((item) => Number(item.getAttribute('data-chat-turn')) === best);
    }

    /** The message text a live turn shows, without our own marks. */
    function liveTexts(items) {
      const texts = new Set();
      for (const item of items) {
        for (const body of item.querySelectorAll('[data-text-interaction-source]')) {
          const { text } = bodyText(body);
          if (text === '') continue;
          texts.add(text);
          texts.add(text.trim());
        }
      }
      return texts;
    }

    /**
     * Decorate the live turn only: a turn that has moved on is already
     * compressed, so it keeps neither marks nor an edit control and stops
     * paying for them.
     */
    function decorateChat() {
      if (typeof document === 'undefined') return false;
      const items = liveItems();
      const live = new Set(items);
      const texts = liveTexts(items);
      const signature = [...texts].sort().join('\u0000');
      const scopeChanged = signature !== liveSignature;
      liveSignature = signature;
      liveTextsNow = texts;
      setLiveTurn(items.reduce((max, item) => Math.max(max, Number(item.getAttribute('data-chat-turn')) || 0), -1));

      // Drop our marks outside the live turn — once per turn change, not on
      // every pass, so the observer is not fed by its own cleanup.
      if (scopeChanged) {
        for (const mark of document.querySelectorAll(`[${MARK_ATTR}]`)) {
          const item = mark.closest('[data-chat-flow-key]');
          if (item === null || !live.has(item)) mark.remove();
        }
        for (const root of document.querySelectorAll(`[${MARKED_ATTR}]`)) {
          const item = root.closest('[data-chat-flow-key]');
          if (item === null || !live.has(item)) root.removeAttribute(MARKED_ATTR);
        }
      }

      if (diffByText.size > 0) {
        for (const item of items) {
          for (const root of item.querySelectorAll('[data-text-interaction-source]:not([data-message-bubble])')) {
            if (root.hasAttribute(MARKED_ATTR)) continue;
            const { text, nodes } = bodyText(root);
            if (text === '' || nodes.length === 0) continue;
            const removals = removalsOf(text);
            if (removals === null) continue;
            const groups = new Map();
            for (const removal of removals) {
              let hit = null;
              for (const entry of nodes) {
                if (entry.start > removal.start) break;
                hit = entry;
              }
              if (hit === null) continue;
              const local = removal.start - hit.start;
              const value = hit.node.nodeValue ?? '';
              if (local < 0 || local >= value.length) continue;
              if (!groups.has(hit.node)) groups.set(hit.node, []);
              groups.get(hit.node).push({ ...removal, local });
            }
            let changed = false;
            for (const [node, list] of groups) {
              const parent = node.parentNode;
              if (parent === null) continue;
              list.sort((left, right) => left.local - right.local);
              parent.replaceChild(markedFragment(node.nodeValue ?? '', list), node);
              changed = true;
            }
            if (changed) root.setAttribute(MARKED_ATTR, '1');
          }
        }
      }

      return scopeChanged;
    }

    /** The newest turn number, published so a message control can hide itself. */
    const liveTurnListeners = new Set();
    let liveTurnNow = -1;
    function setLiveTurn(turn) {
      if (turn === liveTurnNow) return;
      liveTurnNow = turn;
      for (const listener of liveTurnListeners) listener();
    }
    const liveTurnStore = {
      subscribe: (listener) => {
        liveTurnListeners.add(listener);
        return () => liveTurnListeners.delete(listener);
      },
      getSnapshot: () => liveTurnNow,
    };

    /** One 改写 control plus its editor, rendered by the harness itself. */
    function EditControl(props) {
      const liveTurn = React.useSyncExternalStore(liveTurnStore.subscribe, liveTurnStore.getSnapshot);
      const [turn, setTurn] = React.useState(null);
      const [open, setOpen] = React.useState(false);
      const [draft, setDraft] = React.useState('');
      const [status, setStatus] = React.useState('');
      const [id, setId] = React.useState(null);
      const anchor = React.useRef(null);

      React.useLayoutEffect(() => {
        const item = anchor.current?.closest('[data-chat-flow-key]') ?? null;
        const next = item === null ? null : Number(item.getAttribute('data-chat-turn'));
        if (!Object.is(turn, next)) setTurn(next);
      });

      const readShown = () => {
        const item = anchor.current?.closest('[data-chat-flow-key]') ?? null;
        const body = item?.querySelector('[data-message-bubble], [data-text-interaction-source]');
        return body?.textContent ?? '';
      };

      const openEditor = async () => {
        setStatus('读取中…');
        try {
          const list = await fetch(EDIT_ENDPOINT, { headers: { accept: 'application/json' } })
            .then((response) => (response.ok ? response.json() : null));
          const items = Array.isArray(list?.items) ? list.items : [];
          const shown = readShown();
          const target = typeof props.messageId === 'string'
            ? items.find((entry) => entry.id === props.messageId)
            : items.find((entry) => entry.text === shown || entry.text.trim() === shown.trim());
          if (target === undefined) {
            setStatus('这条消息不在可改写范围内');
            return;
          }
          setId(target.id);
          setDraft(target.text);
          setStatus('');
          setOpen(true);
        } catch (failure) {
          setStatus(`读取失败：${String(failure?.message ?? failure)}`);
        }
      };

      const save = async () => {
        if (id === null) return;
        setStatus('保存中…');
        try {
          const response = await fetch(EDIT_ENDPOINT, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ items: [{ id, text: draft }] }),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          setOpen(false);
          setStatus('已改写 · 只在下一次请求生效');
        } catch (failure) {
          setStatus(`保存失败：${String(failure?.message ?? failure)}`);
        }
      };

      React.useEffect(() => {
        if (status === '') return undefined;
        const timer = setTimeout(() => setStatus(''), 4000);
        return () => clearTimeout(timer);
      }, [status]);

      // A turn that has moved on is compressed; rewriting it would change
      // nothing the next request carries, so the control stays hidden. It is
      // hidden with CSS, never unmounted: the anchor must survive so the turn
      // number stays readable (unmounting it loops the renderer).
      const hidden = turn !== null && Number.isFinite(turn) && liveTurn !== -1 && turn !== liveTurn;

      return h('span', {
        ref: anchor,
        style: { display: hidden ? 'none' : 'inline-flex', alignItems: 'center', gap: '6px', marginLeft: '6px' },
      },
        h('button', {
          type: 'button',
          onClick: openEditor,
          title: '改写这条消息：只影响下一次请求，不动历史',
          style: {
            font: 'inherit', fontSize: '11px', lineHeight: '16px', padding: '1px 7px',
            borderRadius: '5px', cursor: 'pointer',
            border: '1px solid var(--dsw-alias-border-l1)', background: 'transparent',
            color: 'var(--dsw-alias-label-secondary)',
          },
        }, '改写'),
        status === '' ? null : h('span', { style: { fontSize: '10px', color: 'var(--dsw-alias-label-secondary)' } }, status),
        open ? h('div', {
          style: {
            position: 'fixed', inset: '0', zIndex: 60, display: 'grid', placeItems: 'center',
            background: 'rgba(0, 0, 0, 0.35)',
          },
          onClick: (event) => { if (event.target === event.currentTarget) setOpen(false); },
        }, h('div', {
          style: {
            width: 'min(560px, 90vw)', padding: '14px 16px', borderRadius: '12px',
            border: '1px solid var(--dsw-alias-border-l1)',
            background: 'var(--dsw-alias-bg-layer-2)', boxShadow: '0 12px 32px rgba(0,0,0,.35)',
            display: 'flex', flexDirection: 'column', gap: '10px',
          },
        },
        h('div', { style: { fontSize: '12px', fontWeight: 600 } }, '改写这条消息'),
        h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } },
          '只写进下一次请求；磁盘上的历史不动，点取消即放弃。'),
        h('textarea', {
          value: draft,
          rows: 8,
          onChange: (event) => setDraft(event.target.value),
          style: {
            width: '100%', boxSizing: 'border-box', font: 'inherit', fontSize: '12px',
            lineHeight: '18px', padding: '8px 10px', borderRadius: '8px', resize: 'vertical',
            border: '1px solid var(--dsw-alias-border-l1)',
            background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)',
          },
        }),
        status === '' ? null : h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } }, status),
        h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px' } },
          h('button', {
            type: 'button',
            onClick: () => setOpen(false),
            style: {
              font: 'inherit', fontSize: '11px', padding: '4px 10px', borderRadius: '6px',
              border: '1px solid var(--dsw-alias-border-l1)', background: 'transparent',
              color: 'var(--dsw-alias-label-primary)', cursor: 'pointer',
            },
          }, '取消'),
          h('button', {
            type: 'button',
            onClick: save,
            style: {
              font: 'inherit', fontSize: '11px', padding: '4px 10px', borderRadius: '6px',
              border: '1px solid var(--dsw-alias-brand-primary)',
              background: 'var(--dsw-alias-brand-primary)', color: 'var(--dsw-alias-bg-base)',
              cursor: 'pointer',
            },
          }, '保存改写')),
        )) : null);
    }

    const RED_MARK = {
      color: 'var(--dsw-alias-state-error-primary)',
      textDecoration: 'line-through',
      background: 'rgba(239, 68, 68, 0.16)',
      borderRadius: '3px',
    };
    const GREEN_MARK = {
      color: 'var(--dsw-alias-state-success-primary)',
      background: 'rgba(34, 197, 94, 0.18)',
      borderRadius: '3px',
      fontWeight: 600,
    };

    /** One anchor character plus the words the request dropped next to it. */
    function ProseDiffNode(props) {
      const data = props?.node?.data ?? {};
      const removed = typeof data.removed === 'string' ? data.removed : '';
      const added = typeof data.added === 'string' ? data.added : '';
      const anchor = h('span', { key: 'anchor' }, props?.raw ?? '');
      return h('span', null,
        data.trailing === true ? anchor : null,
        h('span', { key: 'removed', style: RED_MARK }, removed),
        added === '' ? null : h('span', { key: 'added', style: GREEN_MARK }, added),
        data.trailing === true ? null : anchor);
    }

    /**
     * Plain-language strength presets: one pick sets the budgets and the
     * min-rewrite thresholds. Choosing one saves it straight away; touching a
     * raw number below drops into "custom".
     */
    const PRESETS = {
      gentle: {
        budgets: { default: 9000, read: 18000, grep: 9000, bash: 6000 },
        minChars: 1200,
        minGain: 0.1,
      },
      default: {
        budgets: { default: 6000, read: 12000, grep: 6000, bash: 4000 },
        minChars: 800,
        minGain: 0.05,
      },
      aggressive: {
        budgets: { default: 3000, read: 6000, grep: 3000, bash: 2000 },
        minChars: 400,
        minGain: 0.02,
      },
    };

    /** Which preset (if any) the live config matches, else 'custom'. */
    function presetOf(config) {
      for (const [name, preset] of Object.entries(PRESETS)) {
        if (preset.budgets.default === config?.budgets?.default
          && preset.budgets.read === config?.budgets?.read
          && preset.budgets.grep === config?.budgets?.grep
          && preset.budgets.bash === config?.budgets?.bash
          && preset.minChars === config?.minChars
          && preset.minGain === config?.minGain) {
          return name;
        }
      }
      return 'custom';
    }

    const TEXT = {
      nav: '省 Token',
      title: '省 Token 管理',
      subtitle: '在工具结果写入会话之前决定它进多少。只在这一处改写，历史保持追加，前缀缓存不受影响。',
      failed: '无法连接插件',
      refresh: '刷新',
      reset: '清除历史累计',
      confirm: '确认清除历史累计？',
      confirmYes: '确认清除',
      confirmNo: '取消',
      session: '本次进程',
      cumulative: '历史累计',
      hero: '累计节省 Token（估算）',
      heroSub: (chars) => `来自被移除的 ${chars} 个字符`,
      calls: '检查过的结果',
      rewritten: '被改写的结果',
      messages: '消息与回复修剪',
      before: '改写前字符',
      saved: '移除的字符',
      ratio: '节省比例',
      empty: '暂无记录。第一个被改写的工具结果出现后，这里就会有数字。',
      byTool: '按工具明细',
      tool: '工具',
      tokens: '节省 Token',
      switches: '开关',
      switchesHint: '改动立即生效，无需重启。',
      filters: '命令输出过滤',
      retrieval: '检索式读取',
      prose: '散文整理（标点 / 客套词）',
      proseHint: '只对判定为散文的行生效。代码、diff、路径、URL、版本号一律不动。',
      scopes: {
        off: '关闭',
        filtered: '仅散文输出',
        all: '所有散文',
      },
      systemPrompt: '系统提示词',
      systemPromptHint: '把提示词拆成若干小段（卡片），从上到下按顺序拼到现有系统提示词末尾，保存后下一次请求生效。',
      systemPromptVariables: '{{变量}}：{{provider}} 会替换为当前模型供应商、{{model}} 替换为当前模型名；写其他写法不替换，保持字面量，也不会因此报错。',
      advanced: '高级配置',
      advancedHint: '数字与枚举项改完点「保存配置」；开关立即生效。',
      saveConfig: '保存配置',
      enabled: '启用插件',
      enabledHint: '关闭后所有变换停止，设置保留。',
      recovery: '超预算处理',
      recoveryHint: 'spill 保存全文并给取回标记；rerun 提示重跑；none 不截断。',
      recoveryOptions: {
        spill: 'spill（保存全文）',
        rerun: 'rerun（提示重跑）',
        none: 'none（不截断）',
      },
      fields: {
        'budgets.default': '默认字符上限',
        'budgets.read': 'read 字符上限',
        'budgets.grep': 'grep 字符上限',
        'budgets.bash': 'bash 字符上限',
        'budgets.errorFactor': '错误结果倍数',
        minChars: '最小改写字符',
        minGain: '最小节省比例',
        'retrieval.readOutlineOverLines': '大纲行数阈值',
        'retrieval.maxOutlineSymbols': '大纲符号上限',
        'retrieval.maxGrepMatches': 'grep 匹配上限',
        logEvery: '每 N 次打印日志',
      },
      systemPromptPlaceholder: '写下这一段的提示词…',
      addSegment: '添加一小段',
      moveUp: '上移',
      moveDown: '下移',
      removeSegment: '删除这一段',
      emptySegments: '还没有任何段落。点击「添加一小段」开始。',
      saveSystemPrompt: '保存系统提示词',
      restoreSystemPrompt: '恢复默认提示词',
      nothingToRead: '没有读到当前生效的系统提示词（服务端未返回内容）。',
      modes: {
        pytest: ['pytest 结果', '通过时只留一行结论；失败时保留 FAILED、断言与摘要'],
        git: ['git 输出', 'status 干净时折叠成一行，diff 只留文件头和变更行'],
        tsc: ['tsc 输出', '只保留 error TS 开头的行与总数，告警丢弃'],
        packageManager: ['包管理器安装', '成功时只留摘要行，失败时只留错误行'],
        generic: ['通用清理', '任意命令都安全：ANSI、回车重绘、重复行、进度条'],
        rtk: ['RTK 风格压缩', '命令过滤器未命中时，再按结构压缩 git、构建、eslint、cargo/go 测试、grep/find/ls/tree 等'],
        readOutline: ['大文件大纲', '超过行数阈值且没给 offset/limit 的 read 只返回符号大纲'],
        grepCap: ['搜索结果截断', '匹配过多时只留前 N 条并说明剩余数量'],
        proseStrip: ['标点整理', '段首标点删去；挨着的两个标点只留一个（逗号+句号留句号）；句末连续的 . ， 。 ， 删掉；省略号不动'],
        politenessStrip: ['客套词删除/替换', '删去或替换「谢谢」「请」「please」「thanks」等；词表可在下方自定义，代码、URL、路径不动'],
        systemPrompt: ['修改系统提示词', '把若干小段分段拼接到系统提示词末尾'],
      },
      file: '配置目录',
      none: '未找到配置目录，改动不会落盘',
      generated: '更新时间',
      note: 'Token 数按 Harness 显示上下文时的同一套估算口径（4 字符 ≈ 1 token）折算；只统计被移除的字符。',
      preset: '压缩力度',
      presetHint: '一键设置字符上限与最小改写阈值；想精调再展开下面「高级数字」。',
      presets: {
        gentle: '省着压（留更多内容）',
        default: '默认',
        aggressive: '狠压（最省 token）',
        custom: '自定义（手动调过）',
      },
      presetApply: '应用',
      rawSettings: '高级数字（原始配置）',
      words: '词语删除 / 替换',
      wordsHint: '每行一条：左边的词在散文行里被删掉；右边非空则替换成右边的内容。只作用于散文行，代码、URL、路径、版本号不动。',
      wordLabel: '词',
      replaceLabel: '替换为空 = 删除',
      addWord: '加一个词',
      saveWords: '保存词表',
      editTitle: '对话内容编辑',
      editHint: '改写最近消息的内容。你的改写只在下次请求发给模型，磁盘上的历史原样不动。',
      roleUser: '你',
      roleAssistant: '模型',
      editNow: '编辑',
      editSaving: '保存改写',
      editRestore: '恢复原内容',
      editCancel: '取消',
      editEmpty: '还没有可编辑的消息，对话几句后这里会列出最近的内容。',
      notes: '自动变换记录',
      notesHint: '最近自动删改的原文：红字划线 = 删掉，绿字 = 替换或新增。',
      notesEmpty: '还没有变换记录。',
      notesAgo: (seconds) => (seconds < 60 ? `${seconds} 秒前` : `${Math.floor(seconds / 60)} 分钟前`),
    };

    /** A finite, non-negative number from any wire value. */
    const number = (value) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);

    /** Numeric rows the advanced card edits, in display order, with their step. */
    const CFG_FIELDS = [
      ['budgets.default', '1'],
      ['budgets.read', '1'],
      ['budgets.grep', '1'],
      ['budgets.bash', '1'],
      ['budgets.errorFactor', '0.1'],
      ['minChars', '1'],
      ['minGain', '0.01'],
      ['retrieval.readOutlineOverLines', '1'],
      ['retrieval.maxOutlineSymbols', '1'],
      ['retrieval.maxGrepMatches', '1'],
      ['logEvery', '1'],
    ];

    /** A token count at a glance: 1234 -> 1,234, 23456 -> 23.5k. */
    const compact = (value) => {
      const n = Math.round(number(value));
      if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
      if (n >= 10000) return `${(n / 1000).toFixed(1)}k`;
      return n.toLocaleString('en-US');
    };

    /** A [0, 1] ratio as a percentage. */
    const percent = (value) => `${(Math.min(1, number(value)) * 100).toFixed(1)}%`;

    /** A short local timestamp for the "updated" line. */
    const stamp = (value) => {
      if (typeof value !== 'string' || value === '') return '—';
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
    };

    /** The horizontal switch used by every mode row. */
    function Switch(props) {
      const { on, disabled, label, mode, onToggle } = props;
      return h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': on ? 'true' : 'false',
        'aria-label': label,
        'data-mode': mode,
        disabled,
        onClick: onToggle,
        style: {
          flex: '0 0 auto', width: '32px', height: '18px',
          borderRadius: '9px', border: '1px solid var(--dsw-alias-border-l2)',
          background: on ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l2)',
          cursor: disabled ? 'default' : 'pointer',
          position: 'relative', padding: 0, transition: 'background 120ms ease',
        },
      }, h('span', {
        style: {
          position: 'absolute', top: '1px', left: on ? '15px' : '1px',
          width: '14px', height: '14px', borderRadius: '50%',
          background: 'var(--dsw-alias-bg-base)', transition: 'left 120ms ease',
        },
      }));
    }

    /** One switch, as a full-width row: name and consequence on the left. */
    function ModeRow(props) {
      const { id, on, text, busy, onToggle } = props;
      const [label, description] = text.modes[id] ?? [id, ''];
      return h('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '7px 9px', borderRadius: '8px',
          border: '1px solid var(--dsw-alias-border-l1)',
          background: 'var(--dsw-alias-bg-layer-1)',
        },
      },
      h('div', { style: { flex: '1 1 auto', minWidth: 0 } },
        h('div', {
          style: { fontSize: '12px', lineHeight: '16px', color: 'var(--dsw-alias-label-primary)' },
        }, label),
        h('div', {
          style: {
            marginTop: '2px', fontSize: '11px', lineHeight: '15px',
            color: 'var(--dsw-alias-label-secondary)',
          },
        }, description),
      ),
      h(Switch, { on, disabled: busy === id, label, mode: id, onToggle: () => onToggle(id, !on) }),
      );
    }

    /** One prompt segment card: its text, and the move/remove controls. */
    function SegmentCard(props) {
      const { segment, index, count, text, disabled, onText, onMove, onRemove } = props;
      const control = (label, onClick, off, warning) => h('button', {
        type: 'button',
        disabled: disabled || off,
        onClick,
        style: {
          padding: '2px 6px', borderRadius: '5px', font: 'inherit',
          border: '1px solid var(--dsw-alias-border-l1)',
          background: 'var(--dsw-alias-bg-layer-1)',
          color: warning ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-primary)',
          fontSize: '11px', lineHeight: '15px',
          cursor: disabled || off ? 'default' : 'pointer',
          opacity: disabled || off ? 0.5 : 1,
        },
      }, label);
      return h('div', {
        style: {
          padding: '7px 9px', borderRadius: '8px',
          border: '1px solid var(--dsw-alias-border-l1)',
          background: 'var(--dsw-alias-bg-layer-1)',
        },
      },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' } },
        h('span', {
          style: { fontSize: '10px', color: 'var(--dsw-alias-label-secondary)' },
        }, `${index + 1}/${count}`),
        h('div', { style: { flex: '1 1 auto' } }),
        control(text.moveUp, () => onMove(-1), index === 0),
        control(text.moveDown, () => onMove(1), index === count - 1),
        control(text.removeSegment, onRemove, false, true),
      ),
      h('textarea', {
        value: segment.text ?? '',
        onChange: (event) => onText(event.target.value),
        placeholder: text.systemPromptPlaceholder,
        maxLength: 8000,
        rows: 3,
        disabled,
        style: {
          width: '100%', boxSizing: 'border-box', padding: '7px',
          borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l1)',
          background: 'transparent', color: 'var(--dsw-alias-label-primary)',
          font: 'inherit', fontSize: '12px', lineHeight: '18px', resize: 'vertical',
        },
      }));
    }

    /** One bordered card. */
    function Card(props) {
      return h('div', {
        style: {
          padding: '12px 14px', borderRadius: '10px',
          border: '1px solid var(--dsw-alias-border-l1)',
          background: 'var(--dsw-alias-bg-layer-2)',
          minWidth: 0,
        },
      }, props.children);
    }

    /** One label/value pair inside a card. */
    function Line(props) {
      const { label, value, accent } = props;
      return h('div', {
        style: {
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          gap: '12px', padding: '3px 0', minWidth: 0,
        },
      },
      h('span', {
        style: { flex: '0 0 auto', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' },
      }, label),
      h('span', {
        style: {
          flex: '0 1 auto', minWidth: 0, textAlign: 'right', overflowWrap: 'anywhere',
          fontSize: '12px', fontVariantNumeric: 'tabular-nums',
          color: accent === true ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-label-primary)',
        },
      }, value),
      );
    }

    /**
     * One recorded change, shown the way a Git diff shows a changed line:
     * removed text struck through in red, added text in green.
     */
    function DiffLine(props) {
      const { segments, notes } = props;
      if (!Array.isArray(segments) || segments.length === 0) {
        return h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } },
          Array.isArray(notes) ? notes.join('、') : '');
      }
      return h('div', {
        style: {
          fontSize: '12px', lineHeight: '18px', fontFamily: 'inherit',
          overflowWrap: 'anywhere', whiteSpace: 'pre-wrap',
          maxHeight: '76px', overflowY: 'auto',
        },
      }, segments.map((segment, index) => {
        if (segment?.kind === 'del') {
          return h('span', {
            key: index,
            style: {
              color: 'var(--dsw-alias-state-error-primary)',
              textDecoration: 'line-through',
              background: 'rgba(239, 68, 68, 0.18)',
              borderRadius: '3px',
            },
          }, String(segment.text));
        }
        if (segment?.kind === 'add') {
          return h('span', {
            key: index,
            style: {
              color: 'var(--dsw-alias-state-success-primary)',
              fontWeight: 600,
              background: 'rgba(34, 197, 94, 0.2)',
              borderRadius: '3px',
            },
          }, String(segment.text));
        }
        return h('span', { key: index, style: { color: 'var(--dsw-alias-label-primary)' } }, String(segment?.text ?? ''));
      }));
    }

    /** A share bar for the saved ratio. */
    function Bar(props) {      const ratio = Math.min(1, number(props.ratio));
      return h('div', {
        style: {
          height: '4px', borderRadius: '2px', marginTop: '8px',
          background: 'var(--dsw-alias-border-l1)', overflow: 'hidden',
        },
      }, h('div', {
        style: {
          width: `${(ratio * 100).toFixed(1)}%`, height: '100%',
          background: 'var(--dsw-alias-brand-primary)',
        },
      }));
    }

    /** One card per scope: this process, and everything before it. */
    function ScopeCard(props) {
      const { title, summary, text } = props;
      return h('div', {
        style: {
          flex: '1 1 240px', minWidth: 0, padding: '12px 14px', borderRadius: '10px',
          border: '1px solid var(--dsw-alias-border-l1)',
          background: 'var(--dsw-alias-bg-layer-2)',
        },
      },
      h('div', {
        style: {
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          gap: '8px', marginBottom: '4px',
        },
      },
      h('span', { style: { fontSize: '12px', fontWeight: 600 } }, title),
      h('span', {
        style: {
          fontSize: '16px', fontWeight: 600, fontVariantNumeric: 'tabular-nums',
          color: 'var(--dsw-alias-label-primary)',
        },
      }, compact(summary.savedTokens)),
      ),
      h(Line, { label: text.calls, value: compact(summary.calls) }),
      h(Line, { label: text.rewritten, value: compact(summary.rewritten) }),
      h(Line, { label: text.messages, value: compact(summary.messages) }),
      h(Line, { label: text.before, value: compact(summary.before) }),
      h(Line, { label: text.saved, value: compact(summary.savedChars) }),
      h(Line, { label: text.ratio, value: percent(summary.savedRatio), accent: true }),
      h(Bar, { ratio: summary.savedRatio }),
      );
    }

    /** One horizontal input, the size the page uses everywhere. */
    const inputStyle = {
      padding: '3px 6px', borderRadius: '5px', border: '1px solid var(--dsw-alias-border-l1)',
      background: 'transparent', color: 'var(--dsw-alias-label-primary)', font: 'inherit', fontSize: '12px',
      flex: '1 1 120px', minWidth: 80,
    };

    /** The settings page. */
    function SavingsPage() {
      const text = TEXT;
      const [state, setState] = React.useState(null);
      const [error, setError] = React.useState('');
      const [busy, setBusy] = React.useState('');
      const [confirming, setConfirming] = React.useState(false);
      const [spDraft, setSpDraft] = React.useState(null);
      const [cfgDraft, setCfgDraft] = React.useState(null);
      const [wordsDraft, setWordsDraft] = React.useState(null);
      const [editItems, setEditItems] = React.useState(null);
      const [editDraft, setEditDraft] = React.useState({});
      const [editBusy, setEditBusy] = React.useState('');

      const load = React.useCallback(async () => {
        try {
          const response = await fetch(STATE_ENDPOINT, { headers: { accept: 'application/json' } });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const body = await response.json();
          if (rememberDiffs(body?.recent) && nudgeDiffRules !== null) nudgeDiffRules();
          setState(body);
          setError('');
        } catch (failure) {
          setError(`${text.failed}: ${String(failure?.message ?? failure)}`);
        }
      }, [text]);

      React.useEffect(() => { load(); }, [load]);
      React.useEffect(() => {
        if (spDraft === null && Array.isArray(state?.systemPrompt?.segments)) {
          // Loaded cards may predate the id-bearing editor; give every card a
          // stable key so reorder/edit/remove target the right one.
          setSpDraft({ segments: state.systemPrompt.segments.map((segment, index) => ({
            ...segment,
            id: segment.id ?? `seg-${index}-${Date.now().toString(36)}`,
          })) });
        }
      }, [state, spDraft]);
      React.useEffect(() => {
        if (cfgDraft === null && state?.config) setCfgDraft(state.config);
      }, [state, cfgDraft]);
      React.useEffect(() => {
        const words = state?.config?.prose?.politenessWords;
        if (wordsDraft === null && Array.isArray(words)) {
          setWordsDraft(words.map((entry) => ({ word: entry.word, replace: entry.replace ?? '' })));
        }
      }, [state, wordsDraft]);
      /** Load the editable conversation messages. */
      const loadEdits = React.useCallback(async () => {
        try {
          const response = await fetch(EDIT_ENDPOINT, { headers: { accept: 'application/json' } });
          if (!response.ok) return;
          setEditItems(response.json ? (await response.json()).items : []);
        } catch {
          /* the page still works when the route is absent (older host) */
        }
      }, []);
      React.useEffect(() => { loadEdits(); }, [loadEdits]);
      React.useEffect(() => {
        const timer = setInterval(() => { load(); }, 5000);
        return () => { clearInterval(timer); };
      }, [load]);

      /**
       * Send one patch and adopt the Host's answer. The switch moves at once
       * and reverts on failure, so the page never disagrees with the policy.
       */
      const commit = async (patch, proseScope, systemPrompt) => {
        const previous = state;
        setState((current) => {
          if (current === null) return current;
          return {
            ...current,
            proseScope: proseScope === undefined ? current.proseScope : proseScope,
            systemPrompt: systemPrompt === undefined ? current.systemPrompt : systemPrompt,
            modes: current.modes.map((mode) => (Object.hasOwn(patch, mode.id) ? { ...mode, on: patch[mode.id] } : mode)),
          };
        });
        try {
          const response = await fetch(STATE_ENDPOINT, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              modes: patch,
              ...(proseScope === undefined ? {} : { proseScope }),
              ...(systemPrompt === undefined ? {} : { systemPrompt }),
            }),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const body = await response.json();
          setState((current) => ({ ...current, ...body }));
          setError('');
        } catch (failure) {
          setState(previous);
          setError(`${text.failed}: ${String(failure?.message ?? failure)}`);
        }
      };

      const toggle = async (id, next) => {
        setBusy(id);
        try {
          await commit({ [id]: next });
        } finally {
          setBusy('');
        }
      };

      const setScope = async (scope) => {
        setBusy('scope');
        try {
          await commit({}, scope);
        } finally {
          setBusy('');
        }
      };

      const saveSystemPrompt = async () => {
        setBusy('systemPrompt');
        try {
          await commit({}, undefined, { segments: (spDraft?.segments ?? []).map((segment) => ({ text: segment.text ?? '' })) });
        } finally {
          setBusy('');
        }
      };

      /** A fresh segment id; short enough for section names, unique enough for a page. */
      const nextSegmentId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

      /** Patch the draft's segments array for the card column. */
      const patchSegments = (update) => setSpDraft((draft) => ({ segments: update(draft?.segments ?? []) }));

      const addSegment = () => patchSegments((segments) => [...segments, { id: nextSegmentId(), text: '' }]);
      const setSegmentText = (index, text) => patchSegments((segments) =>
        segments.map((segment, i) => (i === index ? { ...segment, text } : segment)));
      const removeSegment = (index) => patchSegments((segments) => segments.filter((_, i) => i !== index));
      const moveSegment = (index, delta) => patchSegments((segments) => {
        const target = index + delta;
        if (index < 0 || index >= segments.length || target < 0 || target >= segments.length) return segments;
        const next = segments.slice();
        const [segment] = next.splice(index, 1);
        next.splice(target, 0, segment);
        return next;
      });

      /** Read the currently effective default prompt and split it into cards. */
      const restoreSystemPrompt = async () => {
        setBusy('systemPrompt');
        try {
          const response = await fetch(PROMPT_ENDPOINT, { headers: { accept: 'application/json' } });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const body = await response.json();
          const prompt = typeof body?.prompt === 'string' ? body.prompt : '';
          if (prompt === '') {
            setError(text.nothingToRead);
            return;
          }
          const segments = prompt.split(/\n{2,}/)
            .map((text) => text.trim())
            .filter((text) => text !== '')
            .map((text) => ({ id: nextSegmentId(), text }));
          setSpDraft({ segments });
          setError('');
        } catch (failure) {
          setError(`${text.failed}: ${String(failure?.message ?? failure)}`);
        } finally {
          setBusy('');
        }
      };

      const reset = async () => {
        setConfirming(false);
        setBusy('reset');
        try {
          const response = await fetch(STATS_ENDPOINT, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ reset: true }),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const body = await response.json();
          setState((current) => ({ ...current, cumulative: body.cumulative, session: body.session }));
          setError('');
        } catch (failure) {
          setError(`${text.failed}: ${String(failure?.message ?? failure)}`);
        } finally {
          setBusy('');
        }
      };

      /** Read a dotted config path from the draft. */
      const cfgGet = (path) => path.split('.').reduce((node, key) => (node == null ? undefined : node[key]), cfgDraft ?? {});
      /** Write a dotted config path into a copy of the draft. */
      const cfgSet = (path, value) => setCfgDraft((draft) => {
        const next = { ...(draft ?? {}) };
        const keys = path.split('.');
        let node = next;
        for (let i = 0; i < keys.length - 1; i += 1) {
          node[keys[i]] = { ...(node[keys[i]] ?? {}) };
          node = node[keys[i]];
        }
        node[keys[keys.length - 1]] = value;
        return next;
      });

      const postState = async (payload) => {
        const response = await fetch(STATE_ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.json();
        setState((current) => ({ ...current, ...body }));
        setError('');
        return body;
      };

      const saveConfig = async () => {
        setBusy('config');
        try {
          const body = await postState({ config: cfgDraft });
          setCfgDraft(body.config);
        } catch (failure) {
          setError(`${text.failed}: ${String(failure?.message ?? failure)}`);
        } finally {
          setBusy('');
        }
      };

      /** One preset pick saves the whole strength in one call. */
      const applyPreset = async (name) => {
        if (!(name in PRESETS)) return;
        setBusy('preset');
        try {
          const body = await postState({ config: PRESETS[name] });
          setCfgDraft(body.config);
        } catch (failure) {
          setError(`${text.failed}: ${String(failure?.message ?? failure)}`);
        } finally {
          setBusy('');
        }
      };

      const setWordRow = (index, key, value) => setWordsDraft((rows) =>
        (rows ?? []).map((entry, i) => (i === index ? { ...entry, [key]: value } : entry)));
      const addWordRow = () => setWordsDraft((rows) => [...(rows ?? []), { word: '', replace: '' }]);
      const removeWordRow = (index) => setWordsDraft((rows) => (rows ?? []).filter((_, i) => i !== index));

      /** Persist the word list through the config channel (it is a config field). */
      const saveWords = async () => {
        setBusy('words');
        try {
          const words = (wordsDraft ?? [])
            .filter((entry) => entry.word !== '')
            .map((entry) => (entry.replace !== '' ? { word: entry.word, replace: entry.replace } : { word: entry.word }));
          const body = await postState({ config: { prose: { politenessWords: words } } });
          const saved = body?.config?.prose?.politenessWords;
          if (Array.isArray(saved)) setWordsDraft(saved.map((entry) => ({ word: entry.word, replace: entry.replace ?? '' })));
        } catch (failure) {
          setError(`${text.failed}: ${String(failure?.message ?? failure)}`);
        } finally {
          setBusy('');
        }
      };

      /** Save one conversation edit (or restore it with a null text). */
      const commitEdit = async (id, value) => {
        setEditBusy(id);
        try {
          const response = await fetch(EDIT_ENDPOINT, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ items: [{ id, text: value }] }),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const body = await response.json();
          setEditItems(body.items);
          setEditDraft((draft) => {
            const next = { ...draft };
            delete next[id];
            return next;
          });
          setError('');
        } catch (failure) {
          setError(`${text.failed}: ${String(failure?.message ?? failure)}`);
        } finally {
          setEditBusy('');
        }
      };

      const toggleEnabled = async () => {
        setBusy('enabled');
        try {
          await postState({ enabled: state?.enabled !== true });
        } catch (failure) {
          setError(`${text.failed}: ${String(failure?.message ?? failure)}`);
        } finally {
          setBusy('');
        }
      };

      const button = (label, onClick, disabled) => h('button', {
        type: 'button',
        disabled: disabled === true,
        onClick,
        style: {
          padding: '4px 10px', borderRadius: '6px', font: 'inherit',
          border: '1px solid var(--dsw-alias-border-l1)',
          background: 'var(--dsw-alias-bg-layer-1)',
          color: 'var(--dsw-alias-label-primary)',
          fontSize: '11px', lineHeight: '16px',
          cursor: disabled === true ? 'default' : 'pointer',
          opacity: disabled === true ? 0.6 : 1,
        },
      }, label);

      const modes = Array.isArray(state?.modes) ? state.modes : [];
      const modeOf = (id) => modes.find((mode) => mode.id === id)?.on === true;
      const proseOn = modeOf('proseStrip') || modeOf('politenessStrip');
      const cumulative = state?.cumulative ?? {};
      const session = state?.session ?? {};
      const tools = Array.isArray(cumulative.tools) ? cumulative.tools : [];
      const scopes = Array.isArray(state?.scopes) ? state.scopes : ['off', 'filtered', 'all'];
      const spSegments = Array.isArray(spDraft?.segments) ? spDraft.segments : [];

      const group = (title, ids) => h(Card, null,
        h('div', { style: { fontSize: '12px', fontWeight: 600, marginBottom: '6px' } }, title),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
          ids.map((id) => h(ModeRow, {
            key: id, id, on: modeOf(id), text, busy, onToggle: toggle,
          }))),
      );

      return h('div', {
        style: {
          display: 'flex', flexDirection: 'column', gap: '12px',
          maxWidth: '760px', padding: '4px 0 16px',
          fontFamily: 'inherit', color: 'var(--dsw-alias-label-primary)',
        },
      },
      h('div', null,
        h('div', { style: { fontSize: '15px', fontWeight: 600 } }, text.title),
        h('div', {
          style: { marginTop: '2px', fontSize: '11px', lineHeight: '16px', color: 'var(--dsw-alias-label-secondary)' },
        }, text.subtitle),
      ),
      error !== '' ? h('div', {
        style: {
          padding: '6px 9px', borderRadius: '6px', fontSize: '11px',
          color: 'var(--dsw-alias-state-error-primary)',
          border: '1px solid var(--dsw-alias-state-error-primary)',
        },
      }, error) : null,
      h(Card, null,
        h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } }, text.hero),
        h('div', {
          style: {
            marginTop: '2px', fontSize: '28px', fontWeight: 600, lineHeight: '34px',
            fontVariantNumeric: 'tabular-nums',
          },
        }, compact(cumulative.savedTokens)),
        h('div', {
          style: { marginTop: '2px', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' },
        }, text.heroSub(compact(cumulative.savedChars))),
      ),
      h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '12px' } },
        h(ScopeCard, { title: text.session, summary: session, text }),
        h(ScopeCard, { title: text.cumulative, summary: cumulative, text }),
      ),
      h(Card, null,
        h('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px' } },
          h('span', { style: { fontSize: '12px', fontWeight: 600 } }, text.advanced),
          h('span', { style: { fontSize: '10px', color: 'var(--dsw-alias-label-secondary)' } }, text.advancedHint)),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' } },
          h(Switch, {
            on: state?.enabled !== false, label: text.enabled, mode: 'enabled',
            disabled: busy === 'enabled', onToggle: toggleEnabled,
          }),
          h('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } }, text.enabledHint)),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' } },
          h('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } }, text.preset),
          h('select', {
            value: presetOf(cfgDraft ?? state?.config),
            disabled: busy === 'preset',
            onChange: (event) => {
              if (event.target.value !== 'custom') applyPreset(event.target.value);
            },
            style: {
              padding: '3px 6px', borderRadius: '5px', border: '1px solid var(--dsw-alias-border-l1)',
              background: 'transparent', color: 'var(--dsw-alias-label-primary)', font: 'inherit', fontSize: '12px',
            },
          }, ['gentle', 'default', 'aggressive', 'custom'].map((name) => h('option', {
            key: name,
            value: name,
          }, text.presets[name] ?? name))),
          h('span', { style: { fontSize: '10px', color: 'var(--dsw-alias-label-secondary)' } }, text.presetHint)),
        h('details', { style: { marginTop: '8px' } },
          h('summary', {
            style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer' },
          }, text.rawSettings),
          h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '6px', marginTop: '8px' } },
            CFG_FIELDS.map(([path, step]) => h('label', {
              key: path,
              style: { display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' },
            },
            text.fields[path] ?? path,
            h('input', {
              type: 'number', value: cfgGet(path) ?? '', step, min: 0, disabled: busy === 'config',
              onChange: (event) => cfgSet(path, event.target.value === '' ? '' : Number(event.target.value)),
              style: {
                padding: '3px 6px', borderRadius: '5px', border: '1px solid var(--dsw-alias-border-l1)',
                background: 'transparent', color: 'var(--dsw-alias-label-primary)', font: 'inherit', fontSize: '12px',
              },
            }))),
          h('label', { style: { display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', marginTop: '8px' } },
            text.recovery,
            h('select', {
              value: cfgGet('recovery') ?? 'spill', disabled: busy === 'config',
              onChange: (event) => cfgSet('recovery', event.target.value),
              style: {
                padding: '3px 6px', borderRadius: '5px', border: '1px solid var(--dsw-alias-border-l1)',
                background: 'transparent', color: 'var(--dsw-alias-label-primary)', font: 'inherit', fontSize: '12px', maxWidth: '260px',
              },
            }, Object.entries(text.recoveryOptions).map(([value, label]) => h('option', { key: value, value }, label)))),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' } },
            button(text.saveConfig, saveConfig, busy === 'config' || cfgDraft === null),
            h('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } }, text.recoveryHint)),
        ),
      ),
      ),
      group(text.filters, ['pytest', 'git', 'tsc', 'packageManager', 'generic', 'rtk']),
      group(text.retrieval, ['readOutline', 'grepCap']),
      h(Card, null,
        h('div', {
          style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px' },
        },
        h('span', { style: { fontSize: '12px', fontWeight: 600 } }, text.prose),
        h('span', { style: { fontSize: '10px', color: 'var(--dsw-alias-label-secondary)' } }, text.switchesHint),
        ),
        h('div', { style: { marginTop: '6px' } },
          h(ModeRow, {
            id: 'proseStrip', on: modeOf('proseStrip'), text, busy, onToggle: toggle,
          }),
          h(ModeRow, {
            id: 'politenessStrip', on: modeOf('politenessStrip'), text, busy, onToggle: toggle,
          }),
        ),
        h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' } },
          scopes.map((scope) => {
            const on = (state?.proseScope ?? 'filtered') === scope;
            return h('button', {
              key: scope,
              type: 'button',
              role: 'radio',
              'aria-checked': on ? 'true' : 'false',
              'data-scope': scope,
              disabled: !proseOn || busy === 'scope',
              onClick: () => setScope(scope),
              style: {
                padding: '3px 9px', borderRadius: '999px',
                border: '1px solid ' + (on ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l1)'),
                background: on ? 'var(--dsw-alias-bg-layer-1)' : 'transparent',
                color: on ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
                fontSize: '11px', lineHeight: '16px', font: 'inherit',
                cursor: proseOn ? 'pointer' : 'default',
                opacity: proseOn ? 1 : 0.55,
              },
            }, text.scopes[scope] ?? scope);
          }),
        ),
        modeOf('politenessStrip') ? h('div', { style: { marginTop: '8px' } },
          h('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px' } },
            h('span', { style: { fontSize: '12px', fontWeight: 600 } }, text.words),
            h('span', { style: { fontSize: '10px', color: 'var(--dsw-alias-label-secondary)' } }, text.wordsHint)),
          (wordsDraft ?? []).length === 0
            ? h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', margin: '6px 0' } }, text.emptySegments)
            : h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '6px' } },
              (wordsDraft ?? []).map((entry, index) => h('div', {
                key: index,
                style: { display: 'flex', gap: '6px', alignItems: 'center' },
              },
                h('input', {
                  value: entry.word,
                  placeholder: text.wordLabel,
                  maxLength: 40,
                  disabled: busy === 'words',
                  onChange: (event) => setWordRow(index, 'word', event.target.value),
                  style: inputStyle,
                }),
                h('input', {
                  value: entry.replace,
                  placeholder: text.replaceLabel,
                  maxLength: 60,
                  disabled: busy === 'words',
                  onChange: (event) => setWordRow(index, 'replace', event.target.value),
                  style: inputStyle,
                }),
                h('button', {
                  type: 'button',
                  onClick: () => removeWordRow(index),
                  disabled: busy === 'words',
                  style: {
                    padding: '2px 6px', borderRadius: '5px', fontSize: '11px',
                    border: '1px solid var(--dsw-alias-border-l1)',
                    background: 'var(--dsw-alias-bg-layer-1)',
                    color: 'var(--dsw-alias-state-error-primary)',
                    cursor: 'pointer',
                  },
                }, '×'),
              ))),
          h('div', { style: { display: 'flex', gap: '8px', marginTop: '6px', flexWrap: 'wrap' } },
            button(text.addWord, addWordRow, busy === 'words'),
            button(text.saveWords, saveWords, busy === 'words' || (wordsDraft ?? []).every((entry) => entry.word === '' && entry.replace === '')),
          ),
        ) : null,
        h('div', {
          style: {
            marginTop: '6px', fontSize: '11px', lineHeight: '16px',
            color: 'var(--dsw-alias-label-secondary)',
          },
        }, text.proseHint),
      ),
      h(Card, null,
        h('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px', marginBottom: '6px' } },
          h('span', { style: { fontSize: '12px', fontWeight: 600 } }, text.editTitle),
          h('span', { style: { fontSize: '10px', color: 'var(--dsw-alias-label-secondary)' } }, text.editHint)),
        editItems === null || editItems.length === 0
          ? h('div', { style: { fontSize: '11px', lineHeight: '16px', color: 'var(--dsw-alias-label-secondary)' } }, text.editEmpty)
          : h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
            editItems.map((item) => {
              const drafting = editDraft[item.id] !== undefined;
              return h('div', {
                key: item.id,
                style: {
                  padding: '7px 9px', borderRadius: '8px',
                  border: item.edited ? '1px solid var(--dsw-alias-brand-primary)' : '1px solid var(--dsw-alias-border-l1)',
                  background: 'var(--dsw-alias-bg-layer-1)',
                },
              },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' } },
                  h('span', {
                    style: {
                      fontSize: '10px', padding: '1px 6px', borderRadius: '999px',
                      border: '1px solid var(--dsw-alias-border-l1)',
                      color: item.role === 'user' ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
                    },
                  }, item.role === 'user' ? text.roleUser : text.roleAssistant),
                  item.edited ? h('span', { style: { fontSize: '10px', color: 'var(--dsw-alias-state-success-primary)' } }, '· edited') : null,
                  h('div', { style: { flex: '1 1 auto', minWidth: 0 } }),
                  !drafting ? button(text.editNow, () => setEditDraft((draft) => ({ ...draft, [item.id]: item.text })), false) : null,
                ),
                drafting
                  ? h('textarea', {
                    value: editDraft[item.id],
                    maxLength: 20000,
                    rows: 3,
                    onChange: (event) => setEditDraft((draft) => ({ ...draft, [item.id]: event.target.value })),
                    style: {
                      ...inputStyle, width: '100%', resize: 'vertical', flex: '1 1 auto',
                    },
                  })
                  : h('div', {
                    style: {
                      fontSize: '11px', lineHeight: '16px', color: 'var(--dsw-alias-label-secondary)',
                      whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
                    },
                  }, item.text),
                h('div', { style: { display: 'flex', gap: '6px', marginTop: '6px' } },
                  drafting
                    ? button(text.editSaving, () => { commitEdit(item.id, editDraft[item.id].trim() === '' ? null : editDraft[item.id]); }, editBusy === item.id)
                    : null,
                  drafting
                    ? button(text.editCancel, () => setEditDraft((draft) => { const next = { ...draft }; delete next[item.id]; return next; }), editBusy === item.id)
                    : null,
                  item.edited && !drafting
                    ? button(text.editRestore, () => commitEdit(item.id, null), editBusy === item.id)
                    : null),
              );
            }),
          ),
      ),
      h(Card, null,
        h('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px', marginBottom: '6px' } },
          h('span', { style: { fontSize: '12px', fontWeight: 600 } }, text.notes),
          h('span', { style: { fontSize: '10px', color: 'var(--dsw-alias-label-secondary)' } }, text.notesHint)),
        (Array.isArray(state?.recent) && state.recent.length > 0)
          ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
            state.recent.slice(0, 20).map((entry, index) => h('div', {
              key: index,
              style: {
                padding: '5px 8px', borderRadius: '6px', minWidth: 0,
                border: '1px solid var(--dsw-alias-border-l1)',
                background: 'var(--dsw-alias-bg-layer-1)',
              },
            },
            h('div', {
              style: {
                display: 'flex', gap: '8px', fontSize: '10px', lineHeight: '14px',
                marginBottom: '2px', color: 'var(--dsw-alias-label-secondary)',
              },
            },
            h('span', { style: { fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } }, entry.label),
            h('span', null, text.notesAgo(Math.max(0, (Date.now() - entry.at) / 1000)))),
            h(DiffLine, { segments: entry.diff, notes: entry.notes }),
            )),
          )
          : h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } }, text.notesEmpty),
      ),
      h(Card, null,
        h('div', { style: { fontSize: '12px', fontWeight: 600, marginBottom: '6px' } }, text.systemPrompt),
        h(ModeRow, { id: 'systemPrompt', on: modeOf('systemPrompt'), text, busy, onToggle: toggle }),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' } },
          spSegments.length === 0
            ? h('div', {
              style: { fontSize: '11px', lineHeight: '16px', color: 'var(--dsw-alias-label-secondary)' },
            }, text.emptySegments)
            : spSegments.map((segment, index) => h(SegmentCard, {
              key: segment.id ?? index,
              segment,
              index,
              count: spSegments.length,
              text,
              disabled: !modeOf('systemPrompt'),
              onText: (value) => setSegmentText(index, value),
              onMove: (delta) => moveSegment(index, delta),
              onRemove: () => removeSegment(index),
            })),
        ),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px', flexWrap: 'wrap' } },
          button(text.addSegment, () => { addSegment(); }, !modeOf('systemPrompt') || busy === 'systemPrompt'),
          button(text.saveSystemPrompt, () => { saveSystemPrompt(); }, !modeOf('systemPrompt') || busy === 'systemPrompt'),
          button(text.restoreSystemPrompt, () => { restoreSystemPrompt(); }, !modeOf('systemPrompt') || busy !== ''),
        ),
        h('div', {
          style: {
            marginTop: '6px', fontSize: '11px', lineHeight: '16px',
            color: 'var(--dsw-alias-label-secondary)',
          },
        }, text.systemPromptHint),
        h('div', {
          style: {
            marginTop: '3px', fontSize: '11px', lineHeight: '16px',
            color: 'var(--dsw-alias-label-secondary)',
          },
        }, text.systemPromptVariables),
      ),
      h(Card, null,
        h('div', { style: { fontSize: '12px', fontWeight: 600, marginBottom: '4px' } }, text.byTool),
        tools.length === 0
          ? h('div', {
            style: { fontSize: '11px', lineHeight: '16px', color: 'var(--dsw-alias-label-secondary)' },
          }, text.empty)
          : h('div', {
            style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto auto', gap: '4px 10px' },
          },
          ...[text.tool, text.tokens, text.rewritten, text.ratio].map((heading) => h('div', {
            key: `h-${heading}`,
            style: { fontSize: '10px', color: 'var(--dsw-alias-label-secondary)' },
          }, heading)),
          ...tools.slice(0, 12).flatMap((row) => [
            h('div', {
              key: `${row.tool}-name`,
              style: {
                minWidth: 0, fontSize: '11px', overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              },
            }, row.tool),
            h('div', {
              key: `${row.tool}-tokens`,
              style: { fontSize: '11px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--dsw-alias-state-success-primary)' },
            }, compact(row.savedTokens)),
            h('div', {
              key: `${row.tool}-rewritten`,
              style: { fontSize: '11px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--dsw-alias-label-secondary)' },
            }, compact(row.rewritten)),
            h('div', {
              key: `${row.tool}-ratio`,
              style: { fontSize: '11px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--dsw-alias-label-secondary)' },
            }, percent(row.savedRatio)),
          ]),
          ),
      ),
      h(Card, null,
        h('div', {
          style: { fontSize: '11px', lineHeight: '16px', color: 'var(--dsw-alias-label-secondary)' },
        }, text.note),
        h('div', { style: { marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '2px' } },
          h(Line, { label: text.file, value: state?.profileDir ?? text.none }),
          h(Line, { label: text.generated, value: stamp(state?.generatedAt) }),
        ),
        h('div', { style: { marginTop: '10px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
          button(text.refresh, () => { setBusy(''); load(); }, false),
          confirming
            ? h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '8px' } },
              h('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-state-error-primary)' } }, text.confirm),
              button(text.confirmYes, () => { reset(); }, busy === 'reset'),
              button(text.confirmNo, () => { setConfirming(false); }, false))
            : button(text.reset, () => { setConfirming(true); }, busy === 'reset' || state === null),
        ),
      ),
      );
    }

    return {
      inject: ['slots', 'uiConversation'],
      apply(ctx) {
        // Re-registering the rule publishes a new revision, and that revision is
        // what makes an already-rendered message evaluate again once its record
        // arrives — a plain Map change would leave it unmarked.
        let releaseRule;
        const armRule = () => {
          if (releaseRule !== undefined) releaseRule();
          releaseRule = ctx.uiConversation.userText.register(diffRule);
        };
        // Replies have no text hook, so their finished bodies are decorated and
        // observed instead; the pass is a no-op when nothing matches.
        let decorateNow = () => {};
        if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
          let scheduled = 0;
          let applying = false;
          decorateNow = () => {
            applying = true;
            let scopeChanged = false;
            try {
              scopeChanged = decorateChat();
            } finally {
              applying = false;
            }
            // A new turn retires the old one's marks: re-register so already
            // rendered bubbles evaluate again without them.
            if (scopeChanged) armRule();
            return scopeChanged;
          };
          const schedule = () => {
            if (applying || scheduled !== 0) return;
            scheduled = setTimeout(() => {
              scheduled = 0;
              decorateNow();
            }, 120);
          };
          const observer = new MutationObserver(schedule);
          observer.observe(document.body, { childList: true, subtree: true, characterData: true });
          ctx.effect(() => () => {
            observer.disconnect();
            if (scheduled !== 0) clearTimeout(scheduled);
          });
          decorateNow();
        }
        nudgeDiffRules = () => {
          armRule();
          decorateNow();
        };
        armRule();

        // Keep the message → change map warm even while the settings page is
        // closed, because the chat renders messages at any time.
        const refreshDiffs = () => {
          fetch(STATE_ENDPOINT, { headers: { accept: 'application/json' } })
            .then((response) => (response.ok ? response.json() : null))
            .then((body) => {
              if (rememberDiffs(body?.recent)) {
                armRule();
                decorateNow();
              }
            })
            .catch(() => {});
        };
        refreshDiffs();
        const timer = setInterval(refreshDiffs, 3000);
        ctx.effect(() => () => {
          clearInterval(timer);
          if (releaseRule !== undefined) releaseRule();
        });

        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'dsh-oh-my-token',
          order: 61,
          label: () => TEXT.nav,
        }, SavingsPage));

        // Removed words in the person's own messages, marked where they were.
        ctx.slots.inject('conversation.user.text.node', () => ctx.slots.register({
          name: 'conversation.user.text.node',
          key: DIFF_RULE_ID,
          priority: 50,
        }, ProseDiffNode));

        // 改写 lives in the harness's own message slots, so its reconciler owns
        // the DOM. A slot option this harness rejects must never take the
        // plugin (and the rest of the UI) down with it.
        const tryRegister = (name, options) => {
          ctx.slots.inject(name, () => {
            try {
              return ctx.slots.register({ ...options, name }, EditControl);
            } catch (error) {
              console.warn('oh-my-token: slot', name, String(error?.message ?? error));
              return () => {};
            }
          });
        };
        // `conversation.chat.user.before` is a chain slot: it elects one entry
        // through a pure selector, and only for a real user row.
        tryRegister('conversation.chat.user.before', {
          select: (owner) => (owner?.kind === 'user' ? { edit: true } : null),
        });
        tryRegister('conversation.chat.assistant-actions', { id: DIFF_RULE_ID });
      },
    };
  },
});
