# Comment schema drop release

[Schema-drop PR #7360](https://github.com/macro-inc/macro/pull/7360) includes both
the final PDF highlight query fix and the legacy schema drop in one release.
The user explicitly accepted temporary PDF highlight discussion failures on
October 2, overriding the usual separate-release rule in
[Database development](DATABASE_DEVELOPMENT.md#safe-database-schema-changes)
for this change. The separate prerequisite PR #7358 is superseded.
The combined change also adapts the historical Slack message writer/reader and
channel search-backfill query added by #7311 on newer `main` to parent identity.
If a release containing the older versions of those consumers runs at drop time,
Slack archive imports and channel search backfills also fail until those consumers
are replaced. Keep import jobs stopped through rollout and resume only on the
compatible worker. Channel filtering, stable pagination, and attribution remain
unchanged.
This PR preparation does not authorize merge or deployment.

Migrations deploy before services. After the drop commits, old service instances
still executing the `"PdfHighlightAnchor"."threadId"` predicate will fail to
attach discussions to highlights until the updated service replaces them.
Recovery depends on a successful rollout; there is no guaranteed 30-minute
limit. A failed rollout or automatic rollback to the old binary leaves that
operation broken and requires rolling forward to the compatible code.

In the October 1 release, migrations finished at 22:31:53 UTC and the document
service deployment job finished at 22:33:12 UTC (79 seconds later). The service
uses `continueBeforeSteadyState: true`, so job completion does not establish when
all old instances stopped serving requests. This is context, not an outage SLA.
The database table rewrite also has its own locking impact, described below.

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

1. Release the query fix and drop together from this PR. Confirm the release
   includes the removal of the PDF highlight `threadId` predicate and that legacy
   writes remain frozen. Imports must be complete, with no importer scheduled or
   running: an old importer could overwrite a newly attached highlight root.
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
that no longer references any removed schema, including the PDF highlight
`threadId` predicate. Confirm service rollout completion separately from the
deployment job and roll forward if the old binary remains active.
Rolling back to #6732 or earlier is unsafe. Recovering deleted source tables
requires the approved snapshot/recovery procedure; do not fabricate an empty
replacement schema or rerun retired importers.
