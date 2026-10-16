# macro_service_urls

## What it is

Belongs to shared infrastructure: typed per-environment URLs for every Macro
service and gateway, resolved from `macro_env::Environment` with an
`OVERRIDE_<NAME>` env var escape hatch.

## Start here

- `src/lib.rs`: the `service_url!` macro and the `ServiceUrls` collection — the
  whole crate is this one file plus its macro-generated types.
- `src/test.rs`: override-resolution tests; also shows the macro's expected usage.

## Scope

- Owns: the `local`/`dev`/`prod` default for every service URL, the
  `OVERRIDE_*` env var convention, and the `ServiceUrl<'a>` string wrapper.
- Not here: the URL value itself used outside Rust → `infra/packages/shared/src/service_urls.ts`,
  `apps/web/src/lib/core/constant/servers.ts`, `packages/sdk/src/config.ts` (hand-kept
  in sync; see the config rule).

## Boundaries

- Depends on: `macro_env` (for `Environment`).
- Used by: nearly every Rust service that calls another service — construct a
  type with `XServiceUrl::new()`, never a raw string or env var.

## Recipes

- Add a new service URL: add a field to the `service_url! { struct ServiceUrls { ... } }`
  block in `src/lib.rs` with `local`/`dev`/`prod` values, then update the other
  three copies of the table (see Related).

## Checks

- `cargo test -p macro_service_urls` (`SQLX_OFFLINE` unset).

## Gotchas

- The override env var name is derived from the struct name
  (`CalendarServiceUrl` → `OVERRIDE_CALENDAR_SERVICE_URL`); renaming a struct
  silently changes what override callers must set.
- `local` defaults are host ports, not Docker-network addresses; a service
  calling another from inside Docker needs an `OVERRIDE_*_URL` entry in
  `local_env.rs`, not a different `local` default here.

## Related

- Rules: `.agents/rules/config-and-service-urls.md` ·
  Docs: `docs/guides/new-service.md` (§5 Service discovery)
