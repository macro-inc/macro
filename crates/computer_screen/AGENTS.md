# computer_screen

## What it is

Agent teammates' screens: people watch, and team owners/admins drive, the agent's
computer from the web app. This crate holds the domain: single-use socket tickets,
the one driver lease per computer, the audit rows, and the hold that keeps the
agent's brain waiting while a person drives.

## Start here

- `src/domain/service.rs`: tickets (with who may get one), socket caps,
  take-over/hand-back, lapse, `hold_agent`, notices.
- `src/domain/ports.rs`: storage (`ScreenRepo`), the guest's driver file
  (`DriverSignal`), lease changes, who may use a harness's screen
  (`ScreenAccess`: rollout, harness permission, the computer's agent) and who
  people are (`People`).
- `src/outbound/pg.rs`: the `computer_screen_*` tables; every lease change
  `pg_notify`s `computer_screen_lease_changed` in its transaction.
- `src/outbound/lease_changes.rs`: the `LISTEN` side, one connection per process.

## Scope

- Owns: `computer_screen_tickets`, `_sessions` (one per socket), `_drives` (one per
  take-over, ended `handBack` or `lapsed`), `_driver_leases`, `_agent_notices`.
- Not here: the WebSocket, guest tunnel, RFB gate and media relays, and the
  adapters of `ScreenAccess`/`People` →
  `services/agent_harness_service/src/computers/screen/`; the harness
  permissions themselves (`View` watches, `Manage` drives) → `crates/harnesses`.

## Gotchas

- Only a person gets a ticket: `issue_ticket` refuses a program's request
  (an agent's or a routine's run, `TicketRequest::program`) and agent
  accounts, then checks the rollout and the harness permission, and limits a
  person to `MAX_TICKETS_PER_WINDOW` a minute on each replica.
- At most `MAX_SOCKETS_PER_VIEWER` sockets per person and
  `MAX_SOCKETS_PER_COMPUTER` watching sockets per computer are open (sockets
  seen within `SESSION_FRESH_FOR`); a driving socket is never refused for
  the computer's count. The count and the insert are not atomic, so
  parallel opens can pass a cap by a few.
- A take-over takes the lease only when it is free, lapsed or the same
  user's: the upsert is guarded, so two people taking over at once never both
  drive.
- A lease lapses `LEASE_TTL` after its last renewal (driver input renews it
  at most every 15 s) or take-over; nothing sweeps it. Whoever next reads it
  (`ScreenService::lease`, `hold_agent`, `take_over`) releases it, which
  records the hand-back notice and tells the guest.
- The hold gates the agent's next brain request; a step already under way
  (tool calls of a model answer it has, its own scripts) finishes.
- Notices (`computer.screen.takeOver`/`handBack`) name the driver by name
  only and ride the agent's next brain request; they are deleted once that
  request succeeded (`notices_delivered`), so a refused request carries them
  again.
- `DriverSignal` must not wait on the guest: the harness queues the write.
- Tickets are stored as SHA-256 only; the secret exists in one HTTP response.
  Each carries the issuing request's `traceparent`, so the socket's span joins
  that trace.

## Retention

- Tickets: used up on redeem; expired ones are deleted an hour after expiry,
  with each new ticket.
- Notices: deleted when delivered; one no agent picked up within
  `NOTICE_KEPT_FOR` (a day; its computer was released, say) is no longer read
  and is deleted with the next ticket.
- Sessions and drives: the audit of who watched and drove which computer,
  one row per socket and per take-over, kept like other audit rows. A row a
  gone process left open is ended as `lost` on the computer's next socket.

## Checks

- `cargo test -p computer_screen` against a migrated database (`SQLX_OFFLINE` unset),
  with `DATABASE_URL` set inside `nix develop -c env ...`: the devshell resets it to
  the shared local Postgres.
