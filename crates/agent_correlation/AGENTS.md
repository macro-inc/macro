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
- `src/scope.rs`: session scopes and the requests each allows. A
  default-deny scope maps to an `Allowlist` (`SessionScope::allowlist`):
  its `scope/<scope>_reads.txt` and `<scope>_writes.txt` lists, `[spec]`
  headers then `METHOD /path` lines as the spec names them. A new
  default-deny scope adds its lists and one arm there. `job` (a
  background job's credential): default deny, reads included; only the
  requests on `src/scope/job_reads.txt` and `src/scope/job_writes.txt`
  (spec routes, by spec), so routes without a spec and new routes are
  refused. Every spec GET is on the job's read list or on
  `job_refused_reads.txt` (server-side fetches of caller-chosen URLs,
  credentials, sign-in flows, invite and join tokens, vault secrets), and
  every list line names a spec operation
  (`a_job_classifies_every_read_and_allows_only_its_lists`). Its writes are
  only its own session's reviews and views, its owner's notification inbox
  and a tool-free completion (`a_job_writes_only_its_session_and_its_owners_inbox`),
  so nothing it writes lands where someone else reads. A job's placeholders
  are typed (`typed_matches`): an id placeholder takes only an id-like
  segment, so an unannotated route that differs by a literal word isn't
  admitted. OPTIONS is refused to a job (a preflight carries no
  credential). Each list entry is bound to its spec's service: a service
  declares the specs it serves (`CorrelationState::serving`), and an entry
  counts only there (`allows_on`). A service that declares none refuses a
  job everything (fails closed); a signed-scope-only service a job reads
  uses `enforce_signed_scope_serving` (static files). The test
  `every_service_declares_the_specs_it_serves` holds every service to it.
  No scope shares. Signed-scope services
  (`enforce_signed_scope`) hold a job to the same lists. `generation`:
  reads by method, its own writes, and `POST_READS`; `no_send` (a background
  run that sends nothing): anything but `SENDS`, the requests that reach
  someone else, carry data out (web fetch and search), or start work with
  the person's full access (agent sessions, session control, tool
  approvals, review decisions, running or rewriting
  chat tool calls, and agents, bots, the computers they run on and their
  credentials, imports and app connections, sync permission tokens, and the
  account, team, billing and password-vault secrets). Every write in the
  OpenAPI specs under `packages/sdk/specs` must be refused, a `POST_READS`
  entry, or reviewed into `src/scope/no_send_writes.txt`
  (`the_no_send_scope_classifies_every_write_in_the_specs`): a new route
  fails it until classified; `dry_run` (a routine step's dry run, signed with no
  correlation): reads by method and `POST_READS`, nothing else, held to the
  SDK catalog by the harness test `the_dry_run_scope_is_every_sdk_read_and_no_write`.
  The harness tests
  `a_run_that_sends_nothing_is_refused_every_send_in_the_sdk` (every
  send-like SDK write is refused or reviewed, and every reviewed one is still
  allowed) and
  `a_run_that_sends_nothing_starts_no_work_with_the_persons_access` hold
  `no_send` to that; the harness test
  `the_generation_scope_matches_the_sdk_catalog` keeps the lists in step with
  the SDK's operation catalog. A new POST read or session tool route updates
  them. Credentials are not a scope's to decide: a token that signs
  `agent_scope` authenticates as `ScopedMacroApiJwt`, which
  `AccountHolderOrInternal` refuses on every route that issues a credential.
  `SignedScope` reads the `agent_scope` claim; a name this build doesn't know
  allows only reads. `ANY_WRITE` lists paths that run any write whatever the
  method (DSS GraphQL, by POST or its WebSocket); every scope, and an unknown
  one, is refused them. No scope may share (`allows_sharing`).
- `src/context.rs`: async context (`Attribution`: correlation, routine, the
  display verb sent with a correlated SDK call, the validated session
  (`current_session`), and the scope stored with it, else the one the
  credential signs (`current_scope`)); capture before spawning,
  scope each message. `current_routine()` feeds
  `macro_event_broker::Event.routine_id`, which keeps routines from starting
  on routine writes. `may_share` says whether the request may change who can
  see an item. `entity_access_db_utils::scoped_grants` checks it wherever
  access grants are written, so creation, filing in a folder, assignment and
  imports need no route check. `refuse_sharing` is the body check for sharing
  that isn't a grant (link sharing) or that the grant writer can't see:
  documents, call records, initiatives, projects, chats, DSS threads and saved
  views, CRM pipeline edits and email contribution activation. Rule validation
  and count previews are `POST_READS`; they never grant sharing. Policy PUT
  also belongs in `SENDS`, so `no_send` refuses it before the handler. A new such
  field or edit route joins that check.
  Both record the refusal for `propagate`.
- `src/verb.rs`: closed SDK display-verb vocabulary.
- `src/inbound.rs`: optional signed-claim extractor and HTTP propagation.
  It reads `macro_auth::credential::request_credential`, as authentication
  does, and verifies every user token the request carries: the request is
  held to every scope any verified token signs or is stored with, and the
  narrowest is the one handlers see. Verified tokens of different users,
  or credentials that can't be told apart, are refused 400
  `conflicting_credentials` before any handler runs. `propagate` checks the signed scope, then scopes the validated
  correlation, its verb and the signed routine, and answers a request that
  recorded a sharing refusal with 403 `SharingRefused`, whatever error the
  handler mapped it to. `enforce_signed_scope` is the
  check alone, for a service with no database to look a correlation up in.
  `refuse_signed_scopes` refuses every request carrying a verified token
  that signs a scope, for a
  service no scope may reach at all (the image proxy, which fetches what
  its caller names).
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
  under one gateway service prefix (`SERVICE_PREFIXES`), then alone or
  under one API version (`/v1`; document storage, cognition and
  notification serve every route under `/{version}`). Never match by
  suffix: `/web/search` is a write that ends like `/search`.
- `ANY_WRITE` names GraphQL where document storage mounts it
  (`/items/soup/graphql`); its test
  `no_scope_reaches_graphql_where_it_is_mounted` builds the path from the
  router's own constants, so a moved mount fails until the scope follows.
- Session deletion cascades mappings; activity retains its existing entity lifecycle.
