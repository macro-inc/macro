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

- Owns: `agent_mailboxes`, `agent_mailbox_sends`, `agent_mailbox_sweep_claims`, the provider adapter, the
  scoped-key cipher.
- Not here: when a teammate gets a mailbox and who else sees it → `crates/team_agents`;
  the fake provider → `crates/agent_mailbox_fake_vendor`.

## Boundaries

- Hosted by `email_service` (`composition/agent_mailboxes.rs`).
- Used by: `email_service_client::agent_mailboxes`, for the teammate lifecycle in
  `crates/team_agents`. That caller lands separately; until it does, nothing
  provisions, pauses or releases except a direct call to the internal routes.

## Checks

- `cargo test -p agent_mailbox --all-features` (`SQLX_OFFLINE` unset, migrated DB).

## Gotchas

- The mailbox is always the caller's own (`live_mailbox(caller)`). Never add a
  route or tool that takes a mailbox id; message ids are confined twice (the
  scoped key, then the reported `inbox_id`).
- Provider-side steps (create, scope a key, revoke, delete) run under the
  row's lease (`claim`/`unclaim`); every write recording one names the lease
  token. Pause, resume and the start of a release are plain state flips that
  win over a running attempt. Only a release revokes a stored credential.
- A send whose outcome is unknown keeps its cap slot; a retry reuses the
  provider idempotency key only inside `SEND_RETRY_WINDOW` (one hour, inside both
  the provider's replay window and the hourly cap), then answers
  `send_outcome_unknown`. Only a definite refusal of the attempt that made
  the reservation cancels it; a refused retry leaves it.
- One `agent_mailbox_sends` row per key is the dedupe, the caps (outcome not
  `refused`) and the 400-day audit. The key is bound to its fingerprint;
  never key a cap or replay on the key alone. `reserve_send` rechecks the
  mailbox state under the row lock.
- Cluster-wide jobs (orphan check, prune) run in the replica that wins
  `claim_sweep_job`; add a job there rather than running it on every replica.
- Team-wide caps take a per-team advisory lock before the mailbox row lock;
  keep that order everywhere.
- Provider idempotency keys come from `provider_key(mailbox, operation)`;
  never send the agent's key or a mailbox id raw.
- Every send and reply needs the owner's quoted approval (`OwnerApproval`),
  decided in the domain: the caller is always an agent account, whatever
  credential it uses.
- Provider content (headers, injection scores, webhooks) never authorizes anything.
- A `402` from the provider is `NotConfigured`; the adapter never pays.
- The scoped key is KMS ciphertext bound to the mailbox and user (CS-72).
  Deleting a row revokes nothing upstream: release revokes the key, then deletes.
- Response shapes follow the provider's OpenAPI document and TypeScript SDK;
  the credentials and pagination shapes still need a live check.

## Related

- Rules: `.agents/rules/rust/security.md`, `.agents/rules/config-and-service-urls.md`
