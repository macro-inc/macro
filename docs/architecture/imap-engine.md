# IMAP and SMTP engine

The private `imap_service` connects existing user-owned mailboxes to Macro.
`email_service` remains the public API and owns account authorization, verified
sender identity, entitlements, connection reservations, mailbox projections and
commands. See [email backend](email-backend.md) for the shared mailbox workers.

## Boundaries and credentials

`imap_engine::domain` owns the closed operations, identity and journal rules,
credential binding, draft versions and submission admission. Its ports describe
persistence, credential encryption, provider transport, discovery, settings and
notifications. Axum handlers authenticate an internal key and decode a link with
both sync and grant generations. PostgreSQL, KMS, DNS and mail sockets live in
outbound adapters. `imap_service` composes the adapters and scheduler.

The email domain authorizes connect and reconnect against the signed-in owner's
verified address before credentials reach the engine. Verification produces an
expiring owner-bound token; promotion binds it to exactly one link. Concurrent
or retried public connections use durable reservations and provider conflicts
cannot silently replace an existing Gmail or Outlook inbox. Generation changes
fence old commands, settings edits and connection owners.

Passwords are encrypted with a dedicated KMS key and encryption context bound to
the owner, link and credential purpose. They are absent from ordinary email link
models, settings responses and logs. The service client reuses redacting source
models in its generated API. Disconnect removes credentials and provider state;
old notifications and receipts cannot revive the link.

## Mail transport and state

Transport resolves and validates every remote address through the shared
`egress_guard` classifier, pins the selected numeric socket and verifies TLS
against the requested server name. IMAPS and SMTPS use implicit TLS; IMAP143 and
submission587 require STARTTLS before authentication. Discovery supplies proposed
possible endpoints. Owners confirm their hosts before either login. After both
logins succeed, the credential record also retains a closed list of negotiated
IMAP capabilities, SMTP extensions, the verification time and the advertised
SMTP size limit. The owner settings view exposes these facts without server
banners or credentials. An older record gains these fields on reconnect.

Connection ownership is a renewable database lease, separate from the bounded
operation lease. This lets separate HTTP replicas serialize changes without
waiting for a long-lived IDLE connection to finish. Every repository operation
checks the link and both generations. Folder/message identifiers and associations
are account-scoped. A durable per-folder journal feeds Macro's existing stream
reconciliation. MIME is retrieved lazily and parsed with explicit size/depth
bounds; a corrupt message must not prevent the next message from synchronizing.

Drafts and uploads are engine-side staging. Sending persists admission before
SMTP side effects. Explicit 4xx/5xx refusals before DATA fail the attempt. A
negative or lost final response after the body remains Unknown rather than
being retried as a fresh send. SMTP telemetry records only phase and reply class.
Pooled SMTP sessions receive a three-second RSET check before reuse. A transport
failure before any message-body byte gets one fresh-connection retry using the same frozen MIME
and send identity. Admission, connection setup and envelope commands share one 60-second
deadline; a retry needs at least 30 seconds remaining. DATA transmission and its
final reply share the absolute six-minute deadline from admission and remain
uncertain on failure or expiry. Submit is tracked independently of the HTTP
request. The composition root supplies its tracker and shutdown token explicitly;
shutdown refuses unadmitted sends while preserving any prior sticky outcome.
Its first command-lease renewal is after sixty seconds; a concurrent heartbeat
bounds each database renewal at ten seconds, so it cannot stop polling SMTP or
its single transport deadline. Renewal failures are counted and logged while
SMTP continues, since Unknown already prevents resending. A
stale final save cannot overwrite newer state. HTTP and tracked-work shutdown
share thirty seconds, below the ECS stop timeout; a process cut-off retains
Unknown. Exhausted pre-body connection failures return the closed
`SendUnavailable` category: the email coordinator fails that attempt visibly,
clears its submitting marker, and releases later work on the same link. A generic
HTTP 503 or timeout does not carry this certainty and remains an uncertain send.
The durable code remains `send_rejected`; an optional `send_rejection_reason`
checkpoint field carries the shared closed reason and is persisted before terminal
settlement. Recovery of that fact fails the attempt without reading or submitting
again. HTTP/GraphQL status adds an optional reason without changing existing issue
enum values. Only the current send-rejection issue projects that reason; a
deliberate retry or another failure does not expose an old checkpoint reason.
The optional `send_refusal` detail adds a closed sender/recipient/message phase,
reply class, and the refused recipient's zero-based position in the frozen To,
Cc, then Bcc envelope. It contains no address or provider text. A recipient refusal
abandons the entire envelope before DATA, including any earlier accepted RCPTs.
The owner UI resolves the position against its existing message recipients.
Frozen aggregates and every recipient read sort each type by contact_id; the
(message_id, contact_id, recipient_type) primary key makes that order total.
There is no stored typed-entry order: recipients now display in deterministic
contact-id order instead of an arbitrary physical order. A checkpoint whose
revision differs from the current draft projects no recipient refusal detail.
The engine returns a typed rejection but clears the Unknown fence before saving;
it never persists a new submission-outcome value that an older binary cannot read.
Only a current `send_rejected` issue projects the detail. Old checkpoints have none.

A queued send's server acceptance is distinct from SMTP acceptance. A client-side
stall timer never infers delivery uncertainty; only the server's actual unconfirmed
outcome may display that warning. Local account row-lock or command-lease contention
returns `AccountBusy`, not provider `Throttled`; the internal client preserves a
provider Retry-After header or body hint. Local draft retries start at five
seconds and double to a sixty-second ceiling across claims; a defaulted checkpoint
count survives worker restarts and clears on progress. Provider pacing remains
unchanged (generic provider/host limits keep a sixty-second floor). A local admission failure at Submit atomically resets
the Ready checkpoint and schedule processing/start markers under the command
lease before releasing for that short retry; only proven pre-IO failures may
clear those markers. The `email.mailbox.draft` span
records the stage, due-time lag, retry seconds and closed error kind.

The [refusal and retry query plans](../design/imap-submission-refusal-query-plans.json)
cover the changed projections, recipient ordering, fenced reset and reused claim
locks with synthetic local data. The fixture is below production size; unchanged
attachment-side joins are not scale-seeded, so no production latency is claimed.

Legacy rows have an unknown reason. A permit wait that expires before inspecting
the prior durable submission remains a generic connectivity failure. SMTP attempt
and outcome span fields are written once at completion; stale-probe errors log at WARN. The current UI reads this detail
from its existing HTTP status query; existing GraphQL fragments stay unchanged.
Read-only reconciliation targets the requested draft and requires one exact
Message-ID header in Sent; substring search hits, duplicate IDs and a missing
Sent folder cannot establish delivery. Reconciliation never APPENDs evidence.
The engine
associates the remote Sent copy with the stable draft identity and preserves a
readable fallback until association succeeds. Bcc belongs in the SMTP envelope
and must not be exposed in delivered MIME.

The owner settings surface exposes sanitized endpoints, detected folder roles,
manual role overrides, exclusions and one optional extra watched folder. The
catalog retains up to 1,000 listed folders. Ordinary accounts monitor up to 200
eligible folders, prioritizing Inbox, watched folders and routing roles. Settings
show the monitoring choice from the latest completed pass alongside the owner's
current exclusions. Changes
use optimistic revision checks. INBOX cannot be excluded or reassigned. Another
account's opaque folder identifier cannot be used as a routing destination.

The web enrollment and settings dialogs propagate the user interaction's trace
through discovery, verification and folder configuration requests. Span
attributes use the opaque link ID when available. The transport records the HTTP
method, path and status. Server names, addresses, bodies and credentials stay
out of these spans.

## Configuration and operation

- `enable-imap-connections` is the single user-scoped rollout flag for the
  public offer, discovery, verification, connect and reconnect.
- Established synchronization and authorized sends, moves and deletes run
  independently of PostHog. Ownership, active/reauth state, generations,
  leases and explicit pause/disconnect/delete controls remain authoritative.
- `INTERNAL_AUTH_KEY` authenticates private engine HTTP calls. Bootstrap it to
  the same value as email_service's `EmailInternalApiKey`: the shared key
  authenticates both host-to-engine calls and engine-to-host callbacks.
- `IMAP_CREDENTIAL_KMS_KEY_ID` selects the dedicated credential key.
- `IMAP_TEST_ENDPOINT_MAP` and `IMAP_TEST_TRUST_ROOT_PEM` support local verified
  TLS fixtures and are rejected outside `Environment::Local`.

The internal service uses private discovery, dedicated mail egress subnets and a
least-privilege credential key policy. Its deployment registration remains
`bootstrap_pending` until the private network and environment configuration are
provisioned. Building this change does not provision or enable production.

[The protocol lab](../../docker/imap-lab/AGENTS.md) supplies independent Dovecot,
SMTP capture and optional Stalwart fixtures. The Rust engine tests exercise
protocol behavior; `email_e2e` exercises public authorization, durable workers,
projection and submission. The browser IMAP profile exercises the existing Email
and settings UI against the local engine. Generated internal API contracts are
updated with `bash crates/imap_service_client/regen.sh`; `--check` detects drift.

Mailbox projection refreshes mounted readers independently of notification
policy, before slower contact and indexing effects. Import completion is queued
once per generation with its durable completion marker, including empty
imports. Gateway failures retry the projection; clients coalesce refreshes and
catch up on reconnect.

Enrollment and password-free discovery use the existing validated Email/EmailStr
identity types. Discovery retains the submitted spelling and plus suffix through
catalog and XML username selection after a case-insensitive ownership check.
Enrollment uses the actor's existing canonical identity; catalog domain matching
is case-insensitive. HTTP
identities reject surrounding whitespace rather than implicitly trimming.
Provider usernames, SMTP envelopes and received MIME headers remain raw protocol
strings, including SMTPUTF8 addresses outside Macro's ASCII sign-in grammar.
Persisted protocol credentials are checked at the settings/discovery boundary.

IMAP correspondence uses the distinct `imap` contacts inbox list while preserving
legacy contact edges. Apply the additive list-key constraint migrations and update
every contacts worker and directory reader (including document_storage_service)
before publishing that queue value. The existing contacts
list-publication flag remains independent of IMAP enrollment and mailbox work.

Passive enrollment suggestions recognize hosted custom domains through bounded,
domain-only MX queries. This adapter has no HTTP/autoconfig client. Unknown,
failed, over-limit or ambiguous primary MX answers retain the generic chooser;
full address-bearing discovery remains an explicit setup action.

Admission reserves independent FIFO pools for user operations (16), live ingestion
(4), older-mail import (2) and synchronization (default 2). Worker composition
classifies stream providers, background settings scans and maintenance jobs
through the optional internal `x-imap-work-class` header. API settings, user
commands, draft materialization and sends retain their interactive client.
Authentication, ownership and both generation fences apply to every class;
absent headers retain interactive behavior for old callers.

Each account actor awaits one round before enqueuing another. Existing account
ownership/coverage remains unchanged. `SyncConcurrency` validates 1–16 at
construction; its typed code default stays at 2 for the existing task memory
budget. There is no new environment setting. An owner heartbeat renews every
60 seconds while queued or executing, and ownership is checked atomically again
after admission, before state loading or provider IO. A lost owner skips the round.

The 240-second cooperative work budget includes owner validation, state loading,
provider IO, merging and checkpointing after admission. It derives from the
five-minute command lease with 60 seconds reserved for fenced cleanup. Real
Postgres tests pin the command and owner lease durations. The expensive sync slot
is released before cleanup; release still uses the exact command lease fence.
Admission spans record class, queue depth, elapsed wait and final outcome,
including cancellation. Scheduler ticks emit aggregate saturation spans while
a class has queued work and no free permits, so monitoring does not wait for the long-lived wait span
to finish; completed waits of at least 30 seconds also warn.

Worst-case new-mail delay grows with accounts per replica multiplied by observed
round duration, divided by sync slots, plus provider/database overhead and retry
backoff. The queue does not promise constant latency as account count grows.
Increasing concurrency requires memory/round measurements; reducing account
coverage is not a substitute. The stacked H3 paging change reduces round duration
and permits durable progress for large initial imports.

Graceful shutdown cancels provider work, drains command cleanup and releases
the owner lease before a replacement starts. A crash cannot perform that cleanup:
its command and owner fences remain until their five- and six-minute expiries.
A failed watcher drain also retains ownership until expiry to avoid overlapping
sockets. The real-Postgres restart regression cancels a stalled round and proves
a replacement reaches provider work without waiting for lease expiry.

Transient owner-heartbeat errors leave the current round running and retry at
the next heartbeat. Confirmed ownership loss cancels provider work cooperatively
and drains command-lease cleanup; acquisition completes before that cancellation
is observed so its returned lease can be released.

State hydration and its command claim share one transaction, committed before
provider IO. Loading cancellation rolls the claim back. A primary-key NOWAIT
non-key lock makes competing claims fail promptly without blocking first-owner
foreign-key checks. Statements have a 30-second deadline; full sync hydration's
idle backstop follows its 240-second admitted work budget, including CPU work.
The loading semaphore admits seven simultaneous loads from the production
pool's ten connections: the configuration listener holds one, and two remain
shared by heartbeats, saves and cleanup. Those two are not dedicated reservations.

The [owner-renewal plan record](../design/imap-owner-renewal-query-plans.json)
measures the heartbeat caller against synthetic large tables, including actual
renewal/takeover updates rather than empty matches.

The [acquisition-lock plans](../design/imap-acquisition-lock-query-plans.json)
cover existing and missing keys under fresh/stale statistics; the peer-lock
regression separately verifies NOWAIT and rollback with real concurrent transactions.

### Consistent reads during synchronization

Changes, Message, Organization, Attachment, Folders and RecentInbox use a
lease-free scoped snapshot. Scalar health and selected catalog/index rows share
one repeatable-read, read-only transaction, committed before lazy MIME/provider
IO. Reads therefore continue while synchronization holds its command lease.
Before returning any provider result the engine rechecks the loaded owner,
active link, reauth and both generations. Revision advances from concurrent sync
alone do not revoke a consistent read.

Read snapshots carry no command lease. Persistence, renewal and release reject
that capability; only mutating operations obtain a lease. Draft access remains
leased because recovery may reconcile a previously uncertain submission.
Real-Postgres tests cover a writer commit between scalar/row reads and a blocked
MIME fetch with the sole database connection available to other work.

The [scoped-read plan record](../design/imap-scoped-read-query-plans.json)
measures the indexed binding/owner lookup for both snapshot and post-IO validation.

Per endpoint/login and replica, at most three pooled command sessions may be
in flight, shared across links and reconnect generations. Reusable sockets stay
link/generation-fenced; another scope's idle sockets are closed before a new
dial. Global idle retention remains 64 sockets. Saturation returns AccountBusy
promptly. Eligible reads and pre-write Apply operations retry once after one
second with their global slot and snapshot already released; continued contention
then surfaces as a local busy failure.
This keeps a slow account's waiters from occupying user slots for other accounts.

Sync scan, IDLE setup and Sent reconciliation use independent fresh sessions;
Sent work is serialized by its existing command lease. These paths do not wait
for body-read permits. This is not a distributed connection quota: command
totals grow across replicas, and independent owner/Sent work adds sockets;
owner leases bound actor sockets only. Read snapshots use local 30-second
statement and 10-second idle deadlines; post-IO validation shares the loading
gate. Operation access classification is exhaustive.

Before arming IDLE, the actor reads its committed catalog state without holding
an account command lease or database connection across provider IO. The transport
compares SELECT's UIDVALIDITY, UIDNEXT, message count and CONDSTORE watermark with
that physical folder baseline. Gmail watches compare the All Mail feed rather
than its filtered derived-feed counts; an extra derived-feed watcher compares
physical watermarks while skipping its filtered count. Excluded folders do not repeatedly compare
a deliberately stale snapshot. A changed status returns immediately for a new
sync. Unsolicited changes received before the IDLE continuation are consumed too,
closing both delivery windows around IDLE setup.

Planned primary and extra-folder IDLE renewals re-arm the cheap SELECT/watch
without a full scan. An actual change, configuration wake or thirty-minute
periodic walk requests synchronization. Watcher setup reads only the scoped
catalog, without a command lease or a second discovery/login session. Without
IDLE, SELECT comparison runs every thirty seconds and uses HIGHESTMODSEQ when
CONDSTORE is advertised. UIDNEXT still detects new Spam and Trash arrivals.
While polling without CONDSTORE, remote read/unread and flagged changes can wait
for the periodic walk, up to thirty minutes. This applies when IDLE is unavailable
or a saturated host has no watch slot; it is the trade-off for avoiding full
scans on quiet accounts. New mail remains detectable through UIDNEXT and counts.

Each replica owns at most 150 actors and admits at most 25 new actors per
thirty-second scheduler tick, retaining its already-owned bindings. Per-host
watch admission is separately capped at 150 of the connector's 200 sockets,
leaving 50 available to commands and verification. A primary or extra watch
without a slot uses the cheap SELECT comparison every thirty seconds and
retries IDLE admission next round; new mail can take up to thirty seconds under
host saturation. Poll sockets close before the wait and do not occupy the
reserve as idle cached connections. These limits are local to each replica.

An actor's initial round still performs a full scan after a process restart.
New-actor admission paces that wave; avoiding or spreading it further remains
follow-up `mac-lcie`.

An absent or refused physical baseline returns BaselineUnavailable. Recovery
scans back off from thirty seconds, doubling to thirty minutes. That wait is
covered by the owner heartbeat and holds no command lease, so submissions and
mailbox actions remain admitted. A process restart resets this in-memory ladder;
a valid baseline resets it immediately.

The watch interval is an absolute deadline, independent of server keepalives.
A planned deadline completes DONE and LOGOUT and returns WaitOutcome::Restarted;
it is not false connection-drop evidence or failure backoff. Actual changes
return WaitOutcome::Changed. The separate 300-second outer timeout remains a
backstop for stalled protocol IO. The imap.idle.wait span records the closed
outcome and whether a change was detected while arming, without folder names.


### Busy admission and deterministic content limits

Only AccountBusy permits the bounded one-second retry outside global admission.
Other throttles and unsupported content never enter that retry. Apply can retry
only before its first provider mutation; any busy follow-up after that point
returns unavailability for reconciliation, without replaying the action. Submit
is excluded. The private edge returns 429 with Retry-After for AccountBusy; the
email gateway preserves it as a local refusal without provider cooldown.

MessageTooLarge is a separate permanent content failure (private HTTP413),
matching the existing 25 MiB full-source limit. Known oversized sources are
rejected from indexed RFC822.SIZE before any download; actual response length
is checked too. RecentInbox handles busy and oversized messages independently,
keeps successful complete bodies, and records deferred/oversized counts. It does
not refetch the entire batch or pass header-only MIME off as complete content.

Organization-write ports distinguish NotStarted admission refusal from Uncertain
provider work. Only the former can expose retryable AccountBusy. A recent-inbox
batch retains completed bodies and retries only deferred items once after
releasing global admission; a still-all-busy batch reports a busy failure rather
than an empty success. Public source/attachment failures preserve ContentTooLarge
as HTTP413 with code message_too_large; the web client presents fixed size-limit
copy and one capped Retry-After retry for ordinary email mutations, never sends.

Loading spans record selected row count and encoded component bytes, reusing
checkpoint serialization rather than serializing the rows again. These bytes
measure loaded metadata, not network transfer. Closed acquisition outcomes
separate lock contention, an existing lease, a stale fence, statement timeout,
idle timeout and other unavailability; database text and row content are omitted.

### Per-command transport accounting

The stream meters bytes per explicitly armed protocol response, rather than
closing a healthy pooled connection after 512 MiB of lifetime reads. IMAP
commands declare a 16 MiB metadata, 4 MiB catalog, or 26 MiB full-source/header-batch budget;
SMTP framing arms a 4 MiB reply budget. IDLE and plaintext STARTTLS boundaries
are explicit too. No credentials or outgoing command payloads are inspected.
The 25 MiB literal and 32 MiB line guards remain independent. Source spans
record response bytes and lifetime connection read bytes as counts only.

A synthetic TLS regression reads thirty 20 MiB sources over one pooled socket;
separate stream tests reject a single oversized response, literal, or line.
Lifetime accounting is not a daily transfer budget or resumable backfill. Those
remain in the stacked synchronization follow-up.

### Snapshot safety and oversized folders

Fresh sync, IDLE and verification sockets retain the 512 MiB connection ceiling.
Sync also shares a 512 MiB application-byte allowance across replacement sockets,
including discarded oversized responses. Pooled command sockets use per-command
limits instead. The snapshot retains at most 256 MiB of MIME/header and message
metadata, and refuses a folder with more than 250,000 UIDs before fetching headers.
The UID count is a defensive allocation bound, not a promised mailbox capacity or
a value derived from average header size; the number remains subject to review.
Header batches target 4 MiB using observed header sizes. An unexpectedly larger
response discards its socket and halves the batch down to one header, preserving
the cumulative sync budget. The literal and line limits remain independent.

An oversized monitored folder aborts the complete account snapshot: publish
nothing and retain the last complete index, including the previous inbox view.
The visible issue is "Mailbox too large to sync yet"; new Inbox mail also waits
when another monitored folder exceeds the bound. Gmail All Mail supplies derived
feeds and is subject to the same limit. Gmail is offered its API integration
first, while app-password access remains a user choice. The 250,000-UID cap is
pending confirmation. A first import can therefore fail to finish for a very
large mailbox even though its credentials are valid. The user-scoped
`enable-imap-connections` flag defaults off; resumable paging, minimal header
fields, incremental forward scans and folder parking are tracked in the stacked
follow-up `mac-imap-smtp.23`. This PR does not implement that core sync rewrite.

Size failures persist a growing retry deadline: one, two, four, eight, sixteen,
then twenty-four hours (capped there). Repeated sync wakeups, restarts and other
replicas check that deadline before decrypting or opening a provider connection.
Successful sync and manual reconnect reset it. A fenced folder-preference change
clears only the deadline, allowing one immediate attempt while preserving the
failure count if the new scope still exceeds the limit. Actors wait for the remaining
window; ordinary requests may still read the last complete index. Folder parking
is deferred to the stacked incremental-sync work: it must charge retained old
indexes to an account-wide persisted-state budget and preserve progress when the
shared wire allowance is exhausted. Resumable paging and backfill remain there.

Size health is independent of authentication. An optional typed issue is carried
with its optional retry timestamp in the generation-fenced engine notification,
projected to nullable email_links columns and an
edge-triggered LinkChanged outbox event. Unknown future codes receive generic
health guidance. Successful complete sync clears the account issue. The inbox list and selected empty-inbox view show account issues even when
generic sync badges are disabled. Retry guidance uses the projected timestamp
formatted in the interface locale; older notifications without one make no
timing promise. Neither condition implies a rejected password.

[Sync-health query plans](../design/imap-sync-health-query-plans.json) measure
exact projection/catalog/reconnect/preference statements against synthetic
10-million-contact, 1.1-million-outbox and 110,000-link tables. Custom and generic
plans with stale and analyzed statistics use selective indexes, including real
conflict updates. The largest measured owned inbox set is 32; the fixture does
not claim an unbounded inbox catalog is paginated. PostgreSQL 18 results do not
replace compatibility checks on the production database version.

### Saved credential recovery

IncorrectKey, missing/disabled keys, service/policy failures and decrypted documents
that cannot be parsed remain transient. This includes key/alias configuration
mistakes and rollback to a binary that does not understand a newer document.
InvalidCiphertext qualifies as `credentials_unreadable` only if this process has
recently decrypted this binding with the identical context and a known-good
ciphertext still decrypts through the current alias to the same returned key ARN.
The cached proof contains ciphertext only, never plaintext, and is bounded to
2048 accounts with a ten-minute lifetime.

A process-local fleet guard counts distinct successfully decrypted permanent accounts in that window (verification-only ids are excluded) and permits
parking only at or below five percent verified unreadable. Replicas observing
fewer than twenty accounts never auto-park; the user's **Change login details**
action remains available. A damaged credential must qualify repeatedly across
thirty seconds before parking. Cold starts, an expired proof, a failed canary,
or an active fleet guard retain ordinary backoff. Never mass-reconnect accounts
in response to a KMS configuration incident.

The existing `needs_reauth` lifecycle gate requires reconnect; the optional mailbox
issue explains why. Unreadable saved credentials never set `credentials_rejected`,
which remains reserved for provider authentication refusals, and do not stamp
the provider-refusal timestamp. Pending fenced health callbacks survive restarts:
the scheduler admits parked pending bindings, the actor delivers before decrypt
or provider work, and completed parking is excluded. Verified reconnect preserves
the link, advances generations and clears the old issue/deadline.

Decrypt spans contain only `available`, `unreadable` or `unavailable` outcomes.
Each bounded `imap.credentials.classification` span is one counter sample;
`monitors/imap-credentials.ts` declares unreadable/fleet-guard SpansMetrics,
a dashboard, and non-paging spike/guard monitors. No mailbox/key/context dimensions
are exported. These definitions are code only and require a separately approved
deployment. On a spike, check KMS availability, alias/ARN and context/configuration
changes before recommending reconnect; never replay user credentials.

The changed reconnect-health and scheduler queries have measured plans on
110,000 synthetic links/accounts and 22,000 live owners:
[credential-health query plans](../design/imap-credential-health-query-plans.json).

## Legacy mailbox-work provider routing

Work provider columns use constant Outlook defaults without rewriting existing
heaps. Streams were Outlook-only; legacy reconciliation can include Gmail
cleanup. Derivation triggers read each immutable link's provider for old and new
inserts; link-id foreign keys retain ownership. Reconciliation claims relabel
at most 64 mismatches in their due window and return maintenance progress. This
also handles rows that become due later, so no repair job, dedicated connection
or completion marker is needed. A corrupt wrong-provider stream is parked
without changing routing; the trigger and provider immutability exclude this
state from normal writes. Recovery can re-park unsupported corruption once per
five-minute wrap without adding another index.

The [routing runbook](../runbooks/email-provider-routing.md) records one-time
transition costs and the preserved preview's migration-history limitation.

## Host catch-up after restart

The engine's snapshot persists a pending host hint before delivery. A separate
account task retries one bounded callback at a time with five-second exponential
backoff capped at sixty seconds, independently of provider scans and IDLE. It
retains no command lease or database connection during HTTP. An ACK clears the
pending bit only under the original binding and observed state revision; a newer
snapshot keeps its hint. A successful ACK is remembered while local contention
prevents its fenced clear, avoiding repeated HTTP callbacks for that revision.
The earliest pending time persists in the small account JSON state, so a new actor
does not reset the alert age. Legacy rows without it use the current actor's age
until the next durable change. Routine ownership loss stops delivery cleanly.
Shutdown drains the bounded callback and fenced save.

Notifications carry an optional engine revision. The host records the last health
revision under its sync and grant generations and ignores reordered older health
while retaining the stream wake. Old unversioned senders remain accepted for a
mixed rollout or rollback; generation changes begin a new revision scope.

Only the email pubsub worker requests startup catch-up. A global database lease
and saved UUID cursor serialize fleet recovery, coalescing worker boots for five
minutes. Each page examines at most sixteen streams, including up to eight due
deferred ids. Locked or failed rows enter a bounded-backoff queue; deleted and
ineligible ids are retired. The steady-state thirty-second cycle uses a partial
index of unconsumed notification revisions, so an idle cycle does not scan every
account. The dedicated catch-up pool adds one connection per worker replica;
normal sync uses its existing pool. Statements are bounded to fifteen seconds,
individual wake transactions to one second, and no provider I/O occurs in a page.

Claims capture the current notification revision. Successful commits and local
error releases cannot consume a newer wake. Startup catch-up always bumps the
revision, including when a lease is already in flight; steady-state catch-up
leaves already-due work in its existing queue position without another write.
A provider retry floor is separate: every claim enforces it, so even an older
writer moving the due timestamp cannot shorten it. The claim that honors an
expired floor consumes it. Import pacing remains separate and unchanged.

Resync returns the latest future Inbox/catalog deadline in its typed response; Mail
settings says “Paused by your provider until …” instead of claiming work started.
A verified reconnect carries the latest persisted future floor into the new
generation's catalog. A changed password clears credential/size health without
cancelling provider pacing. Provider deadlines are recorded on resync/activation
spans as Unix milliseconds. Missing-mailbox probe delays remain local backoff,
not a provider rate limit.

The `imap.host_notification.flush` span reports attempt count, pending age and
closed outcomes. `email.imap.catch_up` reports scanned, woken, deferred and failed
counts plus deferred age and attempts. Code-only non-paging monitors flag pending
callbacks or deferred work older than five minutes. Inspect callback status,
worker availability, the singleton cursor and deferred counts; never clear
cursors, provider floors or pending hints to silence an alert. Callback failure
does not stop engine ingestion; catch-up recovers host projection without relying
on another provider change.

A reconnect racing a stale-generation provider release can miss that newly
recorded floor and cause one early retry against the provider limit. No mail is
lost or duplicated. Serialized handoff is tracked in `mac-zn2o`.

[Restart catch-up query and migration evidence](../design/imap-restart-catchup-query-plans.json)
covers 36 statements and 1,488 plan executions, with custom/generic plans and
fresh/stale statistics on 100,000 synthetic links and about one million streams.
It includes the production-major PostgreSQL 14 migration rehearsal on one million
links and five million streams: constant defaults did not rewrite the heaps;
concurrent index builds allowed writes. Waiting metadata DDL can queue new reads
until its five-second lock timeout, even before obtaining its exclusive lock.
These are local measurements, not production timing claims. Inherited wide-link
claim fallback and reimport costs are compared with the previous head in the
report; the new floor lookup uses a bounded full-key lateral join.
