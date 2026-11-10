# email_sequences

## What it is

Part of the Email feature, surfaced in Customers (CRM) as "Sequences":
multi-step outreach a user sends from their own Gmail inbox to their team's CRM
people. The server owns all state; the browser only calls the API.

## How it works

- A sequence's steps can be edited at any time. Nothing is copied per
  enrollment: the sweep (`domain/sweep.rs`, every ~30 s in every
  `pubsub_workers` process) renders each email about a minute before it sends,
  from the sequence's current steps and the CRM person's current name.
- An enrollment has at most one unsent step (a partial unique index). History
  rows are keyed by the step's stable `id`; the next step is the one after the
  last step reached that is still in the sequence.
- Steps are scheduled sends (`source = 'sequence'`) that stay out of Mail until
  they are sent or fail, created and withdrawn through the email crate's
  `SequenceStepStore` port on the sweep's own connection. One the owner
  reschedules in Mail becomes theirs: it is recorded once sent, never withdrawn.
- An email that didn't go out (refused, stuck, cancelled or trashed in Mail,
  or gone) puts the enrollment in `needs_attention`. An inbox that can't send,
  or an owner without access, only holds steps back.
- Inbox sync calls `message_synced` after each upsert; a reply or bounce stops
  the enrollment (`domain/replies.rs` classifies, pure).

## Start here

- `domain/service.rs`: API use cases and the enrollment changes every path shares.
- `domain/sweep.rs`: resolving in-flight steps, creating due ones, the reply hook.
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
  lock, then the email crate's locks. Read an enrollment's steps and its
  sequence in new statements after locking it, never locking the sequence.
- Every path that ends or pauses an enrollment withdraws its unsent step in the
  same transaction. A step whose delivery started can't be withdrawn; the sweep
  records it whatever the status.
- An unsubscribe commits before any enrollment stops; a failed stop is caught
  by the sweep before the step sends.
- `due_at` is when the next step is planned. Only `active` enrollments of an
  `active` sequence are due; a change to the steps' delays or order re-plans
  everyone waiting.
- Spans and logs carry ids and counts only: never addresses, names or tokens.
