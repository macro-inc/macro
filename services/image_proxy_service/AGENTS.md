# image_proxy_service

## What it is

Shared infrastructure for rendering remote images safely, used by Email
rendering among other callers. A deployable service that proxies arbitrary
remote image URLs through an authenticated, SSRF-guarded fetch.

## Start here

- `src/api/proxy.rs`: the `/proxy` route — size cap (`MAX_IMAGE_SIZE` 10 MB),
  redirect cap, timeouts, and a browser-like User-Agent to clear strict WAFs.
- `src/api/proxy/resolver.rs`: `PrivateIpFilteringResolver` — blocks DNS
  resolution to private/loopback IPs to prevent SSRF.
- `src/api/context.rs`: `ApiContext` / `AuthorizationService`.
- `src/openapi.rs`, `src/doppler_config.rs`: separate `[[bin]]` targets for
  OpenAPI generation and Doppler config.

## Scope

- Owns: fetching and streaming back a remote image URL on behalf of an
  authenticated caller, with SSRF and resource-exhaustion protections.
- Not here: resizing/transcoding Macro's own stored images →
  `image_optimizer`.

## Checks

- `cargo test -p image_proxy_service` (`SQLX_OFFLINE` unset).

## Gotchas

- Never bypass or weaken `PrivateIpFilteringResolver` — it is the only thing
  stopping this service from being an SSRF vector into internal infra.

## Related

- Rules: `.agents/rules/rust/security.md` · Skill: `new-service`
