# system_status

## What it is

Platform status banner: Macro staff set the status (operational, degraded,
major outage with a message) and every user sees a banner while it is not
operational. Each update is kept as history; the newest is current.

## How it works

`POST /system-status` (staff) inserts a row in `system_status`, then
broadcasts the new `CurrentSystemStatus` to every open app as a
`system_status` websocket message through the connection gateway's
`/message/broadcast`. Apps load `GET /system-status` (public) on start and
keep whichever of the fetched or pushed status is newer (`updatedAt`).
The current status carries the `id` of the update that set it; the banner
remembers a dismissal by that id.

## Start here

- `src/domain/models.rs`: `SystemStatus` (message only on non-operational
  variants, enforced again by the table's CHECK) and the wire shapes.
- `src/domain/service.rs`: staff check, store, then best-effort broadcast.
- `src/inbound/axum_router/set_status.rs`: the documented endpoint staff call.

## Scope

- Owns: status storage, history, the staff check, and the broadcast payload.
- Not here: delivery to sockets → `services/connection_gateway`; the banner
  and dashboard → `apps/web/src/features/system-status/`.

## Boundaries

- Depends on: `macro_authorization` (axum), `connection_gateway_client`.
- Used by: `services/authentication_service`, which mounts the router at
  `/system-status` and lists it in `src/api/swagger.rs`.

## Checks

- `cargo test -p system_status --all-features` (`SQLX_OFFLINE` unset).
- `nix develop --command just prepare_db` from the repo root after query changes.

## Gotchas

- A failed broadcast does not fail the request: the row is already current,
  and a retry would record a duplicate. Apps refetch on focus.

## Related

- Rules: `.agents/rules/rust/architecture.md` · Skill:
  `cloud-storage-hexagonal-architecture`
