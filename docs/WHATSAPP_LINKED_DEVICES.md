# Personal WhatsApp groups in native Macro channels

This companion to [#7981](https://github.com/macro-inc/macro/pull/7981)
adds personal linked devices underneath the existing native messaging pipeline.
Seven independently owned accounts can explicitly adopt one existing group into
one workspace channel. Each deliberate send uses the authenticated human's own
verified account. There is no colleague account picker, business fallback or Matrix.

## Data and authority

DSS owns human authorization, workspace bindings, native audience grants, canonical
messages, private documents and publication. `meta_messaging::MessagingService`
drives both the existing Meta adapters and the personal transport through the
same durable send state machine. The Go service owns WhatsApp sockets, pairing,
protocol state, encrypted local journals and media transfer. Its DB role can read
account identity/generation and write only ownership and scalar outcomes.

Personal accounts belong to stable Macro users, independently of workspaces.
Bindings are unique by workspace and remote group. Adoption is serialized; an
existing private binding is returned only to an existing authorized viewer.
Creating a native audience grant does not consent another person's device to
observe. Each person explicitly connects their account and adopts the group.
Each binding keeps its own adoption/consent history boundary. One account may
adopt groups across workspaces without granting either workspace the other's data.

A linked endpoint necessarily receives account-wide WhatsApp protocol traffic.
Only explicitly adopted groups enter Macro's content journal. Unrelated chats are
dropped before content, documents, search or analytics; unavoidable protocol keys,
retry buffers and identity mappings remain in that account's isolated private
store. The connection dialog explains this distinction.

Canonical source identity is `(binding, verified external person, source ID)`.
Verified PN/LID aliases resolve the person; names and similar text never do.
Ambiguous/unresolved aliases are quarantined with bounded deferred retries.
Seven observations converge on one native message, one attachment reservation
per ordinal and one revision/outbox identity. Macro accepted replies and phone
echoes converge using the preallocated source ID. Phone-origin activity retains
external provenance, optionally associated with the verified Macro user.

## Native access and content

The native `whatsapp_linked_group` discriminator gates channel reads, posting,
participant enumeration, search/Soup source expansion, document source grants and
notification list/retry/final delivery. Ordinary channels do not perform personal
account or session lookups. Current native participation, workspace membership,
explicit native audience and verified remote membership are required for group
access; remote roster updates never create native audience grants. Removing one
person's access leaves the other authorized people usable. Temporarily offline
sessions do not erase permitted history.

Group-derived document access is revoked with the source group. Existing owner,
direct, team and independently granted channel access keep their ordinary native
meaning. Public links alone cannot expose imported originals. This is source-grant
revocation, not an assertion that separately authorized copies or owners can be
retroactively deprived of information. Delete-for-everyone removes the source
channel grant and leaves permanent source tombstones; unrelated grants are not
removed. Native content ownership is explicit. When its owner loses authority,
new materialization waits for a current manager to accept ownership of future
files; old documents are not silently reassigned.

Implemented content: UTF-8 text up to 16 KiB, canonical quoted replies, incoming
and deliberate outgoing reactions, edits and deletes. Outbound edits/deletes
require the current account's own message and use a conservative ten-minute
window; remote rejection remains possible. Supported private files are capped
at 32 MiB each: JPEG/PNG/WebP, Ogg/MP3/MP4/AAC audio, MP4 video, PDF and plain text.
One outgoing attachment is supported per deliberate send. Ogg/Opus attachments
with a verified Opus identification header use WhatsApp voice-note mode. Audio captions require
a separate text message. Native viewers and private storage handle files; no
public staging URL is created. Failed media keeps useful text and an actionable
placeholder and retries the same reservation without overwriting ready bytes.

View-once and disappearing messages are placeholders, without archived content.
Groups enabling disappearing messages or unsupported community modes suspend
content retention and sending. Other unsupported protocol shapes get a readable
placeholder while supported accompanying text is preserved. Private chats,
community announcements, newsletters, broadcasts, status and calls are outside
this surface. The existing Cloud API group path and Instagram remain separate.

Reading in Macro only changes native per-user unread state. No remote read receipt
is sent. Participant receipts are stored separately from server acceptance and
never treated as proof that everyone in the group received/read the message.
Historical/replayed facts, edits and receipts do not issue new notifications.
Phone-origin messages can notify the other currently permitted native viewers.

## Delivery and process ownership

Account authorization generation changes with explicit consent retirement;
worker ownership epoch changes with physical process replacement. They are not
interchangeable. The durable intent records actor, personal account/generation,
binding/order, exact approved content, digest, deadline and allocated source ID.
Unattempted work expires ten minutes after enqueue using database time. Slow
preparation is followed by renewed channel, document and personal-account checks.
Bot/API-key submissions are refused. There is no automatic internal posting.

The adapter records `dispatching` before physical submission. Duplicate commands
return their durable outcome. A timeout/crash after submission is `unknown`, never
an automatic new send. A later server result/echo can settle the retained source
ID, including after account retirement. This is not exactly-once remote delivery.
A deliberate new send after uncertainty is visibly new and warns that the previous
message may already have arrived.

Each account runs in a separate supervised child process. Expired leases are
insufficient to transfer ownership: the prior process must terminate and `Wait`
must complete. DB/control loss kills and reaps the worker. Graceful service shutdown
joins workers and retirement before closing PostgreSQL. Crash/stall cases whose
physical termination cannot be established deliberately block reacquisition.

A minimal scalar `whatsapp_transport_outcome` ledger retains command/source ID,
generation and outcome without credentials or bodies. After physical termination,
retirement exports encrypted outcomes before deleting a revoked generation's live
DB/WAL/key files. A durable nonsecret `retirement.json` marker retries failed export
on periodic cleanup, result lookup and next start; it never launches the old sender.
The marker plus durable ownership proof is required. Connected-generation restarts
keep their protocol stores. Backups follow the separately configured retention policy.

Per account: 4,096 pending events / 64 MiB, 128 active commands, 256 MiB media,
32 MiB per transfer and two concurrent media transfers. The control process caps
children at 32. DSS content processing is bounded to eight accounts concurrently;
consent/control renewal has an independent worker so slow media cannot stop leases.
Allowlist leases last 30 seconds and require renewal; group snapshots refresh
periodically and before sends. Snapshot timestamps reflect request start, not
completion; competing observer updates serialize. Verified self-removal is a
scoped negative fact even when fetching the full roster is no longer possible.
Command payload copies are pruned after seven days, media after 24 hours; scalar
idempotency/outcomes and canonical deletion tombstones remain for replay safety.

## Pairing and desktop authentication

Pairing is an authenticated, short-lived owner-bound transaction. Status polls are
safe after completion; continuation replay is refused. Cancellation/expiry fence
consent and retire the worker independently of a browser. Reconnect must match
its retained verified identity. Replacement is explicit and requires fresh group
consent. A verified identity cannot be stolen by a different Macro user.

QR generation is local. Pairing DOM is excluded from PostHog replay using its
`ph-no-capture` class. Secrets are no-store, not URL parameters, and absent from
persistent frontend query caches. A browser passkey step links to Macro desktop
using only the expiring flow identifier; the receiving desktop reauthenticates
its owner before fetching any challenge. The ID alone is not a capability.

The Tauri command authenticates the actual WhatsApp challenge, fixes the WhatsApp
origin/RP boundary and requires user verification. It uses the pinned Beeper
`webauthn-authenticator-rs` fork directly: caBLE on macOS/Linux, native Windows
WebAuthn on Windows. Authentication runs with upstream tracing suppressed; only
scoped IPC UI events return a temporary code. iOS/Android native helpers return an
explicit unsupported capability and browser users can finish in desktop. macOS
Bluetooth permission is declared. Actual passkeys, OS prompts, Bluetooth/tunnel
behavior and Windows/Linux packaging still require the real-device qualification
below; compiling an implementation is not proof of a working physical authenticator.

## Live testing on localhost

The linked-device service can run beside a named Macro local stack. It does not
require a cloud deployment or public webhook: the WhatsApp worker establishes an
outbound connection. LocalStack can provide the KMS API, with dummy AWS credentials,
so a paid AWS account is not required for local testing.

Use the existing [local-stack workflow](development/running-locally.md), a separate
instance and the current branch's server binaries. Supply the linked switches,
client certificate and CA through `--env-file`; enable the frontend with
`VITE_ENABLE_WHATSAPP_LINKED=true`. Preserve any existing instance's databases and
volumes. An old instance whose checkout was removed needs its binaries and generated
configuration rebuilt before it can serve the app again.
Restart an existing preview through its saved Compose configuration; rerunning
`run_local` reinitializes its instance. An existing development bundle can be served
with `vite preview --mode development` to avoid hot-reload overhead.

Run the session executable on the host with `AWS_ENDPOINT_URL_KMS` set to that
instance's exposed LocalStack endpoint, `AWS_ACCESS_KEY_ID=test`,
`AWS_SECRET_ACCESS_KEY=test`, and `AWS_REGION=us-east-1`. Create a dedicated local
KMS alias and use the restricted database role below against the local MacroDB.
Keep its SQLCipher state in a private persistent directory. The default local
stack does not persist the emulator's KMS key material across recreation/restart:
preserve or restore that state separately, or explicitly re-pair after losing it.
Creating the same alias again does not recover existing encrypted session keys.
Generate local TLS certificates; when DSS runs in Docker and the session executable runs on the host,
use `https://host.docker.internal:<session-port>/` as the service override and
include `host.docker.internal` in the server certificate's SANs. Both sides still
authenticate with mTLS.

Once the local app and session service are running, sign into the local Macro
account and use Settings → WhatsApp → Connect. The user scans the QR. Any required
passkey step needs a desktop build from this branch pointed at the same local
backend and signed into the same local user. The regular production desktop cannot
resume a localhost pairing: the handoff carries the flow ID, not a backend override.
The desktop navigation allowlist accepts `http://localhost:3000` through
`http://localhost:3009`; use one of those origins for its frontend and proxy to the
same named backend instance. Live pairing and messages require that explicit user
action; a running local stack alone does not establish real WhatsApp delivery.

## Operator setup and rollout

No real account, remote message, group mutation or deployment is part of automated
verification. Keep all switches off until infrastructure, licensing review and
real-account checks are approved. `services-config.json` marks the Go service
bootstrap-pending and disables automatic Rust deploy machinery. This is a separate
Go container with an opt-in persistent-host compose definition, not a Rust binary
or a public gateway route.

1. Apply the additive MacroDB migration through the normal migration process.
2. Provision one private persistent host and encrypted volume/backups owned by UID
   12001. Start with one supervisor. Account stores cannot be independently copied
   to a second live host. Create the DB LOGIN through secrets management and apply
   `services/whatsapp_session/deploy/control-role.sql` as an administrator.
3. Provision a dedicated KMS envelope key and IAM `GenerateDataKey`/`Decrypt`
   permissions bound to the service role and encryption context. SQLCipher encrypts
   every protocol/journal DB page and WAL with a per-account/generation data key;
   only the KMS-wrapped key is stored next to it. RAM in the endpoint necessarily
   contains decrypted protocol state. Host disk/backup encryption is additional.
4. Issue server TLS and a **dedicated DSS client CA** that issues only the service
   identity. The Go listener requires TLS 1.3 and a verified client certificate.
   Give DSS the client certificate/private key and server trust CA. Configure the
   private DNS/default service URL or the typed URL's process override
   `OVERRIDE_WHATS_APP_SESSION_SERVICE_URL`. Do not expose the control listener publicly.
5. Build the pinned container using `services/whatsapp_session/Dockerfile`, record
   its immutable digest, and run the opt-in `deploy/compose.yaml` with operator-owned
   env, TLS and state paths. Set the private bind IP explicitly if DSS is on another
   host; restrict its firewall to DSS. No automatic deployment is configured here.

Go service configuration (all required; use either `APP_SECRETS_JSON` or process
environment, never mixed service-key fallbacks):

| Key | Value |
| --- | --- |
| `WHATSAPP_CONTROL_DATABASE_URL` | Restricted role, TLS to MacroDB |
| `WHATSAPP_KMS_KEY` | Dedicated KMS key ARN |
| `WHATSAPP_SESSION_DIRECTORY` | `/var/lib/whatsapp` |
| `WHATSAPP_TLS_CERT`, `WHATSAPP_TLS_KEY` | Private mounted server certificate/key paths |
| `WHATSAPP_CLIENT_CA` | Dedicated DSS client CA file |
| `WHATSAPP_LISTEN` | `:8128` inside the private container |

AWS region/instance-role configuration and standard `OTEL_EXPORTER_OTLP_*` process
settings use their SDK conventions. Never place message or protocol identifiers
in metric labels. Safe traces correlate opaque account/command IDs; upstream
protocol logging is disabled. Monitor oldest pending/deferred event, stale group
facts, missing owner/lease, unknown send, accepted/unmaterialized intent, media
reservation age and unpublished native revision counts. Alert on retirement export
failures and a sustained all-observers-offline condition; do not log row payloads.

DSS configuration is loaded once at startup from MacroConfig. Add optional values
to `cloud-storage-service` dev/prd and local secrets through the normal operator
process. The local BootStub defaults keep it off:

- `WHATSAPP_SESSION_CLIENT_IDENTITY_PEM`: combined client certificate/private key.
- `WHATSAPP_SESSION_CA_PEM`: server trust CA PEM.
- `WHATSAPP_LINKED_PAIRING_ENABLED`, `WHATSAPP_LINKED_ADOPTION_ENABLED`,
  `WHATSAPP_LINKED_SENDING_ENABLED`: each exactly `true` or `false`, default false.
- Frontend `enable-whatsapp-linked` flag (local build fallback
  `VITE_ENABLE_WHATSAPP_LINKED=true`) reveals Settings/adoption UI.

Roll out the server switches independently. Disable sending first during an
incident, then new adoption/pairing if needed. Keep the configured session adapter
available while accepted results and native publication drain. Turning flags off
does not convert linked channels into internal channels or erase history. Restart
DSS to apply startup configuration changes. The new native helper ships with the
desktop binary; an old desktop must update before passkey handoff can succeed.

## Recovery

| Condition | Procedure |
| --- | --- |
| Temporary socket failure | Keep consent/generation; the fenced same-generation owner reconnects, refreshes group facts and drains its retained journal. Do not ask for a fresh pairing solely for a network error. |
| Remote logout/invalid credentials | Fence generation, stop observation and unattempted sends, ask the owner to reconnect explicitly. Check WhatsApp Linked devices if remote unlink was not confirmed. |
| DB partition/owner crash/stall | Fail closed. Restore DB connectivity, prove process/container/host termination, then repair only that owner row to terminated through an approved operator operation. Never steal a running row on lease age alone. |
| Retirement KMS/export failure | Restore KMS/DB; retained marker retries read-only export, then purges revoked live stores. Do not erase the marker/key first. |
| Backup restore | Stop/fence every old process before restoring. Preserve monotonic consent decisions and unknown intents; reconcile current WhatsApp identity/device/group state. If consent or current keys cannot be established, require explicit re-pair, never re-send unknown work. |
| Protocol incompatibility | Disable new sends; retain journals. Pin a reviewed upstream revision and repeat socket cancellation, ambiguous send, identity and native tests before restarting. |
| Stalled media | Inspect safe reservation/error categories, restore storage/RPC access and replay the same source reservation. Do not recreate a message or overwrite ready bytes. |
| Native owner removed | Suspend materialization/new grants; a permitted manager explicitly takes ownership of future files in Participants. |
| All observers offline | Existing permitted history remains available; synchronization is delayed. Restore an existing consented session or ask its owner to reconnect if credentials are invalid. |

## Licensing and pinned source

whatsmeow is pinned at `b2b1e71d45e2ff171153b025b5a42f475bb30ef8`
(`v0.0.0-20261017175727-b2b1e71d45e2`). The native authenticator fork is pinned at
`579f9144d37161bedf25ed1236d73486ce303de6`. See the service's
[third-party notices](../services/whatsapp_session/THIRD_PARTY_NOTICES.md), copied
license texts and module checksums. No mautrix-whatsapp connector/converter code
was copied. The inspected wrapper was reference material only.

The maintained MPL patches cover per-request disconnect retry control, physical
writer retirement, protocol-part failure propagation, grouped-receipt failure
aggregation and a bounded history parser. The supported manual-history path
withholds ordinary/history/peer acknowledgements until allowed content is durable;
it keeps a private cursor and completion marker, stable source-derived event IDs,
and acknowledged-ID deduplication so capacity failures resume without reimporting
a prefix. Compressed history is capped at 32 MiB and expanded history at 64 MiB;
one history handler per account runs with a 45-second deadline and at most 32
unfinished cursors. Oversized histories fail closed, without deleting their
remote blob. It is required by `go.sh` and the Docker build;
compilation checks its safety marker. Upstream #1226/#1284/#1285 were still open
at implementation review. An upstream update must re-evaluate whether the patch
can be removed and rerun the physical websocket writer regression.

**Release decision required:** whatsmeow's MPL does not erase its GPL-3.0 libsignal
dependency. Normal legal/release review must approve the exact service artifact,
corresponding-source/notice obligations, native fork and distribution model before
shipping. No exception, license compatibility determination or WhatsApp approval
is asserted. Implementation does not establish provider authorization or long-term
account safety. This prerequisite is separate from the technical verification.

## Verification and user qualification

Executed commands and limitations are recorded in
[WHATSAPP_LINKED_VERIFICATION.md](WHATSAPP_LINKED_VERIFICATION.md). Automated tests
use synthetic identities, an isolated MacroDB, encrypted local stores, a controlled
child process and browser routes that block external network destinations.

For the user/operator's real-account qualification (do not automate these effects):

1. Seven humans connect seven real accounts through Settings. Exercise QR, a
   passkey-required flow, confirmation, cancellation/expiry and browser-to-desktop
   return. Verify another logged-in desktop cannot continue the first person's flow.
2. Use one **already-existing group with at least nine total participants** including
   an external customer. Explicitly review workspace/native audience and have each
   account adopt it. Confirm one native channel and no unrelated DM/group import.
3. Each person sends distinct text, quoted reply and supported media deliberately
   from Macro. Inspect every actual sender on the external participant's phone.
   Repeat phone-origin text/media from all seven and the customer; verify one native
   timeline item/file/effect and correct external origin.
4. Exercise reactions, edits, deletes, missing quote targets, partial media failures
   and unsupported/disappearing/view-once content. Verify native viewers, search,
   per-user unread and authorized notifications; Macro reads must not mark every
   WhatsApp account read.
5. Restart the service and interrupt a controlled send after submission. Confirm
   unknown remains unknown until evidence arrives and no automatic fresh send occurs.
   Exercise temporary offline/reconnect and all observers offline.
6. Remove one remote member, revoke a native audience grant and workspace membership,
   disconnect and replace one account, and remove the native content owner. Verify
   timeline/search/document/queued-notification boundaries and that other permitted
   senders continue. Verify replacement cannot submit a previous account's draft.
7. Check desktop/mobile layouts and real macOS/Windows/Linux authentication devices.
   Record OS/native app version, pinned service digest and observed outcomes. These
   results qualify only the tested configurations, not every WhatsApp group maximum.
