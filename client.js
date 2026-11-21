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
      systemPromptHint: '把你写的文本加入系统提示词：追加到末尾，或整体替换。{{变量}} 保持字面量。保存后下一次请求生效。',
      systemPromptModes: { append: '追加到末尾', replace: '整体替换' },
      systemPromptPlaceholder: '在这里写下要发送给模型的系统提示词…',
      saveSystemPrompt: '保存系统提示词',
      readCurrentPrompt: '读取原提示词',
      readCurrentTools: '读取工具说明',
      nothingToRead: '还没有捕获到请求，先发一条消息再读取。',
      modes: {
        pytest: ['pytest 结果', '通过时只留一行结论；失败时保留 FAILED、断言与摘要'],
        git: ['git 输出', 'status 干净时折叠成一行，diff 只留文件头和变更行'],
        tsc: ['tsc 输出', '只保留 error TS 开头的行与总数，告警丢弃'],
        packageManager: ['包管理器安装', '成功时只留摘要行，失败时只留错误行'],
        generic: ['通用清理', '任意命令都安全：ANSI、回车重绘、重复行、进度条'],
        readOutline: ['大文件大纲', '超过行数阈值且没给 offset/limit 的 read 只返回符号大纲'],
        grepCap: ['搜索结果截断', '匹配过多时只留前 N 条并说明剩余数量'],
        proseStrip: ['删除句末句号', '删除散文行、你的输入与助手回复（含历史消息）末尾的一个句号，省下每个句子的一个 token'],
        systemPrompt: ['修改系统提示词', '把你写的文本加入或替换系统提示词'],
      },
      file: '配置目录',
      none: '未找到配置目录，改动不会落盘',
      generated: '更新时间',
      note: 'Token 数按 Harness 显示上下文时的同一套估算口径（4 字符 ≈ 1 token）折算；只统计被移除的字符。',
    };

    /** A finite, non-negative number from any wire value. */
    const number = (value) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);

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
        if (spDraft === null && state?.systemPrompt) setSpDraft(state.systemPrompt);
      }, [state, spDraft]);
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
          await commit({}, undefined, spDraft);
        } finally {
          setBusy('');
        }
      };

      /** Append the latest real request's prompt or tool schemas to the draft. */
      const readIntoDraft = async (field) => {
        setBusy(`read-${field}`);
        try {
          const response = await fetch(PROMPT_ENDPOINT, { headers: { accept: 'application/json' } });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const body = await response.json();
          const addition = body?.[field] ?? '';
          if (addition === '') {
            setError(text.nothingToRead);
            return;
          }
          setSpDraft((current) => ({
            mode: current?.mode ?? 'append',
            text: (current?.text ?? '') + (current?.text ? '\n\n' : '') + addition,
          }));
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
      group(text.filters, ['pytest', 'git', 'tsc', 'packageManager', 'generic']),
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
        h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' } },
          Object.keys(text.systemPromptModes).map((mode) => {
            const on = (spDraft?.mode ?? 'append') === mode;
            return h('button', {
              key: mode,
              type: 'button',
              role: 'radio',
              'aria-checked': on ? 'true' : 'false',
              onClick: () => setSpDraft({ mode, text: spDraft?.text ?? '' }),
              style: {
                padding: '3px 9px', borderRadius: '999px',
                border: '1px solid ' + (on ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l1)'),
                background: on ? 'var(--dsw-alias-bg-layer-1)' : 'transparent',
                color: on ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
                fontSize: '11px', lineHeight: '16px', font: 'inherit', cursor: 'pointer',
              },
            }, text.systemPromptModes[mode]);
          }),
        ),
        h('textarea', {
          value: spDraft?.text ?? '',
          onChange: (event) => setSpDraft({ mode: spDraft?.mode ?? 'append', text: event.target.value }),
          placeholder: text.systemPromptPlaceholder,
          maxLength: 8000,
          rows: 6,
          disabled: !modeOf('systemPrompt'),
          style: {
            width: '100%', boxSizing: 'border-box', marginTop: '6px', padding: '8px',
            borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l1)',
            background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)',
            font: 'inherit', fontSize: '12px', lineHeight: '18px', resize: 'vertical',
          },
        }),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px', flexWrap: 'wrap' } },
          button(text.saveSystemPrompt, () => { saveSystemPrompt(); }, !modeOf('systemPrompt') || busy === 'systemPrompt'),
          button(text.readCurrentPrompt, () => { readIntoDraft('prompt'); }, !modeOf('systemPrompt') || busy !== ''),
          button(text.readCurrentTools, () => { readIntoDraft('tools'); }, !modeOf('systemPrompt') || busy !== ''),
        ),
        h('div', {
          style: {
            marginTop: '6px', fontSize: '11px', lineHeight: '16px',
            color: 'var(--dsw-alias-label-secondary)',
          },
        }, text.systemPromptHint),
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
