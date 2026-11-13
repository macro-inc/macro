# agent_correlation

## What it is

Attribution of work to the code-mode invocation (agent session) and/or the
routine run that caused it. A code-mode correlation is durable and validated
against its session; a routine id is a signed Macro API token claim
(`routine_id`) that needs no lookup. Neither grants access or changes the
JWT's acting user. A correlation may carry a `SessionScope`, set where the
harness mints the credential: then every service that accepts it refuses
requests outside the scope (`403`), so a hidden session's limits hold in
code, not in its prompt. The harness also signs the scope into the credential
(`agent_scope`), so a service with no database enforces it too
(`enforce_signed_scope`).

## Start here

- `src/domain.rs`: repository contract and agent-binding validation.
- `src/scope.rs`: session scopes and the requests each allows. `generation`:
  reads by method, its own writes, and `POST_READS`; `no_send` (a background
  run that sends nothing): anything but `SENDS`, the requests that reach
  someone else or start work with the person's full access (agent sessions,
  session control, tool approvals, review decisions, chat tool calls). The
  harness tests `a_run_that_sends_nothing_is_refused_every_send_in_the_sdk`
  (every send-like SDK write is refused or reviewed) and
  `a_run_that_sends_nothing_starts_no_work_with_the_persons_access` hold
  `no_send` to that; the harness test
  `the_generation_scope_matches_the_sdk_catalog` keeps the lists in step with
  the SDK's operation catalog. A new POST read or session tool route updates
  them. Credentials are not a scope's to decide: a token that signs
  `agent_scope` authenticates as `ScopedMacroApiJwt`, which
  `AccountHolderOrInternal` refuses on every route that issues a credential.
  `SignedScope` reads the `agent_scope` claim; a name this build doesn't know
  allows only reads.
- `src/context.rs`: async context (`Attribution`: correlation, routine, the
  display verb sent with a correlated SDK call, the validated session
  (`current_session`), and the scope stored with it, else the one the
  credential signs (`current_scope`)); capture before spawning,
  scope each message. `current_routine()` feeds
  `macro_event_broker::Event.routine_id`, which keeps routines from starting
  on routine writes.
- `src/verb.rs`: closed SDK display-verb vocabulary.
- `src/inbound.rs`: optional signed-claim extractor and HTTP propagation
  (`propagate` checks the signed scope, then scopes the validated
  correlation, its verb and the signed routine). `enforce_signed_scope` is the
  check alone, for a service with no database to look a correlation up in.
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
- Read `x-macro-sdk-verb` only after signed correlation validation; unknown
  verbs are absent, a verb never outlives its correlation, and it grants no
  authority.
- Do not check session state: accepted work can complete after a session ends.
- A scope is matched against the request path: the SDK's path, alone or
  under one gateway service prefix (`SERVICE_PREFIXES`). Never match by
  suffix: `/web/search` is a write that ends like `/search`.
- Session deletion cascades mappings; activity retains its existing entity lifecycle.
