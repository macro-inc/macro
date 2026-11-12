# image_proxy_service

## What it is

Shared infrastructure for rendering remote images safely, used by Email
rendering among other callers. A deployable service that proxies arbitrary
remote image URLs through an authenticated, SSRF-guarded fetch.

## Start here

- `src/api/proxy.rs`: the `/proxy` route — size cap (`MAX_IMAGE_SIZE` 10 MB),
  redirect cap, timeouts, and a browser-like User-Agent to clear strict WAFs.
- `src/api/proxy/resolver.rs`: the legacy generic proxy DNS guard.
- `src/outbound/resolver.rs`: the stricter public-image DNS guard for logos.
- `src/api/context.rs`: `ApiContext` / `AuthorizationService`.
- `/logos?domain=`: authenticated, bounded raster favicon cache; `src/domain.rs`
  owns cache policy and `src/outbound.rs` fetches through its strict DNS guard.
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

- Keep cache-miss favicon fetches behind the shared semaphore; cache hits bypass
  admission and saturated misses return 503 without an unbounded waiter queue.
- Keep the generic proxy client and resolver compatible with its deployed contract;
  construct the favicon client separately with the strict outbound DNS guard,
  disabled environment proxies, and trace propagation.
- Never bypass either DNS guard; both paths must reject internal addresses at
  connection time as well as before each redirect hop.
- Serve only image types (`ALLOWED_MEDIA_TYPES`). Every `/proxy` response
  gets `nosniff` and a sandboxing CSP from `sandbox_headers`, and SVG is also
  sent as an attachment: an SVG opened from this origin would otherwise run its
  script here. Never drop those headers or add document types like HTML.

## Related

- Rules: `.agents/rules/rust/security.md` · Skill: `new-service`
