# route_policy

## What it is

Shared infrastructure for every authenticated HTTP service: the one table of
what each kind of caller (a person, a credential they hold outside the app, a
program, a scoped session, a bot, ...) may do on each category of route, and
the axum route constructors that declare each handler's category.

## Start here

- `src/policy.rs`: `decide(caller, category)` and the refusal messages.
  `src/policy/test.rs` pins the whole table as one literal grid.
- `src/category.rs`: what each category means; pick by what a route returns
  or causes, never by its HTTP method.
- `src/caller.rs` and `src/resolve.rs`: who a caller is, and
  `resolve_caller`, which reads one from signed claims only, narrowest
  reading winning.
- `src/inbound/axum.rs`: `get`/`post`/... take a `Category`; the layer they
  put on the handler decides from the `ResolvedCaller` in request
  extensions.

## Scope

- Owns: categories, callers, the decision table, refusal codes and messages.
- Not here: which principals a route admits (`crates/macro_authorization`)
  and item access (domain receipts).

## Boundaries

- Depends on: `serde`, `strum`, `utoipa`; `axum`, `tower`, `tracing` and
  `macro_tower_layers` (`ResponseSpanFields`) for `inbound::axum` only.
- Used by: `agent_correlation` (resolves the caller); services adopt the
  constructors route by route.

## Checks

- `cargo test -p route_policy`

## Gotchas

- A change to the table is a security change: update the literal grid in
  `src/policy/test.rs` in the same commit, so review sees it.
- `Enforcement::Observed` refusals are rollout state, not permission: keep
  every older check (internal-key extractors, scope lists, handler checks)
  until the refusal it duplicates is enforced.
- `agent_correlation`'s `propagate`, `enforce_signed_scope` and
  `refuse_signed_scopes` put the `ResolvedCaller` (and the service's
  `ActiveRollout`) in request extensions. A categorized route with no
  `ResolvedCaller` is refused 403 `no_caller` (`Verdict::Unresolved`),
  always: there is no observed mode and no rollout flag for it. Two requests
  are exempt: a `Category::Public` route, which means anyone (so even an
  unknown scope may POST to it), and a real CORS preflight (`OPTIONS` with `Origin` and
  `Access-Control-Request-Method`; any other `OPTIONS` needs a caller), which
  carries no credentials by design. So a service resolves a caller for every
  request, before routing, before it categorizes a route; no route does yet. A
  token that doesn't verify resolves no caller. The span gets
  `route_policy.code = no_caller`.
- `Rollout` names, per caller, the categories whose observed refusals are
  enforced, applied where the route is decided. No flag feeds it yet; with
  none, `NoRollout` enforces nothing beyond the table.
- An internal key's header resolves nothing here (alone it resolves no
  caller, and it never changes one): never let a `Category::Internal` route
  rely on the policy alone. Keep its internal-key extractor.
- A route can't be forced into the table at runtime: one built with
  `axum::routing` instead of these constructors never runs the layer. A
  service's categorization PR adds a test that calls `undeclared_routes` over
  the routes from its OpenAPI document and its `route_service` mounts, and
  bans raw routing in its crates. The walker marks its requests as probes, so
  a route that declares a category answers without running its handler; one
  that declares none does run its handler, so build the router with test state
  that has nothing behind it.
- `ScopedUnknown` reads by method only (a POST is refused even on a `Read`
  route), as `agent_correlation`'s scope holds it; `ScopedDryRun` reads by
  declared category, so a search sent as a POST goes on. `ChannelMention`
  is held to what `ScopedNoSend` is; never resolve a channel mention to
  `Program`.
- Chain methods with `merge`: `MethodRouter`'s own `.get`/`.post` add a
  handler with no category.
- The layer can't reach the `http.request` span (other middleware opens
  spans in between), so it hands its fields to `macro_tower_layers` in the
  response's `ResponseSpanFields`.
- **Routes the table can't express.** A cell is one category per route, so
  two kinds of route stay outside it:
  - body-dependent checks, such as `refuse_sharing` and `may_share` on a
    route that only sometimes changes who an item is shared with. They keep
    their own check; the route takes the category of what it does without the
    field.
  - multiplexed routes (DSS GraphQL runs any mutation over one path). They
    take the most sensitive category any request to them can reach, and a
    test pins it when they are categorized.
- **Unscoped programs may use egress.** The `program` x `egress` cell is
  observed, not allowed, by design: agents fetch and search the web today, so
  the rollout must not enforce that cell without a replacement path. The
  scoped callers' egress cells are observed too, like the program's; the
  scoped sessions are the first to enforce, since no run of theirs fetches
  today.
- Cells that must not be enforced without a replacement path: `program` x
  `egress`, and `bot` and `harness` x `connect` and `approval_gate` (the
  computers pair and approve through them today).
- A credential header (bot, harness, user API key, internal key) is never
  verified by the resolver: alone it resolves no caller (`no_caller`, 403),
  which is the fail-closed default, and beside a verified token it only
  narrows it.
- **Rule for a service's categorization PR.** Categorizing a service's routes
  must not start refusing a production caller. A credential header alone
  resolves no caller, and a categorized route with no caller is refused
  `no_caller` before any extractor runs, so the route's own extractor can't
  decide it afterwards. Before a route declares a category, decide each real
  caller kind that reaches it with no verified user token (a bot, a computer,
  an internal service, a user API key, an account manager's key) in a layer
  that verifies its credential and puts the `ResolvedCaller` in the request
  extensions before `route_policy` runs. (`macro_authorization`'s manager
  re-decision is not such a layer: it runs in the extractor and only narrows a
  caller already resolved.) The PR carries one test per real caller kind that reaches a
  categorized route, showing it is allowed what its table row allows and
  refused what it refuses, so no production path starts returning 403. A route
  no such caller reaches says so in the PR. Verifying credentials centrally
  instead is bead mac-vq1j.
