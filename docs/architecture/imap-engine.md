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
deadline; a retry needs at least 30 seconds remaining. Body IO lies outside that
deadline and remains uncertain on failure. Exhausted pre-body connection failures return the closed
`SendUnavailable` category: the email coordinator fails that attempt visibly,
clears its submitting marker, and releases later work on the same link. A generic
HTTP 503 or timeout does not carry this certainty and remains an uncertain send.
The durable code remains `send_rejected`; an optional `send_rejection_reason`
checkpoint field carries the shared closed reason and is persisted before terminal
settlement. Recovery of that fact fails the attempt without reading or submitting
again. HTTP/GraphQL status adds an optional reason without changing existing issue
enum values. Only the current send-rejection issue projects that reason; a
deliberate retry or another failure does not expose an old checkpoint reason.
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
- `INTERNAL_AUTH_KEY` authenticates private engine HTTP calls.
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

Transient owner-heartbeat errors leave the current round running and retry at
the next heartbeat. Confirmed ownership loss cancels provider work cooperatively
and drains command-lease cleanup; acquisition completes before that cancellation
is observed so its returned lease can be released.

State hydration and its command claim share one transaction, committed before
provider IO. Loading cancellation rolls the claim back. A primary-key NOWAIT
non-key lock makes competing claims fail promptly without blocking first-owner
foreign-key checks. Statements have a 30-second deadline; full sync hydration's
idle backstop follows its 240-second admitted work budget, including CPU work.
The loading semaphore leaves two of the production pool's ten connections for
all non-loading queries, including heartbeats and cleanup; they are shared.

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
