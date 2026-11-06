# agent_correlation

## What it is

Durable attribution of each code-mode invocation to its agent session. Correlation
does not grant access or change the JWT's acting user.

## Start here

- `src/domain.rs`: repository contract and agent-binding validation.
- `src/context.rs`: async context; capture before spawning, scope each message.
- `src/inbound.rs`: optional signed-claim extractor and HTTP propagation.
- `src/outbound.rs`: invocation mappings and session-agent lookup on the primary.

## Boundaries

- Owns `agent_correlations`; reads the session's bound agent for validation.
- Depends on `macro_auth` only for the HTTP adapter.
- Used by code-mode credential minting, HTTP services, and the event broker.

## Checks

- `cargo test -p agent_correlation --all-features`.

## Gotchas

- Never read correlation from an unsigned header or use it as authority.
- Do not check session state: accepted work can complete after a session ends.
- Session deletion cascades mappings; activity retains its existing entity lifecycle.
