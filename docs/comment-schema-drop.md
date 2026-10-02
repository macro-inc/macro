# Comment schema drop release

This change removes the legacy comment sources after the unified message
cutover. It is **not authorized for merge or deployment yet**. Migrations deploy
before services, and the PDF highlight query in contract commit `f7b3753db2`
still reads `"PdfHighlightAnchor"."threadId"`. The service-only prerequisite
[#7358](https://github.com/macro-inc/macro/pull/7358) must be **deployed to every production
consumer before this drop deploys**; merging that prerequisite is insufficient.

## Completed rollout evidence

- Contract PR [#6732](https://github.com/macro-inc/macro/pull/6732), squash
  `f7b3753db2b5b6b1660d83f68086ec751f986dab`, is an ancestor of release
  `v2026.10.1.0`, commit `4dcc0d2529c66c3f707f7e30bf8ab804d15566c1`.
- [Deployment run 36934197899](https://github.com/macro-inc/macro/actions/runs/36934197899)
  completed all Cloud Storage deployments and migrations, the web app, sync,
  and AI editing on October 1. Only the separate website deployment failed.
- Production CRM import completed September 29: 77 messages inserted, 76
  thread rows, no updates; all invariants zero and the second run a no-op.
- The dev PDF exception was approved test-data cleanup on September 30:
  comment 4261, thread 3012, its anchor link, and one rootless placeable were
  removed. Dev then had zero unmapped live comments and rootless placeables;
  production had neither exception.
- Read-only primary-database checks reported October 2 found **zero rootless
  placeables across all rows**, including soft-deleted rows, in both dev and
  production. Channel message counts were 20,257 in dev and 203,765 in
  production. These are rollout receipts, not a substitute for a fresh preflight.
- PostHog project 299018 flag 890412, `enable-unified-document-discussions`,
  was archived at `2026-10-02T15:04:31Z`: archived=true, active=false,
  status=ARCHIVED, with history/rules preserved.
- `LEGACY_COMMENT_WRITES_ENABLED` was deleted from cloud-storage-service dev
  and prd and verified absent in lcl, lcl_personal, dev, dev_personal, and prd.
  Config retirement was performed separately; this PR changes no config.
- External SDK/webhook consumer compatibility was waived for the contract.
  SDK publishing is out of scope. That waiver does **not** waive the external
  SQL-reader check below.

## Before deploying the drop

1. Deploy the PDF prerequisite and record its release SHA, release ancestry,
   and successful deployment of every consumer. Verify PDF highlight discussion
   creation/reattachment, `/messages`, PDF export, and numeric document links.
   The older #6732 deployment alone does not close this gate.
2. Check external SQL readers, scripts, BI/reporting, and operational jobs for
   both retired `channel_id` columns, PDF `threadId`, and the five source tables.
   Confirm that no retired importer is scheduled or running.
3. Take and verify a production snapshot and record its identifier/time and
   recovery procedure. The schema drop is irreversible by service rollback.
4. Recheck import completeness, old-link mappings, and all-row placeable
   `root_id` completeness. Investigate any mismatch; do not delete data to make
   the migration pass.
5. Schedule a quiet maintenance window. Replacing the channel FK with a stored
   generated parent key rewrites `comms_messages` and rebuilds its indexes;
   the attachment entity index is also rebuilt. Allow for disk/WAL and measure
   on a representative isolated snapshot before setting the window. Local
   synthetic-data timing is not a production duration estimate.
6. Deploy through the normal migration pipeline only after these gates are
   approved. `lock_timeout = '5s'` bounds waiting for each lock, not total
   execution time. The migration is transactional; investigate lock failures
   and retry through the pipeline, without bypassing checks.

## Schema and compatibility

The migration replaces notification soft-delete cleanup **before** removing
`channel_id`. It scopes by parent type/id and matches `messageId` or historical
`message_id`; document comment notifications match UUID `commentId`. A thread
id alone does not identify the deleted message. Recipient notifications retain
their existing FK cascade.

The generated `channel_message_parent_id` derives entirely from parent identity
and keeps channel FK integrity and hard-delete cascades, matching the existing
CRM generated-key pattern. Attachments cascade through their message FK.
Parent timeline/history/activity indexes and entity attachment lookup coverage
are retained. PDF placeables require `root_id`; highlights retain nullable roots
so standalone highlights and discussion deletion continue to work.

`Comment`, `Thread`, `ThreadAnchor`, `crm_comment`, `crm_thread`, their dependent
indexes/FKs, the parent-sync shim, and the obsolete columns are retired. Drops
use RESTRICT, so an unexpected dependency stops the migration. Historical
migrations are unchanged. Both `migrated_comment_*` mapping tables, their FKs,
and the authorized legacy-link resolution path remain. The importer binaries,
features, source-specific tests, and fixtures are removed.

## Validation and recovery

Validation uses newly created local databases only, with live SQLx tests
(`SQLX_OFFLINE` unset). Migration regressions exercise a populated pre-drop
schema, row/geometry/mapping preservation, function ordering, channel cascades,
repeat migration runs, and atomic rejection of rootless placeables. Message
regressions cover all parent notification formats, isolation of unrelated
notifications, recipient cascades, PDF anchors, and numeric-link mapping.
Package tests and regenerated workspace SQLx metadata are recorded in the PR.

After deployment, smoke-test channel/document/CRM messages and attachments,
PDF highlight/placeable discussion creation and export, old numeric document
links, notification deletion, and channel deletion. Monitor database errors
for retired identifiers and latency/lock changes.

If application rollback is necessary after the schema drop, use only a release
that no longer references any removed schema (including the PDF prerequisite).
Rolling back to #6732 or earlier is unsafe. Recovering deleted source tables
requires the approved snapshot/recovery procedure; do not fabricate an empty
replacement schema or rerun retired importers.
