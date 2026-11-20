# computer_screen

## What it is

Agent teammates' screens: people watch, and team owners/admins drive, the agent's
computer from the web app. This crate holds the domain: single-use socket tickets,
the one driver lease per computer, the audit rows, and the hold that keeps the
agent's brain waiting while a person drives.

## Start here

- `src/domain/service.rs`: tickets, take-over/hand-back, lapse, `hold_agent`.
- `src/outbound/pg.rs`: the `computer_screen_*` tables; every lease change
  `pg_notify`s `computer_screen_lease_changed` in its transaction.
- `src/outbound/lease_changes.rs`: the `LISTEN` side, one connection per process.

## Scope

- Owns: `computer_screen_tickets`, `_sessions` (one per socket), `_drives` (one per
  take-over, ended `handBack` or `lapsed`), `_driver_leases`, `_agent_notices`.
- Not here: the WebSocket, guest tunnel, RFB gate and media relays →
  `services/agent_harness_service/src/computers/screen/`; who may watch or drive
  (`HarnessPermission::View`/`Manage`) → `crates/harnesses`.

## Gotchas

- A lease lapses `LEASE_TTL` after the last input or take-over; nothing sweeps it.
  Whoever next reads it (`ScreenService::lease`, `hold_agent`, `take_over`)
  releases it, which records the hand-back notice and tells the guest.
- Notices (`computer.screen.takeOver`/`handBack`) are delivered once, by
  `take_notices`, with the agent's next brain request.
- Tickets are stored as SHA-256 only; the secret exists in one HTTP response.
  Each carries the issuing request's `traceparent`, so the socket's span joins
  that trace.

## Checks

- `cargo test -p computer_screen` against a migrated database (`SQLX_OFFLINE` unset),
  with `DATABASE_URL` set inside `nix develop -c env ...`: the devshell resets it to
  the shared local Postgres.
