# agent_secrets

## What it is

Agent teammates: secrets a team agent keeps for itself (third-party tokens
and the like), KMS-encrypted per agent and name. The brain fetches one per
use; secrets never go in prompts, files or the computer's config drive.

## How it works

Routes nest at `/team_agents` in the auth service, merged with the
`team_agents` router: `PUT|GET|DELETE /me/secrets/{name}` for the calling
agent, `GET /{agent_user_id}/secrets` (names only) and
`DELETE /{agent_user_id}/secrets/{name}` for its team's admins.

## Start here

- `src/domain/service.rs`: who may read or change which secret.
- `src/outbound/kms_secret_cipher.rs`: the encryption context.

## Boundaries

- Depends on: `cursor_api_key::cipher::KmsCiphertexts` (the KMS seam and CMK
  `agent_api_keys` also reuses); a `TeamAgentDirectory` port, implemented by
  `crates/team_agents`.
- Used by: `services/authentication_service`.

## Checks

- `cargo test -p agent_secrets --all-features` (`SQLX_OFFLINE` unset).

## Gotchas

- The encryption context binds `macro:agent-user-id` and `macro:secret-name`;
  a row copied to another agent or renamed fails to decrypt, by design.
- Values are capped at 4096 bytes, KMS's direct-encrypt limit.
- Locally the CMK is LocalStack's `alias/macro-local-cursor-api-key`, wired
  through `CURSOR_API_KEY_KMS_KEY_ID` like the other users of the seam.

## Related

- Rules: `.agents/rules/rust/security.md` · Docs: `docs/design/agent-brains.md`
