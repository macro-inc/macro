# sqlx-postgres 0.8.6, with the cancelled-begin fix

In the published 0.8.6, `PgTransactionManager::begin` sends `BEGIN` and only
counts the transaction once the server answers. A begin future dropped in
between (a request or a subscription that ends while it waits) leaves the
server inside a transaction with nothing queued to end it, because the
rollback a dropped transaction queues is skipped while the count is zero.
The pool then hands that connection to the next borrower: its statements run
inside the stale transaction, and a borrower that opens one with an isolation
level (Soup's snapshot `BEGIN ISOLATION LEVEL REPEATABLE READ`) fails and
leaves the connection aborted until the service restarts.

This copy backports upstream's fix (launchbadge/sqlx#4394, first released in
0.9.1): `begin` counts the transaction before the round trip and uncounts it
if the server did not open one. One addition of ours: a nested begin whose
SAVEPOINT the server refuses (its transaction already aborted) unwinds the
count and queues no rollback, since there is no savepoint to roll back to;
upstream's fix alone would queue `ROLLBACK TO SAVEPOINT` for it, and the
caller's next statement would fail with "savepoint does not exist".

Nothing else differs from the published crate, except that:

- `Cargo.toml` lists the authors by name only, and four doc comments are
  reworded (an example email address, a PEM header, an integer range) so the
  repository's PII scan does not read them as personal data or a key.
- `src/lib.rs` allows the deprecation and dead-code warnings the published
  crate builds with. Cargo caps a crates.io dependency's warnings but not a
  path dependency's, and the workspace builds with `-Dwarnings`.

Drop this copy, and its `[patch.crates-io]` entry, once the workspace is on
sqlx 0.9.1 or later, if upstream by then handles a refused SAVEPOINT too: the
first test below fails if it does not. The tests that guard this copy are
`a_refused_savepoint_leaves_its_transaction_to_roll_back`,
`a_begin_dropped_mid_flight_leaves_the_connection_clean`
(`crates/soup/src/outbound/pg_soup_repo/expanded/dynamic/test.rs`) and
`a_dropped_read_of_known_items_leaves_no_transaction_open`
(`crates/soup/src/outbound/pg_soup_repo/attention/test.rs`).
