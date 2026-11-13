# image_proxy_service

## What it is

Shared infrastructure for rendering remote images safely, used by Email
rendering among other callers. A deployable service that proxies arbitrary
remote image URLs through an authenticated, SSRF-guarded fetch.

## Start here

- `src/api/proxy.rs`: the `/proxy` route — its `safe_fetch::FetchPolicy`
  (10 MB, the `ALLOWED_MEDIA_TYPES` image allowlist, 5 redirects, timeouts),
  sandboxing response headers, and a browser-like User-Agent to clear strict
  WAFs.
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

- Fetch `/proxy` upstreams only through `safe_fetch::SafeFetcher` — it is the
  only thing stopping this service from being an SSRF vector into internal
  infra.
- Keep cache-miss favicon fetches behind the shared semaphore; cache hits bypass
  admission and saturated misses return 503 without an unbounded waiter queue.
- Keep the `/proxy` error bodies and status codes compatible with its deployed
  contract; construct the favicon client separately with the strict outbound
  DNS guard, disabled environment proxies, and trace propagation.
- Never bypass either guard; both paths must reject internal addresses at
  connection time as well as before each redirect hop.
- Serve only image types (`ALLOWED_MEDIA_TYPES`). Every `/proxy` response
  gets `nosniff` and a sandboxing CSP from `sandbox_headers`, and SVG is also
  sent as an attachment: an SVG opened from this origin would otherwise run its
  script here. Never drop those headers or add document types like HTML.

## Related

- Rules: `.agents/rules/rust/security.md` · Skill: `new-service`
