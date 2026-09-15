# Codex Desktop Cloud task transport

Status: verified official bundle review and live probe, 2026-09-15.

This catalogs the unpublished ChatGPT Codex Cloud task transport used by the
official Desktop app. It is implementation evidence, not a public third-party
REST stability promise.

## Provenance

The package was selected and verified through the `codex-desktop-linux` signed
APT workflow, then its data payload and ASAR were extracted without running the
application or package maintainer scripts.

| Field | Value |
| --- | --- |
| Package | `chatgpt` 26.908.70816, amd64 |
| Repository | `https://persistent.oaistatic.com/codex-app-prod/linux/deb` |
| Package SHA-256 | `10ed0c1a880b9975d1f185bf7911a7f514e06b9863cd4ed9561d40063617c854` |
| Upstream `app.asar` SHA-256 | `bffe9bb51691ce8633208db9ceb6e215490084cdad2c19cf5a2658596169e571` |

ASAR-relative evidence identifiers for this package:

- `webview/assets/app-initial-cf777d5420b1.js`: task operations and generic
  SSE parser;
- `webview/assets/remote-conversation-page-29652746442b.js`: Cloud turn stream,
  event validation, deduplication, and folding;
- `.vite/build/main-DaMR-wdT.js`: main-process authentication and refresh;
- `.vite/build/window-all-closed-BxbCP6YG.js`: bearer/account header builder.

The payload was temporary inspection material and is not committed. The
reproducible extraction workflow is documented by
[codex-desktop-linux](../codex-desktop-linux/AGENTS.md).

## Authentication

The renderer sends relative WHAM paths through the Desktop network bridge with
internal bridge flags and `originator: "Codex Desktop"`. The main process
recognizes `/wham`, `/api/wham`, and `/backend-api/wham`, obtains the ChatGPT
credential from app-server, and attaches:

```http
Authorization: Bearer <ChatGPT access token>
ChatGPT-Account-Id: <workspace/account id>
```

It pins the expected principal and refreshes after a 401. Generic Electron
fetches can include cookies, but these task calls do not establish a cookie
requirement. The live probes succeeded with bearer and account headers.

## Operations

| Operation | Method and path | Body/query | Bundle call site | Live result |
| --- | --- | --- | --- | --- |
| Create | `POST /wham/tasks` | `new_task`, optional metadata, input items | `OAi` | Verified previously |
| Follow up | `POST /wham/tasks` | `follow_up`, optional metadata, input items | `NAi` | Same task, distinct new user/assistant turns |
| Cancel | `POST /wham/tasks/{task_id}/cancel` | No body | `WAi` | `{success: ...}`; terminal `cancelled` on next ~1-second read |
| Task | `GET /wham/tasks/{task_id}` | None | `pAi` | Verified |
| Turn list | `GET /wham/tasks/{task_id}/turns` | None | `mAi` | `current_turn_id` plus `turn_mapping` |
| Turn | `GET /wham/tasks/{task_id}/turns/{turn_id}` | None | `yAi` | Outer `task`, `turn`, `user_turn` |
| Logs | `GET /wham/tasks/{task_id}/turns/{turn_id}/logs` | None | `bAi` | Object with `logs`; observed length 84 |
| Stream | `GET /wham/tasks/{task_id}/turns/{turn_id}/stream` | `item_type=thread_event&item_type=log` | remote hook `to` | HTTP/2 200 `text/event-stream` |
| Archive/unarchive | `POST .../{task_id}/archive` / `recover` | No body | `eFo` / `tFo` | Not needed for ACP |

`recover` means unarchive, not execution recovery.

### Create and follow-up bodies

Create uses:

```json
{
  "new_task": {
    "branch": "<git ref>",
    "environment_id": "<environment id>",
    "run_environment_in_qa_mode": false
  },
  "metadata": { "model_slug": "<optional>" },
  "input_items": [{
    "type": "message",
    "role": "user",
    "content": [{ "content_type": "text", "text": "<prompt>" }]
  }]
}
```

Follow-up uses the same endpoint with:

```json
{
  "follow_up": {
    "task_id": "<existing task id>",
    "turn_id": "<current assistant turn id>",
    "environment_mode": "code"
  },
  "metadata": { "model_slug": "<optional>" },
  "input_items": [{
    "type": "message",
    "role": "user",
    "content": [{ "content_type": "text", "text": "<next prompt>" }]
  }]
}
```

`environment_mode` is `ask` for QA mode and `code` otherwise. Desktop can also
include IDE context, images, diffs, prior conversation context, and comment
attachments. The live follow-up retained the task ID and returned distinct new
user and assistant turn IDs, proving a real continuation surface.

## SSE behavior

The exact request is:

```http
GET /wham/tasks/{task_id}/turns/{turn_id}/stream?item_type=thread_event&item_type=log
```

An SSE `data` payload is either:

```json
{"id":"<event id>","item_type":"thread_event","event":{"method":"item/agentMessage/delta","params":{}}}
```

or a setup log:

```json
{"id":"<log id>","item_type":"log","key":{"type":"UserSetupScript","created_at":0},"line":"<line>"}
```

Desktop accepts `turn/started`, `turn/completed`, `turn/diff/updated`,
`turn/plan/updated`, `item/started`, `item/completed`,
`item/agentMessage/delta`, `item/plan/delta`,
`item/reasoning/summaryTextDelta`, `item/reasoning/textDelta`,
`item/commandExecution/outputDelta`, and `error`. Its underlying stored stream
can also contain thread status, token usage, goal, and raw-response events.

A completed-turn replay returned 425 records: 388 `thread_event` and 37 `log`.
It included 342 assistant deltas (1,270 characters), 12 completed items (five
agent messages, four commands, two reasoning items, one user message), reasoning
summary deltas, raw response items, thread status/token usage, and turn
start/completion.

The active cancellation probe proved real-time delivery: 13 events arrived
while the turn was nonterminal, including `turn/started`, completed user input,
five assistant deltas (19 characters), and completed assistant output. The SSE
then ended cleanly without a `turn/completed` or explicit cancellation marker.
The task detail changed from `in_progress` to `cancelled` on the next poll.
Cancellation therefore requires terminal task/turn verification after SSE EOF.

Desktop deduplicates outer events by ID, upserts items by item ID, and appends
deltas to their item. Stored completed events take precedence over live events;
assistant `output_items` are fallback text if no structured agent message exists.

The call site sends no resume cursor and configures no explicit retry. Ordinary
EOF completes the stream and invalidates task/turn queries. Production must
journal event IDs and reconcile with turn/task reads after disconnect.

### Desktop reconciliation audit

Static review of version 26.908.70816 on 2026-09-15 traced the remote page,
shared fetch/SSE parser, native authentication bridge, and conversation renderer.
This audit did not establish a lossless provider stream contract.

The remote page uses the same WHAM SSE route as Macro. Its caller passes no
cursor, offset, `Last-Event-ID`, retry strategy, or alternate WebSocket transport.
The shared SSE parser recognizes `event:` and `data:` but ignores `id:` and
`retry:`. Outer JSON record IDs deduplicate events; they do not establish order.

The desktop keeps replaceable message items:

1. `item/started` and `item/completed` insert or replace the full item by ID.
2. Deltas append only when an item with the matching ID/type already exists.
   Orphan deltas are discarded. There is no completed-item guard against later
   deltas in this reducer.
3. A changed turn snapshot rebuilds the projection from stored events and eligible
   live events. Once a completed turn contains a stored completed agent message,
   stored history takes precedence and live text is excluded.
4. `output_items` text is used only when no agent message exists. It does not
   repair an existing partial message by itself.

Thus a full completion can repair a missing prefix, but no desktop mechanism
found here reconstructs an unknown ordering of live fragments. The task and turn
list queries have a five-second **stale time**, not a five-second polling timer.
Normal SSE completion invalidates those queries. Macro independently polls the
active turn every five seconds and reconciles its final text.

A separate ChatGPT completion engine in the same bundle uses
`/f/conversation/resume`, offsets/resume tokens, and `/celsius/ws/user` WebSocket
handoff. No call path connects those mechanisms to the WHAM remote task page;
their presence does not establish a Codex task resume surface.

#### Macro completed-message policy

Macro withholds incomplete assistant text fragments. Completed provider messages
and final snapshots supply the answer through ordinary ACP message chunks.
Tools, status and thinking remain live. The experimental text replacement
capability and its fold support have been removed.

The archived `live_text_replacement.jsonl` recording documents why provisional
text was unsuitable: 236 updates ended with a 1,007-character incomplete message
before a completion supplied the full 1,357-character answer. Rendering those
fragments produced visibly missing words until the final correction.
The active regression replays actual missing-delta records through ACP and the
fold and verifies complete answers without correction wrappers or duplication.

#### Citation rendering

Desktop parses `【F:path†L1-L3】` into a structured file directive. Its file control
dispatches path, working directory, host and line data to an opener; the marker
does not contain a GitHub URL. The remote renderer supplies a null working
directory. Macro currently converts explicit file citations to Markdown code
such as `path:1-3`, without guessing a local checkout or remote revision.

#### Reproducible source locations

Offsets below are approximate zero-based Unicode character offsets in the
unmodified extracted files, not UTF-8 byte offsets. Minified names are specific
to this build.

| Asset | Functions / offsets | Evidence |
| --- | --- | --- |
| `remote-conversation-page-29652746442b.js` | `wa` 41915, `Da` 42300, `ja` 44200, `Na` 44900, `Ba` 47970, `to` 49430 | Stored/live fold, item replacement, SSE hook |
| `app-initial-cf777d5420b1.js` | `LS.stream` 2785158, `nC` 2796398, `pAi` 5254358, `mAi` 5254533 | Stream transport, bridge headers, snapshot query settings |
| `src-25d8c35b9f39.js` | `Cd` 93710, `wd` 94061 | SSE parser |
| `app-initial-cf777d5420b1.js` | `Lvn` 2941900, `Yvn` 2944200, `iyi` 5080224 | Citation parser and file opener |
| `app-primary-b7eba075b72d.js` | `fat` 440404, `Omt` 683070 | File-reference rendering and click dispatch |

SHA-256 of the remote conversation asset:
`3fc92f2adcb66ec889939e5d4616287f4b28493f8ef781daa61a6db159f5e734`.
The package and ASAR hashes above identify the other assets.

## ACP mapping

| ACP operation | Mapping |
| --- | --- |
| First `session/prompt` | Create task, checkpoint task/turn IDs, open SSE, reconcile terminal state |
| Later `session/prompt` | POST `follow_up` with current assistant turn ID; checkpoint and stream the returned turn |
| `session/update` | Translate thread events; expose setup logs only under an intentional product policy |
| `session/cancel` | POST cancel, then read until authoritative provider terminal state |
| `session/load` | Replay Macro journal; use turn reads/SSE replay for reconciliation because no resume cursor is exposed |

These routes remain unpublished. Pin sanitized fixtures by package version,
fail visibly on unknown shapes, and retain polling/final-snapshot fallback.

## Environment repository metadata

The desktop's `GET /wham/environments` response includes `repos` (ordered
repository IDs) and `repo_map` (metadata keyed by those IDs). Each repository
provides `repository_full_name`, `clone_url`, and `default_branch`. Settings
renders all repository entries; the task composer uses the first repository's
default branch. A repository can have multiple environments: the CLI's
`GET /wham/environments/by-repo/github/{owner}/{repo}` returns a list.

Source locations in the extracted 26.908.70816 package:

- `webview/assets/app-initial-cf777d5420b1.js`: `SAi` lists environments;
  `TNa`/`ENa` resolve the first repository; `ALa` reads its default branch.
- `webview/assets/cloud-environments-settings-page-1af730ab5175.js`: `ft` and
  the list render each repository via `repo_map`; `Lt` creates a singleton
  `repos:[repositoryId]` environment.
- Cloned CLI: `codex/codex-rs/cloud-tasks/src/env_detect.rs` lists environments
  by GitHub repository.

A read-only authenticated check on 2026-09-15 confirmed these fields for both
existing test-account environments. Repository IDs were strings; clone URLs
were HTTPS GitHub URLs ending in `.git`; both default branches were `main`.
Only environment identity and this repository subset were inspected. No task
was created. The model/UI projection must omit setup scripts, environment
variables, credentials, and arbitrary fields from the provider response.
