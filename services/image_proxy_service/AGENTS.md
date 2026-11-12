# image_proxy_service

## What it is

Shared infrastructure for rendering remote images safely, used by Email
rendering among other callers. A deployable service that proxies arbitrary
remote image URLs through an authenticated, SSRF-guarded fetch.

## Start here

- `src/api/proxy.rs`: the `/proxy` route — its `safe_fetch::FetchPolicy`
  (10 MB, any image but SVG, octet-stream, 5 redirects, timeouts) and a
  browser-like User-Agent to clear strict WAFs.
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

- Fetch upstreams only through `safe_fetch::SafeFetcher` — it is the only thing
  stopping this service from being an SSRF vector into internal infra. Don't
  add SVG to the accepted media types: an SVG opened from this origin runs
  script here.

## Related

- Rules: `.agents/rules/rust/security.md` · Skill: `new-service`
