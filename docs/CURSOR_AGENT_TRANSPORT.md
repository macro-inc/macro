# Cursor-managed agents as a third session transport

Status: implemented. This is the design as built; where the shipped code
diverged from the original draft the text says so rather than describing a plan
that no longer exists.

## Goal

Let a user register their Cursor API key in Macro settings, then `@cursor` in any
channel and get an agent session that behaves like Macro Coder — same thread
announcement, same session page, same log — except the work runs on a Cursor
cloud agent instead of a sandbox we provision.

Second goal, which shapes the first: `@cursor` and `@macro` must work **at the
same time, in the same deployment, in the same channel**. This is the first time
the harness has had two live container providers rather than one chosen at boot.

## What exists today

The pieces this builds on, so the design can be read against real code.

### The transport seam

`ContainerManager` (`crates/agent_harness/src/domain/ports.rs:49`) is the port
every provider implements:

```rust
pub trait ContainerManager: Send + Sync + 'static {
    type Transport: AgentConnector;
    fn spawn(&self, command: SpawnContainer) -> impl Future<Output = Result<Self::Transport>> + Send;
    fn resume(&self, session: AgentSessionId) -> impl Future<Output = Result<Self::Transport>> + Send;
    fn teardown(&self, session: AgentSessionId) -> impl Future<Output = Result<()>> + Send;
}
```

`AgentConnector` is just `Transport<ToRuntimeMessage, ToServerMessage>`
(`crates/agent_session/src/domain/ports.rs`). And `SidecarTransport`
(`crates/agent_harness/src/outbound/sidecar.rs`) exists purely to wrap a raw ACP
JSON-RPC websocket into those envelopes — its own doc comment says the sidecar
"is a byte pipe: it speaks bare ACP JSON-RPC ... and knows nothing about the
runtime protocol."

**The harness is already an ACP client and does not care what is on the other
end of the pipe.** That is the whole reason this project is small.

### What the harness actually asks of an ACP agent

From the session actor (`crates/agent_session/src/domain/session/session.rs`):

- `initialize`
- one of `session/new`, `session/resume`, `session/load` (`SessionOpening`, line 309)
- `session/prompt`
- it *answers* `session/request_permission`, auto-approving (line 421)

It never sends `fs/read_text_file`, `fs/write_text_file`, or any `terminal/*`
request. This matters: a Cursor cloud agent's filesystem lives inside Cursor's
VM and we only observe it through SSE tool-call events. If the harness needed
filesystem service from the agent side, this design would not work. It doesn't.

### `crates/cursor_acp`

Already an ACP *agent* backed by the Cursor Cloud Agents API, written sans-io:

- `domain/service.rs` — `CursorSessionService`, the use cases. One ACP session ↔
  one Cursor agent, created lazily on first prompt (Cursor mints agent + first
  run together). Turns are strictly sequential per session, enforced with
  `TurnAlreadyActive` — which happens to match Cursor's own `409 agent_busy`.
- `domain/ports.rs` — `CursorAgents`, `RunStream`, `SessionNotifier`, `RepoResolver`.
- `domain/translate.rs` — `TranslateMachine`, SSE events → ACP `SessionUpdate`.
- `cursor/` — the HTTP/SSE client. `CursorClient::new` validates a `crsr_` prefix.
- `inbound/acp.rs` — stdio JSON-RPC adapter. Handles `initialize`,
  `authenticate`, `session/new`, `session/prompt`.
- `replay.rs` + `fixtures/real/*.sse` + insta snapshots — recorded real sessions
  pinned as tests.

### The other providers

Daytona (`outbound/daytona/manager.rs`), namespace, and local
(`outbound/local/`, PR #5826) are **mutually exclusive deployment choices**. The
composition root picks exactly one. `ContainerManager::Transport` is a single
associated type, resolved once.

---

## Product surface

### 1. Settings → Agents → Harness

A field to enter a Cursor API key. On submit we validate it before storing:
`GET /v1/me` with the key. A `crsr_`-prefixed key that authenticates is stored;
anything else is rejected with a useful message rather than silently saved.

The stored record is per Macro user. Deleting it is supported and revokes
`@cursor` for that user.

### 2. `@cursor` in any channel

Behaves exactly like Macro Coder: mention it, a session opens, the bot posts the
magic-chip announcement into the thread, the mention text becomes the first
prompt, follow-up mentions in the thread route to the same session.

Gated on key registration. A user with no Cursor key registered should not see
`@cursor` in the mention autocomplete, and a mention that somehow arrives anyway
must fail with a message telling them to register a key — never silently drop.

**How the gate works.** The mention autocomplete reads
`useChannelBotsQuery` → `GET /channels/{id}/bots`
(`apps/web/src/lib/queries/channel/channel-bots.ts:31`). That endpoint already
authenticates the caller, so the filter belongs there: omit `@cursor` from the
response when the caller has no row in `cursor_api_key`. One `LEFT JOIN` on the
authenticated user.

No new endpoint, no new frontend query, no client-side join, and no window where
the autocomplete offers a bot that would fail. The check mirrors
`is_managed_bot` — a hardcoded `CURSOR_BOT_ID` comparison in the channel-bots
read. When there is a second credential-gated bot, this becomes a
`requires_user_credential` column on `bots` and the filter goes declarative; for
one bot that is premature.

Settings needs its own small surface regardless, for the connections tab:
`GET /me/cursor-key` → `{ registered: bool }`, `PUT` to set, `DELETE` to revoke.
The `GET` never returns key material.

### 3. Repo hardcoded for the first pass; model chosen per session

**Repo: hardcoded to `https://github.com/macro-inc/macro`.** Deliberately
temporary. `agent_session.repo_url` is `TEXT NOT NULL`, so a session must name
one, and picking it properly means either a settings field or the rate-limited
`GET /v1/repositories`. Neither belongs in a first pass. Put it behind a single
named constant — `CURSOR_DEFAULT_REPO` in the harness config — so replacing it
is one edit and grep finds every use.

The known limitation: this only works for a user whose Cursor GitHub App
installation can see `macro-inc/macro`. For anyone else, agent creation fails at
the Cursor API. That failure needs to surface as a legible session error
("Cursor cannot access this repository") rather than a generic 400, because it
will be the most common first-run failure.

**Model: chosen per session, over ACP.** Absent, Cursor resolves user default →
team default → system default, and that stays the default: it respects whatever
the user already chose in their own Cursor settings. But it is no longer the only
option — the session advertises the account's models as an ACP `model` config
option and accepts `session/set_config_option` at any time.

Two API facts this rests on, both established by probing rather than from the
docs, which are wrong about the first:

- **`POST /v1/agents/{id}/runs` accepts `model`.** Cursor's reference lists only
  `prompt`, `mode` and `mcpServers` for follow-up runs and states that they
  inherit the agent's model. They do not have to: the field is validated and
  honoured there. The endpoint's schema is strict — an unknown key comes back as
  `validation_error` naming the key — which is how the field was shown to exist
  rather than be silently ignored. The full accepted set is `prompt`, `model`,
  `mode`, `mcpServers`, `envVars`.
- **A selection is an id *plus* its params.** `{"id": "grok-4.5"}` is rejected
  with `Model 'grok-4.5' does not match a known variant`; the same id with
  `effort=high, fast=true` is accepted. `GET /v1/models` enumerates the accepted
  combinations as `variants`, one flagged `isDefault`.

So a mid-session model change needs no new agent and no second credential — it is
a field on the next run, reachable with the user's own scoped `crsr_` key. There
is no agent-level model update: `PATCH`/`PUT`/`POST` on `/v1/agents/{id}` do not
exist.

One thing the API will not tell us: which model a run actually used. It is absent
from the run record, the run list and the stream, so the advertised current value
is our own record of what we last asked for.

`CURSOR_MODEL` still pins a starting model for the standalone binary, by id; its
params come from that model's default variant.

### 4. Agent sessions page

When a session has a joined external record, show a provider link with a logo —
for Cursor, `https://cursor.com/agents/<agentId>` (the API returns this as
`agent.url`, so we store it rather than reconstruct it).

---

## Architecture

### The transport: in-process ACP over a duplex pipe

`CursorContainerManager::spawn` does **not** create a container. It:

1. Resolves the session owner's Cursor API key.
2. Builds a `CursorClient` for that key.
3. Creates a `tokio::io::duplex` pair.
4. Spawns `cursor_acp`'s `serve` loop on one end, wired to a
   `CursorSessionService` over that client.
5. Wraps the other end in an envelope adapter and returns it as the `Transport`.

The harness then speaks real ACP JSON-RPC down the pipe, exactly as it does to a
sidecar websocket. Every tested path in `cursor_acp` — dispatch, the service,
`TranslateMachine`, the replay fixtures — is reused unchanged.

Cost: one serialize/deserialize hop per frame, in-process. Worth it. The
alternative (an adapter calling `CursorSessionService` directly and synthesizing
frames) means reimplementing the request/response correlation that
`inbound/acp.rs` already does and has tests for.

The envelope adapter is a near-clone of `SidecarTransport` differing only in its
carrier — a duplex pipe instead of a `WebSocketStream`. Both should end up over
one generic `AcpPipeTransport<Socket>` rather than two copies; `SidecarTransport`
is already written against `AsyncRead + AsyncWrite`, so this is a small
generalization, not a rewrite.

### Provider routing: the part with real blast radius

`ContainerManager` has one associated `Transport` type. Cursor coexists with
Daytona rather than replacing it, so the choice moves from boot-time to
per-session.

Introduce a routing manager in the composition root:

```rust
pub struct RoutedContainerManager<Sandbox> {
    sandbox: Sandbox,                  // Daytona | local | namespace
    cursor: CursorContainerManager,
}

pub enum RoutedTransport<Sandbox> {
    Sandbox(Sandbox),
    Cursor(CursorTransport),
}
```

`RoutedTransport` implements `Transport<ToRuntimeMessage, ToServerMessage>` by
delegating to whichever variant it holds; same for its `Sender` and `Receiver`.
Static dispatch, no `dyn`, both variants concrete and testable.

Routing key: the session's bot. `spawn` reads it from `SpawnContainer`, which
means **`SpawnContainer` needs a `bot_id`** — it currently carries only
`session_id` and `repo_url` (`domain/model.rs:167`). `resume` and `teardown`
take only an `AgentSessionId`, so they route by looking the session up in the
external-session registry: a session with a Cursor external record routes to
Cursor, anything else to the sandbox provider.

### `is_managed_bot` stops being a single value

```rust
pub fn is_managed_bot(bot: BotId) -> bool {
    bot == bot_id::MACRO_CODER_BOT_ID
}
```

Its own doc comment anticipates this: "This becomes a bot attribute the day
managed bots stop being a closed set of one." That day is now. Add
`CURSOR_BOT_ID` to `bot_id` and make this a set membership test. Promoting it to
a real bot column is a larger change; the set keeps this PR honest and small,
and the comment should be updated to say the set is now two rather than deleted.

---

## Data model

### `external_agent_session`

One row per agent session that is served by an external provider.

Note the existing table is `agent_session`, singular
(`migrations/20260818220644_new_ai_agents.up.sql:8`).

```sql
CREATE TABLE external_agent_session (
    agent_session_id  UUID PRIMARY KEY REFERENCES agent_session (id) ON DELETE CASCADE,
    provider          TEXT        NOT NULL,   -- 'cursor'
    external_id       TEXT        NOT NULL,   -- 'bc-<uuid>'
    external_name     TEXT,                   -- Cursor's derived agent name
    external_url      TEXT,                   -- agent.url, for the frontend link
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider, external_id)
);
```

Keyed by `agent_session_id` rather than a synthetic id: a session has at most
one external backing, so the join is 1:1 and the FK *is* the key. `ON DELETE
CASCADE` means deleting a session cleans this up. `UNIQUE (provider,
external_id)` stops two sessions from claiming the same Cursor agent.

**This is why the mapping cannot be memory-only.** Daytona's `resume` finds a
sandbox by label:

```rust
self.client.find_by_label(SESSION_LABEL, &session.to_string())
```

The Cursor API has no labels. `GET /v1/agents` returns `id`, `name`, `status`,
`env`, `url`, timestamps, `latestRunId` — nothing we can write a session id
into. There is no query that recovers `AgentSessionId → CursorAgentId`, so it
has to be persisted at spawn time or it is gone.

**No `external_session_meta` column on `agent_session`.** The table alone is the
record. A column would duplicate what the join already answers, and the frontend
condition ("joined external session is non-null") is a `LEFT JOIN ... IS NOT
NULL` either way.

### Cursor API keys

Two existing precedents in the repo, one generation apart:

- **`mcp_servers.credentials`** (`crates/mcp_client/src/outbound/pg_server_repo.rs`)
  — AES-256-GCM under a single process-wide `AesKey` from config. No AAD, no
  per-record key, no KMS. One key compromise reads every row, and without AAD a
  ciphertext is interchangeable between rows, so moving user A's blob into user
  B's row decrypts happily. Do not copy this.
- **`microsoft_oauth_grants`** (`services/authentication_service/src/microsoft_token_cipher.rs`,
  migration `20260819123655`) — KMS envelope encryption, per-record data key,
  AAD binding the ciphertext to `purpose ‖ version ‖ user ‖ mailbox`, the same
  tuple as KMS encryption context, `Zeroizing` plaintext, versioned scheme,
  deliberately opaque errors. This is the considered one.

**Recommendation: direct KMS `Encrypt`/`Decrypt`, not the envelope.** KMS handles
plaintexts up to 4 KB directly and a `crsr_` key is ~60 bytes, so the envelope's
benefits do not apply: we are not over 4 KB, we make one KMS round trip either
way, KMS manages its own nonces so there is no GCM nonce-reuse bound to dodge,
and CMK auto-rotation keeps old ciphertext readable so nothing gets re-encrypted.
We keep the three properties that matter — KMS gates every read, the encryption
context binds the row to its user and is enforced by KMS with a CloudTrail
record, and the root key never leaves KMS — with no hand-rolled AES at all.

The counter-argument is that the envelope is already written and tested. But
reusing it means extracting and generalizing 364 lines of `pub(crate)` security
code out of `authentication_service` into a shared crate, which is careful work.
Direct `Encrypt` is roughly 40 lines and no new schema columns.

```sql
CREATE TABLE cursor_api_key (
    user_id             TEXT PRIMARY KEY,
    key_ciphertext      BYTEA       NOT NULL,
    encryption_version  SMALLINT    NOT NULL,
    kms_key_id          TEXT        NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT cursor_api_key_ciphertext_not_empty CHECK (octet_length(key_ciphertext) > 0),
    CONSTRAINT cursor_api_key_version_positive CHECK (encryption_version > 0)
);
```

`encryption_version` is worth keeping even in the simple scheme: it is what lets
a later move to the envelope be additive rather than a rewrite.

Encryption context: `{ macro:purpose = "cursor-api-key", macro:encryption-version,
macro:user-id }`. Bind to the Macro user id only — **not** to any Cursor-side
identity, which changes if they swap Cursor accounts and would strand the row.

**Use a separate KMS key from the Microsoft one.** The deciding argument is IAM,
not rotation: reusing it means granting `agent_harness_service` decrypt on the
key that also protects everyone's mail refresh tokens. A separate key means a
compromised harness cannot reach mailbox credentials.

### The real exposure is plaintext residency, not the table

The Microsoft pattern's `Zeroizing` discipline assumes short-lived plaintext. Our
usage breaks that assumption: the key is decrypted on every spawn *and* every
resume, and then lives in `CursorConfig.api_key` as a plain `String` for the
whole life of the session — hours, one copy per concurrent session, in a
long-lived process, eligible for any core dump.

Worse, `CursorConfig` originally derived `Debug` over a `pub api_key: String`,
and `CursorClient` derives `Debug` and holds one. A single
`tracing::debug!(?config)` would print a live user key into logs.

Done:

- `ApiKey` is a newtype with a hand-written `Debug` that redacts, over a
  `Zeroizing<String>` so the plaintext does not linger in freed memory when a
  session's client is dropped. The plaintext leaves only through `expose()`,
  which feeds the Basic-auth header and nothing else. Reads of the settings
  endpoint return `{ registered, updatedAt }` and nothing more.

Still open:

- Building the `Authorization` header once at client construction and dropping
  the plaintext, rather than holding it for the session's lifetime. `Zeroizing`
  bounds the damage; it does not shorten the residency.

### Revocation is not ours

If a user rotates their key at Cursor, our copy silently starts returning 401
mid-session. That needs a distinct "reconnect your Cursor account" state rather
than a generic session failure. And deleting our row does not revoke anything at
Cursor — the settings UI must say so rather than implying we have.

### The alternative that was considered and rejected: sub-tokens

`POST /v1/sub-tokens` takes a team service-account key and mints 1-hour
user-scoped tokens by `forUserEmail`. The agent runs *as* that teammate, with
their attribution and repo access, and we store **one org secret** — exactly how
`DAYTONA_API_KEY` already works — and zero user secrets.

This is viable for v1 *precisely because* the repo is hardcoded to
`macro-inc/macro`: the only people who can productively use `@cursor` are those
whose Cursor GitHub App installation can see it, which is our Cursor team. BYO
keys only become necessary when we support arbitrary repos for people outside
it, which is out of scope.

Cost: tokens last an hour and cannot self-refresh, so they must be minted per
API call rather than per session — a session outliving its token is the failure
mode to design against.

**Not taken.** It deletes the secret-at-rest problem by deleting the property
the feature is for: the agent would run as a service account acting *for* a
teammate rather than as the teammate, and the repo scope would be Macro's
rather than theirs. The per-user key is the whole point, so the residency
discipline above is the cost of admission.

---

## Lifecycle mapping

Most of the sandbox lifecycle is meaningless for Cursor. Stating what each port
method degenerates to, so the small implementation does not read as an
oversight:

| Port | Daytona | Cursor |
| --- | --- | --- |
| `spawn` | create sandbox, `ensure_ready.sh`, port preview, ping, dial | build client, spawn `serve` on a duplex pipe. The Cursor agent itself is not created until the first prompt — `CursorSessionService` is lazy by design |
| `resume` | find by label, start sandbox, re-run readiness, re-dial | read `external_agent_session`, build client, new pipe, `session/load` with the stored agent id. No boot, no readiness, effectively free |
| `teardown` | destroy sandbox | `POST /v1/agents/{id}/archive`, delete the row |
| idle reaping | stop sandboxes after `IDLE_TIMEOUT` to stop paying | **nothing.** No sandbox to stop and no per-minute cost to us. `ManagedContainers`, `IDLE_TIMEOUT`, `STOP_CONCURRENCY` have no Cursor analogue |

Consequences worth being explicit about:

- **Archive, not delete.** `DELETE /v1/agents/{id}` is irreversible and destroys
  the user's own work in *their* Cursor account. Archive is reversible and
  idempotent. Teardown of a Macro session should not vaporize a Cursor agent the
  user may still want; archive is the right default and delete should not be
  reachable from session teardown at all.
- **Cancel is terminal in Cursor**, but ACP cancel just ends a turn. `cursor_acp`
  already handles this correctly: cancel the run, and the next prompt opens a
  *new* run on the same agent, so the conversation survives.

## Changes needed in `crates/cursor_acp`

The crate is currently shaped for one process, one key, stdio. Four changes:

1. **Generalize `serve`.** It reads `tokio::io::stdin()` directly
   (`inbound/acp.rs:190`) and the service type is hardcoded to `StdioNotifier`
   (line 184). Make it generic over `AsyncRead + AsyncWrite` and over the
   notifier. The bin keeps passing stdio; the harness passes a duplex half.
   `StdioWriter`/`StdioNotifier` become a writer/notifier over any `AsyncWrite`.

2. **Implement `session/load` and advertise it.** Two separate bugs here, and
   without both, `resume` does not merely degrade — the session *dies*. See
   "Resume is the sharp edge" below.

3. **Report the created agent back out.** The manager has to persist
   `external_id`, `external_name`, and `external_url` when the first prompt mints
   the agent — which happens *inside* the service, well after `spawn` returned.
   Needs an observer port, e.g. `AgentCreated { agent_id, name, url }`, that the
   manager implements by writing the `external_agent_session` row.

4. **Key and repo from arguments, not env.** The bin reads `CURSOR_API_KEY`,
   `CURSOR_REPO`, `CURSOR_REF`, `CURSOR_MODEL` via `env_var!`. Server-side these
   are per-session, so they must be constructor arguments.

None of these change the domain or the fixtures. They are adapter-shaped.

Once generalized, `src/bin/cursor_acp.rs` becomes a thin example over the general
pieces: read env, build a `CursorClient`, wire the service to stdio, call the
generic `serve`. It stays a real working ACP agent for editor clients, but it
holds no logic the harness path does not also go through — nothing gets to be
"the stdio special case."

### Resume is the sharp edge

Two independent gaps that only bite on the second prompt after a restart, so
they will not show up in a first happy-path test.

**The capability gate.** `begin_opening`
(`crates/agent_session/src/domain/session/session.rs:270`) picks the opening
method from what the agent advertised at `initialize`:

```rust
Some(session_id) if restore.resume => self.build_resume_session_request(session_id),
Some(session_id) if restore.load  => self.build_load_session_request(session_id),
Some(_) => { self.resume_unsupported(effects); return; }   // <- session dies
None    => self.build_new_session_request(),
```

`cursor_acp`'s `agent_capabilities()` (`inbound/acp.rs:188`) is
`AgentCapabilities::default().prompt_capabilities(…embedded_context(true))` —
it advertises **neither** `session_capabilities.resume` nor `load_session`. So
any session with a stored `acp_session_id` that gets resumed hits
`resume_unsupported` and dies. Advertising `load_session` is mandatory, not
optional polish.

**Session-id rehydration.** `CursorSessionService::new_session` mints ids from an
in-memory counter (`cursor-acp-{n}`, `service.rs:96`) and holds sessions in a
`HashMap` that starts empty in a fresh process. The harness, meanwhile, persists
that string as `agent_session.acp_session_id` and sends it back on
`session/load`. So after a restart the id the harness asks for cannot be found,
and the service has no database to look it up in — by design, it is sans-io.

The manager closes that loop. `CursorContainerManager::resume`:

1. reads `external_agent_session` for the session's `external_id` (`bc-…`) and
   `agent_session.acp_session_id`,
2. constructs the `CursorSessionService` **pre-seeded** with that
   `(AcpSessionId → CursorAgentId)` pair and the resolved repo,
3. then serves the pipe, so the incoming `session/load` finds a live session
   already pointing at the right Cursor agent.

This wants a constructor like `CursorSessionService::with_sessions(...)` — or a
`restore_session(id, agent)` method the manager calls before serving. Either way
the service stays sans-io and the manager stays the only thing that touches
Postgres. Worth stating plainly because it is the one piece of the design that is
not obvious from either crate alone.

## In-memory registry and boot reconciliation

On `agent_harness_service` boot, build the in-memory view of Cursor-backed
sessions and keep it current as sessions are created and torn down.

The important ordering point: **the mapping is read from Postgres, not from
Cursor.** `external_agent_session` is authoritative for
`AgentSessionId → CursorAgentId`, because Cursor cannot answer that question.
`GET /v1/agents` is useful for a second, different thing — liveness. So boot is:

1. Load Cursor-backed sessions from `external_agent_session`.
2. Optionally, per distinct API key, `GET /v1/agents` and mark rows whose agent
   is gone or archived, so a resume fails fast with a real message instead of a
   404 mid-prompt.

Step 2 is a nice-to-have and has a cost: it is one paginated listing per
registered user key, and `GET /v1/repositories` is documented as very heavily
rate-limited (1/user/min) though `/v1/agents` is not called out that way. Start
without it; add it if stale rows turn out to bite.

## Honest limitations

Things `@cursor` will not do that `@macro` does, worth knowing before they are
reported as bugs:

- **Repo access is the user's, not ours.** Cursor cloud agents reach GitHub
  through the Cursor GitHub App installation on the key owner's account. A repo
  our Daytona sandboxes can clone may be invisible to their Cursor agent.
- **No MCP servers from our side.** `inbound/acp.rs` already logs a warning and
  ignores `mcpServers` on `session/new`. The Cursor API does accept inline MCP
  definitions at create time, so this is a later possibility, not a wall.
- **Streaming can degrade, but a turn cannot lose its answer.** Cursor's
  stream endpoint refuses connects (`stream_unavailable`, both as a 409 and
  as an in-stream error) for a second or two after a run is created, and can
  drop mid-run. The client reconnects through the head-of-stream refusals,
  and any later streaming failure falls back to polling `GET run` until the
  run is terminal, delivering the final result text. What the fallback gives
  up is liveness and per-tool-call detail, never the outcome. `Last-Event-ID`
  resumption (picking a broken stream back up mid-run without losing detail)
  remains a follow-up.
- **Turns driven from cursor.com mirror into Macro within about a second.**
  While a session's pipe is up, the manager polls the agent's runs once a
  second (Cursor's v1 API has no webhooks yet) and replays anything it did
  not drive itself through the run's own stream — the cursor.com prompt
  (quoted, attributed), thoughts, tool calls, and answer, at the same
  fidelity as a Macro-driven turn. Degradations, in order: a run whose
  stream has left the retention window mirrors as its recorded final text
  only; a restored session has no watermark and does not replay history it
  cannot tell from missed runs; and a mirror that lands after newer Macro
  messages appends late, because the log is append-only — with the 1s poll
  that inversion effectively requires the session's pipe to have been down.
- **Idle pipes retire themselves, Daytona-reaper style.** Five minutes
  without a frame in either direction closes the pipe, reclaiming its tasks
  and its poll; the session parks on a clean disconnect and the next prompt
  resumes it. A parked session mirrors nothing until then.
- **A provisioning failure does not reach the thread.** The open path
  announces the session before it spawns, so when spawn fails — most often
  because the mentioning user has not registered a Cursor key — the session
  is marked disconnected and the reason goes to a log. What the user sees is
  a session chip that never answers. `SessionAnnouncer` announces sessions
  and nothing else, so closing this needs a way to post a failure back to
  the originating thread. `HarnessError::CursorNotConnected` already carries
  the sentence to post; it has nowhere to go yet.
- **One run at a time per agent.** Cursor returns `409 agent_busy`. Already
  matched by the service's sequential-turn rule, so this surfaces as a clean
  error rather than a race.

## Suggested sequencing

1. **`cursor_acp` adapter refactor** — the four changes above. Self-contained,
   fully unit-testable, no harness or DB involvement. Fixtures keep passing.
2. **Migrations + repos** — `external_agent_session`, `cursor_api_keys`, the
   cipher, the key-resolver port. `just prepare_db`, tests against live Postgres.
3. **`CursorContainerManager` + routing** — the manager, `RoutedTransport`,
   `bot_id` on `SpawnContainer`, `is_managed_bot` as a set, composition root.
4. **Settings + `@cursor` gating** — the connections UI, key validation via
   `GET /v1/me`, mention-autocomplete filtering.
5. **Sessions page link** — the joined read and the provider logo.

Steps 1 and 2 are independent and can go in parallel.

## Testing

- `cursor_acp`: existing replay fixtures must keep passing through the
  generalized `serve`. Add a fixture exercising `session/load`.
- Transport: drive the duplex pipe end-to-end against the in-memory `CursorAgents`
  / `RunStream` doubles already in `testing.rs` — a full `initialize` →
  `session/new` → `session/prompt` → updates round trip with no network.
- Routing: `RoutedContainerManager` sends a Cursor bot to the Cursor manager and
  anything else to the sandbox manager. Cheap, and it is the piece whose failure
  mode is worst.
- Cipher: round-trip encrypt/decrypt, and a test asserting the plaintext key
  does not appear in the `Debug` output of the types that hold it.
- Repos: standard live-Postgres tests. Include the `UNIQUE (provider,
  external_id)` conflict and the `ON DELETE CASCADE`.

## Resolved questions

Resolved in review: the external table alone (no `agent_session` column), one
global seeded `@cursor` system bot, channel-bots server-side filtering for the
mention gate, hardcoded `macro-inc/macro` repo, and omitted model.

1. **Do we store user keys at all in v1?** **Yes.** Sub-tokens were the
   alternative, and they lose the property that makes this feature legible: the
   agent runs as *the user*, on their own Cursor account, with their attribution
   and their repo access. There is no deployment-wide `CURSOR_API_KEY` — the
   manager resolves the session owner's key from `cursor_api_keys` at every
   spawn, resume, and teardown, and a user who has not connected Cursor gets
   `HarnessError::CursorNotConnected` in the channel rather than a silent skip.
2. **Lazy or eager agent creation?** **Lazy**, as leaned. `RecordingCursor`
   decorates `CursorAgents` and writes the `external_agent_session` row inside
   `create_agent`, before it returns — so no prompt can be answered by an agent
   the database does not know about, and the laziness stays load-bearing in the
   service's own tests.
3. ~~Is `ContainerManager::resume` exercised today?~~ **Resolved: yes, and it is
   a primary path.** `domain/service.rs` calls it whenever an action is sent to
   a session with nothing attached (`AgentSessionError::Disconnected`), gated on
   the bot being managed. So it fires on every follow-up mention after a service
   restart. The resume work — capability advertisement, `session/load`, service
   pre-seeding — is mandatory, not a follow-up. A `@cursor` session that cannot
   resume is one that stops answering after any deploy.

   That gate is why `CURSOR_BOT_ID` had to join the managed set (now
   `AgentKind::is_managed`): without it, a disconnected Cursor session takes the
   external-runtime branch and waits forever for an operator to dial in that
   will never come.
