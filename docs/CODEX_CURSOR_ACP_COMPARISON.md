# Codex Cloud and Cursor Cloud as ACP agents

Status: source review plus externally run probe results, 2026-09-15. This
review used no credentials and launched no provider tasks itself. Initial
snapshot-only probes exposed final text but no intermediate output or structured
shell-failure event. After official Desktop source revealed the turn stream,
follow-up, and cancel calls, live probes verified all three, including assistant
deltas during an active turn. The live probe report remains authoritative for
request/response captures.

## Conclusion

Cursor Cloud currently supplies the lifecycle needed for a faithful ACP v1
adapter: start and continue one conversation, stream ordered run events, cancel
the active remote run, inspect status, and rebuild known history. The existing
adapter implements those operations and journals provider observations before
publishing ACP updates.

Codex Cloud source now supplies candidate operations for the full core
lifecycle: a follow-up body on the task-create endpoint, task cancellation,
turn reads/logs, and a turn SSE stream carrying thread events and setup logs.
These operations were found in the verified official Desktop bundle after the
Rust review; the Rust cloud client implements only creation and snapshots.
Live probes then confirmed turn/list/log reads, structured SSE replay and live
deltas, a same-task follow-up with new turn IDs, and remote cancellation to
terminal `cancelled`. The remaining risks are unpublished-contract drift and
reconnect semantics, rather than core lifecycle feasibility.

Codex app-server has the missing-looking thread and turn operations, but it is
a protocol for a running Codex process. Its `thread/start`, `turn/start`,
`turn/interrupt`, history, and live notifications are not evidence that the
ChatGPT Codex Cloud task service supports those operations.

## ACP contract and the repository's version boundary

The repository pins `agent-client-protocol` 2.0.0 at Rust SDK revision
`8769d16d…`, but the Cursor adapter explicitly implements
`agent_client_protocol::schema::v1`; the pinned schema crate is 1.6.0. Its
effective contract is therefore ACP v1, even though the SDK package is 2.0.0.
See [Cargo.lock](../Cargo.lock) and the
[Cursor ACP adapter](../crates/cursor_cloud_agents/src/inbound/acp.rs).

For that implemented v1 contract:

| Method or notification | Requirement | Macro Cursor implementation |
| --- | --- | --- |
| `initialize` | Baseline; first request and capability negotiation | Implemented; negotiates at most v1 |
| `session/new` | Baseline session creation | Implemented; creates local state only |
| `session/prompt` | Baseline turn operation | Implemented; response waits for a terminal provider outcome |
| `session/cancel` | Baseline client-to-agent notification for an active turn | Implemented; sends Cursor remote cancel and continues observing termination |
| `authenticate` | Conditional: clients call it only for an advertised auth method | Handler exists, but `authMethods` is empty because the host injects credentials; clients should not call it |
| `session/load` | Optional and gated by `loadSession` | Implemented and advertised; replays journaled history |
| `session/set_config_option` | Optional and gated by returned config options | Implemented for Cursor model selection |
| `session/resume`, `session/close` | V1 capability-gated session lifecycle extensions | `close` has a handler but neither capability is advertised; a compliant v1 client will call neither |
| `session/request_permission` | Agent-to-client interaction, used only when needed | Never sent; Cursor approves remotely and exposes no interception point |
| Client filesystem/terminal methods | Capability-gated | Not advertised; work runs remotely |
| MCP transports | Capability-gated | HTTP and SSE advertised and forwarded; stdio declined because its executable is local to the ACP client |

ACP has since stabilized v2. Its current baseline session surface includes
`session/new`, `session/prompt`, `session/list`, `session/resume`, and
`session/close`; `session/cancel` remains a notification. If `authMethods` is
non-empty, the agent must implement both `auth/login` and `auth/logout`.
`session/close` must cancel ongoing work and free the active session. V2 also
changes prompt lifecycle: the prompt response acknowledges acceptance and
progress/foreground completion travels through `session/update`, including an
idle state. This project must choose an explicit v1 compatibility target or do
a separate v2 migration; cloud-provider feasibility does not remove that work.

Sources: [ACP v1 overview](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/protocol/v1/overview.mdx),
[ACP v1 session setup](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/protocol/v1/session-setup.mdx),
[ACP v2 overview](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/protocol/v2/overview.mdx),
[ACP v2 session setup](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/protocol/v2/session-setup.mdx), and
[ACP protocol updates](https://agentclientprotocol.com/updates). The versioned
repository implementation, rather than the moving latest specification, is
authoritative for current Macro behavior.

## Provider compatibility

| ACP need | Cursor Cloud | Codex Cloud task transport | Consequence for Codex ACP |
| --- | --- | --- | --- |
| Create a conversation | `POST /v1/agents` creates an agent and first run | `POST /backend-api/wham/tasks` creates a task/user turn | Viable for the first prompt, preferably lazily after `session/new` |
| Continue context | `POST /v1/agents/{agent}/runs` opens another run on the same agent | Official Desktop posts `/wham/tasks` with `follow_up.task_id`, prior `turn_id`, environment mode, and new input items | Live probe retained the task and returned distinct new user/assistant turns; suitable for repeated `session/prompt` |
| Intermediate output | `GET .../runs/{run}/stream` returns SSE assistant, thinking, tool, interaction and result events | Official Desktop opens per-turn SSE filtered to `thread_event` and `log` | Live probe received five assistant deltas while the turn was active; journal event IDs and reconcile with snapshots |
| Terminal result | Stream terminal result plus run-status fallback | Task status and task details expose current assistant/diff turns | Single-turn completion appears feasible; final text/diff needs deduplication and stable ordering |
| Cancel remote work | `POST .../runs/{run}/cancel`, then observe terminal result/status | Official Desktop posts `/wham/tasks/{task_id}/cancel` without a body | Live task reached `cancelled` on the next ~1-second read; SSE emitted no terminal cancel event, so verify status |
| Recover/replay | Agent/run list plus an append-only local journal; same translator for live and replay | Task detail has current turns and sibling attempts, not a proven complete ordered transcript or cursor | Persist every observation locally; advertise `loadSession` only after completeness and replay rules are proven |
| Concurrent prompts | Adapter serializes one active run per ACP session | Unknown provider continuation model | Reject or serialize; never infer that matching task IDs make prompts safe |
| Authentication | Host resolves owner-bound Cursor API key | ChatGPT OAuth/device flow plus account routing header | Feasible, but credential lifecycle and workspace binding belong to the host rather than ACP when `authMethods` is empty |
| Models/config | Cursor `/v1/models`; chosen model sent at agent creation | No verified cloud-task model-selection contract in reviewed adapter | Do not advertise model config yet |
| MCP/permissions | HTTP/SSE MCP forwarded at creation; approvals occur in Cursor Cloud | No evidenced cloud-task forwarding or approval response channel | Advertise neither until the task service proves them |

Cursor details come from [API client](../crates/cursor_cloud_agents/src/api.rs),
[session service](../crates/cursor_cloud_agents/src/domain/service.rs),
[event translator](../crates/cursor_cloud_agents/src/domain/translate.rs), and
[replay contract](../crates/cursor_cloud_agents/REPLAY.md). The harness embeds
the agent through an in-process duplex ACP pipe and binds the session owner's
credential in [Cursor manager](../crates/agent_harness/src/outbound/cursor/manager.rs).

## What the Codex Cloud source actually establishes

At reference checkout `codex` revision
`2fdcdeaf0e219eea34c710e01de2ee0571ddeeb5`, the backend client implements:

- `GET /backend-api/wham/tasks/list`, with pagination and filters;
- `GET /backend-api/wham/tasks/{task_id}` for task details;
- `GET /backend-api/wham/tasks/{task_id}/turns/{turn_id}/sibling_turns`;
- `POST /backend-api/wham/tasks` to create a task.

See [backend client](../codex/codex-rs/backend-client/src/client.rs) and
[task detail types](../codex/codex-rs/backend-client/src/types.rs). The latter
extracts the current user prompt, assistant message text, errors, unified diff,
turn IDs/status, worklog assistant messages, and sibling-turn IDs. The local
[Codex Cloud probe](../crates/codex_cloud_agents/src/outbound/openai/tasks.rs)
currently uses creation plus snapshot reads and bounded polling. These
`/backend-api/wham` paths are source observations, not a published third-party
REST contract.

No task follow-up, cancel, or subscription method was found in the reviewed
`backend-client`, `cloud-tasks-client`, or `cloud-tasks` Rust surfaces. The
official Desktop bundle described below supplies all three candidate operations.

The observed final snapshot can put the same turn ID in both
`current_assistant_turn` and `current_diff_task_turn`. Treat these as two views
of one logical turn when IDs match. Merge fields by `(task_id, turn_id)` and
deduplicate individual content records; do not append the full assistant turn
and full diff turn independently. When an ID is missing, retain source-slot
provenance and content hashes rather than guessing identity. This rule also
prevents a polled snapshot from re-emitting the same final text on every read.

The OpenCode reference at revision
`e03db9bc6908f75c9334d8aa997deeaac81c0298` is useful only for authentication
and subscription-backed inference. Its
[Codex plugin](../opencode/packages/opencode/src/plugin/openai/codex.ts) uses
ChatGPT OAuth/account routing and `/backend-api/codex/responses`; that Responses
transport is not the Codex Cloud task API and cannot establish cloud task
follow-up or cancellation.

Official OpenAI documentation found during this review describes public
Responses cancellation/streaming and current agent environment APIs, but it
does not document the WHAM cloud-task endpoints above. The public Responses
API's `POST /responses/{response_id}/cancel` therefore must not be applied to a
WHAM task ID. See the [OpenAI Responses reference](https://developers.openai.com/api/reference/cli/resources/beta/subresources/responses).

## What the desktop Linux repackaging establishes

The `codex-desktop-linux` checkout at revision
`5f7310d71dd02e6e0131deec6fa89d26c8bcaf9c` repackages OpenAI's signed Linux
Electron application. Its [agent guide](../codex-desktop-linux/AGENTS.md) says
the default build preserves upstream `resources/app.asar` byte-for-byte and
forbids editing generated output. This checkout contains no `codex-app/` or
`app.asar`; those paths are excluded by
[its `.gitignore`](../codex-desktop-linux/.gitignore). Consequently it does not
contain the official renderer/main-process bundle needed to discover genuine
cloud-task requests.

The tracked feature patches and their synthetic bundle fragments add useful
boundaries but no new hosted-task endpoint:

- [Authenticated proxy patch](../codex-desktop-linux/linux-features/authenticated-proxy/patch.js)
  recognizes a generic Electron application-network fetch path whose caller
  can request `credentials: "include"` or Electron `useSessionCookies`. Its
  [test](../codex-desktop-linux/linux-features/authenticated-proxy/test.js)
  inserts `https://chatgpt.com/wham/usage` into a synthetic minified source
  string. This demonstrates that the desktop transport abstraction can use its
  browser session cookies; it does not establish that `/wham/usage` is a real
  application route, that Cloud tasks use cookies, or that OAuth/account
  headers are absent.
- [Filesystem-root follow-up](../codex-desktop-linux/linux-features/filesystem-root-follow-ups/README.md)
  applies only to an existing **local** task composer guard. The paired
  [patch](../codex-desktop-linux/linux-features/filesystem-root-follow-ups/patch.js)
  explicitly preserves cloud/worktree behavior. Its use of “follow-up” is not
  a hosted Cloud continuation transport.
- [Model-picker presets](../codex-desktop-linux/linux-features/model-picker-default-presets/README.md)
  observes that local repository tasks and cloud/TPP chats have separate
  upstream catalog/config paths. It changes renderer-side selection and offers
  no task creation, continuation, cancellation, or event URL.
- [Remote Mobile Control](../codex-desktop-linux/linux-features/remote-mobile-control/README.md)
  starts the bundled local `codex app-server --remote-control`, or proxies its
  complete JSON-RPC byte stream to one local Unix-socket owner. Its tracked
  bundle fragments consume app-server `turn/started`, `item/started`,
  `item/completed`, and `turn/completed` notifications and call
  `remoteControl/enable`, `remoteControl/disable`, pairing and status methods.
  Those are remote control of a local Codex host through OpenAI's Remote
  product, not observation or control of a hosted WHAM Cloud task.
- [Remote Control UI](../codex-desktop-linux/linux-features/remote-control-ui/README.md)
  only removes Linux UI gates and explicitly does not fabricate backend state.

The tracked clone alone did not identify a hosted Cloud task WebSocket/SSE
subscription, follow-up request, or cancel request. A separately authorized,
verified extraction of the official package subsequently supplied those call
sites.

### Verified official Desktop bundle

The inspected package is `chatgpt` 26.908.70816 for amd64, selected and
verified through the repackager's signed-repository workflow. Package SHA-256:
`10ed0c1a880b9975d1f185bf7911a7f514e06b9863cd4ed9561d40063617c854`;
upstream `app.asar` SHA-256:
`bffe9bb51691ce8633208db9ceb6e215490084cdad2c19cf5a2658596169e571`.
The extraction was read-only and did not run the application or package
maintainer scripts. Since extracted `/tmp` files are not repository artifacts,
the stable evidence identifiers below include their ASAR-relative paths and
minified function names.

In `webview/assets/app-initial-cf777d5420b1.js`:

- `OAi` creates a task with `POST /wham/tasks`. Its body contains
  `new_task: {branch, environment_id, run_environment_in_qa_mode}` (or an
  inline `environment`), optional `metadata.model_slug`, and `input_items`.
- `NAi` follows up with the same `POST /wham/tasks`. Its body contains
  `follow_up: {task_id, turn_id, environment_mode}`, where mode is `ask` or
  `code`; optional `metadata.model_slug`; and `input_items`. Text input is
  `{type: "message", role: "user", content: [{content_type: "text", text}]}`.
  The Desktop can also include IDE context, images, and comment attachments.
- `WAi` cancels through `POST /wham/tasks/{task_id}/cancel`, substituting the
  path parameter and sending no request body.
- Read hooks call `GET /wham/tasks/{task_id}/turns`,
  `GET /wham/tasks/{task_id}/turns/{task_turn_id}`, and the same turn path with
  `/logs`. Active task lists poll every 15 seconds; inactive lists poll every
  two minutes. Individual task/turn reads have five-second stale times but are
  invalidated when a stream completes.
- `POST /wham/tasks/{task_id}/recover` is paired with `/archive`; it means
  unarchive, not recovery of an interrupted execution.

In `webview/assets/remote-conversation-page-29652746442b.js`, hook `to` opens:

```text
GET /wham/tasks/{task_id}/turns/{turn_id}/stream
    ?item_type=thread_event&item_type=log
```

It opens only while the turn is nonterminal (`pending`/`in_progress`; terminal
statuses are `completed`, `failed`, and `cancelled`) unless its caller asks to
keep the stream open. The generic HTTP stream parser consumes SSE and the hook
closes it with an abort controller when unmounted. This call site supplies no
resume cursor, explicit retry policy, premature-termination recovery, or
`[DONE]` requirement; EOF calls `onComplete` and invalidates task/turn queries.

Each accepted SSE `data` payload has one of these outer shapes:

- thread event: `{id, item_type: "thread_event", event}`. The accepted
  `event.method` values are `turn/started`, `turn/completed`,
  `turn/diff/updated`, `turn/plan/updated`, `item/started`, `item/completed`,
  `item/agentMessage/delta`, `item/plan/delta`,
  `item/reasoning/summaryTextDelta`, `item/reasoning/textDelta`,
  `item/commandExecution/outputDelta`, and `error`. The UI deduplicates by
  outer event ID, upserts completed items by item ID, and folds deltas into the
  corresponding item through the same remote-turn reducer used for stored
  `thread_events.events`.
- setup log: `{id, item_type: "log", key: {type: "UserSetupScript",
  created_at}, line}`. The UI deduplicates logs by ID.

For completed turns, stored completed item events take precedence over live
events; final assistant `output_items` are a fallback if no folded
`agentMessage` exists. This is direct evidence that the task service can expose
structured intermediate events, even though the earlier snapshot-only probes
did not observe them.

The Desktop renderer supplies internal bridge flags and
`originator: "Codex Desktop"`; the main-process transport recognizes WHAM
paths, obtains the app-server's ChatGPT token, and attaches the bearer token and
`ChatGPT-Account-Id`, with principal pinning and a 401 refresh path. Its generic
Electron fetch can optionally include session cookies, but the Cloud call sites
do not establish that cookies are required. These source-derived operations
remain unpublished backend routes and must be fixture-pinned and live-probed
before production use.

See [Codex Desktop Cloud task transport](CODEX_DESKTOP_TRANSPORT.md) for exact
payloads, event shapes, authentication, provenance, and live results.

## App-server is a separate integration option

Codex app-server exposes JSON-RPC methods including `thread/start`,
`thread/resume`, `thread/read`, paginated thread/turn/item reads,
`turn/start`, `turn/steer`, and `turn/interrupt`. It emits thread, turn and item
notifications, and `account/login/start` supports `chatgptDeviceCode` with a
verification URL and user code. See
[method registry](../codex/codex-rs/app-server-protocol/src/protocol/common.rs),
[thread types](../codex/codex-rs/app-server-protocol/src/protocol/v2/thread.rs),
[turn types](../codex/codex-rs/app-server-protocol/src/protocol/v2/turn.rs), and
[account types](../codex/codex-rs/app-server-protocol/src/protocol/v2/account.rs).

That surface is a good basis for a local Codex-to-ACP bridge: ACP session IDs
can map to app-server thread IDs, prompts to `turn/start`, cancel to
`turn/interrupt`, and replay to thread reads. It requires operating a Codex
process and its local rollout/auth state. It does not attach those operations
to an already-running hosted WHAM task, and comments in the source mark some
Cloud history injection and raw-event behavior as internal/experimental.

## Truthful Codex Cloud ACP profile

The source and live probes support this profile:

1. `initialize`: advertise text prompting and no load, MCP, filesystem,
   terminal, permission, model, or protocol-driven auth capabilities.
2. `session/new`: allocate local state and capture environment/branch choices;
   do not launch work.
3. First `session/prompt`: durably record intent, create exactly one task, poll
   snapshots, emit only newly observed provider text/diff/status, and return a
   terminal ACP outcome when provider terminal state is observed.
4. `session/cancel`: call the verified cancel operation, then keep reading until
   the provider reports authoritative cancelled or another terminal state.
5. Further `session/prompt`: use the verified `follow_up` body, checkpoint the
   returned new turn identity, and open that turn's stream.
6. `session/load`: leave unadvertised until local durability plus provider
   snapshot completeness can replay all accepted prompts and emitted updates
   exactly once.

Production parity with Cursor requires successful, repeatable probes for a
same-conversation follow-up, authoritative remote cancel, complete terminal
output, and reconnect-safe incremental observation. An actual event stream is
needed only for live tool/progress fidelity; polling can satisfy ACP correctness
if it yields ordered, complete, deduplicated observations and honest latency.

## Next probes

| Priority | Probe | Pass condition | ACP decision unlocked |
| --- | --- | --- | --- |
| 1 | Disconnect/reconnect the stream mid-turn | Replayed event IDs plus dedupe lose nothing; terminal snapshot agrees | Freeze live/replay journal and retry policy |
| 2 | Follow up after worker restart and after a web-side turn | Current parent turn is unambiguous; no prompt is duplicated | Durable continuation reconciliation |
| 3 | Race cancel with creation and natural completion | Every outcome resolves to provider-observed terminal state | Production `session/cancel` and v2 `session/close` |
| 4 | Failed, no-diff, diff, and multi-attempt tasks | Events, text, errors, diffs, attempts and duplicate slots have stable precedence | Freeze normalizer and ACP translation |
| 5 | Expired/revoked token and workspace switch | Refresh preserves the bound account; mismatch fails without task recreation | Production credential and retry policy |
