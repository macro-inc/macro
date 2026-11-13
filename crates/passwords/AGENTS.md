# passwords

## What it is

Team credential vault hosted by document_storage_service. Postgres stores metadata
and grants; OpenBao stores credential values and TOTP keys. Server-side decryption
means this is a Macro-managed team vault.

## Start here

- `src/domain/models.rs`: public DTOs, zeroizing sensitive values.
- `src/domain/service.rs`: human membership, grants, administrator policy and retry recovery.
- `src/domain/ports.rs`: provider, metadata, lock and per-user rollout ports.
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

- Human admission evaluates `enable-passwords-v1` only for the authenticated user.
  Missing, disabled or failed evaluations deny requests; no service identity is evaluated.
  Local composition explicitly enables the user flag. Provider configuration remains required.
- Cleanup, reconciliation and trusted internal team purge never evaluate flags.
  Empty maintenance passes need no provider configuration; retained erasure work checks
  provider readiness and keeps its journals on failure.
- Require session origin and authoritative `User.isAgent=false`; session-shaped
  agent accounts never gain access through direct or team grants.
- Keep `Record.user_id` as immutable creator. New items get a team Edit grant
  unless `private=true`; updates preserve grants. Current human team administrators
  can access and manage private items after creator departure.
- Derive `canManage`, `canEdit` and `sharedWithTeam` only in `ItemView` responses; never
  persist actor-specific capabilities in metadata or write intents.
  `canEdit` uses current edit grants or administrator access; management remains
  creator/administrator-only, and view grants still permit reveal and copy.
- Mutations require `X-Macro-Passwords: 1`; responses use `private, no-store`.
- Username GET and audited username-copy POST resolve only the current committed
  identifier with normal human view authorization. Recheck access and revision after
  the provider read; never reconcile or return passwords, notes or custom fields.
  Automatic username GETs hold no mutation lease; explicit username-copy POSTs do.
  Reveal/copy, history and codes use normal authenticated human item access.
- Derive `shareCount` from distinct grant `(kind,id)` pairs already loaded with each
  record. Count a team grant once; do not fetch grants per list row or expand members.
- UUIDv7 `operationId` is stable across create/save retries. Pending metadata intents
  reconcile accepted provider writes after a lost response. Team vault locks serialize
  folders, grants and reveal with edits and deletion across replicas. Shared domain
  admission checks rollout and membership before any user lease; item access is
  rechecked under the lease. Contention returns typed `vault_busy`, distinct from
  `version_conflict`; clients retry only contention with a bounded jittered backoff.
- Every OpenBao call uses `openbao_client` generated API methods. Keep provider
  causes typed there and map narrowly to sanitized domain failures; never put
  response bodies in Debug, Display, error sources or tracing.
- Team namespace is `team-{uuid}`, KV mount `passwords`, TOTP mount `totp`;
  JWT role `macro/passwords-service` binds issuer, audience, subject and team ID.
- Value calls reuse a team's service token (`outbound/openbao/token_cache.rs`): one
  login per team per lease, single-flight, LRU-bounded, refreshed 15 s before the
  lease ends. A rejected cached token is dropped and the call retried once after a
  fresh login. `passwords.openbao.authenticate` spans mark real logins only;
  lifecycle (namespace purge) logins are never cached.

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

- Membership and account deletion never erase items or transfer creators. Current
  membership checks end access while values and creator metadata stay with the team.
- Close team admission under the current lease before namespace erasure; purge
  metadata only after acknowledgement and retain the team fence against delayed senders.
- Use existing owned-entity cleanup preflight: the caller proves empty metadata
  before skipping RPC. Any retained item, intent, enrollment or tombstone requires
  guarded internal team purge. Recheck empty under the existing team lease and
  retain its opaque guard through team deletion; release before RPC if data appears.
  Missing provider configuration or failed purge blocks ordinary cleanup effects.
- Retain bounded explicit item-delete retries and TOTP cleanup journals; jobs
  discover retained work independently of user flags and require provider readiness before erasure.
- Namespace cleanup uses parent JWT mount `macro-lifecycle`, per-team role
  `team-<team-id>` and exact namespace read/delete policy. Require GET 404 to
  acknowledge asynchronous erasure; never use runtime bootstrap credentials.
- Lock the actual publisher's membership row through write-intent publication.
  Recheck username, reveal/copy, history and codes after I/O; denied rechecks record
  `post_io_access_denied=true` and codes require the same active enrollment generation.
