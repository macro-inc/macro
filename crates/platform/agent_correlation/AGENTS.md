# agent_correlation

## What it is

Attribution of work to the code-mode invocation (agent session) and/or the
routine run that caused it. A code-mode correlation is durable and validated
against its session; a routine id is a signed Macro API token claim
(`routine_id`) that needs no lookup. Neither grants access or changes the
JWT's acting user.

## Start here

- `src/domain.rs`: repository contract and agent-binding validation.
- `src/context.rs`: async context (`Attribution`: correlation and routine);
  capture before spawning, scope each message. `current_routine()` feeds
  `macro_event_broker::Event.routine_id`, which keeps routines from starting
  on routine writes.
- `src/inbound.rs`: optional signed-claim extractor and HTTP propagation
  (`propagate` scopes both the validated correlation and the signed routine).
- `src/outbound.rs`: invocation mappings and session-agent lookup on the primary.

## Boundaries

- Owns `agent_correlations`; reads the session's bound agent for validation.
- Depends on `macro_auth` only for the HTTP adapter.
- Used by code-mode credential minting, HTTP services, and the event broker.

## Checks

- `cargo test -p agent_correlation --all-features`.

## Gotchas

- Never read correlation or a routine from an unsigned header or use them as
  authority.
- `scope` sets only a correlation and clears any routine; use
  `scope_attribution` to carry both. A bare `tokio::spawn` drops both; wrap
  request work in `capture`.
- Do not check session state: accepted work can complete after a session ends.
- Session deletion cascades mappings; activity retains its existing entity lifecycle.
