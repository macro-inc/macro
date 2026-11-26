# Contacts Service
A service for adding and querying contacts

## Contact list backfill and audit

`contacts_backfill` (`src/bin/contacts_backfill.rs`, logic in
`crates/contacts/src/domain/backfill.rs`) fills `contact_list_members`
(`interacted`) and `contact_inbox_members` (`gmail`, `outlook`) from what the
database already records, and audits the legacy `contacts_connections` graph.
It reads `DATABASE_URL`, writes a JSON report to `--report`, and logs
progress to stdout.
Running it against a hosted database is a separate, approved operation.

```bash
cargo run -p contacts_service --bin contacts_backfill -- --report audit.json audit
cargo run -p contacts_service --bin contacts_backfill -- --report dry-run.json backfill --dry-run
cargo run -p contacts_service --bin contacts_backfill -- --report backfill.json backfill
cargo run -p contacts_service --bin contacts_backfill -- --report repair.json backfill --after 2026-11-20T00:00:00Z --only channels,direct-messages
```

- `audit` writes nothing. It counts the rows the `orphans` pass would
  delete, classifies each direction of every legacy edge
  (teammate, shared channel, DM with a message, inbox; or reverse import,
  empty DM, support channel, referral, disconnected inbox, no surviving
  record) and projects `interacted` rows by channel size and type.
- `backfill` runs four passes, all by default (`--only` picks some):
  `orphans` deletes list rows whose owner has no account and `interacted`
  rows naming someone with none (account deletion removes rows only once
  `contacts-list-writes` is on, and referral invites wrote `invited` rows
  before that; invited and inbox contacts may be addresses without an
  account, so those rows stay); `channels` pairs every two Macro members of each channel that is not a DM
  or a signup support channel, plus the people the April 2026 snapshot
  (`contacts_backfill_outbox`) lists together; `direct-messages` pairs the two
  people of each DM with a message from one of them; `inbox` writes each
  legacy direction whose owner has an inbox that knows the contact. Writes
  are idempotent, so a run can be repeated; nothing is notified.
- `--dry-run` reads everything and reports the writes it would make.
- `--after <RFC 3339>` re-derives only from channel joins and DM messages at
  or after that time, and skips snapshots taken before that time. The inbox pass has no
  time index and always reads every legacy edge.
- `--support-roster` overrides the signup support roster used to recognise
  support channels (private, named `Macro Support x …`, holding a roster
  address). The default is every address the roster has held; add new ones
  to `SUPPORT_ROSTER` when `MACRO_SUPPORT_EMAILS` gains one.
- `--page-size`, `--edge-page-size`, `--contact-page-size` and `--pause-ms`
  bound each read and pace the run. Every statement has a 60 s timeout.
- The run holds every channel's Macro members in memory (hundreds of
  thousands of rows).

Order: turn `contacts-list-writes` on, then `audit`, then `backfill
--dry-run`, then `backfill`. The full run covers everything recorded before
it starts, including the time before the flag was on. To repair a window
the live producers may have missed (for example around the flag flip), run
`backfill --after <a little before it> --only channels,direct-messages`.
The largest channels dominate the write volume (a 5,000-member channel is
25 million rows); read the audit's `largest_channels` before the run.

## Local development SQS component
### Setting up local SQS with localstack and docker
A small SQS worker has been made to aid in the rapid
development of the contacts service. In this pipeline, one
is able to spin up a local SQS worker using local stack, send
messages to it, and then write those messages to disk.

First, make sure the localstack docker image is installed and
running with `just create-localstack`. If it is already installed,
it can be started with `just start-localstack`.

Create a new SQS queue with `just create-queue`.

### Setting up a local postgres instance
From the repository root, start the local databases with `just run_dbs`. See the
top-level README for more information on how to spin this up.

In the contacts-db-client folder, run `just init` to
setup the initial table, followed by `just migrate` to
perform a migration and set up the tables.

Confirm things are working as expected with `just test`.

You can log into postgres instance by runnin `just psql`

### Running the local worker
In the contacts service, run `just sqs-worker` to spin up
a listener.

Send a test message with `just sqs-test-message`. If all goes
well, some connections should appear in the connections table.

Run `just list-connections` to see the connections in the table.

```bash
$ just list-connections
echo "SELECT * FROM connections" | psql -U user contacts
 id | user1  | user2  
----+--------+--------
  1 | apollo | zeus
  2 | apollo | athena
  3 | athena | zeus
(3 rows)
```

It is also possible to send other messages to the SQS service
using `send-message`: `just send-message test/fixtures/connections_message.json`.
