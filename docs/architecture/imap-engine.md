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

- `enable-imap-connections` gates the public offer, connect and reconnect.
- `enable-imap-sync` and `enable-imap-writes` independently gate background work.
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
