# imap_service_client

## What it is

Authenticated internal client for imap_service. Shared DTOs are defined by
imap_engine; the wrapper adds a service-specific key, both mailbox generations,
and trace propagation on every call.

## Checks

- `cargo test -p imap_service_client`.
- Run `bash crates/imap_service_client/regen.sh` after an internal API change;
  `bash crates/imap_service_client/regen.sh --check` verifies the checked-in contract.
- Run `python3 -m unittest discover -s crates/imap_service_client -p test_normalize_openapi.py`
  for strict OpenAPI conversion checks.

## Gotchas

Never edit `src/generated.rs` by hand. The pinned Progenitor generator reuses
source DTOs, including explicit public re-exports, and injects tracing through
its pre-hook. Do not generate parallel types for shared refusal metadata.

Never accept arbitrary upload URLs. Upload identifiers are scoped by the link,
and the service validates the credential binding before reading any bytes.

- Regenerate the error schema when adding a closed engine failure category;
  network failures must remain distinct from verified credential rejection.

Discovery accepts the existing validated Email identity and converts to a string
only in the generated HTTP DTO. Preserve spelling and plus suffixes; keep server
usernames as raw protocol values.

Clients default to interactive operations. Clone with `with_operation_class` only
at trusted worker composition; keep user and background clients separate. The
optional `x-imap-work-class` header preserves default behavior for old clients
and never replaces the internal key or either mailbox-generation fence.

Keep AccountBusy (429, local admission) distinct from MessageTooLarge (413,
unsupported content). Generated contracts reuse the engine's validated domain
types; regenerate the spec/client after changing those codes or status responses.

Preserve a provider Retry-After header (preferred) or retryAfterSeconds body
hint in the typed RateLimited client error; keep local AccountBusy distinct.
The HTTP edge canonicalizes that hint-bearing error to the legacy throttled
code, so older callers still understand the failure category.
