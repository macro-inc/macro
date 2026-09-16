# Claude Cloud harness — internal demo

`claude-cloud` runs Claude Code on Anthropic's cloud using **the session owner's subscription OAuth grant**. It does not use macrod, a local Claude process, or Macro's Anthropic API key. This uses an unofficial first-party protocol verified experimentally on September 15, 2026, not a supported third-party OAuth registration.

## Connect in the local UI (recommended)

The frontend entry points require the PostHog flag **`claude-cloud`**. It is
off by default everywhere (including dev); for a local demo, set
`VITE_CLAUDE_CLOUD=true` when starting/building the frontend. With the flag off,
the connection card never mounts and agent settings neither offer Claude Cloud
nor request its model catalog. This is a UI rollout flag, not a backend
authorization boundary or a kill switch for existing agents/sessions.

Rebuild the local backend from this workspace (`r` in the running `just run_local`
terminal) and refresh the browser. In **Settings → Harness**, the
**Claude Cloud (demo)** row has the Anthropic logo and appears above Cursor,
even before an account is connected. Connection setup is not in Settings → Agents:

1. Click **Connect Claude** to open Claude sign-in in a new tab automatically.
   If the browser blocks it, use the **Didn't open? Open Claude sign-in** link.
2. Sign in and approve on Claude's own page. Macro never asks for your password.
3. Copy the entire one-time `code#state` displayed by Claude, paste it into Macro,
   and click **Finish connecting**.
4. Create/edit an agent and select **Claude Cloud (demo)** as its harness.

This is Claude Code's manual authorization-code + PKCE flow, not an RFC 8628
device-code grant. The registered callback stays on Claude's site, so this works
across Docker/host boundaries without exposing a localhost callback server.
The Macro user comes from authenticated request identity, never an email field.
Attempts expire after ten minutes, are one-use, and are canceled on disconnect.
Starting again invalidates the prior attempt. A failed exchange requires starting again.

**No credential file, container mount, or credential environment variable is needed locally.**
With `ENVIRONMENT=local`, grants are stored in MacroDB's `claude_oauth_grants`
table. The serialized grant is KMS-encrypted, bound to its exact Macro owner and
the `claude-cloud-oauth` purpose. The local stack's existing Cursor KMS key is
reused with this separate encryption context; neither Cursor's configuration rows
nor macrod token hashes are reused. Grant updates include refresh-token rotation.
Reconnect once after upgrading from the old in-memory backend; subsequent
restarts/rebuilds retain the connection. Run one replica: refresh/connect/disconnect
are serialized in the domain service, not protected by a distributed lock.
Access/refresh tokens never reach frontend responses, query caches,
local storage, or logs. The one-time code is briefly in the masked input and POST body,
and is cleared on submission/cancel/expiry. Consent URLs are no-store responses.
Local Macro login may be a different email from the Claude account you authorize.

**Disconnect Claude** forgets Macro's grant and pending attempt. It does not revoke
consent at Anthropic or stop a cloud turn already running; stop the turn first if
needed. Interactive onboarding is disabled outside `ENVIRONMENT=local`.

## Legacy command-line provisioning (optional)

From this workspace, with Node 22+:

```sh
node tooling/claude-cloud/connect.mjs --owner you@macro.com
```

Complete Claude's own browser consent page. This helper uses authorization-code OAuth with PKCE and a loopback callback, not a device-code grant. It requests `user:profile user:inference user:sessions:claude_code`, resolves the selected Claude organization, and selects a single active cloud environment. If there are several, pass `--environment env_...` explicitly. No session is created by connecting.

To reuse a grant obtained by the earlier isolated experiment, supply `--oauth-file /absolute/path/to/private/oauth.json`. Do not paste tokens into commands, chat, frontend storage, or tracked files.

The output defaults to `.claude-cloud/credentials.json` (gitignored). The parent must be `0700` and the file `0600`. The helper refuses to overwrite a connection. The file is **plaintext private demo storage, not encrypted/KMS storage**, and the service must run as its owner. It maps exact `macro|email` identities to grants; there is no shared default credential.

## Enable the service

Local service startup always uses encrypted DB storage, ignoring the legacy file
path. Apply the MacroDB migration before rebuilding the service. Outside local,
`CLAUDE_CLOUD_CREDENTIALS_PATH` still enables the older private-file experiment;
empty leaves Claude disabled. Only that legacy mode needs a private directory
mount. Refresh atomically replaces the file, so mount the directory read/write,
not just the file. Run **one service replica**.

Production startup refuses a nonempty path. Before a hosted dev deployment, register the optional config key in the service's Doppler configuration and provision a private persistent volume; this change does not deploy or modify shared credentials. Local overrides use the normal MacroConfig environment loading.

The standalone frontend against the existing dev backend cannot exercise this new provider. Use a backend built from this workspace; see [running locally](RUNNING_LOCALLY.md).

## Use in Macro

1. Connect through the Claude row in Settings → Harness, then create or edit a private agent in Settings → Agents.
2. Select **Claude Cloud (demo)**. It is offered only when model discovery confirms that your Macro identity has a configured connection.
3. Choose from Claude's reported model catalog. Settings reads up to five recent sessions through your connected account and uses the first available initialization catalog; an existing session uses its own latest catalog. IDs, names, descriptions, and ordering come from Claude, not a fixed list. With no catalog yet, only **Claude · subscription default** is offered, with an explanatory description. The first prompt requests initialization alongside the model and user message, and the picker updates when Claude reports its catalog. Subsequent catalogs replace old choices during polling and streaming without resetting your saved preference. This is last-reported availability, not a fresh entitlement guarantee. Selection saves the next-turn preference after event submission; it does not wait for an idle worker. Each prompt repeats that preference immediately before the user message in one ordered batch, including after a Macro restart. A worker rejection surfaces an error and requests interruption; this cannot guarantee zero inference before the rejection arrives.
4. Start a session with that agent or mention it in a channel. Prompts, follow-ups, text streaming, tool cards, cancellation, and transcript load use Macro's existing session interface.
5. In the session header, use **Open in Claude** (the external-link icon; in the toolbar overflow on narrow screens). Existing demo sessions get the link too.
6. Send a message on that Claude page. While the Macro runtime connection is live,
   durable user messages, assistant text, tool results, and turn completion are
   mirrored back into Macro on a two-second polling cadence. Polls skip active
   Macro turns, share the SSE replay cursor, and back off for 30 seconds on errors.
   Polling uses the bounded history endpoint, so long transcripts may take longer
   than two seconds; cloud-side text appears as durable messages, not token deltas.

Only the session owner may send/control prompts or edit/remove queued input for this provider. Sharing visibility does not grant permission to spend the owner's subscription. Existing Macro access checks still apply.

## Harness integration

Claude implements the shared `ContainerManager` and `ClaudeModelProbe` ports and
is dispatched by `RoutedContainerManager` alongside Cursor and Codex. The
composition root supplies the account-scoped `CloudProvider`, session repository,
existing egress provisioner, and ACP adapter. Each saved agent retains its own
instructions, model, and MCP selection. Provider lifecycle policy lives in
`agent_harness::domain::claude`; OAuth credentials stay behind the account service.

ACP `session/new` and `session/load` carry Macro's existing authenticated HTTP/SSE
MCP server list. Claude translates that list into the SDK's `mcp_set_servers`
control request, ordered before the model and user message in the same batch.
An idle worker needs the user event to wake, so an acknowledgment cannot be awaited
before submitting that batch. A rejected or missing setup acknowledgment fails the
turn; rejection also requests interruption. As with model selection, this cannot
guarantee zero inference before a rejection arrives. Tool permission requests go
through Macro's standard ACP `session/request_permission` policy. Unsupported
stdio servers and duplicate names fail the handshake instead of being dropped.
On reattach the existing egress provisioner mints a fresh session token, persists
its hash, and reconstructs the saved selection, including after a host restart.

The control request and response match
[Anthropic's Agent SDK types](https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.220/sdk.d.ts).
Automated tests exercise protocol translation and host permission decisions using
fake provider ports; they do not establish live Claude Cloud MCP connectivity.
The cloud worker must be able to reach the configured egress URL.

## Demo boundary

- Text prompts only; attachments and repository selection are not forwarded yet. Macro and configured Pipedream MCP servers use the shared session egress path. Built-in cloud tools retain provider policy; explicit permission requests are delegated to the Macro host.
- Model discovery is read-only and bounded to five recent account sessions. No catalog is shared across credential owners. New/removed model IDs require no code change; choices absent from the current catalog are rejected. Provider errors stay visible rather than silently substituting a fixed list. No local filesystem. Agent instructions are forwarded as `append_system_prompt`.
- Access tokens refresh shortly before expiry; rotated refresh tokens are encrypted and saved before provider use. If saving fails, the process retains the rotated grant and retries persistence rather than reusing the old refresh token. A revoked grant produces a reconnect error. No API-key fallback or quota bypass.
- Prompt sends and session creation are not blindly retried. A durable `claude-cloud-create-pending` mapping prevents duplicate creation after an uncertain request or crash. An operator must inspect the Claude account before clearing a stuck intent.
- SSE reconnect is bounded and resumes durable sequence numbers. Durable assistant text reconciles with already-delivered ephemeral text; an inconsistent/truncated replay fails visibly. Session/load recovers the durable transcript. A result ends a turn, not the conversation.
- Closing the Macro transport closes its adapter tasks, not the provider's ongoing work. Use Stop for interruption. Deleting a Macro session requests reversible archive of the cloud session, not deletion of the user's Claude transcript.
- A process restart during a running cloud turn does not automatically reattach live output. Wait or interrupt, then reload the transcript; the harness refuses to send a new prompt while cloud history has an unfinished user turn.
- Provider token usage is reported into Macro's existing session telemetry. This is subscription usage, not a Macro-paid model invocation.
- Fresh-login/device-attestation requirements may differ across accounts. Only the standard cloud-session path was verified; errors are surfaced rather than bypassed.

Before production: supported auth onboarding, a dedicated hosted KMS key and IAM
policy, distributed refresh locking, stronger lifecycle/recovery tests, remote MCP
validation, repo authorization, permission UI, and explicit shared-session billing policy.

## Verification

Discovery was verified against the connected account and the real session picker:
both returned Claude's four reported choices with provider names/descriptions,
without the old hard-coded standalone Opus entry. No inference was sent, and the
saved selection was restored to default. Regression tests cover new arbitrary
model IDs, catalog replacement/removal, malformed data, account separation,
bounded discovery, and polled ACP config updates preserving the saved model.

Model switching was checked in the existing local Macro session: Sonnet was saved, and the picker restored subscription
default (confirmed in MacroDB). No inference was sent in that UI check. The
ordered model-plus-prompt batch and model-rejection interruption are regression
tested; control-only requests were observed to remain pending when the cloud
worker was disconnected, which is why selection does not await worker execution.

The Rust ACP adapter was exercised against the existing experiment's live cloud session: initialize, full transcript load, one harmless prompt, two streaming text chunks, and a successful result. No tools were used. The earlier harness changes passed 200 agent-harness tests and 49 focused frontend tests. The interactive connection change passed 19 Claude adapter tests, 26 harness-service tests, 45 focused frontend tests, TypeScript checking, and a Linux service build. OAuth domain tests cover wrong-user/state rejection, expiry, replay, and disconnect racing an exchange.

The polish pass verified the Anthropic-logo row above Cursor in Harness settings,
its absence from Agents settings, and start/cancel against the rebuilt local
backend. The masked code input, fixed PKCE consent URL, wrong-state rejection,
caller-supplied owner rejection, and canceled-attempt rejection were exercised.
The real session toolbar opened the expected Claude URL in a new tab using a
controlled read-only session fixture. Tests used `claude-ui-demo@example.com`;
no Claude grant or subscription turn was submitted for that identity.

The updated Claude crate has 26 passing tests, including actual PostgreSQL
persistence with a fake KMS boundary, cross-owner ciphertext rejection, refresh
rotation recovery, replay deduplication, and idle polling through the real ACP
channel. The local KMS key is enabled. TypeScript, 45 frontend tests, and the
Linux service build passed. All 214 agent-session tests passed serially (an
existing telemetry test was flaky in parallel), and 26 harness-service tests passed.
Workspace SQLx preparation passed against the named
local database, including test queries; only the six relevant generated cache
files were retained. **A consenting user's reconnect and cloud-page follow-up
are still needed to verify the complete live flow with database-backed grants.**

Repeat the non-provider browser smoke against your local frontend:

```sh
node tooling/claude-cloud/browser-smoke.mjs --origin http://localhost:25510
```

It signs into that disposable local identity and tests start/cancel; it does not authorize Claude or consume a subscription turn. `just check` cannot discover the jj-only workspace's diff because it uses Git; scoped checks were run directly instead.

An explicit live smoke runner is available (one short subscription turn; transcript retained):

```sh
cargo run -p claude_cloud_agents --example smoke -- \
  --credentials .claude-cloud/credentials.json \
  --owner 'macro|you@macro.com' \
  --session cse_existing_session
```

Omitting `--session` creates a new cloud conversation. Do not automatically rerun a failed create; inspect the account first. The runner prints only the session identity and outcome, not tokens or private transcript contents.
