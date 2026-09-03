# ACP Elicitation

Status: implementation plan. No protocol or product code has changed as part
of this document.

Sources:

- [Elicitation RFD](https://agentclientprotocol.com/rfds/elicitation) (Completed, 2026-07-22)
- [Protocol: Elicitation](https://agentclientprotocol.com/protocol/v2/elicitation) (stable)
- [Announcement](https://agentclientprotocol.com/announcements/elicitation-stabilized) (2026-07-24)
- [Schema reference](https://agentclientprotocol.com/protocol/schema)

The RFD is done. The remaining work is ours: Macro is an ACP client today and
does not advertise, hold, render, or answer `elicitation/create`.

## Elevator pitch

Let a coding agent pause a turn and ask the user a structured question (form)
or send them through a safe out-of-band flow (URL, typically OAuth). The user
answers in the session page. The agent gets a typed `accept` / `decline` /
`cancel` and continues. This is not a permission prompt and not a session
config option.

## Why this exists

ACP agents already have two limited ways to get input:

1. **Session config options** — persistent, pre-declared at session open
   (model, mode). Defaults required. Wrong tool for a one-off decision.
2. **Unstructured turn text** — the agent writes "which approach?" in prose
   and hopes the next `session/prompt` is the answer. No validation, no
   cancel/decline distinction, no safe place for secrets.

Elicitation is the missing transient request/response. The community rejected
a one-off `session/select` (PR #340) in favor of the MCP elicitation data
model, adapted to ACP's persistent bidirectional connection.

## Protocol, compressed

Agents send `elicitation/create` **directly** to the Client. MCP instead
embeds the same payload in an `InputRequiredResult` and waits for the Client
to retry the originating request. That is the main ACP/MCP split.

### Modes

- **Form** — restricted JSON Schema, in-band. Non-sensitive data only.
- **URL** — out-of-band browser flow. Credentials never transit ACP or enter
  Client / model context.

`mode` is required. An omitted mode is not form. Unknown modes (and
implementation-specific modes starting with `_`) must be preserved when
stored or forwarded, and must not be rendered as form or URL.

### Scope (flattened on the request)

- **Session** — `sessionId` set. Optional `toolCallId` when the elicitation
  was forwarded from an MCP server during a tool call.
- **Request** — `requestId` set. Pre-session (auth / setup). No `sessionId`.

Every elicitation and its state binds to the **Client connection** and, when
auth exists, the **verified user**. A `sessionId` alone is not enough.

### Capability negotiation

Advertised on `initialize` under `clientCapabilities.elicitation`:

```json
{ "elicitation": { "form": {}, "url": {} } }
```

| Wire | Meaning |
| --- | --- |
| omitted / `null` | elicitation unsupported |
| `{ "form": {} }` | form only |
| `{ "url": {} }` | URL only |
| `{ "form": {}, "url": {} }` | both |
| `{}` or `{ "form": null, "url": null }` | no modes (not "form by default") |

This is a deliberate ACP/MCP split: MCP still treats an empty object as
form-only. Agents **MUST NOT** send a mode the Client did not advertise.
Unsupported mode → JSON-RPC `-32602`.

### Restricted form schema

Senders must send `type: "object"` and `properties`. Flat primitives only:

- `string` (`minLength`, `maxLength`, `pattern`, `format`: `email` / `uri` /
  `date` / `date-time`, plus unknown formats preserved)
- `number` / `integer` (`minimum`, `maximum`)
- `boolean`
- single-select: `enum` or titled `oneOf` + `const`
- multi-select: array of string `enum` or titled `anyOf` + `const`
  (`minItems` / `maxItems`)

ACP additions over MCP: `pattern`, schema-level `title` / `description`,
titled-enum descriptions, `_meta`. No `$schema`, no deprecated `enumNames`.

Not supported: nested objects, arrays of objects, conditionals.

`pattern` is agent-supplied. Evaluating it requires a time-bounded regex
engine. A pathological pattern must not block the UI.

### Response actions

| Action | Meaning | `content` |
| --- | --- | --- |
| `accept` | user submitted (form) or consented to open (URL) | form: SHOULD match schema; URL: usually omitted |
| `decline` | explicit no | ignored |
| `cancel` | dismissed (Escape, close, navigate away) | ignored |

Unknown actions starting with `_` are preserved, never treated as the three
known ones. Agents must handle every action and every failure; they must not
assume success.

URL `accept` is **consent to open**, not completion. Completion is a later
optional `elicitation/complete` notification carrying the original
`elicitationId`.

### URL security (normative)

Agents:

- MUST NOT put credentials, PII, or pre-authenticated access in the URL
- SHOULD use HTTPS outside development
- SHOULD NOT put clickable URLs in form fields
- MUST NOT send tokens obtained through URL mode back over ACP
- MUST verify the user who started the flow is the user who finishes it

Clients:

- MUST NOT prefetch the URL or its metadata
- MUST show the full URL and obtain consent before navigating
- MUST highlight the host; SHOULD warn on Punycode / suspicious URIs
- MUST open in a context the Client and the model cannot inspect
  (new browser tab, not an embedded webview we control)
- MUST identify the requesting Agent and offer decline + cancel

### Not a permission request

The RFD is explicit: keep elicitation and `session/request_permission`
separate. Permission is "may this tool run?". Elicitation is "what should I
do next?". Different UX, different policy, different defaults.

## What Macro does today

Macro is an ACP **Client**. The harness does not care which agent is on the
other end of the pipe (`docs/CURSOR_AGENT_TRANSPORT.md`). The pieces that
matter:

```text
web (block-agent)
  └─ POST /agent-sessions/{id}/control     AgentAction
       └─ agent_session SessionMachine     ACP Client
            ├─ initialize / session/new|load|resume / session/prompt
            ├─ auto-answers session/request_permission
            └─ logs every frame
                 └─ agent_fold                 MessagePart vocabulary
                      └─ MagicChip + AgentMessage
```

### Handshake

`SessionMachine::build_initialize_request` sends
`InitializeRequest::new(PROTOCOL_VERSION)` with default
`ClientCapabilities`. That default does **not** advertise `elicitation`.
Agents that check capabilities (they must) will never send
`elicitation/create` to us.

We speak `ProtocolVersion::V1` (`crates/agent_session/src/lib.rs`).
Elicitation is in the stable schema; it does not require a version bump.

### Incoming agent requests

Once `Live`, `on_frame` only special-cases `session/request_permission`. It
picks `AllowAlways`, else `AllowOnce`, else `Cancelled`, and replies
immediately. Comment on the machine: "this autonomous agent has no approval
UI." Everything else is ignored.

If an agent sent `elicitation/create` today, the request would be logged
and then hang until the agent timed out.

### Fold

`agent_fold` already understands permission as a first-class part
(`MessagePart::Permission`) and matches the later JSON-RPC response to
resolve `pending` → `selected` / `cancelled` / `errored` / `unrecognized`.
`acp_ready` clears `pending_permissions` because request ids restart per
connection.

Elicitation is not in the vocabulary. Incoming `elicitation/create` falls
through to "handshake and configuration traffic: nothing to render."

### Control plane

`AgentAction` is `Prompt | SetModel | Compact | Stop`. Those mint a new
`AgentActionId` (`agent_session:{uuid}`) used as the JSON-RPC **request**
id. Control requires `OwnerAccessLevel`.

An elicitation answer is a JSON-RPC **response** to the agent's request id,
the same shape as the permission auto-reply. It does not mint a new ACP
request.

### Frontend

- `PermissionPart` is a read-only `ToolCard` ("Permission requested" +
  trailing outcome). No buttons. By the time the fold shows it, the machine
  has usually already answered.
- MagicChip treats a pending permission as the in-flight activity
  ("Permission needed") and ranks it above a running tool.
- Composer drain keys off `working` (open turn, no stop). A hung
  elicitation would leave `working` true and hold the prompt queue — unless
  we teach both the fold and the composer that "waiting on the user" is
  not "the agent is busy."

### The other ACP role

`cursor_cloud_agents` is an ACP **Agent** (`AgentCapabilities::default()`).
It never sends `session/request_permission` and would not send elicitation
either. Out of scope for v1. When we want Macro-as-agent to ask Zed / Cursor
a question, that is a later slice against this same protocol.

Cognition chat (`POST /cognition/stream/chat/message`) is not ACP. Do not
extend `AssistantMessagePart` for this.

### SDK pin

Workspace `agent-client-protocol` is git-pinned at
`8769d16d10e0c9fa7e662ee18424a4313b06ea88`. That pin resolves
`agent-client-protocol-schema 1.6.0`, which **already has every elicitation
type** in `src/v1/elicitation.rs` — but behind a cargo feature:

```text
agent-client-protocol         feature  unstable_elicitation
  └─ agent-client-protocol-schema  feature  unstable_elicitation
```

Without the feature there is no `ClientCapabilities::elicitation`, no
`CreateElicitationRequest`, and no `matches_method` impl for
`elicitation/create`. No pin bump is needed. One line in the workspace
`Cargo.toml` turns it on.

Zed-as-client recordings in `crates/agent_fold/fixtures/real/` already
advertise `"elicitation":{"form":{},"url":{}}` on `initialize`. That is
Zed's capability object, not ours.

## Harness matrix (research 2026-09-02)

What each popular ACP agent actually does when it wants to ask the user
something, from reading adapter source. The shared idiom (a select plus an
"Other" free-text companion, and the answer the harness settled on) is read
through two `HarnessReader` methods in `crates/agent_fold/src/domain/harness/`
- `custom_answer_for` and `reported_elicitation_answer` - with the shared
marker as the neutral reading (`generic.rs`) and each harness's own marker
and naming fallback in its file (`claude_code.rs`, `codex.rs`). The fold
collapses each pair in `fold/elicitation.rs`; everything else is plain ACP.

| Harness | `agentInfo.name` | Sends `elicitation/create` | Idiom | Client answers by |
| --- | --- | --- | --- | --- |
| Claude Code (`claude-agent-acp` ≥ 0.64) | `@agentclientprotocol/claude-agent-acp` | yes — form for `AskUserQuestion` (gated on `elicitation.form`, tool removed otherwise); url + `elicitation/complete` for MCP servers | `question_N` (`oneOf`, or `array`+`anyOf` for multi) + `question_N_custom` marked `_meta._askUserQuestionCustomAnswer`; `toolCallId` = the `AskUserQuestion` tool call; custom text wins; adapter reports the answer in `_meta.claudeCode.toolResponse.answers`; decline → empty answers, cancel → tool aborted; numeric ids; may have several in flight | JSON-RPC response |
| Codex (`codex-acp` ≥ 1.8) | `@agentclientprotocol/codex-acp` | yes, only in `collaboration_mode: plan` (or a Codex feature flag) and only if `elicitation.form`; MCP url → url mode + complete | `<id>` + `<id>__other` marked `_meta.codex.{questionId,isOtherAnswer}`; `required` names only questions without a companion; `toolCallId` names an id never opened as a `tool_call`; `_meta.codex.autoResolutionMs` may time the request out | JSON-RPC response |
| OpenCode 1.18 | `OpenCode` | no; `clientCapabilities.elicitation` ignored | `question` tool exists but is off under `opencode acp`; if forced on, it blocks forever — nothing on ACP can answer it | new `session/prompt` (agent asks in prose) |
| Hermes Agent | `hermes-agent` | no (PR #30089 unmerged would add `answer` + `other_answer`) | `clarify` excluded from the ACP toolset | n/a |
| OpenClaw bridge | `openclaw-acp` | no | `ask_user` shows as `tool_call` `title:"ask_user: …"`, blocks the Gateway run; cannot be answered over ACP | n/a (times out → `no_answer`) |
| Goose | — | yes, form, MCP-originated | plain ACP | JSON-RPC response |
| Macro in-memory agent | `macro-inmem` | yes — form, when the client advertises it | model-callable `AskUser` asks one required free-text or single-choice question; `/ask` remains the deterministic end-to-end rig | JSON-RPC response |
| Gemini CLI, Kimi, Cursor cloud | — | no | — | — |

Consequences already built in:

- The custom-answer collapse keys on the harness's marker, then the shared
  one, then - only for a property with no `_meta` at all - the harness's
  suffix; it applies to single and multi selects (`customField` on the
  property). An unknown harness collapses on the shared marker alone.
- A collapsed question is required even when the wire says optional: an
  empty submission is useless to the agent.
- Claude Code's tool call is absorbed by the question part; Codex's
  `toolCallId` matches nothing, so the part is simply appended.
- Claude Code may run several elicitations concurrently (parallel
  subagents). This client holds one; the second is refused `-32602`, which
  the adapter turns into a denied tool. Acceptable for v1; revisit if seen.
- OpenCode / OpenClaw questions are not synthesized into elicitation parts:
  nothing could answer them, and a form nobody can submit is worse than a
  tool card.

## What shipped on this branch

The first pass, end to end, on the `cursor/acp-elicitation-spec-caf3`
branch:

- `agent-client-protocol` with `unstable_elicitation` (the pinned rev
  already had every type).
- `AgentAction::RespondElicitation` — a JSON-RPC response on the agent's
  own id, numeric or string.
- `SessionMachine` advertises `{form:{}, url:{}}`, holds one
  session-scoped elicitation, refuses the rest with `-32602`, answers
  through control, cancels the held question on Stop, and 409s a stale
  answer.
- `agent_fold`: `MessagePart::Elicitation`, `SessionMetadata.pending_elicitation`,
  absorption of the asking tool call (by `ToolPath`, so a question a
  subagent asked replaces the nested call), id-routed responses,
  `elicitation/complete`, and the two `HarnessReader` methods above. Real
  Claude Code fixture pinned; Claude multi-question and Codex shapes tested
  from the adapters' documented output; each reader's idiom pinned in
  `test/harness_readers.rs`.
- `agent_inmem`: model-callable `AskUser` sends a real `elicitation/create`
  through a domain user-input port; `/ask <question> | option | option`
  remains the deterministic local end-to-end rig.
- Web: `ElicitationPart` (form with select / "Other" / text / number /
  boolean / multi-select, URL consent), `blockedOnUser` composer notice,
  MagicChip ranking, gallery demo, form-model tests.
- `scripts/convert_stdio_recording.py` turns a stdio recorder's log into a
  fold fixture.

Still to do, in the order the plan lists: agent-side elicitation from
Macro's own tools, request scope, more than one outstanding question per
session (Claude Code's parallel subagents).

## Product decisions

1. **Client first.** The product path is Macro receiving elicitation from
   coding agents. `agent_inmem` also sends it through `AskUser`, both as a
   native harness feature and as the local integration path. Sending from
   `cursor_cloud_agents` remains a later slice.
2. **Do not auto-answer.** Permissions stay auto-approved. Elicitation
   waits for the session owner.
3. **Advertise both modes.** `{ form: {}, url: {} }`.
4. **Owner answers.** Same `OwnerAccessLevel` gate as every other control.
5. **Session-scoped only.** Request-scoped (`requestId`, no `sessionId`)
   is answered `-32602`. Those fire before `session/new`; the session
   machine is the wrong place for them.
6. **One outstanding elicitation per session.** The protocol allows many.
   Macro holds one. A second `elicitation/create` while one is pending is
   answered `-32602` and never rendered. The first is not disturbed.
7. **Permission and elicitation stay separate** parts, separate UX.
8. **Stop cancels the pending elicitation** (`action: "cancel"`) before
   `session/cancel`. Disconnect / `acp_ready` drops it — the JSON-RPC id
   is dead across connections and cannot be answered.
9. **Form answers are conversation content.** Logged as ACP frames, folded
   into the transcript. No password widget; the user's tool is Decline.
10. **URL opens in a new tab** after consent. No iframe, no prefetch.
11. **No new table, no new gateway message type.** The log is the record;
    the fold derives the pending slot into `SessionMetadata`; the existing
    `agent_session_log` realtime stream carries every frame the web needs.

## What changes

Five layers, inner to outer. Each has a type-surface diff and a behavior
diff.

```text
Cargo.toml            feature flag
agent_runtime_protocol  AgentAction::RespondElicitation
agent_session           advertise · hold one slot · answer · stop-cancel
agent_fold              MessagePart::Elicitation · SessionMetadata.pending_elicitation
apps/web                ElicitationPart · composer blockedOnUser · MagicChip
```

### 0. Cargo

```toml
# Cargo.toml [workspace.dependencies]
agent-client-protocol = { git = "…", rev = "8769d16…", features = ["unstable_elicitation"] }
```

Unlocks, all in `agent_client_protocol::schema::v1`:

| Type | Shape (fields that matter) |
| --- | --- |
| `ElicitationCapabilities` | `form: Option<ElicitationFormCapabilities>`, `url: Option<ElicitationUrlCapabilities>` |
| `ClientCapabilities::elicitation(..)` | builder |
| `CreateElicitationRequest` | `mode: ElicitationMode` (flattened), `message: String` |
| `ElicitationMode` | `Form(ElicitationFormMode)` \| `Url(ElicitationUrlMode)` \| `Other(..)` — tagged `mode` |
| `ElicitationFormMode` | `scope: ElicitationScope`, `requested_schema: ElicitationSchema` |
| `ElicitationUrlMode` | `scope`, `elicitation_id: ElicitationId`, `url: String` |
| `ElicitationScope` | `Session { session_id, tool_call_id: Option }` \| `Request { request_id }` |
| `ElicitationSchema` | `properties: BTreeMap<String, ElicitationPropertySchema>`, `required: Option<Vec<String>>`, `title`, `description` |
| `ElicitationPropertySchema` | `String` \| `Number` \| `Integer` \| `Boolean` \| `Array(MultiSelect)` \| `Other { type_, fields }` — tagged `type` |
| `CreateElicitationResponse` | `action: ElicitationAction` (flattened) |
| `ElicitationAction` | `Accept(ElicitationAcceptAction { content: Option<BTreeMap<String, ElicitationContentValue>> })` \| `Decline` \| `Cancel` \| `Other` — tagged `action` |
| `ElicitationContentValue` | untagged `String` \| `Integer(i64)` \| `Number(f64)` \| `Boolean` \| `StringArray` |
| `CompleteElicitationNotification` | `elicitation_id: ElicitationId` |
| `CreateElicitationRequest::matches_method` / `CompleteElicitationNotification::matches_method` | from the SDK's `impl_jsonrpc_*` macros |

Everything is `#[non_exhaustive]`, so every `match` in our code needs a
wildcard arm, same as `PermissionOutcome` today.

Wasm: `agent_fold` builds for wasm32. The schema crate is pure serde; the
feature adds no native deps. `just ensure-agent-fold-wasm` in `apps/web`
is the check.

### 1. `agent_runtime_protocol` — the action

`crates/agent_runtime_protocol/src/domain/action.rs`.

```rust
/// A JSON-RPC request id as the agent sent it, carried whole so the answer
/// echoes the exact id back. `null` is not a valid id for a request that
/// expects a response, so it is not representable here.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
#[serde(untagged)]
pub enum ElicitationRequestId {
    Number(i64),
    Str(String),
}
impl ElicitationRequestId {
    pub fn from_request_id(id: &RequestId) -> Option<Self>;   // Null → None
    pub fn to_request_id(&self) -> RequestId;
}

/// What the user decided. Mirrors ACP's three actions; there is no
/// `Other` because we never originate an unknown action.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum ElicitationAnswer {
    Accept {
        /// Form: the submitted values, keyed by property. URL: omitted.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        content: Option<BTreeMap<String, serde_json::Value>>,
    },
    Decline,
    Cancel,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct AgentRespondElicitationAction {
    /// The agent's `elicitation/create` request id, not an AgentActionId.
    pub request_id: ElicitationRequestId,
    #[serde(flatten)]
    pub answer: ElicitationAnswer,
}

pub enum AgentAction {
    Prompt(AgentPromptAction),
    SetModel(AgentSetModelAction),
    Compact,
    Stop,
    RespondElicitation(AgentRespondElicitationAction),   // new
}
```

Wire body on `POST /agent-sessions/{id}/control`:

```json
{ "type": "respondElicitation", "requestId": 43, "action": "accept",
  "content": { "strategy": "balanced" } }
{ "type": "respondElicitation", "requestId": "el-7", "action": "decline" }
```

Behavior:

- `supersedes_queued()` → `false`.
- `to_runtime(session_id, minted_id)` → **ignores `minted_id`** and builds
  `RawJsonRpcMessage::response(request_id.to_request_id(), Ok(CreateElicitationResponse))`.
  `content` values are converted `serde_json::Value → ElicitationContentValue`;
  a value that is not string / integer / number / boolean / string-array is
  `ActionError::Acp(..)`. This is the only `AgentAction` that emits a
  Response frame rather than a Request or Notification; the doc comment on
  the variant says so.
- `control_from_runtime` → recognizes a `to_runtime` Response whose id is
  in the fold's pending-elicitation map. The fold does this itself (see §3);
  `control_from_runtime` returns `None` for responses, unchanged.

Tests (`action/test.rs`): serde round trip for all three answers; `to_runtime`
emits a Response with the echoed id and a body that deserializes as
`CreateElicitationResponse`; non-primitive content is rejected.

### 2. `agent_session` — advertise, hold, answer

#### Types (`domain/session/types.rs`)

```rust
/// The one elicitation this connection is holding for the user.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct PendingElicitation {
    pub(super) request_id: RequestId,
}
```

Nothing else. Message, schema and mode live in the log; the machine only
needs to know *which* id it may answer.

`SessionPhase::Live` grows the slot:

```rust
Live { session_id: SessionId, elicitation: Option<PendingElicitation> }
```

`Effect` is unchanged. Answers go out as `Effect::Send`.

#### Error (`domain/error.rs`)

```rust
#[error("agent session {0} has no pending elicitation matching that request id")]
ElicitationNotPending(AgentSessionId),
```

HTTP mapping in `inbound/axum_router.rs`: `409 CONFLICT` (a stale or
double answer, same class as "runtime not attached").

#### Machine (`domain/session/session.rs`)

`build_initialize_request`:

```rust
InitializeRequest::new(PROTOCOL_VERSION).client_capabilities(
    ClientCapabilities::new().elicitation(
        ElicitationCapabilities::new()
            .form(ElicitationFormCapabilities::new())
            .url(ElicitationUrlCapabilities::new()),
    ),
)
```

`on_frame` while `Live` — today only `respond_to_permission_request`. Add
`hold_or_refuse_elicitation`:

```text
Request with method elicitation/create
  parse CreateElicitationRequest
    parse fails                         → JSON-RPC -32602 "invalid elicitation"
    mode is Other                       → -32602 "unsupported elicitation mode"
    scope is Request                    → -32602 "request-scoped elicitation unsupported"
    slot already Some                   → -32602 "one elicitation at a time"
    scope.session_id != live session_id → -32602 "elicitation for another session"
    otherwise                           → slot = Some(request.id); no Send
Notification elicitation/complete       → nothing (fold handles it)
```

Every refusal is an `Effect::Send` of `RawJsonRpcMessage::response(id, Err(Error::invalid_params()))`,
which the actor logs before sending like any other outbound frame — so the
refusal is in the transcript too.

`on_command` while `Live`, new arm before the generic enqueue:

```text
RespondElicitation(action)
  slot is None or slot.request_id != action.request_id
      → Effect::Complete { Err(ElicitationNotPending) }   (nothing sent, nothing logged)
  else
      → slot = None; enqueue + flush as usual (to_runtime builds the Response)
```

`Stop` (already `supersedes_queued`): before `drop_pending`, if the slot
is `Some`, push `Effect::Send { from: <stopper>, Response(id, Ok(Cancel)) }`
and clear the slot. Then the existing cancel notification.

Slot lifetime: set on hold; cleared on answer, on stop, and on `die`. A
new `acp_ready` builds a fresh machine, so there is nothing to clear
there. **The machine keeps the slot across a `session/prompt` response**
(the agent may still be waiting). The fold, not the machine, decides
whether to keep offering the form once the turn has ended — see §3.

Tests (`session/tests.rs`), in the style of the permission tests:

- initialize frame carries `"elicitation":{"form":{},"url":{}}`
- form create is held (no Send), status stays Live
- url create is held
- second create while held → `-32602`, first slot intact
- request-scoped → `-32602`; `Other` mode → `-32602`
- respond with matching id → Response frame with `action: accept` and content; slot empty; a repeat → `ElicitationNotPending`
- respond with wrong id → `ElicitationNotPending`, slot intact
- stop with a slot → cancel Response then `session/cancel`, in that order
- close with a slot → no frame, no panic

Actor (`actors.rs`): no change. `deliver` already logs then sends;
`acp_method` returns `None` for a Response, so the span simply lacks
`rpc.method` for an answer. Acceptable; note it.

Harness test agent (`agent_harness/src/testing/helpers/agent.rs`): the
`ClientRequest::parse_message` match is over client→agent requests and is
unaffected. Add a helper `sends_elicitation(request) -> RequestId` and
`elicitation_response(id) -> Option<CreateElicitationResponse>` so
service-level tests can drive the loop end-to-end.

### 3. `agent_fold` — the type surface

`crates/agent_fold/src/domain/model.rs`. Everything here is
`Serialize + specta::Type` and lands in
`apps/web/src/lib/service-clients/service-agent-fold/generated/types.ts`
via `just gen-agent-fold-types`.

#### New: the elicitation vocabulary

```rust
/// The agent's JSON-RPC id for an elicitation, as the answer must echo it.
/// Re-exported from agent_runtime_protocol so the control body and the
/// fold agree byte-for-byte.
pub use agent_runtime_protocol::domain::action::ElicitationRequestId;
//  TS: string | number

/// What the agent asked for.
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum ElicitationRequest {
    Form { schema: ElicitationSchema },
    Url { elicitation_id: String, url: String },
    /// A mode this fold does not know. Kept raw so nothing is lost; never
    /// rendered as form or url.
    Unrecognized { mode: String, #[specta(type = Unknown)] raw: serde_json::Value },
}

/// ACP's restricted form schema, mirrored so the browser gets a typed
/// union instead of `unknown`.
#[serde(rename_all = "camelCase")]
pub struct ElicitationSchema {
    pub title: Option<String>,
    pub description: Option<String>,
    /// In the agent's order. BTreeMap on the wire is alphabetical; the fold
    /// re-reads the raw `properties` object to keep declaration order.
    pub properties: Vec<ElicitationProperty>,
    pub required: Vec<String>,
}

#[serde(rename_all = "camelCase")]
pub struct ElicitationProperty {
    pub name: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub schema: ElicitationPropertySchema,
}

#[serde(tag = "type", rename_all = "snake_case")]
pub enum ElicitationPropertySchema {
    String {
        min_length: Option<u32>, max_length: Option<u32>,
        pattern: Option<String>, format: Option<ElicitationStringFormat>,
        default: Option<String>,
        /// Single-select: `enum` (untitled) or `oneOf` (titled). Empty when free text.
        options: Vec<ElicitationOption>,
    },
    Number  { minimum: Option<f64>, maximum: Option<f64>, default: Option<f64> },
    Integer { minimum: Option<i64>, maximum: Option<i64>, default: Option<i64> },
    Boolean { default: Option<bool> },
    /// Multi-select. `anyOf` (titled) and `items.enum` (untitled) both land here.
    MultiSelect {
        min_items: Option<u64>, max_items: Option<u64>,
        options: Vec<ElicitationOption>, default: Vec<String>,
    },
    /// A property type this fold does not know. The browser renders a
    /// "cannot display" row; Decline / Cancel still work.
    Unrecognized { #[serde(rename = "type")] type_name: String, #[specta(type = Unknown)] raw: serde_json::Value },
}

#[serde(rename_all = "snake_case")]
pub enum ElicitationStringFormat { Email, Uri, Date, DateTime, Other(String) }

#[serde(rename_all = "camelCase")]
pub struct ElicitationOption { pub value: String, pub title: Option<String>, pub description: Option<String> }

/// How the request has resolved so far. `Pending` is a legitimate final
/// state on a dead session, like an unanswered permission.
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ElicitationOutcome {
    Pending,
    Accepted {
        /// The submitted form values (absent for URL accept).
        #[specta(type = Unknown)] content: Option<serde_json::Value>,
    },
    Declined,
    Cancelled,
    /// URL only: `elicitation/complete` arrived after Accepted.
    Completed,
    /// Answered with a JSON-RPC error — including our own -32602 refusals.
    Errored { message: String },
    Unrecognized,
}
```

#### Changed: `MessagePart`

```rust
pub enum MessagePart {
    Text { .. }, Thought { .. }, ToolUse { .. }, Permission { .. }, Control { .. }, Plan { .. },
    /// The agent asking the user a question.                          // new
    Elicitation {
        #[serde(rename = "requestId")] request_id: ElicitationRequestId,
        #[serde(rename = "toolCall")]  tool_call: Option<ToolUseId>,
        message: String,
        request: ElicitationRequest,
        outcome: ElicitationOutcome,
    },
}
```

#### Changed: `SessionMetadata`

```rust
pub struct SessionMetadata {
    pub model, supported_models, title, available_commands, status,   // unchanged
    /// The one elicitation the user can answer right now. `None` when
    /// nothing is pending, the turn that asked has ended, or the
    /// connection that asked is gone.
    pub pending_elicitation: Option<PendingElicitation>,               // new
}

#[serde(rename_all = "camelCase")]
pub struct PendingElicitation {
    pub request_id: ElicitationRequestId,
    /// Where the matching `MessagePart::Elicitation` lives, so a surface
    /// can scroll to it or dedupe against the transcript.
    pub turn: u32,
    pub tool_call: Option<ToolUseId>,
    pub message: String,
    pub request: ElicitationRequest,
}
```

The part is the history; the metadata is the live pointer. The web reads
`metadata.pendingElicitation` to decide *whether to show a form*, and the
part to render the transcript row. The channel MagicChip already receives
metadata and can say "Waiting for your input" without folding parts.

#### Fold state (`domain/fold.rs`)

```rust
struct FoldState {
    ..,
    /// Outstanding elicitations by the agent's request id: where the part
    /// sits (message, part), so a response can resolve it.
    pending_elicitations: HashMap<RequestId, (usize, usize)>,          // new
    /// URL elicitations that were accepted and may still `complete`.
    completable_elicitations: HashMap<String /* elicitationId */, (usize, usize)>, // new
}
```

Dispatch additions, each one arm in `step`:

| Frame | Handler | Effect |
| --- | --- | --- |
| `to_server` Request `elicitation/create` | `request_elicitation` | push part `Pending`; record in `pending_elicitations`; set `metadata.pending_elicitation` (only if none set — a second one, which the machine refuses, still gets a part so the refusal is visible, but never the slot) |
| `to_runtime` Response `Result` whose id ∈ `pending_elicitations` | `resolve_elicitation` | outcome ← Accepted / Declined / Cancelled / Unrecognized; clear slot if it was this id; if URL + Accepted, record in `completable_elicitations` |
| `to_runtime` Response `Error` whose id ∈ `pending_elicitations` | `resolve_elicitation` | outcome ← `Errored { message }`; clear slot |
| `to_server` Notification `elicitation/complete` | `complete_elicitation` | if id ∈ `completable_elicitations` and part is Accepted → Completed; else ignore |
| `session/prompt` Response (turn end) | existing `end_turn` | additionally: `metadata.pending_elicitation = None` if set. The part stays `Pending`. |
| `acp_ready` event | existing | additionally clear `pending_elicitations`, `completable_elicitations`, and the metadata slot |

Dispatch ordering caveat: today a `to_runtime` `Response::Result` is
routed to `resolve_permission`. Route by id: try `pending_elicitations`
first, then `pending_permissions`. Both maps are keyed by the *agent's*
request ids, which the agent keeps unique, so there is no ambiguity.

`request_elicitation` decoding rules, so the TS side never sees a
half-typed schema:

- `ElicitationMode::Form` → `ElicitationRequest::Form`, mapping each
  `ElicitationPropertySchema` variant 1:1; `Other` → `Unrecognized`.
- Declaration order: the SDK's `properties` is a `BTreeMap`, which sorts
  keys. Re-read `params.requestedSchema.properties` as a
  `serde_json::Map` to recover the agent's order — `workspace-hack`
  enables `serde_json/preserve_order`, so that map is insertion-ordered
  everywhere in this workspace, wasm included.
- `ElicitationMode::Url` → `ElicitationRequest::Url`.
- `ElicitationMode::Other` → `ElicitationRequest::Unrecognized`.
- `scope` Request → still folded (the part exists, the machine will have
  refused it, the Error response resolves it to `Errored`). The metadata
  slot is never set for it.

`Turn` gains nothing: positions are held in `FoldState` maps like
`pending_controls`, not per turn, because an answer can legally arrive
after the turn that asked has ended.

Tests (`domain/test/fold.rs`, plus a fixture in `testing/fixtures.rs`):

- form create → part Pending, metadata slot set with same id
- accept with content → part Accepted{content}, slot None
- decline / cancel → part, slot None
- error response → Errored, slot None
- url accept then complete → Completed; complete for unknown id ignored
- second create while pending → second part exists, slot still first id
- turn ends with pending → part Pending, slot None
- `acp_ready` → maps cleared, slot None
- `Other` mode and `Other` property type → Unrecognized, raw preserved
- interrupted log → Pending is a legal final state
- `export_types` output diff is reviewed by hand once

#### Wire (`inbound/wire.rs`)

No change. `FoldedStreamEvent::Metadata` already carries the whole
`SessionMetadata`, so the new field streams for free.

### 4. `apps/web`

Regenerate first, then code against the types:

```sh
just gen-agent-fold-types            # fold model → service-agent-fold/generated/types.ts
bun run gen-api                      # harness openapi → AgentAction incl. respondElicitation
```

#### Service client

`agentHarnessServiceClient.control(sessionId, request)` already takes the
generated `ControlRequest = AgentAction`. Nothing to add; the union grows.

#### Feed / context (`features/block-agent`)

`create-agent-session-feed.ts` already exposes `metadata`. Add one
derived accessor on `AgentSessionContext`:

```ts
pendingElicitation: Accessor<PendingElicitation | undefined>  // metadata()?.pendingElicitation ?? undefined
```

#### Composer (`state/composer-state.ts`, `context/create-composer-controller.ts`)

`ComposerFacts` is **unchanged**. `agentWorking` stays "newest turn has no
stop"; a pending elicitation happens mid-turn, so the drain already holds
and queued prompts already wait. That is correct.

Add to the controller's return, read off metadata:

```ts
/** The agent is waiting on the user, not generating. Stop still works;
 *  the send button must not spin. */
blockedOnUser: Accessor<boolean>
```

`AgentInput` uses it to swap the spinner for a static "Waiting for your
answer" state while keeping the stop square. No change to `isBusy`.

Add:

```ts
respondElicitation: (answer: ElicitationAnswer) => Promise<void>
```

which POSTs `{ type: 'respondElicitation', requestId, ...answer }` with
`requestId` from `pendingElicitation()`. A `409` means the slot is gone
(someone else answered, or the agent moved on): toast and let the
metadata refresh clear the form. No queueing — the answer is not a
prompt and must not sit behind one.

`stop()` is unchanged on the client; the server cancels the slot.

#### Rendering

`component/parts/ElicitationPart.tsx`, routed from `AgentMessage.tsx`'s
`match(...).exhaustive()` (a new arm is mandatory or tsc fails):

- `outcome.kind === 'pending'` **and** `pendingElicitation()?.requestId === part.requestId`
  → interactive card (this is the only place a form is live).
- `pending` but not the slot (turn ended, or a refused second request that
  has not resolved yet) → read-only "Not answered".
- `accepted` → read-only key/value of `content`, or "Opened" for URL.
- `declined` / `cancelled` / `completed` / `errored` / `unrecognized` →
  read-only label.

Form renderer, one component per `ElicitationPropertySchema` variant:
string (text / select when `options` non-empty), number, integer,
boolean, multi_select (checkbox group), unrecognized (disabled row).
Client validation before POST: required, min/max length, min/max, item
count, `format` for email/uri/date/date-time, `pattern` via `new RegExp`
wrapped in a try and a 50 ms budget check (fail closed to "invalid").

URL card: `message`, full URL monospace, host highlighted, warning when
host starts with `xn--`, buttons Open / Decline / Cancel. Open →
`respondElicitation({ action: 'accept' })` **then**
`window.open(url, '_blank', 'noopener,noreferrer')`. Never fetch the URL.

`ui/index.ts` gets `ElicitationCard` next to `ToolCard`.

#### MagicChip (`LexicalMarkdown/.../MagicChip/presentation.ts`)

`partActivity` gets `elicitation` arms (`.exhaustive()` forces it):
pending → `{ label: 'Waiting for your input', busy: false }`; resolved →
`'Resuming work'` busy. `turnInFlightActivity` ranks a pending
elicitation with pending permission, above a running tool.

`create-magic-chip-model.ts` already subscribes to metadata; no change.

#### Debug gallery

`debug/Gallery.tsx` gets one form and one URL fixture so the card can be
eyeballed without an agent.

#### Agent guide

`docs/AGENT_GUIDE/ai-chat.md`: one paragraph — an agent session may show
a form or a link-consent card; answer it or press Stop; queued messages
send after the agent finishes.

### 5. Out of scope, restated

No Postgres table. No new connection-gateway message type. No
request-scoped elicitation. No Macro-as-Agent sending. No change to
permissions or `session/request_permission`.

## Order of work

Each step compiles and passes on its own. 0–3 are backend and can be one
PR; 4 is the web PR against the regenerated types.

| # | Step | Gate |
| --- | --- | --- |
| 0 | Cargo feature | `cargo check -p agent_session -p agent_fold -p agent_runtime_protocol`; `just ensure-agent-fold-wasm` |
| 1 | `AgentAction::RespondElicitation` + tests | `cargo test -p agent_runtime_protocol` |
| 2 | Machine: advertise, hold, answer, stop-cancel, error, HTTP 409 + tests | `cargo test -p agent_session` (`bash .cursor/infra.sh` first — postgres tests) |
| 3 | Fold: model, state, dispatch, tests; regenerate TS | `cargo test -p agent_fold`; `just gen-agent-fold-types`; diff review |
| 4 | Web: context accessor, composer, part, chip, gallery, guide | `bun run check`, `bun run test`, `bun run lint` |
| 5 | End-to-end: `agent_inmem` or a mock agent sends `elicitation/create` mid-turn; answer from the session page; agent continues | manual, recorded |

Steps 0–2 must ship together. Advertising a capability with nothing
holding the request wedges every agent that uses it.

## Risks

- **Advertise without hold.** Covered by shipping 0–2 as one unit.
- **Wrong response routing in the fold.** Elicitation and permission
  responses both arrive as `to_runtime` Results. Route by id map, test the
  interleaving (permission pending, elicitation pending, answer both).
- **Property order.** Recovered from the raw `properties` object;
  `preserve_order` is already on via `workspace-hack`. A test pins that a
  schema declared `b, a` folds as `b, a`.
- **Regex from the agent.** Bounded on the client; the server never
  evaluates `pattern`.
- **Stale answer after failover.** The slot lives in the machine on the
  owning replica. A replica change means a new connection → new machine →
  no slot → `409`. The fold's metadata slot clears on the next `acp_ready`.
- **Composer confusion.** `agentWorking` must stay true while blocked, or
  queued prompts would fire into the agent's question. `blockedOnUser` is
  presentational only.

## Open questions (decide before step 4)

1. Should Stop cancel the elicitation, or only the model? Plan says both.
2. Should a viewer (non-owner) see the form disabled, or hidden? Plan says
   disabled with "Only the session owner can answer".
3. URL accept: fire the POST before or after `window.open`? Plan says
   before, so the agent learns consent even if the popup is blocked; the
   card then shows the link as a fallback.
