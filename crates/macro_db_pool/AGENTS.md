# macro_db_pool

## What it is

Shared infrastructure: session bounds for MacroDB pools that serve web
requests, so Postgres cancels a statement long after its client gave up
instead of running it to completion.

## Start here

- `src/lib.rs`: the timeout constants and `with_request_timeouts`.

## Scope

- Owns: the default `statement_timeout` and `idle_in_transaction_session_timeout`
  of request-serving pools.
- Not here: pool sizing (each service's `main.rs`/`server.rs`) or MacroDB's
  instance-wide parameters (`infra/stacks/macrodb`).

## Boundaries

- Used by: the request pools of DSS (primary and readonly), the email API,
  authentication, calendar, connection gateway, agent harness, notification,
  contacts and convert.
- Unbounded: separate worker binaries (email `pubsub_workers`,
  `agent_trigger_service`, `search_processing_service`,
  `whatsapp_session_service`), Lambdas, `src/bin/*` tools, migrations, and
  contacts' worker pool.
- In-process workers that share a request pool inherit its timeouts: DSS,
  calendar, notification, connection gateway, agent harness and
  authentication run background workers on their bounded request pool. Give a
  worker its own pool without `with_request_timeouts` when its statements may
  run longer, as `services/contacts_service` does.

## Checks

- `cargo test -p macro_db_pool` with `SQLX_OFFLINE` unset and a local database.

## Gotchas

- A statement that legitimately runs longer raises the bound in its own
  transaction with `SET LOCAL statement_timeout`; never leave a whole pool
  unbounded for it.
- Pools derived from a request pool's `connect_options()` inherit the bounds.
  Advisory-lock guards that stay open across provider calls append
  `LOCK_GUARD_IDLE_IN_TRANSACTION_TIMEOUT` (later `options` entries win).
