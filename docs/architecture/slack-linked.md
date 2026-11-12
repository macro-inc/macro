# Slack linked sessions

The Slack provider of [external chats](external-chats.md). A person signs in
to Slack with their own web-client session (an `xoxc-` token per workspace
plus the `d` cookie), Macro lists their **Slack Connect** conversations
(channels shared with another organization, and direct messages with people
from another organization), and each conversation they add becomes their own
`external_chat` with provider `slack`. Each person sends from their own
session. Sharing, the generic API, live updates, notifications and attachment
storage are in [External chats](external-chats.md); this page covers the Slack
side. The behaviour is ported from mautrix-slack and beeper/slackgo, not their
code.

v1 is Slack Connect only: internal channels and internal DMs are never listed
or synced.

## Processes

```
Web app ──REST──▶ DSS ──── MacroDB ◀──── slack_session_service (N replicas)
                         rows + NOTIFY      login steps; one websocket per leased account
```

- **DSS** serves `/slack-linked/*` (`crates/slack_linked/src/inbound`) and
  `/external-chats/*` with `SlackProvider` as the `slack` provider. It writes
  login inputs, chats, memberships and send intents, and never calls Slack.
  It holds no Slack credential it can read (see [Secrets](#secrets)).
- **Session service** (`services/slack_session_service`) runs every call to
  Slack: login steps, the per-account websocket, catalogue refreshes,
  history, media downloads, sends and read marks. It calls
  `slack_linked::domain::session::SessionService` in-process; Slack I/O goes
  through `crates/slack_client`. There is no service-to-service HTTP.

## Data model

Generic rows are the ones in [External chats](external-chats.md#model);
`external_chat.provider = 'slack'`, `remote_id` is the Slack conversation id
(`C…`, `G…` or `D…`), `kind` is `group` for channels and group DMs and
`direct` for a one-to-one DM. Slack conversation ids are unique across Slack,
so a Slack Connect channel the person reaches from several of their
workspaces is still one chat per person (one live row per
`(user, provider, remote_id)`, as for every provider).

| Table | One row per | Holds |
| --- | --- | --- |
| `slack_account` | person × Slack team (workspace) | `team_id`, `enterprise_id`, team name, domain and icon, the person's Slack user id, `state`, `ended_reason`, `generation`, `lease_epoch`, the sealed credentials (`credentials`, `data_key_ciphertext`, `kms_key_id`, `encryption_version`), `last_connected_at` |
| `slack_login_attempt` | sign-in in progress | owner, `step`, the step's public data (site key, workspace list), the sealed private state between steps, the pending input, claim, `expires_at` (10 min) |
| `slack_conversation` | account × Slack Connect conversation | the catalogue: id, kind, name, topic, private, archived, `frozen_reason`, connected teams, the DM's other person, last activity, unread count, Slack's `last_read` |
| `slack_team` | Slack team seen in a conversation | name, domain, icon (connected organizations and external people's teams) |
| `slack_chat_membership` | chat × account | consent at `generation`, `remote_member`, `can_post`, the per-chat sync cursor (`latest_ts`), `last_read_ts` |
| `slack_user_alias` | chat × Slack user id | the `external_chat_person` for a Slack user, their `team_id` and whether they are external to the account's team; names and avatars come from `slack_user` |
| `slack_user` | Slack user id | display name, real name, avatar, `team_id`, `is_bot`, deleted, refreshed from `users.info` / edge lookups |
| `slack_send` | send intent | as `whatsapp_send`: idempotency key, digest, payload, chat sequence, claim, outcome, `traceparent`; the Slack `client_msg_id` it allocates |
| `slack_inbound` | websocket event not yet ingested | account, lease epoch, the raw event (JSON), received time; deleted once ingested |
| `slack_read_mark` | outbound read mark not yet sent | chat, account, `ts`, thread `ts`; coalesced per (chat, account, thread) |

Account states: `connecting` (credentials stored, first boot pending),
`connected`, `logged_out` (Slack ended the session; `ended_reason` says why)
and `disconnected` (the owner disconnected). `generation` counts consent
(sign-in, disconnect, session end) and fences memberships and sends;
`lease_epoch` fences the replica running the account, exactly as for
WhatsApp.

`ended_reason`: `revoked` (`invalid_auth`, `not_authed`, `token_revoked`),
`expired` (`token_expired`), `account_inactive`, `team_disabled`,
`removed_from_team` (`user_removed_from_team`), `enterprise_restricted`
(`enterprise_is_restricted`), `unreadable` (KMS refused the data key or the
credentials don't decrypt).

## Secrets

Credentials are sealed with the shared `kms_envelope` crate (extracted from
`whatsapp_store_pg`): one KMS data key per account, generated with
`GenerateDataKey` under `alias/slack-session-service-<env>` and the
encryption context `{purpose: slack-session, user_id, account_id, version}`,
then AES-256-GCM with associated data account | purpose. The plaintext is
`{token, d, d_s}` in a zeroizing type that is never logged or `Debug`ged.

- Only the session service can `Decrypt` `slack-session` keys, and it seals
  the login attempt's private state between steps under
  `{purpose: slack-login, user_id, attempt_id}`.
- **Pasted or desktop-captured sessions** reach DSS in a request body. DSS
  seals them at once under `{purpose: slack-login-input, user_id,
  attempt_id}` and stores only ciphertext: DSS may call `GenerateDataKey`
  for that purpose and nothing else, never `Decrypt` (IAM condition on
  `kms:EncryptionContext:macro:purpose`). The replica decrypts it, runs
  `auth.test`, reseals it into the account and nulls the attempt's sealed
  input.
- Email confirmation codes and 2FA codes are one-time and expire in minutes;
  they sit in the attempt row like WhatsApp pair codes and are cleared when
  the step consumes them.
- KMS refusal or undecryptable data marks the account `logged_out` with
  `unreadable`; a KMS outage changes nothing and the next rescan retries.

Disconnecting calls `auth.signout` on the session (best effort) and wipes the
sealed credentials and data key.

## The `/slack-linked` API

All routes need the person's bearer session (`UserOnly`); API credentials,
bots and internal callers can't sign in, list or disconnect. Errors use the
generic `ApiError` JSON (`{code, message}`). Times are RFC 3339.

Error codes the web maps, for `/slack-linked` and Slack chats on `/external-chats`:
`invalid_input` (400), `not_found` (404), `forbidden` (403: not the person's
own session), `conflict` (409, including a sign-in input sent in the wrong
step), `disconnected` (no active Slack account), `cannot_add_archived`,
`cannot_add_frozen`, `cannot_add_not_member`, `rate_limited` (429),
`temporarily_unavailable` (503) and `internal_error` (500).

### Sign-in

A sign-in is a `slack_login_attempt` that DSS creates and updates and a
session replica advances. Each `POST` stores the input and signals
`slack_login_requested`; the web polls `GET /slack-linked/login/{id}` (every second,
as the WhatsApp pairing dialog does) until `step` is no longer `working`.

| Route | Body | Allowed when `step` is |
| --- | --- | --- |
| `POST /slack-linked/login` | `{email}` | (new attempt; cancels the person's earlier open attempt) |
| `POST /slack-linked/login/session` | `{source: "manual" \| "desktop", cookie, cookieDs?, tokens: [{token, teamId?}]}` | (new attempt) |
| `GET /slack-linked/login/{id}` | | any |
| `POST /slack-linked/login/{id}/captcha` | `{solution}` | `captcha` |
| `POST /slack-linked/login/{id}/code` | `{code}` (`ABC-123` or `ABC123`) | `email_code` |
| `POST /slack-linked/login/{id}/workspaces` | `{teamIds: [..]}` | `pick_workspaces` |
| `POST /slack-linked/login/{id}/two-factor` | `{code}` (six digits) | `two_factor` |
| `DELETE /slack-linked/login/{id}` | | any open step |

Every route returns the `SlackLogin` DTO; a `POST` in the wrong step (or to
an attempt that is over) is `409 conflict`; an attempt past `expiresAt` reads
as `failed: expired`.

```ts
type SlackLogin = {
  id: string
  step: SlackLoginStep
  expiresAt: string
}

type SlackLoginStep =
  | { kind: "working" }                         // a replica is calling Slack
  | { kind: "captcha", siteKey: string, pageUrl: string, retry: boolean }
  | { kind: "email_code", email: string, retry: boolean }
  | { kind: "pick_workspaces", workspaces: SlackLoginWorkspace[] }
  | { kind: "two_factor", team: SlackLoginWorkspace, retry: boolean }
  | { kind: "finish_on_desktop", team: SlackLoginWorkspace, signInUrl: string }
  | { kind: "done", accounts: SlackAccount[], skipped: SlackLoginWorkspace[] }
  | { kind: "failed", reason: SlackLoginFailure }
  | { kind: "cancelled" }

type SlackLoginWorkspace = {
  teamId: string
  name: string
  domain: string
  iconUrl: string | null
  enterpriseName: string | null   // Enterprise Grid: admins see the session
  signIn: "ready" | "two_factor" | "sso"  // "sso" can't finish here
  alreadyConnected: boolean
}

type SlackLoginFailure =
  | "invalid_email" | "no_workspaces" | "code_expired" | "rate_limited"
  | "two_factor_expired" | "invalid_session"    // pasted/desktop session failed auth.test
  | "expired" | "slack_unavailable"
```

Flow:

1. `POST /slack-linked/login {email}` → `working`. The replica calls
   `signup.checkEmail`; Slack either wants a captcha (`captcha`: render
   Slack's hCaptcha/reCAPTCHA with `siteKey` on a client that can, then
   `POST …/captcha`) or emails a code (`email_code`).
2. `POST …/code` → `pick_workspaces` with every workspace the email signs in
   to (`signin.findWorkspaces`). A wrong code returns `email_code` with
   `retry: true`; an expired one fails with `code_expired`.
3. `POST …/workspaces {teamIds}` signs in to each chosen workspace in turn.
   One that wants 2FA stops at `two_factor` for it (`POST …/two-factor`; a
   wrong code returns `retry: true`), then the next continues. One that
   requires SSO can't be finished by Macro's servers: the step becomes
   `finish_on_desktop` with Slack's sign-in URL, and the desktop app finishes
   it (below); the rest of the chosen workspaces are still signed in.
4. `done` lists the accounts created or reconnected, and the workspaces
   skipped (SSO).

**Pasted or desktop-captured session** (`POST /slack-linked/login/session`):
`manual` is the "paste token and cookie" form; `desktop` is the Macro desktop
app's Slack window, which reads the HttpOnly `d` cookie and every
`localConfig_v2` team token after the person signs in on slack.com (SSO and
all) and posts them all. DSS seals the body and returns `working`; the
replica runs `auth.test` per token and ends in `done` (each valid team an
account) or `failed: invalid_session`. The web shows "Sign in from Macro
desktop" when it can't do this itself, handing off with
`macro:///external?slackLogin=browser` (open the desktop's Slack window) or
`macro:///external?slackLogin=<attemptId>` (resume an attempt's captcha or
SSO step on the desktop).

Each workspace signed in is one `slack_account` (created, or reconnected when
the person already had one for that team: `generation` +1, state
`connecting`), and the session service picks it up.

### Accounts

| Route | Purpose |
| --- | --- |
| `GET /slack-linked/accounts` | `{accounts: SlackAccount[]}`: the person's accounts, any state, oldest first |
| `POST /slack-linked/accounts/{accountId}/disconnect` | `{authorizationGeneration, signOut: boolean}`: end consent; `signOut` also signs the session out at Slack |

```ts
type SlackAccount = {
  id: string
  teamId: string
  teamName: string
  teamDomain: string
  teamIconUrl: string | null
  enterpriseId: string | null
  slackUserId: string | null       // once the first boot ran
  displayName: string | null
  state: "connecting" | "connected" | "logged_out" | "disconnected"
  endedReason: SlackEndedReason | null
  authorizationGeneration: number
  lastConnectedAt: string | null
}
```

### Slack Connect catalogue

`GET /slack-linked/conversations` returns the stored catalogue across the person's
connected accounts and signals `slack_catalogue_requested` (each account
refreshes at most once per 30 s). Only Slack Connect conversations are listed:
channels with `is_ext_shared` (or `is_pending_ext_shared`) and DMs or group
DMs with someone outside the account's team.

```ts
type SlackConversationList = {
  conversations: SlackConversation[]
  refreshing: boolean          // a refresh was requested; refetch on external_chat_changed
}

type SlackConversation = {
  remoteId: string             // C…/G…/D…: POST /external-chats {provider: "slack", remoteId, kind}
  kind: "group" | "direct"
  name: string                 // "#shared-launch"; a DM: the other person's name
  topic: string | null
  isPrivate: boolean
  isArchived: boolean
  frozen: boolean              // connection_severed: read-only
  connectedTeams: SlackTeam[]  // the other organizations
  directPerson: SlackPerson | null
  accounts: string[]           // the person's account ids that see it
  lastActivityAt: string | null
  unreadCount: number
  added: ChatReference | null          // the caller's own external chat
  shared: SharedChatReference | null   // someone else's, shared with the caller
  canAdd: boolean
  cannotAddReason: "archived" | "frozen" | "not_member" | null
}

type SlackTeam = { teamId: string, name: string, domain: string | null, iconUrl: string | null }
type SlackPerson = { slackUserId: string, name: string, avatarUrl: string | null, team: SlackTeam | null }
```

Adding and removing use the generic routes: `POST /external-chats`
(`{provider: "slack", remoteId, kind}`) and `DELETE /external-chats/{id}`.
Adding records a membership for **every** connected account of the person
that sees the conversation, so a channel reached from two workspaces keeps
syncing when one of them ends.

### History

Adding a chat imports its recent history at once: the last 90 days or 1,000
messages, whichever is less, with thread replies (`backfill_state`
`running` → `done` when Slack has nothing older, else `partial`).
`POST /slack-linked/chats/{chatId}/history-import` (owner) imports further back from
the cursor, another 1,000 messages per call, and returns
`{state: BackfillState}`; the generic chat detail carries `backfill`.

## Mapping onto external chats

| Slack | Macro |
| --- | --- |
| message `ts` | `source_id`; `source_at` from `ts` |
| `text` (mrkdwn; `rich_text` blocks rendered to mrkdwn when `text` is empty) | `body` as Slack's raw mrkdwn; the web converts and escapes it, as for WhatsApp. Server-side readers that need text (notifications, task from message) take plain text from `crates/slack_integration`'s mrkdwn parser |
| `<@U…>` | `mentions` (the Slack user ids, the token is the id), named through `slack_user` |
| `<#C…>`, `<!here>`, `<!channel>`, links, `:emoji:` | left in `body`; the web renders them |
| `thread_ts` ≠ `ts` | a thread reply: `thread_root` = the root message (see below) |
| `subtype: message_changed` | revision (edited) |
| `subtype: message_deleted` / `tombstone` | permanent tombstone |
| `reaction_added` / `reaction_removed` | `external_chat_reaction` (Unicode emoji, or `:name:` for custom) |
| `files[]` | attachments: `url_private_download` fetched with the session, `files.info` first when `file_access: check_file_info` |
| `channel_join`, `channel_leave`, `channel_topic`, `channel_name`, `channel_archive`, shared/unshared | system lines (`kind = system`) |
| bot messages (`bot_id`) | a person named after the bot |
| `channel_marked` / `im_marked` / `group_marked` / `mpim_marked` | the owner's `external_chat_read_state` |
| `thread_marked` | the owner's thread read position |
| `channel_id_changed` | `external_chat.remote_id` and memberships follow the new id |

Sending maps back: the composer sends mrkdwn with mentions written `<@U…>`
(each listed in `mentions`), replies in a
thread as `thread_ts` (optionally `reply_broadcast`), edits as `chat.update`,
deletes as `chat.delete`, reactions as `reactions.add/remove`, files with
`files.getUploadURLExternal` + upload + `files.completeUploadExternal`.

## Sync loop

Per leased account (`slack-account:<id>` advisory lock, `begin_lease` bumps
`lease_epoch`):

1. Decrypt the credentials; `client.userBoot` names the person and team.
   A session-ended error stops here (below).
2. Refresh the catalogue (`users.conversations`, Slack Connect only), the
   connected teams, and the people in it.
3. For each added chat the account observes, catch up from the membership's
   `latest_ts` (`conversations.history` `oldest`, then `conversations.replies`
   for roots whose `latest_reply` moved), ingesting as `remote`.
4. Open the websocket. Each event the gate keeps (added chats, the person's
   own read marks, catalogue changes) is written to `slack_inbound` at the
   current lease epoch, then ingested; events for conversations not added are
   dropped, never stored.
5. Work loop: claim sends, read marks and media downloads; catalogue refresh
   on request (≤ once per 30 s); history pages on request.
6. On disconnect: reconnect with backoff (`reconnect_url` first, then a fresh
   boot), and catch up again from step 3.

Signals (payload `{id, traceparent}`):

| Signal | Id | Sent by → read by | Meaning |
| --- | --- | --- | --- |
| `slack_login_requested` | attempt | DSS → session | an attempt has input to process |
| `slack_account_changed` | account | DSS → session | new account, consent or added chats changed; re-read |
| `slack_catalogue_requested` | account | DSS → session | refresh the catalogue (≤ once per 30 s) |
| `slack_history_requested` | account | DSS → session | import earlier messages of its `pending` chats |
| `slack_send_requested` | account | DSS → session | claim pending sends |
| `slack_read_requested` | account | DSS → session | send pending read marks |
| `slack_account_released` | account | session ↔ session | lease handed over |
| `external_chat_effects`, the media-ready signal, `external_chat_changed` | | | generic ([External chats](external-chats.md)) |

## Read state

- In: Slack's `*_marked` events for the person's own session advance the
  owner's `external_chat_read_state` to the message at `ts`.
- Out: when the owner reads a chat in Macro, DSS queues a `slack_read_mark`
  and signals; the replica calls `conversations.mark` (or
  `subscriptions.thread.mark` for a thread). Only the owner's reads go to
  Slack; people the chat is shared with keep their own Macro read state.

## Sending

As WhatsApp: DSS records a `slack_send` only while the sender's account is
connected and observes the chat at its generation; the replica claims sends in
chat order, `begin_dispatch` allocates the `client_msg_id` (point of no
return), calls `chat.postMessage`, and records the outcome; an echo from the
websocket converges on the same message by `client_msg_id`/`ts`. Unknown
outcomes are never resent; intents expire after ten minutes; one send request
per second per person; only the owner of the account sends, from the account
of the chat's membership that last connected. `frozen` and archived
conversations can't be posted to (`sendReason: not_allowed`).

## Failure states

| What happens | Account | Chats | Owner sees |
| --- | --- | --- | --- |
| Slack ends the session (`invalid_auth`, `token_revoked`, `token_expired`, `account_inactive`, `team_disabled`, `user_removed_from_team`) | `logged_out` + `ended_reason`, generation +1, credentials wiped | kept, read-only; sends fail `disconnected` | a notification and "Sign in again" on the Slack page |
| `enterprise_is_restricted` | `logged_out`, `enterprise_restricted` | kept | "Your Slack admin blocks this" |
| KMS refuses the key | `logged_out`, `unreadable` | kept | "Sign in again" |
| KMS or Slack unavailable, `ratelimited` | unchanged | unchanged | nothing; retried with backoff (`Retry-After`) |
| Conversation unshared or severed (`frozen_reason`) | unchanged | `frozen`: read-only | "This conversation was disconnected" |
| The person left the conversation | unchanged | membership `remote_member = false`; can't send | `sendReason: not_allowed` |
| The owner disconnects | `disconnected` | kept, read-only | |

Session end notifies the owner once per generation with an
`external_chat_account_ended` notification (`{provider, accountName,
reason}`).

## Rollout and incidents

The web flag `enable-slack-linked` is the only rollout gate; DSS always serves
`/slack-linked`. Scaling the session service to zero stops all Slack traffic,
including sign-in; accounts stay `connected` and sends expire unsent. Config:
`DATABASE_URL` (RDS instance endpoint for the lease connection) and the KMS
alias chosen from `ENVIRONMENT`.

## Needs from the generic layer

Slack differs from WhatsApp in ways `external_chat` doesn't model yet:

- **Threads**: replies live outside the channel timeline. Needs
  `external_chat_message.thread_root`, a timeline that leaves thread replies
  out (except broadcast ones) with reply counts on roots, and a thread page
  (`GET /external-chats/{id}/messages?thread=<message id>`).
- **Reactions**: a person can add several emoji to one message;
  `external_chat_reaction` is keyed `(message_id, person_id)`.
- **Attachments**: Slack gives no hash before download; `sha256` is
  `NOT NULL`. Download state is provider-owned (being generalized).
- **Read marks out**: a `ChatProvider` hook when the owner's read position
  advances.
- **Account-ended notification**: a generic notification kind.
