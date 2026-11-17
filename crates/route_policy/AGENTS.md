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
  put on the handler decides from the `Caller` in request extensions.

## Scope

- Owns: categories, callers, the decision table, refusal codes and messages.
- Not here: which principals a route admits (`crates/macro_authorization`)
  and item access (domain receipts).

## Boundaries

- Depends on: `serde`, `strum`, `utoipa`; `axum`, `tower`, `tracing` and
  `macro_tower_layers` (`ResponseSpanFields`) for `inbound::axum` only.
- Used by: `agent_correlation` (resolves the caller), `macro_authorization`
  (decides again as `AccountManager` once a key's lookup finds a manager's);
  services adopt the constructors route by route.

## Checks

- `cargo test -p route_policy`

## Gotchas

- A change to the table is a security change: update the literal grid in
  `src/policy/test.rs` in the same commit, so review sees it.
- `Enforcement::Observed` refusals are rollout state, not permission: keep
  every older check (internal-key extractors, scope lists, handler checks)
  until the refusal it duplicates is enforced.
- `agent_correlation`'s `propagate`, `enforce_signed_scope` and
  `refuse_signed_scopes` put the `ResolvedCaller` (and `propagate` the
  service's `ActiveRollout`) in request extensions. On a service without
  them the layer decides nothing (`Verdict::Unresolved`). A request with
  nothing verified and nothing signed is `Unresolved` too; its route refuses
  it itself.
- `Rollout` names, per caller, the categories whose observed refusals are
  enforced, applied where the route is decided. No flag feeds it yet; with
  none, `NoRollout` enforces nothing beyond the table.
- An internal key is resolved from its header, not verified: never let a
  `Category::Internal` route rely on the policy alone. Keep its internal-key
  extractor.
- Chain methods with `merge`: `MethodRouter`'s own `.get`/`.post` add a
  handler with no category.
- The layer can't reach the `http.request` span (other middleware opens
  spans in between), so it hands its fields to `macro_tower_layers` in the
  response's `ResponseSpanFields`.
