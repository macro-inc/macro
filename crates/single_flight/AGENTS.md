# single_flight

## What it is

Shared infrastructure: lets concurrent callers that ask for the same thing
share one piece of running work instead of each starting their own. Permission
lookups use it so overlapping searches by one user run one database query.

## Start here

- `src/lib.rs`: `SingleFlight::run` and the crate docs, which state what
  happens on errors, cancellation and panics.
- `src/database_key.rs`: `DatabaseKey`, the part of a key that says which
  database a lookup reads.

## Scope

- Owns: sharing work that is running right now, per process.
- Not here: keeping results after the work finishes. That is a cache with a
  lifetime, which the caller owns (the permission lookups keep theirs in the
  `cached` macro around the function).

## Boundaries

- Used by: `macro_db_client` (`item_access::get_accessible_items`,
  `call_record::get::get_accessible_call_ids`) and `entity_access`
  (`get_user_source_ids`).

## Checks

- `cargo test -p single_flight`

## Gotchas

- The key must name everything the output depends on: callers with equal keys
  receive the same output. A database lookup's key starts with a `DatabaseKey`.
- A caller that joins receives data as of when the run started. Do not put a
  read that must see the caller's own preceding write behind it.
- `run` takes a function that makes the work, and the work must be `'static`:
  clone the pool and own the arguments inside it.
- `run` records `coalesced` on the caller's span when the span declares that
  field as `tracing::field::Empty`, and links a waiting caller's span to the
  span that started the work (`follows_from`), where the query's time is.
