# route_policy

## What it is

Shared infrastructure for every authenticated HTTP service: the one table of
what each kind of caller (a person, a credential they hold outside the app, a
program, a scoped session, a bot, ...) may do on each category of route. Being
wired in: a tower layer will decide each route from its declared category.

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
