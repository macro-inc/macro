# sqs_client

## What it is

Shared infrastructure — a thin SQS client plus one queue-specific enqueue
module per consumer, gated behind Cargo features, used by any service or
crate that produces or consumes an SQS queue.

## Start here

- `src/queue.rs`: the `SQS` transport (`send_fifo_message`, `receive_messages`,
  delete/visibility) every feature module calls into.
- `src/message_attribute.rs`: typed SQS message attributes shared across queues.
- `src/email/trace_context.rs`: optional W3C context on backfill messages and
  deferrals; consumers adopt it before dispatching work. Missing or malformed
  context does not change job behavior.
- One module per feature (`chat`, `document`, `email`, `gmail`,
  `organization_retention`, `search`, `upload_extractor`): each defines its own
  enqueue function and message shape for one downstream consumer.

## Scope

- Owns: SQS send/receive plumbing and the message schema for each queue this
  crate produces or consumes.
- Not here: the Lambda/service handlers that drain these queues — each queue's
  consuming service (e.g. `services/email_sfs_delete_handler`,
  `services/upload_extractor_lambda_handler`) owns its own receive loop.

## Boundaries

- Depends on: `aws-sdk-sqs`; optional `model`, `models_email`,
  `models_ai_projection` behind their matching features. Never a domain crate:
  ports implemented for `SQS` live with their trait, such as `email`'s `sqs`
  feature, so this crate stays at the bottom of the compile chain.
- Used by: most SQS-producing services (`document_storage_service`,
  `email_service`, `search_processing_service`, `authentication_service`,
  the `*_handler`/`*_trigger` Lambda services) and `crates/accounts/teams`,
  `crates/integrations/webhook`, `crates/documents/documents`, `crates/ai/ai_projections`,
  `crates/ai/ai_tools`, `crates/projects/folder`, `crates/ai/memory`.

## Recipes

- Add a new queue producer: new `src/<area>.rs` module → feature flag in
  `Cargo.toml` → `pub mod <area>;` behind `#[cfg(feature = "<area>")]` in
  `src/lib.rs` → add it to `default` if every consumer needs it.
- Add a field to an existing queue's message: the module's message struct →
  its consuming service's deserialization (grep the queue name/feature across
  `services/`).

## Checks

- `cargo test -p sqs_client` (`SQLX_OFFLINE` unset).
- `cargo test -p sqs_client --no-default-features --features <area>` when
  changing a single feature's gating.

## Gotchas

- A new message type for a queue reaches workers that may not decode it yet:
  producers and consumers deploy in parallel. Keep producing the old form until
  every consumer is rolled out, behind a deployment switch (see
  `gmail_label_write_batches` and its test against the released worker format).

## Related

- Rules: `.agents/rules/rust/architecture.md`
