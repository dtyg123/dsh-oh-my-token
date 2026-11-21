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
      prose: '句末标点',
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
        rtk: ['RTK 风格压缩', '命令过滤器未命中时，再按结构压缩 git 输出、构建日志、grep/find/ls/tree 等'],
        readOutline: ['大文件大纲', '超过行数阈值且没给 offset/limit 的 read 只返回符号大纲'],
        grepCap: ['搜索结果截断', '匹配过多时只留前 N 条并说明剩余数量'],
        proseStrip: ['句末标点与客套词', '删除散文行、你的输入与助手回复末尾的句号/逗号，并删去「谢谢」「请」等客套词；代码、URL、路径、版本号不动'],
        systemPrompt: ['修改系统提示词', '把若干小段分段拼接到系统提示词末尾'],
      },
      file: '配置目录',
      none: '未找到配置目录，改动不会落盘',
      generated: '更新时间',
      note: 'Token 数按 Harness 显示上下文时的同一套估算口径（4 字符 ≈ 1 token）折算；只统计被移除的字符。',
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

    /** A share bar for the saved ratio. */
    function Bar(props) {
      const ratio = Math.min(1, number(props.ratio));
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

    /** The settings page. */
    function SavingsPage() {
      const text = TEXT;
      const [state, setState] = React.useState(null);
      const [error, setError] = React.useState('');
      const [busy, setBusy] = React.useState('');
      const [confirming, setConfirming] = React.useState(false);
      const [spDraft, setSpDraft] = React.useState(null);
      const [cfgDraft, setCfgDraft] = React.useState(null);

      const load = React.useCallback(async () => {
        try {
          const response = await fetch(STATE_ENDPOINT, { headers: { accept: 'application/json' } });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          setState(await response.json());
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
          })))),
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
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', flexWrap: 'wrap' } },
          button(text.saveConfig, saveConfig, busy === 'config' || cfgDraft === null),
          h('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } }, text.recoveryHint)),
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
              disabled: !modeOf('proseStrip') || busy === 'scope',
              onClick: () => setScope(scope),
              style: {
                padding: '3px 9px', borderRadius: '999px',
                border: '1px solid ' + (on ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l1)'),
                background: on ? 'var(--dsw-alias-bg-layer-1)' : 'transparent',
                color: on ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
                fontSize: '11px', lineHeight: '16px', font: 'inherit',
                cursor: modeOf('proseStrip') ? 'pointer' : 'default',
                opacity: modeOf('proseStrip') ? 1 : 0.55,
              },
            }, text.scopes[scope] ?? scope);
          }),
        ),
        h('div', {
          style: {
            marginTop: '6px', fontSize: '11px', lineHeight: '16px',
            color: 'var(--dsw-alias-label-secondary)',
          },
        }, text.proseHint),
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
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'dsh-oh-my-token',
          order: 61,
          label: () => TEXT.nav,
        }, SavingsPage));
      },
    };
  },
});
