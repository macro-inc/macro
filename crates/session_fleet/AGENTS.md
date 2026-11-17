# session_fleet

## What it is

Shared by the WhatsApp and Slack session services: which replica runs which
provider account. Each account runs on the replica holding its Postgres
advisory lock (`hashtextextended('<namespace>' || id, 0)`); the supervisor
takes free accounts on rescan and on `NOTIFY`, forwards signals to the
account's runner, hands accounts over in batches on SIGTERM, and stops
everything when the lock connection dies.

## Start here

- `src/supervisor.rs`: `Supervisor`, `FleetSignal` (released, per-account
  work with or without taking the account, keyed lookups, resync),
  `FleetNames` (span `fleet` field and the health/drain `telemetry_event`s).
- `src/ports.rs`: `AccountLocks`, `AccountDirectory`, `AccountRunner` (its
  `Signal` type is the service's own), `AccountControl`, `AccountExit`.
- `src/locks.rs`: `PgAccountLocks` on one dedicated non-pooled connection,
  pinged every keepalive. `src/listener.rs`: `SignalListener` over a
  service's `Channels`.

## Boundaries

- Depends on: `external_chat` (signal payloads and trace context).
- Used by: `services/whatsapp_session_service`, `services/slack_session_service`.

## Checks

- `cargo test -p session_fleet`; the lock tests against Postgres live in
  `services/whatsapp_session_service/src/outbound/lease/test.rs`.

## Gotchas

- Unlock before announcing a release, or the next replica's `try_lock` loses
  the race.
- The lock connection must reach the database instance, never RDS Proxy:
  the proxy multiplexes and drops session advisory locks and `LISTEN`.
- Monitors read the `telemetry_event` values in `FleetNames`; keep a
  service's values stable.
