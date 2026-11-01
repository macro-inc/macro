# organization_retention_handler

## What it is

Shared infrastructure for organization data retention policies. A Lambda
that consumes `OrganizationRetentionQueue` SQS messages, finds items older
than an organization's retention window, and enqueues them for deletion.

## Start here

- `src/handler.rs`: reads `organization_id`/`retention_days` from SQS message
  attributes, fetches violating items, and splits them by entity type.
- `src/service/db/get_violating_items.rs`: the query that finds stale items.
- `src/main.rs`: Lambda wiring (DB pool, SQS client with document/chat delete
  queues).

## Scope

- Owns: turning one organization's retention check into per-item delete-queue
  messages (`DocumentDeleteQueue`, `ChatDeleteQueue`).
- Not here: deciding which organizations have retention enabled or when to run
  → `services/organization_retention_trigger`, which produces this Lambda's
  input; deleting the items themselves → whatever consumes the delete queues.

## Checks

- `cargo test -p organization_retention_handler` (`SQLX_OFFLINE` unset).

## Gotchas

- The handler requires exactly one SQS record per invocation (enforced in
  `src/handler.rs`) — the queue's batch size must stay at 1 or the Lambda
  errors out.
- Only `"document"` and `"chat"` item types are recognized; other item type
  strings from `get_violating_items` are silently dropped from both delete
  lists.

## Related

- Rules: `.agents/rules/rust/guardrails.md`
