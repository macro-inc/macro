# Codex cloud in Macro

Macro's global `@codex` bot runs tasks in the user's Codex cloud environment.
The implementation is in this branch; deploying the services, schema and web app
is required before it is available in a shared environment.

## User flow

1. Open **Settings → Harness → Codex** and choose **Connect with ChatGPT**.
2. Open the official verification page and enter the displayed device code.
   Macro polls the owner-bound attempt until it completes, expires or is cancelled.
3. Select a **Cloud environment** and save it. New sessions always start from
   `main`. Repositories must already be configured in Codex on the web.
4. Choose Codex in the agent composer or mention `@codex` in a channel. The first
   prompt creates a remote task; later messages continue the same task. Macro
   displays complete assistant messages, live command activity and a link to the cloud task.
5. **Stop** requests cancellation at the provider. Disconnect in Harness settings
   removes Macro's credentials; reconnecting creates a new connection identity.

Deleting a Macro session removes its local mapping; use **Stop** first to cancel
running cloud work. Disconnecting credentials also does not cancel remote tasks.

The login uses the source-backed Codex device authorization flow. The provider
identifies its registered OAuth client as Codex. Macro does not have a separately
registered OpenAI OAuth client. This is device authorization through a browser,
not a redirect/callback OAuth flow.

## Ownership and storage

The global bot has stable ID `00000000-0000-0000-0000-00000000c0de` and runtime slug
`codex-cloud`. It does not own a shared subscription. The runtime resolves the
Macro session owner's connection before each provider operation and retains the
existing session write/control authorization rules.

`crates/codex_connection` owns login attempts, refresh, disconnect and environment
selection. Its domain service uses replaceable OAuth, repository and cipher ports.
The authentication service exposes user-authenticated `/codex` routes; credentials
are never included in API responses. Only the service composition roots construct
the OpenAI, PostgreSQL and KMS adapters.

The `codex_connections` table stores an encrypted JSON envelope keyed by Macro
user ID. A fresh AES-256-GCM data key protects each write; KMS protects that key.
Both KMS encryption context and AES authenticated data bind the state to its owner,
purpose and version. A PostgreSQL row lock serializes login exchange and refresh
across replicas. Rotated credentials are saved before another provider operation.

The long-lived connection payload contains the access token and refresh token,
plus account identity and expiry metadata. Pending authorization additionally
holds the device authorization ID and user code; finishing or cancelling the
attempt clears those values. ChatGPT passwords and browser cookies are not used.

`codex_cloud_sessions` stores task/turn identity, account and connection generation,
environment, branch and uncertain-write state. `codex_journal_input` separately
appends original prompts, raw SSE records, polling observations and lifecycle facts
in session sequence order, before translating them into ACP output. Both tables
belong to the Macro session and cascade on deletion. Reads and writes check its
activated manager fence under the same row lock used by takeover; appends also
compare the expected sequence. Old attachments cannot adopt a newer generation.
The environment and branch recorded at creation remain attached to that session.

The adapter advertises `session/load`, without `session/resume`. Macro's existing
ACP fold replaces history only after a successful load. Replay uses the same
native-input reducer as live delivery, validates the complete candidate before
publishing, and refuses incomplete history or uncertain submissions. It never
retries a cloud launch during recovery.

Recovery records historical provider events silently and requests Macro's generic
history replacement. New prompts wait until that load succeeds. Replay places
late records inside their original turn and reconciles fallback text before
closing the turn, so late history does not create another assistant response.

The standalone `codex_acp` and `codex-cloud-probe` binaries retain their private
local JSON configuration for Zed/probe use. Those stores and fixed paths are
private demo-binary helpers, not exported library adapters. They support one
current format, without compatibility readers. Hosted Macro sessions use the
per-user PostgreSQL connection and journal, never those local credentials.

## Runtime capabilities

| Surface | Behavior |
| --- | --- |
| Launch | Requires a saved environment, then creates a cloud task on `main`. |
| Follow-up | Continues the existing task using its latest assistant turn. |
| Streaming | Uses the source-backed per-turn SSE route and reconciles final turn state. |
| Stop | Requests remote cancellation; terminal state comes from provider evidence. |
| Load | Replaces history from the native journal and observes an unfinished turn; no `session/resume`. |
| Commands | Translates exposed command events to ACP tool activity. |
| Pull requests | Publishes verified provider PR associations to the shared session metadata and magic chip. |
| Elicitation/approval | Unsupported; requests cancellation and reports the limitation. |
| Models, Macro MCP, sandbox resize | Not advertised for this runtime. |

Cloud execution happens in OpenAI's sandbox. See
[desktop transport evidence](CODEX_DESKTOP_TRANSPORT.md),
[live probe results](CODEX_CLOUD_LIVE_PROBES.md) and
[ACP verification](CODEX_ACP_VERIFICATION.md) for the tested protocol surfaces.
These endpoints were discovered from client source and verified experimentally;
they are not a documented third-party Codex cloud API contract.

## Pull request links

The task response's `task.external_pull_requests` associates each GitHub URL with
an assistant turn. Macro accepts links for turns it submitted and for the pinned
repository, then uses the same owner-authorized `SessionPullRequests` service as
Cursor. A `type: "pr"` output contains a proposed title, message and diff; neither
that output nor assistant text proves that a GitHub PR was created.

Task metadata is checked during observation and every 20 seconds while attached,
including after a turn finishes. Failures retry with backoff capped at five
minutes. Changed PR evidence is journaled before the
session link is published. Metadata records do not add assistant messages to
live output or replacement history. Duplicate links are idempotent, failed
publication retries, and an empty response does not clear an existing link.
The PR write locks and checks the attachment's manager generation in the same
transaction, so a superseded runtime cannot overwrite its successor's link.

Viewing a detached Codex session restores observation through the existing
manager claim and `session/load` lifecycle. It does not send a prompt or create
a cloud task. Sessions already managed locally or by another replica keep their
attachment. A disconnected or replaced ChatGPT connection prevents refresh;
saved history and any previously recorded link remain readable.

Publishing sends the existing session-update notification. Mounted magic chips
reload the link, which opens GitHub directly until webhook sync supplies a Macro
PR entity. GitHub webhook events then drive the usual PR status display. Macro
does not create a PR merely to obtain a link.

Source evidence: the cloned Codex models `TaskResponse`,
`ExternalPullRequestResponse` and `GitPullRequest`, plus desktop bundle
`26.908.70816`'s `remote-conversation-page` component, which matches the external
association by assistant turn. The existing test task had a PR proposal but an
empty external association list. A read-only scan of all seven current tasks in
the disposable test environment also found no linked PRs. Positive PR discovery
is covered with provider fixtures; the browser check uses mocked session metadata
and realtime events.

## Environment selection

Codex requires an explicit saved environment in Harness settings. A newly
connected account cannot launch work until its environment is saved. This path
does not call Cursor's Haiku repository chooser or inspect recent sessions.
Cursor's repository selection behavior is unchanged.

The transport exposes environment IDs, labels and safe repository metadata from
the connected account. Configuration accepts only an environment ID and verifies
that it is available. New cloud tasks always use `main`, even if the repository
advertises a different default branch. No branch preference is stored.

The environment, `main` branch and primary repository are pinned on the first
successful prompt. Follow-ups and replacement loads retain the session's target
even if the saved environment changes. Standalone demo target configuration is
independent of this hosted setup.

## Configuration and rollout

Apply the three additive migrations before releasing the services:

- `20260910144347_codex_connections.sql`
- `20260910144348_codex_cloud_session_journal.sql`
- `20260910144349_codex_cloud_native_inputs.sql`

The authentication stack owns a dedicated rotating KMS key with alias
`alias/authentication-service-codex-oauth-<stack>`. Its key policy grants the auth
and harness roles `kms:GenerateDataKey` and `kms:Decrypt`. The existing harness
role output supplies the principal; the shared stable alias avoids adding a
reverse stack dependency. Deploy the authentication stack before the updated
harness stack so the alias and grants exist before use.

Both services read `CODEX_OAUTH_KMS_KEY_ID` through typed configuration. Pulumi
injects the key ARN into authentication and the alias into the harness; it is a
resource identifier, not a user credential. It can also be supplied through the
normal Doppler configuration. Missing configuration keeps unrelated service
features running and makes Codex report that its connection service is unavailable.

LocalStack provisions `alias/macro-local-codex-oauth`; the local runner injects
that alias into both services. Existing keys and credentials are retained when
local resources are reprovisioned. No deployment-wide ChatGPT tokens are needed.

## Verification

Run affected package tests from the repository root inside Nix with
`SQLX_OFFLINE` unset and an explicitly selected local `DATABASE_URL`. Include
`codex_cloud_agents --features postgres`, `codex_connection`, `agent_harness`,
`bot_id` and `xtask_local`, plus the authentication/harness service checks.
Refresh root SQLx metadata with the workspace prepare helper, including tests.

Frontend tests cover device-login states, environment configuration, disconnect,
composer gating and channel mentions. Browser verification uses a separate
Chromium page with mocked new authentication routes when the shared dev backend
has not yet deployed them. That verifies rendering and interactions; a real
account login and cloud run through the deployed Macro stack remains a distinct
release check. Keep real credentials out of fixtures and snapshots.

### Results for this implementation

- Connection lifecycle: tests cover required environment configuration, PostgreSQL
  concurrency and owner isolation.
- Cloud/ACP: 64 library, 17 private CLI and 4 stdio tests, including recorded snapshots,
  restart without relaunch, immediate follow-up after load, and ownership takeover.
  Six served ACP-to-fold tests cover replacement, cancellation, incomplete loads,
  and late historical records remaining in the original turn.
- Harness: 216 package tests and 32 service tests, including named/channel-triggered
  startup without sandbox provisioning, required environment selection, retry after
  setup in the same session, and target pinning after restart.
- Session service: 218 tests, including atomic PR publication during ownership
  takeover, authorized observation, and readable metadata during provider outages.
- Authentication: 102 existing service tests and 5 Codex HTTP/DTO tests.
- Frontend: focused configuration tests; mocked Chromium settings,
  composer and account-switch flows passed without JavaScript errors. The settings
  checks cover required environment save and fixed `main` behavior.
- PR UI: 33 shared magic-chip tests cover Cursor and Codex. Mocked Chromium checks
  verified late PR metadata, realtime invalidation, duplicate and changed links,
  and clicking the exact GitHub URL without JavaScript errors.
- Local runner: 95 tests. Infrastructure type check, root `just check`, workspace
  SQLx preparation with tests, and Codex crate clippy with warnings denied passed.

The full web TypeScript check still reports two existing scroll-deferral errors
outside the changed files. Strict harness clippy is blocked by the existing unused
`channels::domain::reference_sharing::grant_level` function; normal harness clippy
reports that dependency warning, while the Codex crates pass with warnings denied.
The PR integration's combined all-target clippy pass also reports an existing
`sort_by_key` suggestion in an unrelated session PostgreSQL test; changed code
has no lint findings.
The default local database had an unrelated missing
migration in its recorded history; schema and SQLx tests used a separate local
database migrated from the complete repository history.

The repository metadata was also checked against the authenticated test account
without launching a task. Environment selection changes do not alter database queries. The full application login
and cloud launch through a deployed backend remains a release check.
