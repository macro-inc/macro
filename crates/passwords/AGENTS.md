# passwords

## What it is

Team credential vault hosted by document_storage_service. Postgres stores metadata
and grants; OpenBao stores credential values and TOTP keys. Server-side decryption
means this is a Macro-managed team vault.

## Start here

- `src/domain/models.rs`: public DTOs, zeroizing sensitive values.
- `src/domain/service.rs`: membership, grant, recent sign-in policy and retry recovery.
- `src/domain/ports.rs`: provider, metadata, lock, reauthentication and rollout ports.
- `src/outbound/openbao.rs`: team JWT login, KV v2 CAS/history, TOTP.
- `src/outbound/postgres.rs`: metadata index, durable intents and transaction-scoped locks.
- `src/inbound/router.rs`: authenticated human routes, CSRF header, private no-store responses.

## Scope

Owns password item entities, folders, grants and activity. No agent tools or UI.
Do not add plaintext values to any metadata record, errors or tracing fields.

## Checks

- `cargo test -p passwords` with a migrated disposable MacroDB, `SQLX_OFFLINE` unset.
- `cargo check -p document_storage_service` verifies composition and OpenAPI registration.
- `just prepare_db` refreshes root SQLx metadata after query changes.
- `python3 -m unittest discover -s infra/local/openbao -p 'test_*.py'`
  verifies real OpenBao namespaces/JWT/CAS/TOTP; see its README for local settings.
- Drain pool connections between independent lease assertions in database tests:
  SQLx queues rollback on transaction drop. Use a completion barrier, never sleeps.

## Gotchas

- Every human use case checks `enable-passwords` and current team membership; hosted
  evaluation is remote and Local uses an explicit development snapshot. Cleanup
  continues independently of rollout so disabling the feature cannot strand seeds.
- Only human session credentials are accepted. Secret responses additionally verify
  signed FusionAuth `auth_time` within five minutes; refresh does not extend it.
- Mutations require `X-Macro-Passwords: 1`; responses use `private, no-store`.
- Return typed `reauthentication_required` with HTTP 403 for stale sign-in; keep
  HTTP 401 for invalid sessions so token refresh does not repeat stale disclosures.
- Username GET and audited username-copy POST resolve only the current committed
  identifier with normal human view authorization. Recheck access and revision after
  the provider read; never reconcile or return passwords, notes or custom fields.
  Automatic username GETs hold no mutation lease; explicit username-copy POSTs do.
  Password reveal/copy and verification codes still require recent sign-in.
- Derive `shareCount` from distinct grant `(kind,id)` pairs already loaded with each
  record. Count a team grant once; do not fetch grants per list row or expand members.
- UUIDv7 `operationId` is stable across create/save retries. Pending metadata intents
  reconcile accepted provider writes after a lost response. Team vault locks serialize
  folders, grants and reveal with edits and deletion across replicas. Shared domain
  admission checks rollout and membership before any user lease; item access is
  rechecked under the lease. Contention returns typed `vault_busy`, distinct from
  `version_conflict`; clients retry only contention with a bounded jittered backoff.
- All vaultrs futures run with `NoSubscriber`: upstream rustify traces raw provider
  error response bodies. Keep sanitized outer provider spans outside that scope.
- Team namespace is `team-{uuid}`, KV mount `passwords`, TOTP mount `totp`;
  JWT role `macro/passwords-service` binds issuer, audience, subject and team ID.

Run both ignored Rust provider tests against a disposable local OpenBao with
`PASSWORDS_TEST_OPENBAO_ADDRESS`, `PASSWORDS_TEST_OPENBAO_SIGNING_KEY` (private
PEM file path), `PASSWORDS_TEST_OPENBAO_PUBLIC_KEY` (public PEM file path), and
`BAO_TOKEN` and `DATABASE_URL` set explicitly: `cargo test -p passwords -- --ignored`.
The test creates synthetic team namespaces with the local bootstrap script.

Vault writes, protected disclosure and username-copy actions hold a nonblocking
team-scoped advisory lease. Automatic username reads use a revalidated committed
snapshot; metadata reads hold no leases and fetch no values. Keep the metadata-only operation
journal: it prevents operation ID reuse from creating unaudited secret versions.
KV deletion advances CAS and destroys values while retaining provider metadata;
this fence prevents delayed pre-delete requests from recreating credentials.

TOTP setup stages a unique enrollment UUID before writing its seed. The active
pointer changes atomically only after setup succeeds; replacements and removals
retire prior generations. Activation and user removal compare the authorized
metadata revision before changing any enrollment, so a sender that loses its lease
cannot replace or remove a newer generation. Unconditional retirement is restricted
to deletion tombstones. DSS runs the tracked cleanup worker every minute.
Under the vault lease, the first cleanup pass quarantines an unreferenced generation
for 180 seconds. Later passes erase it and retain its journal tombstone for hourly
repeated erasure, covering responses or senders that resume after losing a lease.
A live item's current active pointer always excludes its generation from cleanup.

Configure OpenBao's maximum request duration at no more than 90 seconds and service
tokens at a 60-second maximum TTL with JWT validation leeway disabled. Keep hosted
clocks synchronized. Do not shorten the 180-second quarantine without reviewing
those provider bounds. Retain journal identities; acknowledging deletion does not
prove a suspended sender can never resume.

Construct one shared `PgRepository::new(pool)` for the service. Its nonblocking
admission semaphore limits lease transactions to half the pool and leaves capacity
for metadata queries. Every full-record save checks both provider version and
metadata revision, so losing a lease cannot restore stale grants or TOTP pointers.

## Membership and deletion

- Keep departure policy in `domain/lifecycle.rs` and transaction SQL in
  `outbound/postgres/lifecycle.rs`; the membership adapter holds the team lease.
- Fence affected records reversibly at membership commit. Pending records return
  typed `vault_busy` only after normal grant checks; keep unauthorized items opaque.
  Only saga completion publishes private erasure and marks
  the removal finished in one transaction. Rollback restores the original grants
  and ownership without erasing values. Never transfer private values.
- Close account admission by immutable account UUID, and close team admission
  before namespace deletion. Purge metadata only after provider deletion is
  acknowledged; retain the closed identity to reject suspended senders.
- Prioritize first erasure/quarantine before hourly repeats. Retain journal
  tombstones for the lifetime of the namespace, including acknowledged erasures.
- Namespace cleanup uses parent JWT mount `macro-lifecycle`, per-team role
  `team-<team-id>`, and exact namespace read/delete policy. Require GET 404 before
  acknowledging asynchronous provider deletion. Never use a bootstrap token at runtime.

- Lock the actual publisher's membership row through write-intent publication so
  revocation's scan includes every admitted intent. Share the post-I/O disclosure
  recheck across username, reveal/copy, history, and codes; record denied rechecks
  with `post_io_access_denied=true` and reject retired TOTP generations.
