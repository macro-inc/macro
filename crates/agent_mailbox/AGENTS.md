# agent_mailbox

## What it is

Part of agent teammates: an email inbox and address of its own for each agent
account, which the agent reads, sends and replies from through routes that
take no mailbox id. Mail is hosted by a provider (deadsimple.email for now)
behind provider-neutral ports. Design: `docs/design/agent-mailboxes.md`.

## Start here

- `src/domain/service.rs`: provisioning, lifecycle, the sweep, and the agent's
  reads and sends.
- `src/domain/ports.rs`: `MailboxProvisioner` (server-only admin key) and
  `MailboxClient` (one mailbox-scoped key per call).
- `src/inbound/axum_router.rs`: agent routes (`/email/agent-mailbox`) and the
  internal lifecycle routes (`/internal/agent-mailboxes`).
- `src/wire.rs`: bodies shared with `email_service_client`.

## Scope

- Owns: `agent_mailboxes`, `agent_mailbox_sends`, the provider adapter, the
  scoped-key cipher.
- Not here: when a teammate gets a mailbox and who else sees it → `crates/team_agents`;
  the fake provider → `crates/agent_mailbox_fake_vendor`.

## Boundaries

- Hosted by `email_service` (`composition/agent_mailboxes.rs`).
- Used by: `email_service_client::agent_mailboxes` (teammate service).

## Checks

- `cargo test -p agent_mailbox --all-features` (`SQLX_OFFLINE` unset, migrated DB).

## Gotchas

- The mailbox is always the caller's own (`live_mailbox(caller)`). Never add a
  route or tool that takes a mailbox id; message ids are confined twice (the
  scoped key, then the reported `inbox_id`).
- A send whose outcome is unknown keeps its cap slot; a retry reuses the
  provider idempotency key. Only a definite refusal cancels the reservation.
- Provider content (headers, injection scores, webhooks) never authorizes anything.
- A `402` from the provider is `NotConfigured`; the adapter never pays.
- The scoped key is KMS ciphertext bound to the mailbox and user (CS-72).
  Deleting a row revokes nothing upstream: release revokes the key, then deletes.
- Response shapes follow the provider's OpenAPI document and TypeScript SDK;
  the credentials and pagination shapes still need a live check.

## Related

- Rules: `.agents/rules/rust/security.md`, `.agents/rules/config-and-service-urls.md`
