# contacts_core

## What it is

Part of Contacts: the contact graph, meaning who each user knows, built from
message and call activity and explicit relationships. Models, the ports the
adapters implement, and `ContactsDomainService`. HTTP and the SQS worker are
`crates/comms/contacts_inbound`; the Postgres, SQS and connection gateway
adapters are `crates/comms/contacts_outbound`.

## Start here

- `src/service.rs`: the contacts use cases.
- `src/ports.rs`: the traits the inbound/outbound crates implement.
- `src/models/`: contact graphs, users and the queue messages.

## Scope

- Owns: the contact graph and its use cases.
- Not here: CRM companies/contacts (external organizations) → `crates/databases/crm`;
  connection-level presence/relay → `crates/clients/connection_gateway_client`.

## Boundaries

- Depends on: `macro_user_id`.
- Used by: `teams` (backfill on team join), `channels`, `databases_sql`, the
  adapter crates, and through the `contacts` facade the composition roots and
  `ai_tools`.

## Recipes

- Add an HTTP endpoint: `src/ports.rs` (port method) → `src/service.rs` →
  `contacts_inbound`'s `src/http.rs` (handler + router + swagger).

## Checks

- `cargo test -p contacts_core`

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/security.md`
