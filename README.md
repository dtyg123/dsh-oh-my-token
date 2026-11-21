# dsh-oh-my-token

> 让工具输出在 agent 真正需要之前，不进入提示词。
> Keep tool output out of the prompt unless the agent needs it.

`dsh-oh-my-token` 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件。它在工具结果**写入日志之前**完成改写，因此模型看到的字节与持久化记录完全一致；它从不改写工具参数、从不触碰磁盘上的会话文件、也不启动任何外部进程。

`dsh-oh-my-token` is a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that rewrites a tool result **before it is logged**, so the model and the durable transcript see the same bytes. It never rewrites tool arguments, never touches session files on disk, and never spawns a helper process.

它把两个工具的理念内建到进程里，而不是捆绑两个二进制：

It internalises two ideas rather than bundling two tools:

| 理念 / Idea | 来源 / Source | 本插件的做法 / What `dsh-oh-my-token` does instead |
| --- | --- | --- |
| 按命令过滤输出 / Per-command output filtering | [RTK](https://github.com/rtk-ai/rtk) | 解析模型已经运行过的命令，只保留结论和失败细节。纯 JS，无代理二进制。Parses the command the model already ran and keeps the verdict plus failure detail. Pure JS, no proxy binary. |
| 检索符号而非整文件 / Retrieve symbols, not files | codegraph | 把超大且未指定范围的 `read` 变成符号大纲，并限制过大的 `grep` 结果。无 SQLite 图库、无 MCP 服务。Turns a large un-ranged `read` into a symbol outline and caps huge `grep` results. No SQLite graph, no MCP server. |

外加一项模型根本不需要读取的变换：对可判定为散文的行，删除句末的 `.` 或 `。`。它作用于工具输出、你亲手输入的消息、助手的回复，以及历史对话——历史部分在组装请求时剥离，因此模型永远不会看到这些句号，而磁盘上的会话文件保持逐字节不变。

Plus one transformation the model never needs to read: a sentence-final `.` or `。` on a line that is provably prose. It applies to tool output, your own typed messages, the assistant's replies, and past turns — the last of these is stripped while the request is assembled, so the model never sees those periods while the stored session files stay byte-for-byte unchanged.

## 它保留了什么 / What it keeps

过滤只允许丢弃不承载决策的文本。具体来说：

Filtering is only allowed to drop text that carries no decision. Concretely:

- `pytest` → `✓ 42 passed in 1.23s`；失败时保留每一条 `FAILED`、`E   `、回溯与摘要行。On failure every `FAILED`, `E   `, traceback and summary line survives.
- `git status` → `clean`，或前 40 行。→ `clean`, or the first 40 lines.
- `git diff` → 文件头加变更行；纯空白 diff 折叠为一行。Headers plus changed lines; a whitespace-only diff collapses.
- `tsc` → 每条 `error TSxxxx` 加总数；告警丢弃。Every `error TSxxxx` line and a total count; warnings drop.
- `npm/pnpm/yarn/bun/pip/uv/poetry` 安装 → 成功留摘要行，失败留错误行。The summary line, or the error lines on failure.
- 其他命令 → 只做 ANSI、回车重绘、重复行与进度条清理。命令字符串永不改写。ANSI, carriage-return repaints, repeated lines and progress bars only. The command string is never rewritten.

结果仍超预算时，全文通过 `ctx.spillStore` 保存，标记会告诉模型去哪里取。如果没挂载 spill store，标记会说明如何重跑或重新读取——插件绝不丢弃无法恢复的文本。

When a result is still over budget, the full text is saved through `ctx.spillStore` and the marker tells the model where it went. If no spill store is mounted, the marker says how to re-run or re-read instead — the plugin never elides text it cannot recover.

## 安装 / Install

```sh
dsh plugin --profile web add dsh-oh-my-token
```

本地检出 / For a local checkout:

```sh
dsh plugin --profile web add file:/path/to/dsh-oh-my-token
```

该命令把包加入配置目录的 `dsh.profile.bundles`，包自带的 `cordis.patch.yml` 负责挂载这一行。可用 `dsh --profile web --dump-config` 查看合成后的配置。

The command adds the package to the profile's `dsh.profile.bundles`, and the package's own `cordis.patch.yml` mounts the row. `dsh --profile web --dump-config` shows the composed row if you want to confirm it.

要改预算，在配置目录的 `cordis.patch.yml` 对应行下添加字段；省略的字段沿用 bundle patch 的默认值。开关和散文范围无需改 patch——由设置页面管理。

To change a budget, add the field under that row in the profile's `cordis.patch.yml`; anything omitted keeps the default from the bundle patch. The switches and the prose scope do not need the patch — the Settings page owns them.

## 设置页面 / Settings page

**设置 → 省 Token**（**Settings → 省 Token**）是管理面板：

- 每个变换一个开关（5 个命令过滤器、2 个检索变换、句号剥离器、系统提示词编辑）；One switch per transform (5 command filters, 2 retrieval transforms, the period trimmer, the system-prompt editor);
- 句号剥离器的三档范围（`off` / 仅散文输出 / 所有散文）；A three-way scope for the period trimmer (`off` / prose outputs only / all prose);
- 节省记录：本次进程与历史累计、移除的 token 与字符、节省比例、按工具明细表，以及消息/回复剥离计数；The savings record: this process and all time, tokens and characters removed, the saved share, a per-tool table, and a message/reply strip count;
- 选择被写入的配置目录，方便确认开关是否真的落盘。The profile directory the choice is written to, so you can see whether a switch actually persisted.

改动在下一次工具调用即生效，无需重启。选择写入配置目录的 `dsh-oh-my-token.state.json`（优先取 `DSH_PROFILE_DIR`，否则从携带本包的配置目录推断），下次启动时覆盖 bundle 配置。统计在同目录的 `dsh-oh-my-token.stats.json`，可在页面清除。

Changes apply on the next tool call — no restart. The choice is written to `dsh-oh-my-token.state.json` in the profile directory (`DSH_PROFILE_DIR` when set, otherwise discovered from the profile that carries this package) and wins over the bundle config on the next start. Statistics live beside it in `dsh-oh-my-token.stats.json` and can be cleared from the page.

页面由两条精确路由支撑：`/dsh-oh-my-token/state` 与 `/dsh-oh-my-token/stats`。

Two exact routes back the page: `/dsh-oh-my-token/state` and `/dsh-oh-my-token/stats`.

## 系统提示词 / System prompt

在「设置 → 省 Token」底部的「系统提示词」卡片里，打开开关、选择「追加到末尾」或「整体替换」、填入文本并保存。文本通过 DSH 官方的 `system-prompt/assemble` 水面注入：

- **追加**：保留原有所有 section，在末尾加一个 `interpolate: false` 的 section——文本里的 `{{...}}` 保持字面量，不会被当作未知变量而报错；
- **整体替换**：只保留你写的那一段；
- 运行时上下文快照不受影响；改动在下一次请求生效，无需重启。

At the bottom of Settings → 省 Token, the 系统提示词 card lets you enable the switch, pick append or replace, type text, and save. The text is injected through DSH's official `system-prompt/assemble` waterfall:

- **append** keeps every existing section and adds one `interpolate: false` section at the end — `{{...}}` in your text stays literal instead of throwing as an unknown variable;
- **replace** keeps only your text;
- runtime context snapshots are untouched, and changes apply on the next request with no restart.

## 配置 / Configuration

| 字段 / Field | 默认值 / Default | 说明 / Meaning |
| --- | --- | --- |
| `enabled` | `true` | 关闭插件但不移除配置行。Turn the plugin off without removing the row. |
| `budgets.default` | `6000` | 没有单独配置的工具的字符上限。Character cap for any tool without its own entry. |
| `budgets.read` | `12000` | 文件内容是编辑的基础，因此额度更高。File content is the substrate for edits, so it gets more. |
| `budgets.grep` | `6000` | |
| `budgets.bash` | `4000` | |
| `budgets.errorFactor` | `2` | 错误结果允许放大到倍数。An error result is allowed to be this many times larger. |
| `minChars` | `800` | 小于此值的结果不动（清理不值得冒险）。Results below this are left alone (cleanup is not worth the risk). |
| `minGain` | `0.05` | 丢弃节省低于此比例的改写；散文句号改写始终保留。Discard a rewrite that saves less than this fraction. A prose-period rewrite is kept regardless. |
| `filters.*` | 全部 `true` | 各过滤器开关：`pytest`、`git`、`tsc`、`packageManager`、`generic`。Per-filter switches. |
| `retrieval.readOutlineOverLines` | `400` | 仅当行数超过此值且调用未带 `offset`/`limit` 时才生成大纲。Outline a `read` only above this line count, and only when the call had no `offset`/`limit`. |
| `retrieval.maxOutlineSymbols` | `60` | |
| `retrieval.maxGrepMatches` | `50` | |
| `prose.stripTrailingPeriod` | `true` | 删除散文行末尾的一个 `.` / `。`。Remove one sentence-final `.` / `。` from prose lines. |
| `prose.scope` | `filtered` | `filtered` = 仅命令过滤器标记为散文的输出（如 `git log`）；`all`；`off`。 |
| `recovery` | `spill` | `spill` \| `rerun` \| `none`。 |
| `logEvery` | `0` | 每 N 次改写打印一条节省日志；`0` 为静默。Log a savings line every N rewritten results; `0` is quiet. |

未知字段会在激活时报错，而不是静默忽略。An unknown field is an error at activation, not a silent no-op.

### 为什么句号剥离有防护 / Why the period trimmer is guarded

删掉文件名、URL、版本号或代码行里的句号，为了省一个 token 而损坏数据，代价太大。因此 `isProseLine` 会拒绝：

Deleting a period from a filename, a URL, a version or a line of code corrupts data to save one token. `isProseLine` therefore refuses:

- 围栏代码、diff 行、以 `{ [ <` 开头或以 `;{},=` 结尾的行；fenced code, diff lines, lines starting with `{ [ <`, lines ending in `;{},=`
- 含 URL、邮箱、带扩展名路径的行；anything containing a URL, an email address, a path with an extension
- 看起来像版本号（`2.2.0`）或 `host:port` 的内容；anything that looks like a version (`2.2.0`) or `host:port`
- 列表项（`- `、`*`）、省略号，以及 `e.g.` / `i.e.`。list items (`- `, `* `), ellipses, and `e.g.` / `i.e.`

## 测量 / Measure it

```sh
oh-my-token report [profile-dir | session.jsonl]
```

按事件类型（`user/message`、`assistant/message`、`tool/call`、`tool/result`）统计会话日志，并列出最昂贵的工具结果。这是"改写前"的数字；设置页面显示"改写后"。

Buckets a session log by event type (`user/message`, `assistant/message`, `tool/call`, `tool/result`) and lists the most expensive tool results. That is the "before" number; the Settings page shows the "after".

```sh
oh-my-token map <file|dir>      # the outline `read` would produce
oh-my-token lint [config.json]  # validate a row config without starting DSH
```

## 设计约束 / Design constraints

- **工具结果只追加 / Append-only tool results.** 替换发生在 `tools/post-execute`，因此被记录的就是替换后的内容。不用 `sessionProjections`、不做追溯修改、不会让前缀缓存失效。聊天文本则有意不同：历史句号只在派生请求（`session.deriveMessages()`）中剥离，从不写入持久化日志。The replacement is produced in `tools/post-execute`, so it is what gets logged. No `sessionProjections`, no retroactive edits, no prefix cache invalidation. Chat text is different by design: old periods are removed only from the derived request (`session.deriveMessages()`), never from the durable session log.
- **不改写参数 / No argument rewriting.** DSH 在工具管线里禁止这样做，改写过的命令是另一个可能出错的地方。DSH forbids it in the tool pipeline, and a rewritten command is a second thing that can be wrong.
- **零新依赖 / No new dependencies.** `index.js` 只引入自己的文件。`index.js` imports only its own files.
- **过滤器故障不等于工具失败 / A filter fault is not a tool failure.** 每个分支都有保护；出错时返回原始 decision。Every branch is wrapped; on error the original decision is returned untouched.
- **与 `dsh-token-frugal` 兼容 / Plays well with `dsh-token-frugal`.** 两者同时挂载时，让 `dsh-token-frugal` 先跑无损编码，再由 `dsh-oh-my-token` 做语义准入。两者在任何变换上都不重叠。If both are mounted, let `dsh-token-frugal` run its lossless encoders first and `dsh-oh-my-token` do the semantic admission. The two do not overlap on any transform.

## 刻意不做 / Deliberately not here

- **宿主 CLI 发现 / Host CLI discovery.** 告诉 agent 有哪些二进制可用（`PromptContext` 条目、`oh-my-token host-tools`）是独立的可选阶段；注入工具清单会让每个会话都付出提示词字节，包括从不调用 shell 的会话。Telling the agent which binaries exist (`PromptContext` entry, `oh-my-token host-tools`) is a separate, optional phase; injecting a tool inventory costs prompt bytes for every session, including ones that never shell out.
- **字符级压缩 / Character-level compression.** 到处删标点风险很大，只为省一个 token 的零头。只保留上面的散文场景。Removing punctuation everywhere is a large risk for a rounding error in tokens. Only the prose case above is kept.
- **符号图 / A symbol graph.** 大纲来自语言感知的正则。LSP 解析器更好，但那也是本插件拒绝引入的构建依赖。Outlines come from language-aware regexes. An LSP-backed resolver would be better; it is also a build dependency this plugin refuses to take.
- **输入框下方的小卡片 / A composer-dock chip.** 页面放在设置里——人找策略时会去那里；输入框下方的卡片会在每个屏幕重复同样的数字。The page is under Settings, where a person looks for a policy; a chip below the composer would repeat the same numbers on every screen.

## 许可 / Licence

MIT
