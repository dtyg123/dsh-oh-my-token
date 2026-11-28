# dsh-oh-my-token

[中文](README.md) | English

> Keep tool output out of the prompt unless the agent needs it.

`dsh-oh-my-token` is a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that rewrites a tool result **before it is logged**, so the model and the durable transcript see the same bytes. It never rewrites tool arguments, never touches session files on disk, and never spawns a helper process.

It internalises two ideas rather than bundling two tools:

| Idea | Source | What `dsh-oh-my-token` does instead |
| --- | --- | --- |
| Command- and structure-aware compaction | [RTK](https://github.com/rtk-ai/rtk) (Apache-2.0) | Parses the command the model already ran and keeps the verdict plus failure detail; when no command filter matched, compacts by output shape: git diff/status/log, build logs, grep/find/ls/tree, duplicate logs, numbered dumps and search lists. Pure JS, no binary. |
| Retrieve symbols, not files | [codegraph](https://github.com/isink17/codegraph) | Turns a large un-ranged `read` into a symbol outline and caps huge `grep` results. No SQLite graph, no MCP server. |

Plus two transformations the model never needs to read (independently switchable): on a line that is provably prose, a configurable word table deletes or replaces words (`谢谢`, `请`, `please`, `thanks`, … — delete by default, or swap one word for another), and punctuation is tidied: a mark opening a paragraph is dropped, two stuck-together marks collapse to one (a comma and a period keep the period; the same strength rule applies to the rest), and the run of **sentence-final** `.`, `。`, `,` and `，` marks is removed (an ASCII ellipsis is kept). They apply to tool output, your own typed messages, the assistant's replies, and past turns — the last of these is stripped while the request is assembled, so the model never sees those bytes while the stored session files stay byte-for-byte unchanged.

Plus one extra on the same derived path:

- **Red lines in the chat** — in your own messages and in the **body** of the model's replies, every word the plugin drops is drawn where it was: struck through in red, a replacement in green. Your messages use the harness's text-rule hook; a reply body is harness-rendered Markdown with no text hook, so the plugin puts the removed words back into the finished DOM (a re-render is decorated again).

## What it keeps

Filtering is only allowed to drop text that carries no decision. Concretely:

- `pytest` → `✓ 42 passed in 1.23s`; on failure every `FAILED`, `E   `, traceback and summary line survives.
- `git status` → `clean`, or the first 40 lines.
- `git diff` → headers plus changed lines; a whitespace-only diff collapses.
- `tsc` → every `error TSxxxx` line and a total count; warnings drop.
- `npm/pnpm/yarn/bun/pip/uv/poetry` install → the summary line, or the error lines on failure.
- Any other command → ANSI, carriage-return repaints, repeated lines and progress bars only. The command string is never rewritten.
- When no command filter matched (or for old tool results in history), RTK structure compaction takes over by shape: git diff/status/log keep names, counts and hunk headers; build logs keep errors, warnings and the summary; `cargo build/test` folds the Compiling/Checking progress and keeps `error[E…]`, `test result:` and Finished; `go test` collapses every `ok`/`?` package into one verdict line and, on failure, keeps the detail from the first FAIL; `eslint` compact output groups and counts by file; grep/find/ls/tree/search-list group and count; duplicate log lines collapse; an unstructured blob keeps head and tail. It only ever shrinks.

When a result is still over budget, the full text is saved through `ctx.spillStore` and the marker tells the model where it went. If no spill store is mounted, the marker says how to re-run or re-read instead — the plugin never elides text it cannot recover.

## Install

```sh
dsh plugin --profile web add dsh-oh-my-token
```

For a local checkout:

```sh
dsh plugin --profile web add file:/path/to/dsh-oh-my-token
```

The command adds the package to the profile's `dsh.profile.bundles`, and the package's own `cordis.patch.yml` mounts the row. `dsh --profile web --dump-config` shows the composed row if you want to confirm it.

To change a budget, add the field under that row in the profile's `cordis.patch.yml`; anything omitted keeps the default from the bundle patch. The switches and the prose scope do not need the patch — the Settings page owns them.

## Settings page

**Settings → 省 Token** is the management panel, split into **Overview / Compression / Prose / Prompt / About** tabs instead of one long page (About shows the plugin name, the version read from `package.json`, and a button that opens the GitHub repository):

- One switch per transform (5 command filters, RTK structure compaction, 2 retrieval transforms, the punctuation tidy);
- A plain-language compression-strength pick (gentle / default / aggressive) that sets the budgets and min-rewrite thresholds in one click, with the raw numbers still available under "advanced";
- Advanced: budgets, `minChars`/`minGain`, retrieval thresholds, over-budget recovery (`spill`/`rerun`/`none`), `logEvery`, and the plugin master switch;
- A three-way scope shared by the prose transforms (punctuation / words) (`off` / prose outputs only / all prose);
- A custom word table: one row per word with an optional replacement (empty = delete), saved as `prose.politenessWords`; particles live in the same table. The defaults include 谢谢 / 好的 / 请 / please / thanks and particles such as 啊 / 呀 / 吧 / 呢 / 嘛 / 哦. Particles are only dropped at the end of a phrase, so 酒吧 / 网吧 / 毛呢 / 哗啦 stay intact. The table also has a “keep a line made up of one word” option;
- Each message of the live turn has a 改写 button in the chat; it matches on the message text, so it needs no session knowledge and works right after a restart;
- The savings record: all time, tokens and characters removed, the saved share, a per-tool table, and a message/reply strip count;
- The profile directory the choice is written to, so you can see whether a switch actually persisted.

Changes apply on the next tool call — no restart. The choice is written to `dsh-oh-my-token.state.json` in the profile directory (`DSH_PROFILE_DIR` when set, otherwise discovered from the profile that carries this package) and wins over the bundle config on the next start. Statistics live beside it in `dsh-oh-my-token.stats.json` and can be cleared from the page.

Three exact routes back the page: `/dsh-oh-my-token/state`, `/dsh-oh-my-token/stats`, and `/dsh-oh-my-token/prompt` (reads the currently effective system prompt).

## Full prompt

The 完整提示词 card in Settings → 省 Token is **read-only**, not an editor: press 获取提示词 and the plugin asks the host to assemble the effective system prompt right now (`assemble({ preview: true })`), so what you see is exactly what the next request would carry — the core prompt, the host's context, and **sections other plugins injected**, in the same order. Because it is assembled on demand, the prompt is readable even before the first request. Variables such as `{{provider}}` and `{{model}}` are substituted with their current values; a variable with no value stays literal instead of failing the read.

- 复制全文 copies the text to the clipboard;
- the card's header shows `N sections · M characters`, so a composed prompt can be checked at a glance;
- the plugin never edits the prompt — it only reads it.

## Configuration

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Turn the plugin off without removing the row. |
| `budgets.default` | `6000` | Character cap for any tool without its own entry. |
| `budgets.read` | `12000` | File content is the substrate for edits, so it gets more. |
| `budgets.grep` | `6000` | |
| `budgets.bash` | `4000` | |
| `budgets.errorFactor` | `2` | An error result is allowed to be this many times larger. |
| `minChars` | `800` | Results below this are left alone (cleanup is not worth the risk). |
| `minGain` | `0.05` | Discard a rewrite that saves less than this fraction. A prose-period rewrite is kept regardless. |
| `filters.*` | all `true` | Per-filter switches: `pytest`, `git`, `tsc`, `packageManager`, `generic`. |
| `rtk` | `true` | Enable RTK structure compaction when no command filter matched; also a Settings switch. |
| `retrieval.readOutlineOverLines` | `400` | Outline a `read` only above this line count, and only when the call had no `offset`/`limit`. |
| `retrieval.maxOutlineSymbols` | `60` | |
| `retrieval.maxGrepMatches` | `50` | |
| `prose.stripTrailingPeriod` | `true` | Tidy punctuation: drop a mark opening a paragraph; collapse two stuck-together marks to one (a comma and a period keep the period, same-strength keeps the right one); then drop the run of trailing `.` / `。` / `,` / `，` (an ASCII ellipsis is kept). |
| `prose.stripPoliteness` | `true` | Delete or replace words on prose lines via the `politenessWords` table. |
| `prose.keepWholeLine` | `true` | Keep a line made up of one listed word (with optional sentence-ending punctuation); only tidy its punctuation. Turn it off to apply deletion/replacement normally. |
| `prose.politenessWords` | built-in rules | Each entry is `{ word, replace? }`: empty/omitted `replace` deletes the word, a string replaces it. The defaults include 谢谢 / 好的 / 请 / please / thanks and particles 啊 / 呀 / 吧 / 呢 / 嘛 / 哦, deleted only at a phrase end and guarded against splitting compounds. An explicit empty list turns the word step off. Lines containing URLs, paths, Markdown links or code are left alone. |
| `prose.scope` | `filtered` | `filtered` = only output a command filter marked as prose (e.g. `git log`); `all`; `off`. |
| `recovery` | `spill` | `spill` \| `rerun` \| `none`. |
| `logEvery` | `0` | Log a savings line every N rewritten results; `0` is quiet. |

An unknown field is an error at activation, not a silent no-op. Every field above is editable in Settings → 省 Token → Advanced; `enabled` is the master switch, and `filters.*` map to the switch rows above.

### Why the period trimmer is guarded

Deleting a period from a filename, a URL, a version or a line of code corrupts data to save one token. `isProseLine` therefore refuses:

- fenced or inline code, diff lines, lines starting with `{ [ <`, lines ending in `;{}=`, and lines carrying code punctuation (`= ( ) ; { } [ ]`) that end in a comma;
- assignment/statement lines (containing `= ; { }` or starting with `const`/`function`/`import`), which word removal never touches;
- lines containing URLs, email addresses, Markdown links or paths, which word removal never touches;
- anything that looks like a version (`2.2.0`) or `host:port`;
- list items (`- `, `* `), ellipses, and `e.g.` / `i.e.`.

## Measure it

```sh
oh-my-token report [profile-dir | session.jsonl]
```

Buckets a session log by event type (`user/message`, `assistant/message`, `tool/call`, `tool/result`) and lists the most expensive tool results. That is the "before" number; the Settings page shows the "after".

```sh
oh-my-token map <file|dir>      # the outline `read` would produce
oh-my-token lint [config.json]  # validate a row config without starting DSH
```

## Where else it could compress

Walked through "every byte the model could act on" once more:

- **Command output** (the big one): 5 command filters + 17 RTK structural compactors already cover pytest / git / tsc / package managers / eslint / cargo / go test / grep / find / ls / tree. The long tail (docker, kubectl, make…) runs through shape detection + generic cleanup + smart-truncation instead of one more hand-written parser — every parser is a regression-test surface to maintain.
- **File reads**: large `read` gets a symbol outline, large `grep` gets capped. Going further (AST-only, skip import blocks) would trade "text the model can quote" for "a summary the model has to ask for again", with a real chance of dropping the one line that matters. Not worth it.
- **JSON / images**: collapsing repeated JSON objects is the next candidate, but for a lockfile one deleted line can send the model after the wrong version — asymmetric risk, deferred. Image bytes are not text; that cost lives in the upstream multimodal encoder, where no plugin-side compression is safe.
- **Conversation text**: covered by the word table and the punctuation tidy. Anything more aggressive (summarising history) needs another LLM call, which breaks the no-helper-process constraint.
- **System prompt**: read-only. Every word in a prompt is a constraint the user chose, so the plugin never trims it and never appends to it.

## Design constraints

- **Append-only tool results.** The replacement is produced in `tools/post-execute`, so it is what gets logged. No `sessionProjections`, no retroactive edits, no prefix cache invalidation. Chat text and old tool results are different by design: historical periods and RTK compaction of old tool results happen only in the derived request (`session.deriveMessages()`), never in the durable session log.
- **No argument rewriting.** DSH forbids it in the tool pipeline, and a rewritten command is a second thing that can be wrong.
- **No new dependencies.** `index.js` imports only its own files.
- **A filter fault is not a tool failure.** Every branch is wrapped; on error the original decision is returned untouched.
- **Plays well with `dsh-token-frugal`.** If both are mounted, let `dsh-token-frugal` run its lossless encoders first and `dsh-oh-my-token` do the semantic admission. The two do not overlap on any transform.

## Deliberately not here

- **Host CLI discovery.** Telling the agent which binaries exist (`PromptContext` entry, `oh-my-token host-tools`) is a separate, optional phase; injecting a tool inventory costs prompt bytes for every session, including ones that never shell out.
- **Character-level compression.** Removing punctuation everywhere is a large risk for a rounding error in tokens. Only the prose case above is kept.
- **A symbol graph.** Outlines come from language-aware regexes. An LSP-backed resolver would be better; it is also a build dependency this plugin refuses to take.
- **A composer-dock chip.** The page is under Settings, where a person looks for a policy; a chip below the composer would repeat the same numbers on every screen.

## Sponsor

This plugin is fully open-source under the MIT licence and maintained on personal time. If it saves you enough tokens to feel worth a coffee, you can support me here:

![QR for sponsorship](docs/sponsor-qrcode.jpg)

Not required, not expected, and it doesn't buy any promises — the code is already yours.

## Contributors

Rendered from GitHub's live data — nothing is hard-coded in the repository:

<a href="https://github.com/dtyg123/dsh-oh-my-token/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=dtyg123/dsh-oh-my-token" alt="Contributors" />
</a>

## Stars

[![Star history](https://api.star-history.com/svg?repos=dtyg123/dsh-oh-my-token&type=Date)](https://star-history.com/#dtyg123/dsh-oh-my-token&Date)

![GitHub stars](https://img.shields.io/github/stars/dtyg123/dsh-oh-my-token?style=social)

## Acknowledgements

- **[RTK](https://github.com/rtk-ai/rtk) (Apache-2.0)** — the per-command output-filtering idea comes from RTK; this plugin implements both the command filters and the structural filters in pure JS.
- **[codegraph](https://github.com/isink17/codegraph) (MCP service, FSL-1.1)** — the "read the symbol map first, then a range" retrieval idea comes from codegraph; this plugin implements a lightweight version with language-aware regexes, with no graph database and no MCP server.
- See the third-party notices for the exact licence terms and the Apache-2.0 text: [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) and [`LICENSES/Apache-2.0.txt`](LICENSES/Apache-2.0.txt).

## Licence

MIT

The RTK structural filters are used under Apache-2.0; the full third-party notices (including the Apache-2.0 text) are in `THIRD_PARTY_NOTICES.md` and `LICENSES/Apache-2.0.txt`.
