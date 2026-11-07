# slack_integration

## What it is

Part of the channels/chat (messaging) feature — lets a team bring its Slack
history into Macro. Browser-staged Slack archive imports: upload a Slack
export, map it onto Macro channels/messages/users, and import it as a job.

## Start here

- `src/domain/importer.rs` + `src/domain/importer/stream.rs`/`targets.rs`:
  the import pipeline and its target resolution (which Macro entities a
  Slack channel/user maps to).
- `src/domain/slack/`: Slack-format parsing — `mrkdwn.rs`, `reactions.rs`,
  `threads.rs`, `users.rs`, `references.rs`, `export.rs`.
- `src/domain/service.rs`: the job lifecycle service.
- `src/inbound/axum_router.rs` (`create.rs`, `uploads.rs`, `jobs.rs`) and
  `src/inbound/worker.rs`: the upload/create HTTP routes and the import worker.
- `src/outbound/pg_slack_import_repo.rs`: job/batch/upload/reference persistence.

## Scope

- Owns: parsing a Slack export, staging its upload, and running the import
  job end to end (including search backfill and reference reconciliation).
- Not here: the resulting Macro channel/message storage itself → `channels`,
  `chat`.

## Boundaries

- Depends on: `mention_utils`; feature-gated: `s3_key`/`aws-sdk-s3` (`s3`),
  `connection_gateway_client` (`gateway`), `aws-sdk-sqs`/`macro_queues` (`sqs`),
  `import` (`ledger`), `reqwest` (`search`).
- Used by: `document_storage_service`, `slack_import_worker`.

## Recipes

- Add a Slack format quirk (new mrkdwn token, reaction, reference type):
  `src/domain/slack/<area>.rs` → its sibling `test.rs` →
  `src/domain/importer/targets.rs` if it changes what the importer maps to.
- Add an import stage: `src/domain/importer.rs` →
  `src/outbound/pg_slack_import_repo/lifecycle.rs` →
  `src/inbound/worker.rs`.

## Checks

- `cargo test -p slack_integration` (`SQLX_OFFLINE` unset).

## Gotchas

- References (channel/user mentions) are reconciled after import, not at
  parse time — see `src/domain/reference_reconciliation.rs`; don't resolve
  them inline in `slack/references.rs`.

## Related

- Skill: `cloud-storage-hexagonal-architecture` · Rules: `.agents/rules/rust/architecture.md`
