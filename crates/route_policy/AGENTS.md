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
- `src/caller.rs`: who a caller is, resolved from signed claims only.
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
- Used by: services adopt the constructors route by route.

## Checks

- `cargo test -p route_policy`

## Gotchas

- A change to the table is a security change: update the literal grid in
  `src/policy/test.rs` in the same commit, so review sees it.
- `Enforcement::Observed` refusals are rollout state, not permission: keep
  every older check (internal-key extractors, scope lists, handler checks)
  until the refusal it duplicates is enforced.
- A categorized route with no `ResolvedCaller` in its request's extensions is
  refused 403 `no_caller` (`Verdict::Unresolved`), always: there is no
  observed mode and no rollout flag for it. Two requests are exempt: a
  `Category::Public` route, which means anyone (so even an unknown scope may
  POST to it), and a real CORS preflight (`OPTIONS` with `Origin` and `Access-Control-Request-Method`; any other `OPTIONS` needs a caller), which carries no credentials
  by design. So a service puts a `ResolvedCaller` in every request before
  routing, from signed claims, before it categorizes a route; no route does
  yet. The span gets `route_policy.code = no_caller`.
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
