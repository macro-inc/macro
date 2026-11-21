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
- Until a service puts a `ResolvedCaller` in request extensions, the layer
  decides nothing (`Verdict::Unresolved`) and every request goes on. A
  service that resolves callers must resolve one for every authenticated
  request, before routing, so `Unresolved` never means "allowed" there.
- Chain methods with `merge`: `MethodRouter`'s own `.get`/`.post` add a
  handler with no category.
- The layer can't reach the `http.request` span (other middleware opens
  spans in between), so it hands its fields to `macro_tower_layers` in the
  response's `ResponseSpanFields`.
