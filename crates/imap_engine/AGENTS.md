# imap_engine

## What it is

The internal IMAP/SMTP engine. `domain` owns binding checks, credential promotion,
message identity, sync journals, draft versions and durable submission admission.
`inbound/http` is a thin authenticated axum adapter. `outbound` owns Postgres,
KMS and the pinned TLS mail transport.

[Upstream provenance and license](PROVENANCE.md) record the port source.

## Boundaries

Every operation is scoped by the link and both generations. Passwords remain
KMS ciphertext outside an immediate provider connection. The email domain owns
user authorization and verified sender identity; the internal engine never
accepts bearer access to a remote mail server.

## Checks

- SMTP reconnect tests generate ephemeral TLS identities with OpenSSL from the dev shell/CI.
- `cargo test -p imap_engine` with SQLX_OFFLINE unset and a migrated local database.
- `cargo check -p imap_engine`.
- Run `cargo test -p imap_engine real_tls_initial_scan_of_one_hundred_thousand_remote_messages -- --ignored --nocapture`
  for protocol-scale evidence against the task-owned Dovecot lab. It seeds a new
  unique 100,000-message mailbox over verified TLS with MULTIAPPEND, preserves it,
  and reports scan timing, metadata bytes and process RSS; no engine index is seeded.
- `domain/bounce/corpus.rs` exercises synthetic DSN, complaint and automated-reply MIME
  shapes offline. The per-host IDLE and folder-health tests run in the same crate.
- Read the [port coverage ledger](../../docs/design/imap-smtp-port-ledger.md) when
  comparing an upstream behavior or changing a recorded compatibility assumption.

## Gotchas

- Retain the original IMAP wire path for commands. The localized role resolver decodes
  modified UTF-7 for display and ranks explicit SPECIAL-USE flags above detected names.
- Fence optional watches, exclusions, role updates and server information to the
  current owner and both link generations. Reconnect advances the preference revision.
- A persisted Unknown submission is never dispatched again. A lost SMTP final
  response or a negative reply after DATA retains Unknown. Reconcile only the
  requested draft using one exact Message-ID in an existing Sent folder; never
  treat substring search hits as delivery proof or APPEND to prove an unknown send.
- Every sent draft id retains a readable fallback until the remote Sent copy
  is associated with it. Commit `sent_copy_attempted` before an APPEND-capable call;
  later reconciliation searches without another APPEND after an uncertain result.
  Keep Sent and Answered effects pending until their provider writes succeed.
- Resolve, block private addresses, pin the numeric socket, then validate the
  original TLS hostname. Local endpoint maps are composition-only and forbidden
  outside the local environment.
- Store mailbox metadata, locations and journals as link-scoped indexed rows in
  `imap_state_entries`. Use `StateSelection` for message, draft, upload, recent and
  cursor operations; reserve full metadata hydration for synchronization. Preserve
  the loaded-row checkpoint when saving so unrelated mailbox rows are retained.
  Use `save_health` when only account scalars changed; notification delivery must
  not hash the full mailbox index again.
- Treat destination UID zero as pending MOVE reconciliation. Never issue a remote
  command or MIME fetch for that placeholder; IDLE sync resolves it when COPYUID
  was unavailable.
- Keep the bounded full folder catalog for filing and role ancestry. Preserve the
  separate physical scan state (`monitored`) and framework feed admission (`syncEnabled`):
  excluded Gmail All Mail still supplies fresh metadata to its derived Inbox feed.
  Schedule at most 200 feeds from the 1000-entry catalog, prioritizing roles and owner preferences.
- Gmail scans All Mail, Spam and Trash and derives label feeds with shared header
  storage. Keep virtual feed locators on the physical All Mail path, preserve native
  ids and hash label membership in organization versions.
- Pass committed physical folder state into every IDLE watch. Compare SELECT's
  UIDVALIDITY, UIDNEXT, EXISTS and CONDSTORE watermark; consume unsolicited changes
  queued before the IDLE continuation. Use an absolute deadline independent of
  keepalives, and return WaitOutcome::Restarted for its normal completion.
- Spare IMAP and SMTP sockets belong to an exact link and both generations. Evict
  them on disconnect, failed commands and bounded idle/age maintenance. Keep each
  synchronization and IDLE cycle on a fresh independent connection.
- Check a pooled SMTP socket with bounded RSET before reuse. Retry a transport
  failure once on a fresh socket only before any message-body byte; keep the frozen send identity.
  Start the shared 60-second deadline at request admission and retain it through connection and envelope commands; skip a retry with less than 30 seconds left.
  Return typed `SendUnavailable` when neither attempt submitted message data.
- Drain STORE completion codes explicitly: RFC7162 `MODIFIED` means Conflict even
  when the tagged status is OK.
- Preserve the protocol source/literal limits. Run the ignored protocol tests against
  the local Dovecot lab and optional Stalwart profile for actual TLS interoperability,
  socket isolation, final-reply loss and Sent-copy reconciliation.

- Retain active local scheduler bindings before filling free capacity from
  unowned or expired accounts. A truncated candidate page is not the active
  account catalog; an actor that loses its first ownership claim must exit.
- Negotiate SMTPUTF8 for internationalized envelopes or MIME headers and
  8BITMIME for 8-bit data before sending MAIL. Unsupported capabilities are
  definite rejections; a lost DATA acknowledgment remains Unknown.

- Return a definite pre-DATA SMTP refusal immediately; discard its socket without
  waiting for RSET, so cleanup cannot turn rejection into an uncertain timeout.
- Classify explicit IMAP authentication response codes before diagnostic prose.
  SMTP authentication replies are separate from submission replies: 535 rejects
  credentials, temporary failures and transport closes never imply bad passwords.
  Trace closed stage/error fields only; never emit login commands or provider text.

Discovery and verification identities deserialize as the existing EmailStr;
borrow its validated Email through catalog, DNS and XML discovery. Keep raw
provider logins and SMTP envelope/MIME addresses as protocol strings: Macro's
ASCII sign-in parser cannot represent every SMTPUTF8 sender. Never normalize
case or plus suffixes when deriving a protocol username.

The engine accepts authenticated, lifecycle-fenced bindings without rollout
switches. The email host owns the existing user-scoped enrollment flag; sync,
send and organization operations never depend on a PostHog response.

Record final SMTP attempt/outcome span fields once after settlement; expected pooled-session probe failures log at WARN. An expired admission wait cannot establish a prior send outcome.

Passive provider hints use only the catalog and bounded domain-only MX lookup.
Never run identity-bearing HTTP autoconfig for a first-visit suggestion; unknown,
failed or ambiguous MX evidence leaves provider choice to the user.

Admission has separate user (16), live ingestion (4), import (2) and sync pools.
Worker read jobs use ingestion/import classes; API settings, user commands,
draft materialization and sends keep the interactive client. Keep one awaited
round per actor and FIFO sync admission; never lower account coverage to reduce
queue length. `SyncConcurrency::DEFAULT` is a typed code-level limit of 2;
tuning is a follow-up with no new environment setting.
Renew ownership every 60 seconds while queued and recheck it after admission.
Include state loading in the 240-second work budget, leaving cleanup headroom in
the five-minute command lease. Admission spans record final wait/outcome;
scheduler ticks also emit aggregate saturation spans before queued waits finish.
Cancelled waiters must release their count and permit.

Transient owner-heartbeat errors leave the current round running and retry at
the next heartbeat. Confirmed ownership loss cancels provider work cooperatively
and drains command-lease cleanup; acquisition completes before that cancellation
is observed so its returned lease can be released.

Keep command claims uncommitted through state hydration, with local statement
and idle-transaction deadlines. Use FOR NO KEY UPDATE NOWAIT so peers fail fast
without blocking first-owner foreign-key checks. Full sync idle time follows the
round budget; small read snapshots keep a short idle limit. Reserve the listener's
one connection before admitting loads (pool max minus three), leaving two shared
non-loading slots without claiming dedicated heartbeat capacity.

Read Changes, Message, Organization, Attachment, Folders and RecentInbox through
read_scoped without a command lease. Keep scalar state and selected rows in one
REPEATABLE READ READ ONLY transaction, commit before provider/MIME IO, then
validate the original owner, active state, reauth and both generations again.
A read Account has no lease_id; save, save_health, renew and release must reject
it. Draft reads remain leased because they may reconcile an uncertain send.

Limit pooled command sessions to three per endpoint/login per replica; keep
socket reuse generation-fenced and retain the permit through publication/drop.
Return AccountBusy promptly at saturation. Retry eligible reads and pre-write
Apply operations once after one second outside global admission and without a
DB snapshot; never queue account waiters while retaining user slots. Scan, IDLE setup and leased Sent reconciliation use
independent sessions. The quota is not distributed and excludes those owner/Sent
sockets. Give read transactions local statement/idle deadlines and gate post-IO
validation with other loads.

Retry only typed AccountBusy once outside global admission. Apply may expose
that signal only before its first provider write; map busy follow-up work to
reconciliation/unavailability so it cannot replay the mutation. Never retry
Submit through this mechanism. Keep MessageTooLarge distinct (HTTP413), reject
known oversized sources before fetching, and defer busy/oversized RecentInbox
items individually rather than restarting the batch or returning partial MIME.

Organization writes return ApplyError::NotStarted only before command-session
admission; every failure afterward is Uncertain. Never promote a post-write busy
error into a retry. RecentInbox retries only deferred bodies once outside global
admission and reports AccountBusy when the whole requested batch remains busy.

Arm transport response budgets explicitly at every command: metadata 16 MiB,
catalog/SMTP reply 4 MiB, full source/header batch 26 MiB. Pooled command
sockets retain per-response limits; fresh sync, IDLE and verify sockets retain
a 512 MiB connection ceiling. Synchronization shares a 512 MiB wire budget
across reconnects and bounds retained metadata to 256 MiB and each folder to
250,000 UIDs. Target header batches at 4 MiB, shrinking on overflow down to one.
Keep the independent 25 MiB literal and 32 MiB line guards. IMAP borrowing commands use limit_response; IDLE arms before moving the
session, and plaintext STARTTLS exchanges arm each reply. Never infer boundaries
by inspecting outgoing login or authentication payloads.

Abort an oversized snapshot without publishing a partial index. Preserve the
last complete account view, publish the separate size issue, and persist an
exponential retry deadline from one hour to twenty-four hours. Check it before
provider work across wakeups/restarts; successful sync or manual reconnect clears
it. Fenced folder-preference changes clear only the deadline, allowing one fresh
attempt without forgetting repeated failures. Folder parking belongs to the stacked paging work and must budget old indexes.

Treat IncorrectKey, missing/disabled/configured-key errors, service failures and
unparseable decrypted documents as transient. InvalidCiphertext qualifies as
CredentialsUnreadable only with this process's recent same-context known-good
ciphertext, still decryptable through the current alias to the same key ARN.
Exclude verification-only ids from the account sample. Keep proof and distinct-account observations bounded to 2048 accounts/ten
minutes. Auto-parking requires at most five percent verified unreadable accounts;
fewer than twenty observed accounts therefore never auto-park. Emit the bounded
classification counter and fleet-guard error; never log credentials/key/context.
Confirm qualified failures across thirty seconds before parking with the separate
mailbox issue. Re-admit parked pending notifications after restart and deliver
before credential/provider work; completed parking remains excluded.

A very large first import can exceed the account snapshot bounds and never finish
until the owner excludes large folders. Keep the last complete index and expose
the typed size issue with durable backoff. `enable-imap-connections` defaults off;
resumable paging and incremental scans belong to stacked follow-up
`mac-imap-smtp.23`, not this initial bounded-snapshot implementation.

Report row-lock and command-lease contention as AccountBusy so a due send never
inherits provider-throttle pacing. A pre-body refusal returns a typed command
phase and recipient position, never an address or raw reply; abandon the whole
recipient envelope before DATA. Clear the Unknown fence before returning a
definite refusal, and never persist the new rejected response outcome.

Retry durable host notifications independently of provider scans and IDLE. Retain
no command lease or database connection during the bounded callback; clear pending
only after an ACK for the observed revision. Drain the fenced save on shutdown.
A callback outage must never freeze provider synchronization.
