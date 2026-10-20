# Native WhatsApp Business and Instagram messaging

Receive and deliberately reply to customers through private native Macro channels.
This supports official WhatsApp Cloud API Platform/coexistence accounts and Instagram
Business/Creator accounts. Personal inbox connection, Instagram groups, existing-group
adoption, CRM changes, export uploads and proactive automation are outside scope.
See [content coverage](META_MESSAGE_CONTENT.md) and [verification](META_MESSAGING_TESTING.md).

## Account and team model

Each account belongs to one team; each account/customer pair maps to one private
channel, initially accessible only to the connector. Native permissions govern
channel/file reads. External replies additionally require an explicit human session,
current account-team membership, channel posting permission and provider eligibility.
Teammates send as the business; external authors remain visibly marked **External**.
API keys, bots and harnesses cannot submit external replies. Agent output stays internal.

Any current member can connect and list account details. The current connecting
member or a team admin can reconnect, disconnect or import history; authority is
rechecked at completion. A fresh connection cannot take over an existing account.
Reconnect does not transfer channel/file ownership or grant access. Leaving the
team blocks new inbound effects and external dispatch, but does not revoke separate
native read grants. Accepted replies still finish native recovery. Automatic account
rosters, administrator takeover and ownership conversion are not implemented.

## Code boundaries

`meta_messaging::domain::service` owns conversation access, human send authority,
durable intents, dispatch fencing and accepted-message recovery. Its ports carry
account identity, team, health and generation without Meta credentials.
`domain::meta` owns account lifecycle, subscriptions, history and group controls.
Provider/database adapters implement ports; DSS composes native channel, message
and private-file effects through their owning domains. Stable sanitized error codes
select recovery guidance; provider diagnostics and credentials are never returned.

The frontend reply source translates generated transport types into feature-owned
capabilities. One channel interaction state gates internal, external, group setup,
loading and error UI. `messaging_binding` is committed with native binding/setup and
exposed by detail, list and GraphQL reads. Unknown metadata cannot enable sending;
errors offer a retry of the native metadata request. Confirmed ordinary channels make
zero `/meta/*` requests. Settings and group controls use authoritative channel detail,
independently of sidebar membership. Cached account rows survive refresh errors;
registration PINs remain only in the mounted password field.

## WhatsApp groups

Only new groups created through Macro on eligible Official Business Account Platform
numbers are supported. The current connector must still belong to the account team;
team-admin status alone does not grant creation or private-channel access. Business-app
coexistence and Instagram groups are unsupported. Adding Macro teammates changes native
access only. Participants join WhatsApp through an invite link.

Meta limits groups to eight participants and one Cloud API business. A participant’s
message refreshes the 24-hour service window; joining does not. Text, supported media
and approved text templates are supported. Calls, disappearing/view-once content,
edits/deletes, reactions, quoted-reply UI, pin/read actions and aggregate read receipts
are unavailable. Applicable sends are billed per delivered recipient. Since October 1,
2026, group utility templates are charged inside the service window; non-template
messages are free only within the number’s shared 1,000-delivery tier. See Meta’s
[limits](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups)
and [pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/pricing).

Before each new remote create attempt, preflight checks OBA/Platform mode, the bounded Groups capability probe,
and app subscriptions for `messages`, `group_lifecycle_update`,
`group_participants_update`, `group_settings_update` and `group_status_update`.
Missing subscriptions and transient provider errors fail closed for that request.
The next deliberate attempt checks again; startup and recovery require no readiness
request or restart. Returned remote group IDs are never adopted.

Creation reserves the native channel and one setup row before a single Meta POST
with `join_approval_mode: auto_approve`. Only the current request ID, authenticated
signed callback and connection generation can bind it. Tracked work survives client
disconnects. Definite failure or uncertainty permits deliberate retry; unknown outcomes
warn that the earlier attempt may have left an unused group. There is no automatic
remote create retry. After binding removes setup, the original subject and generation
remain with the conversation: authorized create/retry replays return `bound` without
another provider create. Changed account, subject, generation or native authority
cannot reuse that result. Bindings lacking creation evidence are never adopted.

| Control | Required server authority |
| --- | --- |
| View participants | Native channel view |
| Copy link / reply | Human session, account-team membership, native `MessageWrite` |
| Remove participant | Human session, account-team membership, native `AdminParticipantRole` |
| Delete group | Human session, account-team membership, native ownership |

Invite URLs never enter conversation/search metadata or persistent/shared caches.
Authorized mounted controls prefetch them into component memory and clear them on
channel/user/access changes; the copy gesture uses the native clipboard and transient
success feedback. Link access does not require an open reply window. Participant
removal warns that rejoining through the link is unavailable; only signed confirmation
changes membership. Desktop/mobile Participants distinguish Macro and WhatsApp members.

Pending/bound groups reject native human posts, unsupported mutations, local rename,
team conversion and calls server-side. Generic native/entity/API-key deletion fails
closed. Explicit owner deletion retains the lifecycle guard through native teardown;
only Meta `success: true` or a confirmed signed deletion authorizes that teardown.
HTTP 200 alone, 404, permission errors and 131041 do not. Failed deletion keeps the
channel for retry; remote deletion leaves it read-only until the owner removes it.
Discard deletes only a failed/unknown unbound setup and rechecks atomically against binding.
Navigation removes deleted channels from open panes and history.

Group routing uses connection + conversation kind + peer ID. Group IDs never become
person aliases. Participant identities survive departure/rejoining and BSUID changes
without creating direct chats or changing their windows. Source timestamps fence stale
membership, subject and suspension events; deletion never clears. Group sending uses
`recipient_type: "group"` with the group ID; unsupported template components stay blocked.
Error 131020 asks the user to share the link. Removal uses BSUID `user_id` and confirmation
`removed_participants[].input` per the [group contract](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/reference).

Signed group receipts process valid siblings independently. Only group-level sent/failed
facts reconcile sends; participant read/delivery facts do not aggregate or observe identity.
Early callbacks retry within bounds, terminating with `group_binding_pending` if exhausted.
Unknown request/group IDs are ignored. After two minutes a setup stops blocking unrelated
facts, but its saved matching request ID can still bind. Callback transactions lock
connection/setup rows briefly; no row lock spans provider I/O. There is no orphan adoption,
replay-on-bind worker, operation history, automatic invitation or deletion tombstone.

## History import

Connections receive new activity by default. The connector or a current team admin
explicitly starts **Import history → Import available history** in Settings. Import
covers all provider-available one-to-one conversations, without a picker or export parser:

- WhatsApp coexistence: up to 180 days of messages and 14 days of media, with phone consent,
  the app kept open and initiation within the 24-hour onboarding window. Contact sync
  precedes history but creates no CRM records. Test/Platform numbers cannot import it.
- Instagram: API-visible conversations and the latest 20 messages each; Requests inactive
  over 30 days and older content are unavailable. This is not a full account archive.

Generation-bound consent, provider IDs and leased checkpoints preserve channels, original
authors/times, manual names, permissions and private files across overlap and restart.
History does not send or open reply windows; a later eligible live message can. Receipts
queued before consent cannot initiate import. Both connector and consenting-user membership
are rechecked before effects; admin demotion alone does not revoke existing consent.
Reconnect invalidates consent but retains imported content. Instagram reads can resume;
WhatsApp one-shot POSTs are fenced and unknown acceptance is never blindly repeated.
Signed late results can recover, and missing media has an explicit notice.

## WhatsApp identity and Platform registration

One connection-scoped alias table tracks current/previous BSUIDs; phone and its observation
time live on the conversation. A verified BSUID/phone pair upgrades a legacy conversation
and removes its phone alias. Recycled numbers clear stale phone attributes without merging
histories. Ambiguous phone-only facts terminate with an identity-conflict diagnostic.
BSUID updates retain aliases, rekey only into unused destinations and otherwise preserve
both histories while blocking stale new sends. Provider message IDs retain revision scope.

Live/echo/history/status payloads use `from_user_id`, `to_user_id`, `context.user_id` and
`recipient_user_id`. `user_changed_number` / `user_changed_user_id` arrive on `messages`;
there is no separate identity subscription. Production sends prefer BSUID `recipient`;
legacy phones use `to`. Only an explicitly configured developer sender may prefer a current
allowlisted phone. No inferred phone or fallback after a send is permitted. Dispatch
rechecks identity and phone after preparation; 131062 reports account availability.

Platform signup verifies WABA/phone, token scopes and non-Business-app Cloud API mode.
Encrypted credentials survive recoverable registration failures. Only a confirmed
unregistered state enables explicit PIN registration; `PENDING` and unknown modes do not.
Only `CONNECTED` + `CLOUD_API` establishes readiness. PINs never enter drafts, mutation
caches, logs, URLs or durable work. Uncertain registration needs a provider status check
before retry; known PIN rejection permits correction, while 133016 imposes a fresh 72-hour
cooldown. Follow Meta’s [registration limits](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/registration)
(14-day deadline, ten attempts per 72 hours). No worker or local setup registers a number.

## Meta setup dependencies

Use Graph API **v26.0**. WhatsApp and Instagram can share a Meta business app, but Instagram
Login uses its own app ID/secret. WhatsApp production requires business verification,
Tech Provider onboarding and Advanced Access to `whatsapp_business_management` and
`whatsapp_business_messaging`. Configure Embedded Signup **v4**, exact HTTPS origins and
redirect allowlists. Coexistence uses `featureType: whatsapp_business_app_onboarding`;
Platform uses its separate standard v4 configuration. Exchange the code immediately
(30-second provider TTL, independent of local transaction expiry). Never register a
coexistence number; onboarding may unlink companion devices and excludes group history.

Instagram requires Business/Creator accounts, Instagram Login, `instagram_business_basic`
and `instagram_business_manage_messages`, exact redirect and messaging subscriptions.
A Facebook Page is unnecessary. Development needs tester roles; other businesses require
Advanced Access. HUMAN_AGENT requires separate approval and explicit human support, never
automation. Ordinary Instagram replies use 24 hours; ad-entry/support extensions require
server-confirmed eligibility. Test numbers do not qualify coexistence, history or groups.
Recheck [Meta onboarding](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation/)
and [Instagram messaging](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api)
before changing versions or policy.

## Server configuration

Register these exact names in the DSS Doppler configuration before enabling a
provider. Secret registration and Meta app provisioning require environment
access; this branch does not deploy or modify shared secrets.

| Variable | Value / purpose |
| --- | --- |
| `META_WHATSAPP_APP_ID` | Parent Meta business app ID |
| `META_WHATSAPP_APP_SECRET` | Parent app secret; used only server-side |
| `META_WHATSAPP_CONFIGURATION_ID` | Embedded Signup v4 coexistence configuration ID |
| `META_WHATSAPP_PLATFORM_CONFIGURATION_ID` | Optional separate v4 Platform-number configuration ID |
| `META_WHATSAPP_VERIFY_TOKEN` | Random webhook verification token, matching the WhatsApp dashboard |
| `META_INSTAGRAM_APP_ID` | Instagram app ID from Instagram API setup |
| `META_INSTAGRAM_APP_SECRET` | Instagram app secret, also authenticating Instagram webhook bodies |
| `META_INSTAGRAM_REDIRECT_URI` | Exact HTTPS web callback: `<Macro-web-origin>/app/instagram-callback.html` (same origin as Settings) |
| `META_INSTAGRAM_VERIFY_TOKEN` | Independent Instagram webhook verification token |
| `META_INSTAGRAM_HUMAN_AGENT_APPROVED` | Optional `true` only after Meta grants the configured app HUMAN_AGENT approval; defaults to `false`. Reconnect to record approval. Turning it off disables the extension immediately. |
| `META_CREDENTIAL_KMS_KEY` | Dedicated KMS key ARN/alias. Pulumi supplies it to DSS; local provisioning supplies `alias/macro-local-meta-messaging`. |
| `META_WHATSAPP_TEST_BUSINESS_ACCOUNT_ID` | Local-only Meta API Setup test WABA |
| `META_WHATSAPP_TEST_PHONE_NUMBER_ID` | Local-only API Setup phone-number ID |
| `META_WHATSAPP_TEST_TOKEN` | Local-only server token belonging to the selected test WABA/phone |
| `META_WHATSAPP_TEST_RECIPIENTS` | One to five verified and explicitly authorized test WhatsApp IDs, comma-separated, country code included |

Configure WhatsApp app ID, app secret, verification token and at least one signup configuration; or configure all four Instagram
variables; absent providers show an unavailable connection action. A partial
configuration fails startup. The isolated local WhatsApp test path may omit
`META_WHATSAPP_CONFIGURATION_ID` but still requires app ID, app secret, verification
token and KMS configuration. It cannot be enabled in a deployed environment and
cannot send outside its recipient allowlist. Production signup still verifies
account ownership, app/scopes and the selected number's signup-mode eligibility.

WhatsApp callback: `<origin>/dss/meta/webhooks/whatsapp`. Subscribe to `messages`,
`smb_message_echoes`, `account_update`, `history` and `smb_app_state_sync` for coexistence.
History is consumed only after explicit import consent; contact-sync payloads do
not create channels or CRM records. Instagram callback: `<origin>/dss/meta/webhooks/instagram`; the
integration subscribes each connected professional account to its messaging
fields. Complete the dashboard verification GET, then verify a signed POST for
each product. Use a gateway exposing only the callback paths for local Meta
verification. Meta must also be able to retrieve short-lived native attachment
URLs for Instagram; a private LocalStack URL is not usable by Meta.

KMS Encrypt/Decrypt is restricted to the dedicated key and the
`meta-business-messaging-v1` purpose with team and connection encryption context.
Credentials are erased on disconnect. No plaintext fallback is available.

WhatsApp subscriptions belong to the messaging account (WABA), not one phone.
Disconnect removes only that connection's credentials and stops its pending sends.
If another number still uses the same WABA, including on another Macro team, the
shared subscription stays active and Settings reports a successful local disconnect.
The last disconnected number can remove the subscription. Connect and subscription
maintenance coordinate through the same PostgreSQL advisory lock; contended
maintenance is deferred. Requests first queue for bounded local capacity before
acquiring a pool connection; OAuth persistence then waits on the database lock.
The capacity limit reserves pool headroom for the lock owner’s ordinary queries.
Capacity pressure is not an account conflict. Canceled blocking connect waiters close
their connection, so queued rollback cannot consume the owner’s pool headroom.

Account health retains stable, sanitized reasons for expired/revoked authorization,
blocked Meta API access, connector departure, transient failures, setup
issues and other provider rejections. Settings and the customer composer explain
the appropriate recovery; a temporary failure does not tell the user to repeat
OAuth. Raw provider diagnostics, tokens and message contents are not exposed.


## Supported sending and recovery

Customer channels have one external composer with progress/failure/uncertainty feedback.
Successful replies have no delivery/read badge; server state remains available. Bounded,
channel-authorized history lookup covers older visible replies. Recovery restores a draft
without sending or replacing a newer draft. Drafts use existing local persistence scoped
to user/channel, including files, templates and intent key. PINs and invite links are excluded.

Server dispatch rechecks team/channel authority, generation, provider state, quote scope,
content/size limits and reply eligibility after preparation. Approved template content is
resolved and saved before the provider call. Unsupported template inputs are disabled;
templates appear only outside the free-form window and preserve the text draft.
The outbound format limits are:

| Provider | Supported payloads |
| --- | --- |
| WhatsApp | Text: 4096 characters. JPEG/PNG: 5 MiB. AAC/MP4/MP3/OGG audio and MP4 video: 16 MiB. PDF/plain text: 32 MiB. Non-audio captions: 1024 characters. |
| Instagram | Text: 1000 UTF-8 bytes. JPEG/PNG: 8 MiB. AAC/MP4/WAV audio, MP4/MOV/WebM video and PDF: 25 MiB. Attachments send separately from text. |

Provider codecs/account restrictions still apply; unsupported incoming types show a
notice and oversized/unsupported outgoing files fail before dispatch. See
[content coverage](META_MESSAGE_CONTENT.md) for structured content and revision limits.

Durable acceptance queues native finalization; only recovery materializes accepted replies.
It never resends accepted or uncertain work. Pre-fence transient failures and definitive
rate limits retry within bounds. Interrupted dispatch/unrecorded acceptance becomes Unknown,
requiring a human to check the provider before explicitly submitting a new intent.
Unattempted intents expire ten minutes after enqueue, using database time after the account
lock. Retry retains that deadline; accepted/uncertain work never expires into resendable work.

Conversation FIFO `(created_at,id)` spans replicas. Pending retries and locked predecessors
block later sends only in that conversation. Acceptance, definite failure, expiry or settled
uncertainty releases it. Crashed dispatch becomes Unknown after its five-minute lease.
Receipt/send drivers each drain four local slots; independent accounts in a receipt progress
with bounded concurrency. Notify follows committed work and a five-second sweep covers other
replicas, retries, restart and lost wakes. Recovery drains bounded batches; failed native
materialization/publication defers 30 seconds without starving later work. DSS tracks and
drains tasks on cancellation. No provider/media I/O occurs in claim/fence transactions.

Independent webhook items preserve healthy siblings. Permanent decode errors are counted;
account-state failures retry within retention. Revocations cannot affect a newer generation;
already-dispatched sends can record acceptance after disconnect. Reconnect retries inbound
work without resetting outbound intents. Lease/publication revision mismatches fail explicitly;
new attachment revisions are protected from older retry updates.

Successful raw receipts clear after seven days. Failed/incomplete/partially decoded payloads
retain the original thirty-day deadline; late success still receives its seven-day window.
Cleanup skips leases, bounds each write to 500 rows and removes metadata at the original thirty-day threshold once
the payload is cleared. OAuth digests expire too. Native message/revision/acceptance records are
independent. Operational diagnostics contain IDs, states and counts, never content/tokens.

Files remain private user-owned Macro documents. Source reservations retain IDs/hashes across
crashes; recovery never overwrites ready content. Sharing uses native access services, and
loss of access after acceptance creates an unavailable-attachment notice. Unsend removes
content/references, not separately reused documents. Messaging staging explicitly requests
private initial sharing rather than inheriting team link defaults.

Enqueue validates an authorized read of the ready native file, including content and provider
limits, without preparing provider delivery. Dispatch reads and validates again before staging;
idempotent enqueue replays cannot create unused provider copies.

Instagram stages opaque copies under `ATTACHMENT_BUCKET/temp/macro-messaging/<UUID>` after
rechecking native file access. Originals never become public. Signed URLs last 15 minutes;
the existing unversioned email bucket’s `temp/` lifecycle expires objects after one day
(eventual deletion). S3 operations have a 60-second bound. Grant only GetObject/PutObject on
the prefix, verify lifecycle/versioning and configure Meta-reachable URLs before rollout.
No cleanup ledger/worker or version-list/delete permission is needed. WhatsApp uploads bytes.

Native publication uses existing permission-scoped Soup, activity, notifications and search.
The channel notification adapter owns metadata and delivery routing, including external author
names and stable notification IDs for recovery; messaging selects authorized recipients and
suppresses history/revision notifications without invoking ordinary human-post triggers.
Live customer messages can notify; history, business replies and attachment revisions do not
trigger customer notifications or agent/routine topics. Metadata queries pause offline/in
background and refresh on focus. Active sends poll at two seconds, delivery at ten and idle
conversations at thirty; history leaves fast polling after its initial receipt window.
Workers remain authoritative independently of open UI.

## Running locally and verification

Use an isolated named stack/database per [running locally](development/running-locally.md).
Keep credentials in its private environment and recreate affected containers after variable
changes. Run native consumers from the same revision. Expose only webhook paths publicly;
Instagram OAuth returns to the trusted same-origin browser callback. Keep the passwordless
app and databases private. Follow [automated and live checks](META_MESSAGING_TESTING.md);
fixtures do not establish delivery or production access.

## Production rollout gates

Code verification and the dedicated test app do not establish these prerequisites:

- Confirm the company owns the production Meta app and business portfolio, assign
  operational owners, and finish business verification. An advertising relationship
  does not establish messaging approval.
- Obtain the required messaging permissions, App Review/Advanced Access and
  WhatsApp Tech Provider approval. Verify the configured Embedded Signup v4 flow,
  business token model and exact allowlisted origins/callbacks. A developer token,
  even with a longer expiry, is not the production credential model.
- Qualify a real eligible WhatsApp Business-app number through coexistence. Prove
  phone-app echoes, synchronization, explicit history sharing and multi-number
  lifecycle behavior. The test number cannot satisfy this gate.
- Provision stable HTTPS callbacks, matching verification/signature secrets, and
  private, expiring signed media URLs reachable by Meta. Test expiration, private
  file permissions and supported media with the actual deployed storage origin.
- Register the server variables in the target secrets system, provision the dedicated
  KMS key/policy, apply compatible migrations before services, and deploy the DSS
  workers together with native activity, Soup, notification and search consumers.
- Establish alerts for receipt failures/age, unknown or failed sends, accepted sends
  awaiting native materialization, unpublished native revisions, failed history jobs,
  and revoked/expiring credentials. Report IDs, states, counts and age; exclude
  tokens, payloads and message content from operational diagnostics. Rehearse
  restart recovery and explicit human handling of uncertain sends.

The native notification service retains its existing delivery semantics: notification
records are idempotent, but a crash between its database write and egress publication
can miss a push update. Native conversation content and persisted notifications remain
available by fetch; this integration does not promise exactly-once push delivery.

## Instagram account-linking boundary

`POST /meta/authorize` returns random state and a separate random browser proof
for Instagram. Settings retains both only in memory; only state goes to Meta.
The stored digest binds state and proof to the authenticated initiating team/user,
expires after ten minutes, and is consumed once. The callback page
`/app/instagram-callback.html` loads no app code or analytics, clears its query
and fragment immediately, and hands code/state to its same-origin opener.
Settings checks the popup identity, origin and state, then submits code, state and
proof through authenticated `POST /meta/authorize/complete`. This request originates
in the original Macro page, so production SameSite=Strict session cookies work
without changing their policy. Server user/team, current membership and management authority, expiry, replay,
and reconnect identity checks remain mandatory before credentials are stored.
Missing or wrong proof cannot exchange a code. Pre-upgrade Instagram attempts
are rejected. WhatsApp Embedded Signup is unchanged.

The former public `/meta/oauth/instagram/callback` completion route is removed.
There is no public fallback. Reloading/closing Settings abandons its in-memory
transaction; start again. Cancelling, closing the popup, timing out, switching
Macro accounts, or selecting the wrong reconnect account produces a recoverable
Settings error. A page opened without its initiating window cannot complete.
Connect Instagram from the configured Macro web origin, including on mobile;
external desktop-app browsers do not share the initiating web transaction.

Before enabling Instagram, deploy the web callback and the backend fix together,
set `META_INSTAGRAM_REDIRECT_URI` to the exact web callback URL, and allowlist that
same URL in the Meta app’s Instagram Business Login settings. Remove the obsolete
DSS OAuth callback from the allowlist. Keep unrelated apps and webhook callbacks
unchanged. Serve the callback as the static HTML file (never rewrite it to the app
shell); exclude its query string from CDN/proxy access logs, analytics and error
reporting, and serve it with `Cache-Control: no-store` and
`Referrer-Policy: no-referrer`. OAuth begin/complete responses are also no-store.
The current website CloudFront distribution uses legacy access logging, which
includes query strings. Changing only the redirect allowlist is unsafe: disable
or replace that query-bearing logging before enabling this callback. Its shared
response-header policy must also preserve the popup opener through the whole
`about:blank` → Meta → callback navigation chain. Do not assume COOP
`same-origin-allow-popups` is sufficient: subsequent cross-origin navigations
have different matching rules from `window.open()` ([MDN navigation rules](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Opener-Policy#navigations)).
The callback also needs a no-store response policy instead of the static-asset
max-age policy. These are
release configuration gates; local tests do not validate deployed policies.
For local testing, the callback may be on a trusted HTTPS loopback origin that
the browser can reach and Meta accepts in its redirect allowlist. Webhooks still
need their narrowly exposed public HTTPS endpoint. Do not expose the local
passwordless app to the internet just to receive the browser redirect.

Personal linked-device groups use a distinct account lifecycle and native marker; see [Personal WhatsApp groups](WHATSAPP_LINKED_DEVICES.md). Existing Cloud API and Instagram contracts above remain unchanged.
