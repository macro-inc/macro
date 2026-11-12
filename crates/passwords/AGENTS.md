# passwords

## What it is

Team credential vault hosted by document_storage_service. Postgres stores metadata
and grants; OpenBao stores credential values and TOTP keys. Server-side decryption
means this is a Macro-managed team vault.

## Start here

- `src/domain/models.rs`: public DTOs, zeroizing sensitive values.
- `src/domain/service.rs`: human membership, grants, administrator policy and retry recovery.
- `src/domain/ports.rs`: provider, metadata, lock and global rollout ports.
- `src/outbound/openbao.rs`: team JWT login, KV v2 CAS/history, TOTP.
- `src/outbound/postgres.rs`: metadata index, durable intents and transaction-scoped locks.
- `src/inbound/router.rs`: authenticated human routes, CSRF header, private no-store responses.
- `src/domain/agent.rs`, `src/domain/agent/service.rs`: bounded agent vault API
  (closed Login/API selectors, Agent grants, standing approval, requests, TOTP lifetime).
- `src/inbound/agent_router.rs`: agent routes at `/passwords/agent/teams/{team}` and
  the human review routes; `src/outbound/postgres/agent.rs` their storage.

## Scope

Owns password item entities, folders, grants and activity, and the agent vault API
the agent platform's `secrets` capability calls. No agent tools or UI.
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

- Every human use case, job and internal team purge uses `enable-passwords-v1`,
  evaluated for explicit service context `passwords-v1`. Human admission additionally
  requires the same key for the authenticated actor. Local explicitly enables both.
  Missing/error results in either evaluation and absent
  provider configuration deny work. Off pauses cleanup and retains every retry.
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

## Agent vault API

- Agents authenticate with their own user API key (`CredentialOrigin::UserApiKey`
  only) and an untrusted `X-Macro-Agent-Session-Id` UUIDv7 wake. Admission order:
  both `enable-passwords-v1` and `enable-agent-vault` in the `passwords-v1` service
  snapshot and the agent's own snapshot (off, missing or failed → `404`), then
  `AgentDirectory` (`403 invalid_agent`), wake (`400 invalid_session_attribution`),
  provider configuration presence (`503`), and only then catalog, policy, kind,
  provider I/O and post-I/O rechecks. Body errors surface only after admission.
- Composition wires `NoAgents`, which admits nobody, until the agent platform
  supplies the authoritative directory adapter.
- Use requires `G && (C || A)`: a current Agent grant, plus creator attribution or
  standing approval. Human, team and folder grants never count. A creator whose
  grant was revoked is `not_granted` even with a pending request.
- Agent grants live in the item's `grants` JSON as `kind: agent`. Human sharing
  rejects them as input, preserves them, and never lists or counts them.
- Agent create/update intents retain the agent, wake and action; reconcile commits
  metadata, that audit and intent completion in one transaction
  (`save_reconciled`), whoever reconciles. Agent TOTP setup retains the same on
  the enrollment and audits in the activation transaction. An operation id names
  one action and one item.
- Each agent use case runs under one 30-second `timeout_at` deadline from handler
  entry, after key extraction; reading the request body in axum is outside it, and
  it is no whole-network guarantee. Expiry is a sanitized `503`.
- Verification codes carry `validForMs` from the bracket `[t0 - 2s, t1 + 2s]`
  fitting one 30-second window; the 2 seconds is an operational provider/vault
  clock assumption, not a measured generation time.
- Committed request events go through `password_agent_access_events` (reviewers
  and item name frozen at commit, deferred with backoff on failure): reviewers get
  a `password_access_requested` inbox notification, the agent a private
  `passwords.access_request.resolved` hint on `macro.passwords`.
- **Rollout prerequisite:** released v1 binaries reject `kind: agent` grant JSON,
  even with the flags off. Before the first Agent grant is written, every binary
  that reads password records must include this change, and the rollback target
  must be one that does.

## Membership and deletion

- Membership and account deletion never erase items or transfer creators. Current
  membership checks end access while values and creator metadata stay with the team.
- Close team admission under the current lease before namespace erasure; purge
  metadata only after acknowledgement and retain the team fence against delayed senders.
- Use existing owned-entity cleanup preflight: the caller proves empty metadata
  before skipping RPC. Any retained item, intent, enrollment or tombstone requires
  guarded internal team purge. Recheck empty under the existing team lease and
  retain its opaque guard through team deletion; release before RPC if data appears.
  Off-existing fails before ordinary cleanup effects.
- Retain bounded explicit item-delete retries and TOTP cleanup journals; jobs
  gate before metadata discovery and provider work, and resume retained retries on enablement.
- Namespace cleanup uses parent JWT mount `macro-lifecycle`, per-team role
  `team-<team-id>` and exact namespace read/delete policy. Require GET 404 to
  acknowledge asynchronous erasure; never use runtime bootstrap credentials.
- Lock the actual publisher's membership row through write-intent publication.
  Recheck username, reveal/copy, history and codes after I/O; denied rechecks record
  `post_io_access_denied=true` and codes require the same active enrollment generation.
