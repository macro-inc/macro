# organization_retention_trigger

## What it is

Shared infrastructure for organization data retention policies. A Lambda
fired on an EventBridge schedule that reads each organization's retention
settings and enqueues one SQS message per organization.

## Start here

- `src/main.rs`: the whole Lambda — handler, DB pool, SQS client wiring.
- `src/service/db/get_organization_retention.rs`: the query that reads
  retention settings.

## Scope

- Owns: the scheduled trigger that fans out organization retention checks
  onto `OrganizationRetentionQueue`.
- Not here: evaluating which items are stale and deleting them →
  `services/organization_retention_handler`, which consumes that queue.

## Checks

- `cargo test -p organization_retention_trigger` (`SQLX_OFFLINE` unset).

## Gotchas

- One EventBridge invocation handles the full organization list in a single
  Lambda execution, unlike the handler it feeds, which is one-message-per-Lambda.

## Related

- Rules: `.agents/rules/rust/guardrails.md`
