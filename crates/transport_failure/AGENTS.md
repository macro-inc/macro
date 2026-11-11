# transport_failure

## What it is

Shared by outbound HTTP clients. Classifies why a reqwest request produced no
complete response (timeout, refused connection, connection closed or reset)
from its error chain, so a client can decide whether sending again is safe.

## Start here

- `src/lib.rs`: `TransportFailure::classify` and `lost_connection`.

## Scope

- Owns: reading reqwest, hyper, h2, and I/O errors into a transport cause.
- Not here: whether a request is safe to resend (each client decides from the
  server's semantics); answering provider failures over HTTP →
  `crates/upstream_error`.

## Boundaries

- Depends on: `reqwest`, `hyper`, `h2`.
- Used by: `crates/opensearch_client`, `crates/documents`
  (editing worker markdown calls).

## Checks

- `cargo test -p transport_failure`

## Gotchas

- Workspace feature unification enables reqwest's HTTP/2, so callers of
  HTTPS hosts that offer h2 (Cloudflare, OpenSearch) multiplex every request
  over one connection; when it resets, all in-flight requests fail together.
- reqwest already resends HTTP/2 GOAWAY (`NO_ERROR`) and `REFUSED_STREAM`
  requests, which the server never processed. A `ConnectionClosed` that
  reaches the caller may have been processed.
