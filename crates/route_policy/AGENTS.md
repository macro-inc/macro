# route_policy

## What it is

Shared infrastructure for every authenticated HTTP service: the one table of
what each kind of caller (a person, a credential they hold outside the app, a
program, a scoped session, a bot, ...) may do on each category of route. This
crate is data only: nothing in it decides a request. The layer that does, and
the resolution of a caller from a request, live in the crates stacked on it.

## Start here

- `src/policy.rs`: `decide(caller, category)` and the refusal messages.
  `src/policy/test.rs` pins the whole table as one literal grid.
- `src/category.rs`: what each category means; pick by what a route returns
  or causes, never by its HTTP method.
- `src/caller.rs`: who a caller is, resolved from signed claims only.

## Scope

- Owns: categories, callers, the decision table, refusal codes and messages.
- Not here: which principals a route admits (`crates/macro_authorization`)
  and item access (domain receipts).

## Boundaries

- Depends on: nothing but `serde` and `strum`.
- Used by: none yet; each HTTP service's route policy layer once wired.

## Checks

- `cargo test -p route_policy`

## Gotchas

- A change to the table is a security change: update the literal grid in
  `src/policy/test.rs` in the same commit, so review sees it.
- `Enforcement::Observed` refusals are rollout state, not permission: keep
  every older check (internal-key extractors, scope lists, handler checks)
  until the refusal it duplicates is enforced.
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
