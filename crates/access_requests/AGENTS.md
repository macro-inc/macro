# Access requests

## What it is

Owns initial access requests and upgrades, owner review, and direct user grants
for supported shared entities. Document storage mounts the HTTP adapter and runs
the durable notification/realtime dispatcher.

## Start here

- `src/domain/service.rs`: reviewer authority, supported levels, cooldowns, and transitions.
- `src/domain/ports.rs`: transaction and delivery contracts.
- `src/outbound/postgres.rs`: serialized writes and durable event leases.

## Boundaries

- Authorization and workflow policy stay in the domain service. The database
  adapter reads ownership facts and applies grants through `entity_access_db_utils`.
- Asking for initial access cannot require an existing View receipt. Request
  state hides owner details and other people's requests from ordinary callers
  without access; recorded reviewers can review without a separate View grant.
- Notification delivery is composed in document storage. Stable event IDs and
  durable withdrawal prevent delayed delivery from resurrecting old requests.

## Checks

- `cargo test -p access_requests` with `SQLX_OFFLINE` unset and a live test database.
- Regenerate root SQLx metadata after changing queries; see the database guide.

## Gotchas

- Every state change writes its delivery event in the same transaction. The
  latest event withdraws its immediate pending predecessor; retain this chain
  when changing retry or supersession behavior.
- Request grants only upgrade. Explicit owner changes may lower/remove a direct
  grant while preserving inherited, channel, and team access.
- Submissions and level changes are limited to one per minute for each requester
  and entity. Identical pending replays are harmless; cancellation stays available
  and preserves the deadline. Approval clears it for a further upgrade, while
  denial replaces it with the 24-hour cooldown.
