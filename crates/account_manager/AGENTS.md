# account_manager

## What it is

Part of account security: lets an agent account (`User."isAgent"`) manage another
account. Either side asks in their DM, the other side approves, and the agent
claims a credential once. The managed account revokes it from settings.

## Start here

- `src/domain/service.rs`: the rules: who may ask, respond, claim, and revoke.
- `src/domain/models.rs`: the grant and its statuses.
- `src/outbound/pg_account_manager_repo.rs`: `account_manager_grants`; status
  changes are single conditional writes, so races resolve in the database.
- `src/outbound/dm_delivery.rs`: posts the request card and the claim link.
- `src/inbound/axum_router.rs`: HTTP routes, mounted by `document_storage_service`.

## Scope

- Owns: the `account_manager_grants` table's lifecycle.
- Not here: authenticating with a manager credential → `macro_authorization`
  (`CredentialOrigin::AccountManager`, `AccountHolderOrInternal`). Rendering the
  card → `apps/web/src/features/account-manager`.

## Boundaries

- Depends on: `channels`, `messages`, `entity_access`, `macro_authorization`,
  `user_api_key` (credential format and hashing).
- Used by: `services/document_storage_service`.

## Checks

- `cargo test -p account_manager --all-features` (`SQLX_OFFLINE` unset).

## Gotchas

- The manager is always an agent; the managed account can be a person or another
  agent. Whichever side didn't ask responds, and an agent may respond with its own
  API key.
- A credential is a normal `mak_` key to the SDK, but it lives here, not in
  `"UserApiKey"`, so it never appears in the API Keys tab or counts toward its
  limit. Only its hash is stored.
- Every route here refuses a manager credential, and so does each route using
  `AccountHolderOrInternal`: API keys, API token exchange, bot tokens, harness
  pairing approval, account links and merges, and account deletion. A new route
  that mints a credential that outlives its request, changes who can sign in, or
  deletes the account must use that policy too.
- The card only carries the grant id, because anyone can type message markup. It
  reads everything it shows from the server, which answers only the two accounts.
- Revocation stops the credential immediately. It doesn't undo what the manager
  already created, such as routines or webhooks.

## Related

- Rules: `.agents/rules/rust/security.md`
