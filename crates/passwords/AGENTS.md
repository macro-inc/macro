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
- `src/outbound/openbao/signer.rs`: the ES256 `JwtSigner` seam; `KmsJwtSigner` in
  deployed and local stacks, `LocalJwtSigner` in tests only.
- `src/outbound/postgres.rs`: metadata index, durable intents and transaction-scoped locks.
- `src/outbound/postgres/update_record.sql`: guarded update that locks the row by
  primary key and updates it by ctid (a Tid Scan; no team-wide index scan under
  stale statistics). `test/update_plan.rs` pins the plan. A concurrent change after
  the statement snapshot is not re-checked, so every writer of a live item must
  bump `revision`.
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
- Run the opt-in `import_performance` test with `PWCONC_MODE=after`, explicit
  disposable OpenBao settings, and `DATABASE_URL` pointing to the local
  `macrodb_pwconc` scratch database. It exports to the existing local collector
  and prints timing, pool pressure, token retry counts and trace IDs. Use a
  JSON-file Docker log driver for the fixture: journald can rate-limit its
  redacted audit events during the sweep. Reproduction and audit summarization:
  `src/outbound/postgres/import/test/benchmark.md`.

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
- Favorites are private human preferences in `password_item_favorites`, projected
  in one bounded lookup for list/match responses and one for detail. PUT/DELETE
  `items/{item}/favorite` needs view access, no credential lease, version change
  or shared Activity entry. Initial create/import seeds only the creator's star;
  later credential saves never seed again. Item soft deletion clears preferences;
  physical item deletion and member removal cascade through foreign keys.
- Mutations require `X-Macro-Passwords: 1`; responses use `private, no-store`.
- Missing provider username slots resolve as empty strings; malformed values still
  fail. Username spans record `empty`, `present` or `failed`; HTTP failures warn
  with fixed error codes and status, never values.
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
- Login JWTs are ES256, signed through `JwtSigner`. `KmsJwtSigner` hashes the
  signing input locally, sends only the SHA-256 digest (`MessageType::Digest`),
  and converts KMS's DER signature to JWS `r || s`. There is no fallback signer
  and no private key in config: `PASSWORDS_JWT_KMS_KEY_ID` is a key ARN, an alias
  only locally. One `Sign` per real login (`passwords.jwt.sign` span), so the
  token cache bounds KMS calls to about one per active team per 40 seconds.
- Value calls reuse a team's service token (`outbound/openbao/token_cache.rs`): one
  login per team per lease (clamped to 60 s), single-flight (waiters get the
  failed login's error), refreshed 20 s before the lease ends. Idle slots are LRU-evicted past
  1024 teams; a slot with a caller is never evicted. A 401/403 on a cached token
  replaces it once and re-runs the whole operation, so every `with_session`
  closure must be safe to re-run. A denied fresh token is policy: no retry, no
  eviction. `passwords.openbao.authenticate` spans mark real logins only;
  operation spans carry `cache_hit` and `token_retry`. Lifecycle (namespace
  purge) logins are never cached.
- Nothing here creates namespaces. A missing one at team login (and only there) is
  `Error::NotProvisioned`: HTTP 409 `vault_not_provisioned` (agent routes too), import item code
  `vault_not_provisioned`, authenticate span `outcome=not_provisioned`. Locally,
  `just passwords_provision` creates them (see `infra/local/openbao/README.md`).

Run the ignored Rust provider and import tests against a disposable local OpenBao with
`PASSWORDS_TEST_OPENBAO_ADDRESS`, `PASSWORDS_TEST_OPENBAO_SIGNING_KEY` (P-256
PKCS#8 private PEM file path), `PASSWORDS_TEST_OPENBAO_PUBLIC_KEY` (public PEM file path), and
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
  both `enable-passwords-v1` and `enable-agent-vault` in the agent's own per-user
  snapshot, never its owner's (off, missing or failed → `404`), then
  `AgentDirectory` (`403 invalid_agent`), wake (`400 invalid_session_attribution`),
  provider configuration presence (`503`), and only then catalog, policy, kind and
  provider I/O. Authority is rechecked after provider reads (disclosure, codes and an
  update's own read); writes are authorized when staged and are not retroactive. Body
  errors surface only after admission.
- Composition wires `NoAgents`, which admits nobody, until the agent platform
  supplies the authoritative directory adapter.
- Human review routes require the reviewer's own snapshot of both keys; request
  event delivery, like the other vault jobs, evaluates no flags.
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

## Agent runtime contract

What an agent runtime must do with `macro.passwords.forAgent(team, { wake })`
(`packages/sdk/src/entities/passwords/`). The SDK classes stay `@mcp-exclude` and
carry no `@routing`/`@agent`, so code mode neither lists nor loads this area; a
platform change that gives agents their own authority turns this section into
those tags and a code-mode catalog entry.

- **Prerequisites:** the agent's own user API key (code-mode credentials,
  `MacroApiJwt` or `ScopedMacroApiJwt`, are refused); `enable-passwords-v1` and
  `enable-agent-vault` on the agent's own account; an `AgentDirectory` that admits
  it (composition wires `NoAgents`, so today nobody is); and a fresh UUIDv7 wake
  per wake, never reused.
- **Vault first:** on a sign-in wall or a missing credential, `vault.search(query)`
  before asking a person. It lists team-shared items, items granted to the agent and
  items it created, metadata only. An item neither shared with the team nor granted to
  the agent never appears; one made private later stays visible while the agent keeps
  its grant.
- **Status:** `access.status` is `usable` (use it), `request_access` (ask first) or
  `pending` (asked, undecided); use fails `pending` only while a request awaits review,
  otherwise `not_granted`. `grantPermission` names the current Agent grant, which is no
  authority on its own: after an approval-only revoke it stays while use is refused.
- **Request:** `item.requestAccess(permission)` (`view` or `edit`) asks the human
  creator and the team's admins, deduplicated per item and agent while pending:
  asking again returns that request unchanged, with its original permission. Then
  wait for `passwords.access_request.resolved` (`teamId`, `itemId`, `requestId`,
  `status` `approved | denied | revoked`), a hint that grants nothing, or read
  `item.accessRequest()` sparingly; its state is the truth.
- **Denial:** on `denied` or `revoked`, tell the person and stop; never retry. A
  denial blocks new requests for an hour, and new requests are limited to 20 an hour
  per agent and team (`REQUEST_LIMITS`).
- **One field:** `item.disclose(selector)` returns one login (`username`,
  `password`) or API (`key`, `secret`) field for immediate use. Hand `value` only to
  a sink the runtime supplies (the SDK has none); never put a value or code in chat,
  messages, documents, logs, errors, program results or model context.
- **Verification codes:** `item.verificationCode()` returns `code` and `validForMs`.
  Hand `code` only to the runtime's sink, like a disclosed value, and never return it.
  It is good for `validForMs` minus the time since the request was sent, rounded up; if
  that is not positive when the code is entered, or the code is rejected, fetch a new
  one. Never cache a code or reuse it. Enrolling a seed (`setVerificationSeed`) needs
  `canSetTotp` (the creating agent with edit) on a Login item.
- **Create:** `vault.create` stores a Login or API credential only, always with a team
  Edit grant and the agent's own grant; there is no private option. Reuse one
  `operationId` across retries; updates take `expectedVersion`.

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

## Imports

`src/domain/service/import.rs` imports at most 25 normalized items and 200 source
folders per batch; `src/inbound/import.rs` exposes the session-only 4 MiB route.
Include referenced source folders and ancestors in parent-first order in every batch. UUIDv7 import ids
and opaque source keys derive stable item, folder and target ids. Retries use the
ordinary create recovery path; existing folders retain their current name and
parent, and an existing TOTP enrollment is never replaced by an import.
Per-item failures use fixed codes (`busy` for lease contention, `folder_missing`
when a folder was deleted before that item's create validation); a failed TOTP setup
returns the created item id so retrying can finish enrollment. Admit one team
lease for folder setup and all item futures; recheck membership for each item
when it starts. Validate distinct derived item IDs before sharing that lease.
Keep create and TOTP ordered within each item. Bound concurrency
by `IMPORT_CONCURRENCY` and `Repository::import_capacity` (pool size minus its
lease connection), and return results in input order. Other writers remain
excluded for the whole batch; do not replace the team fence with item locks.
`POST /teams/{team}/items/match` takes up to 500 names in the body (never a
URL), already trimmed and lower-cased by the client, and returns visible
metadata whose `lower(name)` equals one, for the client's duplicate check. Both routes answer a malformed JSON body with the fixed
`invalid_request` failure, never serde's message. Limits (item, folders, batch,
match) are `password_import::vault` constants; don't write them out here.
`password_import_activity` records one counts-and-format entry per completed
batch attempt, including empty and fully failed batches; team purge removes it.
Audit failure preserves per-item results and records `audit_failed` on the batch
span. Await `ItemLock::release` after every item future drains; dropping the
batch cancels its futures and drops the lease. `passwords.import.item` spans
parent to the batch, which records effective concurrency. The
`passwords.lease.hold` span records guard lifetime: normal completion includes
awaited rollback; drop queues SQLx rollback.
The 20,000-item import limit belongs to the browser parser/client.
