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
