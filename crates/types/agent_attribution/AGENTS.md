# agent_attribution

## What it is

The task-local attribution of the current work: the code-mode invocation
(agent session) and routine run that caused it, the session's scope and the
SDK display verb. It holds no I/O, so leaf crates can read it.
`agent_correlation` validates the signed claim at the HTTP boundary, sets the
context and re-exports these modules under their old paths.

## Start here

- `src/context.rs`: async context (`Attribution`: correlation, routine, the
  display verb sent with a correlated SDK call, the validated session
  (`current_session`), and the scope stored with it, else the one the
  credential signs (`current_scope`)); capture before spawning, scope each
  message. `may_share` says whether the request may change who can see an
  item; `refuse_sharing` is the body check for sharing that isn't a grant.
- `src/scope.rs`: session scopes and the requests each allows (see
  `crates/platform/agent_correlation/AGENTS.md` for the lists and the tests that
  hold them).
- `src/verb.rs`: closed SDK display-verb vocabulary.

## Boundaries

- Depends on: no workspace crates.
- Used by: `agent_correlation` (re-exports it), `models_permissions`
  (`may_share`).

## Checks

- `cargo test -p agent_attribution`

## Gotchas

- `scope` sets only a correlation and clears any routine; use
  `scope_attribution` to carry both. A bare `tokio::spawn` drops both; wrap
  request work in `capture`.
