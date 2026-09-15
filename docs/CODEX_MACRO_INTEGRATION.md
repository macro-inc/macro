# Codex cloud in Macro

Macro's global `@codex` bot runs tasks in the user's Codex cloud environment.
The implementation is in this branch; deploying the services, schema and web app
is required before it is available in a shared environment.

## User flow

1. Open **Settings → Harness → Codex** and choose **Connect with ChatGPT**.
2. Open the official verification page and enter the displayed device code.
   Macro polls the owner-bound attempt until it completes, expires or is cancelled.
3. Select a cloud environment and branch and save the configuration. Repositories
   must already be configured in Codex on the web.
4. Choose Codex in the agent composer or mention `@codex` in a channel. The first
   prompt creates a remote task; later messages continue the same task. Macro
   displays streamed assistant text, command activity and a link to the cloud task.
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
| Launch | Creates a Codex cloud task from the selected environment and branch. |
| Follow-up | Continues the existing task using its latest assistant turn. |
| Streaming | Uses the source-backed per-turn SSE route and reconciles final turn state. |
| Stop | Requests remote cancellation; terminal state comes from provider evidence. |
| Load | Replaces history from the native journal and observes an unfinished turn; no `session/resume`. |
| Commands | Translates exposed command events to ACP tool activity. |
| Elicitation/approval | Unsupported; requests cancellation and reports the limitation. |
| Models, Macro MCP, sandbox resize | Not advertised for this runtime. |

Cloud execution happens in OpenAI's sandbox. See
[desktop transport evidence](CODEX_DESKTOP_TRANSPORT.md),
[live probe results](CODEX_CLOUD_LIVE_PROBES.md) and
[ACP verification](CODEX_ACP_VERIFICATION.md) for the tested protocol surfaces.
These endpoints were discovered from client source and verified experimentally;
they are not a documented third-party Codex cloud API contract.

## Repository selection follow-up

The current implementation uses the environment and branch saved in Harness
settings. To add automatic selection, extract the decision logic from
`agent_harness::outbound::cursor::HaikuRepositoryChooser` and supply candidates
from the owner's Codex environments instead of Macro's GitHub installations.
Reuse prompt and recent-session context; keep provider-specific resolution small.

The desktop's environment response includes `repos` and `repo_map`, with
`repository_full_name`, `clone_url`, and `default_branch` for each repository.
The current transport intentionally exposes only environment ID and label; add
that safe repository subset before enabling automatic selection. Do not infer
repository identity from a display label. The cloned CLI's
`cloud-tasks/src/env_detect.rs` also lists environments by repository and returns
a list, so a repository is not a unique environment key.

Keep environment IDs as launch targets. An explicit selection wins; an ambiguous
model choice or multiple environments for one repository needs a picker or an
explicit saved default. Codex needs a configured environment, so Cursor's
no-repository fallback cannot be copied. Preserve the chosen target throughout
the session. Automatic selection is a follow-up, not part of this implementation.

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

- Connection lifecycle: 9 tests, including PostgreSQL concurrency and owner isolation.
- Cloud/ACP: 51 library, 17 private CLI and 4 stdio tests, including recorded snapshots,
  restart without relaunch, immediate follow-up after load, and ownership takeover.
  Six served ACP-to-fold tests cover replacement, cancellation, incomplete loads,
  and late historical records remaining in the original turn.
- Harness: 204 package tests plus service suites and named/channel-triggered Codex
  startup tests that forbid sandbox provisioning and MCP injection.
- Authentication: 102 existing service tests and 4 new HTTP/DTO tests.
- Frontend: 42 tests; mocked Chromium settings, composer and account-switch flows.
- Local runner: 95 tests. Infrastructure type check, root `just check`, workspace
  SQLx preparation with tests, and Codex crate clippy with warnings denied passed.

The full web TypeScript check still reports two existing scroll-deferral errors
outside the changed files. The default local database had an unrelated missing
migration in its recorded history; schema and SQLx tests used a separate local
database migrated from the complete repository history.
