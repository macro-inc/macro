# upstream_error

## What it is

Shared classification for failures of third-party services (GitHub, FusionAuth,
...) so they reach clients as 502/503 with a message the user can act on,
instead of a 500 that blames our code.

## How it works

An outbound adapter turns a provider's 5xx, 429, unreachable host, or
undecodable body into an `UpstreamError { service, failure }` with
`UpstreamFailure::from_status` / `from_transport`. The domain error carries it
in its own `Upstream` variant. The inbound adapter answers it with
`UpstreamError::into_response`: 503 (plus `Retry-After` when throttled) or 502,
with an `UpstreamErrorResponse { message, code }` body.

## Start here

- `src/lib.rs`: the classification and what counts as an upstream failure.
- `src/response.rs`: status codes, body, and `Retry-After`.

## Scope

- Owns: classifying provider HTTP and transport failures; their HTTP answer.
- Not here: connection state the user can fix (not linked, grant revoked,
  reauthentication). Each domain models it as its own 4xx error.

## Boundaries

- Depends on: `http`; `reqwest` and `axum` behind features of the same name.
- Used by: `crates/fusionauth`, `crates/github`, `services/authentication_service`.

## Recipes

- Classify a new provider: in its outbound adapter, map non-success responses
  through `UpstreamFailure::from_status` (after handling the 4xx the endpoint
  documents) and request failures through `from_transport`; give the domain
  error an `Upstream(UpstreamError)` variant; answer it with `into_response()`
  in the inbound adapter's exhaustive match.

## Checks

- `cargo test -p upstream_error`
- `rules/ast-grep/rust-fusionauth-classify-transport.yml` (run by `just check`)
  fails a FusionAuth `send()`/`json()`/`text()` mapped to anything but
  `FusionAuthClientError::transport`.

## Gotchas

- Domain code may hold `UpstreamError`, but `src/domain/**` must not see axum:
  depend with `default-features = false` there and enable `axum` only in the
  crate or feature that owns the inbound adapter.
- Providers signal throttling differently. GitHub's primary limit is a 403 with
  `x-ratelimit-remaining: 0`, which `from_status` cannot see; the GitHub
  adapter detects it before falling back to `from_status`.
- `service` is user-facing ("GitHub", "Google", "The sign-in service"), not a
  log tag. A crate that calls several providers names each one: `fusionauth`
  reports Google token refresh failures as "Google", not as itself.

## Related

- Skills: `cloud-storage-hexagonal-architecture` · Docs: `docs/development/rust.md`
