# bearer_token

## What it is

Shared infrastructure for agent sessions and auth: the SHA-256 digest and
display prefix of the bearer tokens Macro mints for bots (`mbot_…`) and
harnesses (`mhns_…`). Minting and auth-time lookup both use it, so the stored
`token_hash` cannot drift between them.

## Start here

- `src/lib.rs`: `TokenFamily` (`Bot`, `Harness`), `hash_token`,
  `token_prefix::<F>`, `HashedBearerToken<F>` and its `HashedBotToken` /
  `HashedHarnessToken` aliases.

## Boundaries

- Depends on: `sha2` only.
- Used by: `bots`, `harnesses` (mint), `macro_authorization` (lookup).

## Recipes

- Add a token kind: a new uninhabited enum implementing `TokenFamily` with its
  prefix, plus a `Hashed…Token` alias.

## Checks

- `cargo test -p bearer_token`

## Gotchas

- Changing `hash_token` invalidates every stored token; it must also stay
  identical to `user_api_key::hash_key` (see
  `macro_authorization/src/outbound/pg_user_api_key_authorization.rs`).
- The display prefix never contains secret bytes: unshaped tokens fall back to
  12 hex characters of the hash.
