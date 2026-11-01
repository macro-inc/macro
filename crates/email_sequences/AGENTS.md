# email_sequences

## What it is

Part of the Email feature, surfaced in Customers (CRM) as "Sequences":
multi-step outreach a user sends from their own Gmail inbox to their team's CRM
people. The server owns all state; the browser only calls the API.

## How it works

- An enrollment has at most one unsent step (a partial unique index). The sweep
  (`domain/sweep.rs`, run every ~30 s by every `pubsub_workers` process) creates
  it about a minute before it sends, under the enrollment's row lock, after
  checking access, the sending inbox, the unsubscribe list and replies.
- Steps are ordinary scheduled sends (`source = 'sequence'`), created and
  withdrawn through the email crate's `SequenceStepStore` port on the
  sweep's own connection.
- The sweep then resolves every unsent step: records sends, retries refusals,
  flags stuck or withdrawn steps, and withdraws orphans.
- Inbox sync calls `message_synced` after each upsert; a reply or bounce stops
  the enrollment (`domain/replies.rs` classifies, pure).

## Start here

- `domain/service.rs`: API use cases and the enrollment changes every path shares.
- `domain/sweep.rs`: the three sweep phases and the reply hook.
- `outbound/pg_repo.rs` and its `test.rs`: persistence and the invariant tests.

## Scope

- Owns: `email_sequences`, `email_sequence_enrollments`, `email_sequence_steps`,
  `email_sequence_recipients`; the `/email/sequences` API and the public
  `/public/sequences/unsubscribe/{token}` page.
- Not here: drafts, schedules and delivery → `crates/email`, `services/email_service`.

## Boundaries

- Depends on: `email` (ports: `sequence_steps`), `entity_access` and `crm` (team
  membership, `crm_enabled`, CRM people).
- Used by: `services/email_service` (API, workers, inbox sync).

## Checks

- `cargo test -p email_sequences --all-features` (`SQLX_OFFLINE` unset).

## Gotchas

- Lock order: sequence row, enrollment rows (`ORDER BY id`), the inbox send-slot
  lock, then the email crate's locks. Read an enrollment's steps in a new
  statement after locking it.
- Every path that ends or pauses an enrollment withdraws its unsent step in the
  same transaction. A step whose delivery started can't be withdrawn; the sweep
  records it whatever the status, and only `active` or `needs_attention`
  enrollments move on.
- An unsubscribe commits before any enrollment stops; a failed stop is healed by
  the sweep, which never sends to an unsubscribed address.
- Spans and logs carry ids and counts only: never addresses, names or tokens.
