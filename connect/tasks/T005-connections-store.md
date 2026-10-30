# T005: Connect database, customer keys, encrypted grants, connections API

Depends on T003 (`connect_api`, `connect_platform`). Base on the integration
branch after T003 merges.

## Goal

`connect_api` stores who is connected to what, with every OAuth grant
encrypted, and lets an authenticated customer list, read, and delete its
users' connections. The OAuth flow that creates connections is T006; this task
builds what it writes into.

## Context

- `connect/docs/plan.md` (Architecture, Guarantees: customers own their users,
  grants are exportable).
- Envelope encryption prior art: `.agents/rules/rust/security.md` CS-72,
  `crates/microsoft_oauth_grant_db_utils`, and the Microsoft grant code in
  `services/authentication_service/src/outbound/microsoft/` (mine it; Connect
  depends on no Macro crate).
- Hexagonal layout: `.agents/skills/cloud-storage-hexagonal-architecture/SKILL.md`.
- Connect has its own database, so it does not use Macro's workspace SQLx
  cache: queries use runtime-checked `sqlx::query_as::<_, T>` with
  `#[derive(sqlx::FromRow)]`, and every query is exercised by a
  `#[sqlx::test(migrator = ...)]` test against Connect's own migrations
  ([decision](../docs/decisions.md)).

## Do

1. **Database.** `connect/services/connect_api/migrations/` (SQLx), created
   with `sqlx migrate add`. Tables:
   - `customers` (`id` uuid v7, `name`, `created_at`).
   - `customer_api_keys` (`id`, `customer_id`, `key_hash` (SHA-256 of the
     secret), `prefix` (first 8 chars, for display), `created_at`,
     `revoked_at`). Keys look like `ck_<id>_<secret>`; only the hash is stored.
   - `connections` (`id`, `customer_id`, `external_user_id` text,
     `app_id` text, `status` (`active` | `needs_reauth`), `scopes` text[],
     `created_at`, `updated_at`), unique on (`customer_id`,
     `external_user_id`, `app_id`).
   - `grants` (`connection_id` pk/fk, `ciphertext`, `nonce`,
     `encrypted_data_key`, `kms_key_id`, `encryption_version`,
     `access_token_expires_at`, `updated_at`): the envelope, nothing in clear.
2. **Encryption port.** `GrantCipher` port: seal and open an OAuth grant
   (access token, refresh token, token type, expiry, scopes) with AES-256-GCM
   under a per-grant data key, the data key wrapped by a `KeyWrapper` port.
   Adapters: AWS KMS (`aws-sdk-kms`, encryption context
   `{connection_id, customer_id}`) and a local adapter keyed by
   `CONNECT_LOCAL_WRAPPING_KEY` (32 bytes, base64) for development and tests.
   Config picks KMS when `CONNECT_KMS_KEY_ID` is set, local otherwise; startup
   fails if neither is set. Plaintext grants live in a type that redacts
   `Debug` and zeroizes on drop.
3. **Customer auth.** Middleware on `/v1/*` except `/v1/catalog*` and
   `/health`: `Authorization: Bearer ck_...`, looked up by id, compared by
   hash in constant time; revoked keys rejected. A `connect_api` CLI
   subcommand `create-customer <name>` prints a new key once.
4. **Connections API** (customer-scoped; a customer never sees another's
   rows):
   - `GET /v1/users/{external_user_id}/connections`: `app_id`, `status`,
     `scopes`, `created_at`.
   - `DELETE /v1/users/{external_user_id}/connections/{app_id}`: deletes the
     connection and grant. Response says the vendor grant is not revoked
     upstream (CS-72).
   - `GET /v1/users/{external_user_id}/connections/{app_id}/token`: the
     decrypted access token and its expiry (token export). Refreshing an
     expired token is T006; for now return `needs_reauth` (409) when expired.
   - OpenAPI for all of it.
5. **Catalog icons.** `icon_url` is `null` for an app with no embedded icon
   (four apps have no official SVG yet); the OpenAPI schema marks it
   nullable.
6. **Observability.** Spans `connect.connections.list|delete|export` with
   `customer_id`, `app_id`, outcome; never tokens or `external_user_id`
   values that could be personal data (record a hash).
7. **Tests.** `#[sqlx::test]` for every query; router tests for auth (missing,
   wrong, revoked key), customer isolation, list, delete, export, and expiry;
   cipher round-trip, tamper detection (modified ciphertext or wrong context
   fails), and redacted `Debug`.

## Done when

- `cargo nextest run --all-features -p connect_api` passes with
  `DATABASE_URL` pointing at a local Postgres server (tests create their own
  databases).
- `cargo clippy -p connect_api --all-features --all-targets -- -D warnings`,
  `cargo x deps --check`, and `just check` pass.
- Result shows a local run: `create-customer`, then `curl` list with and
  without the key.

## Out of scope

OAuth authorize/callback, token refresh, the MCP gateway, Pulumi/KMS key
creation, Doppler values.

## Result

### Changed

- `connect/services/connect_api/migrations/20261030180344_create_connect_store.sql`: customers, hashed customer keys, customer-scoped connections, and encrypted grant envelopes with cascade cleanup.
- `connect/services/connect_api/src/domain.rs`: customer key and grant types, repository/cipher ports, connection use cases, and safe outcome spans.
- `connect/services/connect_api/src/outbound.rs` and `src/outbound/test.rs`: Connect Postgres queries, AWS KMS/local key wrappers, AES-256-GCM envelope cipher, and query/cipher tests.
- `connect/services/connect_api/src/main.rs` and `src/test.rs`: customer auth middleware, CLI customer creation, list/delete/token export routes, OpenAPI, nullable catalog icons, and router tests.
- `connect/services/connect_api/Cargo.toml` and `Cargo.lock`: required dependencies.
- `connect/services/connect_api/AGENTS.md` and `connect/crates/connect_platform/AGENTS.md`: current routes, storage, configuration, and local run guidance.

### Checks

| Check | Outcome |
| --- | --- |
| `cargo nextest run --all-features -p connect_api` | Passed: 7 tests, 0 failed, 0 skipped, against fresh local Postgres test databases. |
| `cargo clippy -p connect_api --all-features --all-targets -- -D warnings` | Passed. |
| `cargo x deps --check` | Passed. |
| `just check` | Passed (`OK`): rustfmt and ast-grep. Required a writable `XDG_RUNTIME_DIR` and the same ast-grep 0.44.1 binary with its ELF interpreter patched under `/tmp` because Bun's generic Linux binary does not launch directly on NixOS. |
| `cargo fmt --all -- --check` | Passed in audit. |
| `git diff --check` | Passed. |
| Local CLI and curl | `create-customer` generated a key once (captured without printing); list without key returned HTTP 401; list with key returned HTTP 200 and `[]`. Used a fresh local Connect database. |
| Tempo trace verification | Skipped: no connected Tempo trace was available for the local smoke run. |

All Rust and repo commands ran inside `nix develop` with `CARGO_TARGET_DIR="$CONNECT_CARGO_TARGET_DIR"` and `DATABASE_URL="$CONNECT_DATABASE_URL"` (or a fresh local Connect database derived from it for the smoke run). Connect uses runtime-checked SQLx queries by the existing decision in `connect/docs/decisions.md`; its query tests used Connect's own migrator, and no Macro workspace SQLx cache was generated. Hexagonal boundary checked: customer scoping and export policy live in the domain service and repository port; HTTP handlers map transport, while Postgres and encryption live in the outbound adapter.

### Open questions

None.

### Proposed commit

`feat(connect): store encrypted customer connections`

Why: Connect needs customer-owned connection state and exportable, encrypted OAuth grants before the OAuth flow can write them.

What: Add the Connect schema, customer API keys, KMS/local grant encryption, scoped connection routes and OpenAPI, with database, router, and cipher coverage.
