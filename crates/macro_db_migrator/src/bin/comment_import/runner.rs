//! Database-only operator tooling. No application request or authorization path.
//!
//! Every run projects the legacy `"Comment"` / `"Thread"` rows onto the shared
//! message tables one batch of documents at a time. Rows whose projection
//! already matches are left alone, so a rerun is a no-op and a run after new
//! legacy writes carries only the delta.

#[path = "summary.rs"]
mod summary;

use std::collections::HashMap;
use std::time::Duration;

use macro_uuid::{Uuid, generate_uuid_v7};
use sqlx::{Connection, PgConnection, Postgres, Transaction};
pub(super) use summary::{Pending, Summary};

const LOCK_ID: i64 = 732_847_301;
/// Documents handled per transaction when the operator gives no override.
pub(super) const DEFAULT_DOCUMENTS_PER_BATCH: i64 = 250;
const MAPPING_CHUNK: usize = 1_000;
const LOCK_RETRIES: u32 = 5;
const LOCK_RETRY_DELAY: Duration = Duration::from_secs(2);
const LOCK_NOT_AVAILABLE: &str = "55P03";
const DEADLOCK_DETECTED: &str = "40P01";
const PREFLIGHT_SAMPLE: i64 = 20;
const UUID_PATTERN: &str =
    "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";
const DISCUSSION_MARK_PREFIX: &str = "DISCUSSION:";
const COMMENT_NOTIFICATION_TYPES: [&str; 3] = [
    "commented_on_document",
    "replied_to_document_comment_thread",
    "mentioned_in_document_comment",
];
/// Saved PDF export payloads whose `comments[].id` still carries a legacy id.
const NUMERIC_COMMENT_ID_PATH: &str =
    r#"$.**.comments[*].id ? (@.type() == "number" || @ like_regex "^[0-9]+$")"#;

#[derive(Debug, Clone, Copy)]
pub(super) struct Options {
    pub documents_per_batch: i64,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            documents_per_batch: DEFAULT_DOCUMENTS_PER_BATCH,
        }
    }
}

/// The caller owns this dedicated connection; dropping it also releases the lock.
pub(super) async fn run(
    connection: &mut PgConnection,
    options: Options,
) -> Result<Summary, rootcause::Report> {
    if options.documents_per_batch < 1 {
        rootcause::bail!("documents_per_batch must be at least 1");
    }
    with_lock(connection, |connection| {
        Box::pin(run_locked(connection, options))
    })
    .await
}

/// Preflight and pending counts; never writes.
pub(super) async fn check(connection: &mut PgConnection) -> Result<Pending, rootcause::Report> {
    with_lock(connection, |connection| Box::pin(check_locked(connection))).await
}

type Locked<'a, T> =
    std::pin::Pin<Box<dyn Future<Output = Result<T, rootcause::Report>> + Send + 'a>>;

async fn with_lock<T>(
    connection: &mut PgConnection,
    body: impl for<'a> FnOnce(&'a mut PgConnection) -> Locked<'a, T>,
) -> Result<T, rootcause::Report> {
    let acquired =
        sqlx::query_scalar!(r#"SELECT pg_try_advisory_lock($1) AS "acquired!""#, LOCK_ID)
            .fetch_one(&mut *connection)
            .await?;
    if !acquired {
        rootcause::bail!("Another comment import is running");
    }
    let result = body(connection).await;
    let unlock = sqlx::query_scalar!(r#"SELECT pg_advisory_unlock($1) AS "released!""#, LOCK_ID)
        .fetch_one(&mut *connection)
        .await;
    let outcome = result?;
    unlock?;
    Ok(outcome)
}

async fn check_locked(connection: &mut PgConnection) -> Result<Pending, rootcause::Report> {
    preflight(connection).await?;
    let comments_without_mapping = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM "Comment" c
           WHERE NOT EXISTS (SELECT 1 FROM migrated_comment_id m WHERE m.comment_id = c.id)"#
    )
    .fetch_one(&mut *connection)
    .await?;
    let threads_without_mapping = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM "Thread" t
           WHERE NOT EXISTS (SELECT 1 FROM migrated_comment_thread_id m WHERE m.thread_id = t.id)"#
    )
    .fetch_one(&mut *connection)
    .await?;
    let documents_with_legacy_comments =
        sqlx::query_scalar!(r#"SELECT count(DISTINCT "documentId") AS "count!" FROM "Thread""#)
            .fetch_one(&mut *connection)
            .await?;
    Ok(Pending {
        comments_without_mapping,
        threads_without_mapping,
        documents_with_legacy_comments,
    })
}

async fn run_locked(
    connection: &mut PgConnection,
    options: Options,
) -> Result<Summary, rootcause::Report> {
    preflight(connection).await?;
    let mut summary = Summary::default();
    let mut cursor: Option<String> = None;
    loop {
        let documents = sqlx::query_scalar!(
            r#"SELECT d.id FROM "Document" d
               WHERE ($1::text IS NULL OR d.id > $1)
                 AND (EXISTS (SELECT 1 FROM "Thread" t WHERE t."documentId" = d.id)
                      OR EXISTS (SELECT 1 FROM migrated_comment_thread_id m WHERE m.document_id = d.id))
               ORDER BY d.id LIMIT $2"#,
            cursor,
            options.documents_per_batch,
        )
        .fetch_all(&mut *connection)
        .await?;
        let Some(last) = documents.last() else { break };
        cursor = Some(last.clone());
        import_batch_with_retry(connection, &documents, &mut summary).await?;
        summary.documents += documents.len() as u64;
        summary.batches += 1;
    }
    Ok(summary)
}

/// Legacy data that cannot be represented and must be resolved by hand first.
async fn preflight(connection: &mut PgConnection) -> Result<(), rootcause::Report> {
    let ambiguous = sqlx::query_scalar!(
        r#"SELECT t.id FROM "Thread" t
           LEFT JOIN "PdfPlaceableCommentAnchor" p ON p."threadId" = t.id AND NOT p."wasDeleted"
           LEFT JOIN "PdfHighlightAnchor" h ON h."threadId" = t.id AND h."deletedAt" IS NULL
           WHERE t."deletedAt" IS NULL
           GROUP BY t.id HAVING count(DISTINCT p.uuid) + count(DISTINCT h.uuid) > 1
           ORDER BY t.id LIMIT $1"#,
        PREFLIGHT_SAMPLE,
    )
    .fetch_all(&mut *connection)
    .await?;
    if !ambiguous.is_empty() {
        rootcause::bail!(
            "Multiple PDF anchors on a legacy thread; resolve before importing (thread ids {ambiguous:?})"
        );
    }
    let duplicates = sqlx::query!(
        r#"SELECT t."documentId" AS document_id, t.metadata->>'markId' AS "mark_id!",
                  array_agg(t.id ORDER BY t.id) AS "thread_ids!"
           FROM "Thread" t
           WHERE t."deletedAt" IS NULL
             AND t.metadata->>'markId' ~ $1
             AND EXISTS (SELECT 1 FROM "Comment" c WHERE c."threadId" = t.id)
             AND NOT EXISTS (SELECT 1 FROM "PdfPlaceableCommentAnchor" p WHERE p."threadId" = t.id AND NOT p."wasDeleted")
             AND NOT EXISTS (SELECT 1 FROM "PdfHighlightAnchor" h
                             WHERE h."threadId" = t.id AND h."deletedAt" IS NULL)
           GROUP BY 1, 2 HAVING count(*) > 1
           ORDER BY 1, 2 LIMIT $2"#,
        UUID_PATTERN,
        PREFLIGHT_SAMPLE,
    )
    .fetch_all(&mut *connection)
    .await?;
    if let Some(first) = duplicates.first() {
        rootcause::bail!(
            "Multiple active legacy threads share the same Markdown mark; delete the duplicates before importing (document {} mark {} threads {:?}, {} conflicts sampled)",
            first.document_id,
            first.mark_id,
            first.thread_ids,
            duplicates.len()
        );
    }
    Ok(())
}

async fn import_batch_with_retry(
    connection: &mut PgConnection,
    documents: &[String],
    summary: &mut Summary,
) -> Result<(), rootcause::Report> {
    let mut attempt = 0;
    loop {
        match import_batch(connection, documents, summary).await {
            Ok(()) => return Ok(()),
            Err(error) if attempt < LOCK_RETRIES && is_retryable(&error) => {
                attempt += 1;
                tracing::warn!(
                    error = %error,
                    attempt,
                    documents = documents.len(),
                    "legacy tables busy; retrying batch"
                );
                tokio::time::sleep(LOCK_RETRY_DELAY).await;
            }
            Err(error) => return Err(error.into()),
        }
    }
}

fn is_retryable(error: &sqlx::Error) -> bool {
    error
        .as_database_error()
        .and_then(|e| e.code())
        .is_some_and(|code| code == LOCK_NOT_AVAILABLE || code == DEADLOCK_DETECTED)
}

/// One transaction per batch: mapping allocation and the rows those mappings
/// point at commit together, so the mapping foreign keys hold at every boundary.
/// Counts join the run summary only once the batch has committed, so a retried
/// batch is counted once.
async fn import_batch(
    connection: &mut PgConnection,
    documents: &[String],
    summary: &mut Summary,
) -> Result<(), sqlx::Error> {
    let mut tx = connection.begin().await?;
    let mut batch = Summary::default();
    lock_legacy_tables(&mut tx).await?;
    batch.comment_mappings_allocated = allocate_comment_mappings(&mut tx, documents).await?;
    let new_roots = allocate_thread_mappings(&mut tx, documents).await?;
    batch.thread_mappings_allocated = new_roots.len() as u64;

    let (inserted, updated) = upsert_messages(&mut tx, documents).await?;
    batch.messages_inserted += inserted;
    batch.messages_updated += updated;
    let (inserted, updated) = upsert_structural_roots(&mut tx, documents).await?;
    batch.messages_inserted += inserted;
    batch.messages_updated += updated;
    batch.messages_tombstoned += tombstone_orphan_messages(&mut tx, documents).await?;

    batch.threads_written = upsert_thread_state(&mut tx, documents, &new_roots).await?;
    let (threads, messages) = tombstone_orphan_threads(&mut tx, documents).await?;
    batch.threads_tombstoned = threads;
    batch.messages_tombstoned += messages;

    batch.anchors_linked = link_anchors(&mut tx, documents).await?;
    let (remapped, unmapped) = remap_notifications(&mut tx, documents).await?;
    batch.notifications_remapped = remapped;
    batch.warnings.unmapped_notifications = unmapped;
    let (remapped, unmapped) = remap_pdf_payloads(&mut tx, documents).await?;
    batch.pdf_payloads_remapped = remapped;
    batch.warnings.unmapped_pdf_comment_ids = unmapped;

    batch.warnings.invalid_mark_ids = count_invalid_mark_ids(&mut tx, documents).await?;
    batch.warnings.root_order_drift = count_root_order_drift(&mut tx, documents).await?;
    tx.commit().await?;
    summary.absorb(batch);
    Ok(())
}

#[expect(
    clippy::disallowed_methods,
    reason = "utility statements carry no result shape for SQLx to check"
)]
async fn lock_legacy_tables(tx: &mut Transaction<'_, Postgres>) -> Result<(), sqlx::Error> {
    sqlx::query("SET LOCAL lock_timeout = '5s'")
        .execute(&mut **tx)
        .await?;
    sqlx::query(r#"LOCK TABLE "Comment", "Thread" IN SHARE ROW EXCLUSIVE MODE"#)
        .execute(&mut **tx)
        .await?;
    // The 5s timeout bounds only the table-lock wait. Clear it so later batch
    // statements wait normally for unrelated row locks instead of aborting.
    sqlx::query("SET LOCAL lock_timeout = 0")
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn allocate_comment_mappings(
    tx: &mut Transaction<'_, Postgres>,
    documents: &[String],
) -> Result<u64, sqlx::Error> {
    let missing = sqlx::query!(
        r#"SELECT c.id, t."documentId" AS document_id FROM "Comment" c
           JOIN "Thread" t ON t.id = c."threadId"
           WHERE t."documentId" = ANY($1)
             AND NOT EXISTS (SELECT 1 FROM migrated_comment_id m WHERE m.comment_id = c.id)
           ORDER BY c.id"#,
        documents,
    )
    .fetch_all(&mut **tx)
    .await?;
    for chunk in missing.chunks(MAPPING_CHUNK) {
        let ids: Vec<i64> = chunk.iter().map(|row| row.id).collect();
        let uuids: Vec<Uuid> = chunk.iter().map(|_| generate_uuid_v7()).collect();
        let document_ids: Vec<String> = chunk.iter().map(|row| row.document_id.clone()).collect();
        sqlx::query!(
            "INSERT INTO migrated_comment_id (comment_id, message_id, document_id)
             SELECT * FROM UNNEST($1::bigint[], $2::uuid[], $3::text[])",
            &ids,
            &uuids,
            &document_ids,
        )
        .execute(&mut **tx)
        .await?;
    }
    Ok(missing.len() as u64)
}

/// Roots follow legacy display order, then creation time, then id, including
/// deleted comments. Empty threads receive a fresh root id for a structural tombstone.
async fn allocate_thread_mappings(
    tx: &mut Transaction<'_, Postgres>,
    documents: &[String],
) -> Result<Vec<Uuid>, sqlx::Error> {
    let missing = sqlx::query!(
        r#"SELECT t.id, t."documentId" AS document_id, first.message_id AS "root_id?"
           FROM "Thread" t
           LEFT JOIN LATERAL (
               SELECT m.message_id FROM "Comment" c
               JOIN migrated_comment_id m ON m.comment_id = c.id
               WHERE c."threadId" = t.id
               ORDER BY c."order" NULLS LAST, c."createdAt", c.id LIMIT 1
           ) first ON true
           WHERE t."documentId" = ANY($1)
             AND NOT EXISTS (SELECT 1 FROM migrated_comment_thread_id m WHERE m.thread_id = t.id)
           ORDER BY t.id"#,
        documents,
    )
    .fetch_all(&mut **tx)
    .await?;
    let mut roots = Vec::with_capacity(missing.len());
    for chunk in missing.chunks(MAPPING_CHUNK) {
        let ids: Vec<i64> = chunk.iter().map(|row| row.id).collect();
        let chunk_roots: Vec<Uuid> = chunk
            .iter()
            .map(|row| row.root_id.unwrap_or_else(generate_uuid_v7))
            .collect();
        let document_ids: Vec<String> = chunk.iter().map(|row| row.document_id.clone()).collect();
        sqlx::query!(
            "INSERT INTO migrated_comment_thread_id (thread_id, root_id, document_id)
             SELECT * FROM UNNEST($1::bigint[], $2::uuid[], $3::text[])",
            &ids,
            &chunk_roots,
            &document_ids,
        )
        .execute(&mut **tx)
        .await?;
        roots.extend(chunk_roots);
    }
    Ok(roots)
}

fn count_inserts(rows: &[bool]) -> (u64, u64) {
    let inserted = rows.iter().filter(|inserted| **inserted).count() as u64;
    (inserted, rows.len() as u64 - inserted)
}

/// Every mapped comment. Existing rows change only when the legacy row differs
/// and is not older than the stored row, so an edit made through the new API
/// after a legacy row went stale is never reverted.
async fn upsert_messages(
    tx: &mut Transaction<'_, Postgres>,
    documents: &[String],
) -> Result<(u64, u64), sqlx::Error> {
    let rows = sqlx::query_scalar!(
        r#"INSERT INTO comms_messages (
               id, parent_entity_type, parent_entity_id, thread_id, sender_id, imported_author,
               content, created_at, updated_at, edited_at, deleted_at, import_metadata, import_order
           )
           SELECT cm.message_id, 'document', t."documentId",
               CASE WHEN cm.message_id = tm.root_id THEN NULL ELSE tm.root_id END,
               c.owner, c.sender, c.text,
               c."createdAt" AT TIME ZONE 'UTC', c."updatedAt" AT TIME ZONE 'UTC',
               CASE WHEN c."updatedAt" > c."createdAt" THEN c."updatedAt" END,
               COALESCE(c."deletedAt", t."deletedAt"), c.metadata,
               row_number() OVER (PARTITION BY t.id ORDER BY c."order" NULLS LAST, c."createdAt", c.id)
           FROM "Comment" c
           JOIN "Thread" t ON t.id = c."threadId"
           JOIN migrated_comment_id cm ON cm.comment_id = c.id
           JOIN migrated_comment_thread_id tm ON tm.thread_id = t.id
           WHERE t."documentId" = ANY($1)
           ON CONFLICT (id) DO UPDATE SET
               content = EXCLUDED.content,
               updated_at = EXCLUDED.updated_at,
               edited_at = EXCLUDED.edited_at,
               deleted_at = EXCLUDED.deleted_at,
               imported_author = EXCLUDED.imported_author,
               import_metadata = EXCLUDED.import_metadata,
               import_order = EXCLUDED.import_order
           WHERE comms_messages.updated_at <= EXCLUDED.updated_at
             AND (comms_messages.content, comms_messages.updated_at, comms_messages.edited_at,
                  comms_messages.deleted_at, comms_messages.imported_author,
                  comms_messages.import_metadata, comms_messages.import_order)
                 IS DISTINCT FROM
                 (EXCLUDED.content, EXCLUDED.updated_at, EXCLUDED.edited_at, EXCLUDED.deleted_at,
                  EXCLUDED.imported_author, EXCLUDED.import_metadata, EXCLUDED.import_order)
           RETURNING (xmax = 0) AS "inserted!""#,
        documents,
    )
    .fetch_all(&mut **tx)
    .await?;
    Ok(count_inserts(&rows))
}

/// Empty legacy threads keep a deleted root so their identity, anchors, and
/// external links stay representable without rendering as a discussion.
async fn upsert_structural_roots(
    tx: &mut Transaction<'_, Postgres>,
    documents: &[String],
) -> Result<(u64, u64), sqlx::Error> {
    let rows = sqlx::query_scalar!(
        r#"INSERT INTO comms_messages (
               id, parent_entity_type, parent_entity_id, sender_id, content,
               created_at, updated_at, deleted_at
           )
           SELECT tm.root_id, 'document', t."documentId", t.owner, '',
               t."createdAt" AT TIME ZONE 'UTC', t."updatedAt" AT TIME ZONE 'UTC',
               COALESCE(t."deletedAt", t."updatedAt")
           FROM "Thread" t
           JOIN migrated_comment_thread_id tm ON tm.thread_id = t.id
           WHERE t."documentId" = ANY($1)
             AND NOT EXISTS (SELECT 1 FROM "Comment" c WHERE c."threadId" = t.id)
           ON CONFLICT (id) DO UPDATE SET
               updated_at = EXCLUDED.updated_at,
               deleted_at = EXCLUDED.deleted_at
           WHERE comms_messages.updated_at <= EXCLUDED.updated_at
             AND (comms_messages.updated_at, comms_messages.deleted_at)
                 IS DISTINCT FROM (EXCLUDED.updated_at, EXCLUDED.deleted_at)
           RETURNING (xmax = 0) AS "inserted!""#,
        documents,
    )
    .fetch_all(&mut **tx)
    .await?;
    Ok(count_inserts(&rows))
}

/// A mapped comment whose legacy row was removed outright reads as deleted.
async fn tombstone_orphan_messages(
    tx: &mut Transaction<'_, Postgres>,
    documents: &[String],
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query!(
        r#"UPDATE comms_messages m SET deleted_at = now(), updated_at = now()
           FROM migrated_comment_id cm
           WHERE cm.message_id = m.id AND cm.document_id = ANY($1) AND m.deleted_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM "Comment" c WHERE c.id = cm.comment_id)"#,
        documents,
    )
    .execute(&mut **tx)
    .await?;
    Ok(result.rows_affected())
}

/// Thread state for every mapped thread. The root insert trigger has already
/// created a placeholder row for roots written in this batch; those are always
/// overwritten. Older rows follow the same newer-wins rule as messages.
async fn upsert_thread_state(
    tx: &mut Transaction<'_, Postgres>,
    documents: &[String],
    new_roots: &[Uuid],
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query!(
        r#"INSERT INTO comms_message_threads (
               root_id, parent_entity_type, parent_entity_id, user_id, resolved, anchor,
               import_metadata, created_at, updated_at, deleted_at
           )
           SELECT tm.root_id, 'document', t."documentId", t.owner, t.resolved,
               CASE
                   WHEN pa.uuid IS NOT NULL
                       THEN jsonb_build_object('type', 'pdf_placeable', 'anchor_id', pa.uuid)
                   WHEN ph.uuid IS NOT NULL
                       THEN jsonb_build_object('type', 'pdf_highlight', 'anchor_id', ph.uuid)
                   WHEN t.metadata->>'markId' ~ $3
                       THEN jsonb_build_object('type', 'markdown', 'mark_id', (t.metadata->>'markId')::uuid)
               END,
               t.metadata, t."createdAt" AT TIME ZONE 'UTC', t."updatedAt" AT TIME ZONE 'UTC',
               CASE
                   WHEN t."deletedAt" IS NOT NULL THEN t."deletedAt" AT TIME ZONE 'UTC'
                   WHEN NOT EXISTS (SELECT 1 FROM "Comment" c WHERE c."threadId" = t.id)
                       THEN t."updatedAt" AT TIME ZONE 'UTC'
               END
           FROM "Thread" t
           JOIN migrated_comment_thread_id tm ON tm.thread_id = t.id
           LEFT JOIN LATERAL (
               SELECT a.uuid FROM "PdfPlaceableCommentAnchor" a
               WHERE a."threadId" = t.id AND NOT a."wasDeleted"
               ORDER BY a.uuid LIMIT 1
           ) pa ON true
           LEFT JOIN LATERAL (
               SELECT a.uuid FROM "PdfHighlightAnchor" a
               WHERE a."threadId" = t.id AND a."deletedAt" IS NULL
               ORDER BY a.uuid LIMIT 1
           ) ph ON true
           WHERE t."documentId" = ANY($1)
           ON CONFLICT (root_id) DO UPDATE SET
               user_id = EXCLUDED.user_id,
               resolved = EXCLUDED.resolved,
               anchor = EXCLUDED.anchor,
               import_metadata = EXCLUDED.import_metadata,
               created_at = EXCLUDED.created_at,
               updated_at = EXCLUDED.updated_at,
               deleted_at = EXCLUDED.deleted_at
           WHERE (comms_message_threads.root_id = ANY($2)
                  OR comms_message_threads.updated_at <= EXCLUDED.updated_at)
             AND (comms_message_threads.user_id, comms_message_threads.resolved,
                  comms_message_threads.anchor, comms_message_threads.import_metadata,
                  comms_message_threads.created_at, comms_message_threads.updated_at,
                  comms_message_threads.deleted_at)
                 IS DISTINCT FROM
                 (EXCLUDED.user_id, EXCLUDED.resolved, EXCLUDED.anchor, EXCLUDED.import_metadata,
                  EXCLUDED.created_at, EXCLUDED.updated_at, EXCLUDED.deleted_at)"#,
        documents,
        new_roots,
        UUID_PATTERN,
    )
    .execute(&mut **tx)
    .await?;
    Ok(result.rows_affected())
}

/// A mapped thread whose legacy row was removed outright reads as deleted, with its messages.
async fn tombstone_orphan_threads(
    tx: &mut Transaction<'_, Postgres>,
    documents: &[String],
) -> Result<(u64, u64), sqlx::Error> {
    let roots = sqlx::query_scalar!(
        r#"UPDATE comms_message_threads s SET deleted_at = now(), updated_at = now()
           FROM migrated_comment_thread_id tm
           WHERE tm.root_id = s.root_id AND tm.document_id = ANY($1) AND s.deleted_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM "Thread" t WHERE t.id = tm.thread_id)
           RETURNING s.root_id"#,
        documents,
    )
    .fetch_all(&mut **tx)
    .await?;
    if roots.is_empty() {
        return Ok((0, 0));
    }
    let messages = sqlx::query!(
        r#"UPDATE comms_messages SET deleted_at = now(), updated_at = now()
           WHERE (id = ANY($1) OR thread_id = ANY($1)) AND deleted_at IS NULL"#,
        &roots,
    )
    .execute(&mut **tx)
    .await?;
    Ok((roots.len() as u64, messages.rows_affected()))
}

async fn link_anchors(
    tx: &mut Transaction<'_, Postgres>,
    documents: &[String],
) -> Result<u64, sqlx::Error> {
    let placeables = sqlx::query!(
        r#"UPDATE "PdfPlaceableCommentAnchor" a SET root_id = tm.root_id
           FROM migrated_comment_thread_id tm
           WHERE a."threadId" = tm.thread_id AND a."documentId" = ANY($1)
             AND a.root_id IS DISTINCT FROM tm.root_id"#,
        documents,
    )
    .execute(&mut **tx)
    .await?;
    let highlights = sqlx::query!(
        r#"UPDATE "PdfHighlightAnchor" a SET root_id = tm.root_id
           FROM migrated_comment_thread_id tm
           WHERE a."threadId" = tm.thread_id AND a."documentId" = ANY($1)
             AND a.root_id IS DISTINCT FROM tm.root_id"#,
        documents,
    )
    .execute(&mut **tx)
    .await?;
    Ok(placeables.rows_affected() + highlights.rows_affected())
}

/// Historical document comment notifications point at message ids once both
/// the comment and its thread have mappings. Rewritten ids never match again.
async fn remap_notifications(
    tx: &mut Transaction<'_, Postgres>,
    documents: &[String],
) -> Result<(u64, u64), sqlx::Error> {
    let types: Vec<String> = COMMENT_NOTIFICATION_TYPES
        .iter()
        .map(|kind| (*kind).to_owned())
        .collect();
    let remapped = sqlx::query!(
        r#"UPDATE notification n SET metadata = jsonb_set(
               jsonb_set(n.metadata, '{commentId}', to_jsonb(cm.message_id::text)),
               '{threadId}', to_jsonb(tm.root_id::text)
           )
           FROM migrated_comment_id cm, migrated_comment_thread_id tm
           WHERE n.event_item_type = 'document' AND n.event_item_id = ANY($1)
             AND n.notification_event_type = ANY($2)
             AND cm.document_id = n.event_item_id AND tm.document_id = n.event_item_id
             AND n.metadata->>'commentId' = cm.comment_id::text
             AND n.metadata->>'threadId' = tm.thread_id::text"#,
        documents,
        &types,
    )
    .execute(&mut **tx)
    .await?;
    let unmapped = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM notification n
           WHERE n.event_item_type = 'document' AND n.event_item_id = ANY($1)
             AND n.notification_event_type = ANY($2)
             AND (n.metadata->>'commentId' ~ '^[0-9]+$' OR n.metadata->>'threadId' ~ '^[0-9]+$')"#,
        documents,
        &types,
    )
    .fetch_one(&mut **tx)
    .await?;
    Ok((remapped.rows_affected(), unmapped as u64))
}

/// Saved PDF export payloads are relational metadata; their comment ids follow
/// the mapping. Ids without a mapping stay untouched and are counted.
async fn remap_pdf_payloads(
    tx: &mut Transaction<'_, Postgres>,
    documents: &[String],
) -> Result<(u64, u64), sqlx::Error> {
    let payloads = sqlx::query!(
        r#"SELECT m.id, i."documentId" AS document_id, m."modificationData" AS payload
           FROM "DocumentInstanceModificationData" m
           JOIN "DocumentInstance" i ON i.id = m."documentInstanceId"
           JOIN "Document" d ON d.id = i."documentId"
           WHERE i."documentId" = ANY($1) AND d."fileType" = 'pdf'
             AND jsonb_path_exists(m."modificationData", $2::text::jsonpath)
           ORDER BY m.id"#,
        documents,
        NUMERIC_COMMENT_ID_PATH,
    )
    .fetch_all(&mut **tx)
    .await?;
    let mut remapped = 0;
    let mut unmapped = 0;
    let mut mappings: HashMap<String, HashMap<i64, Uuid>> = HashMap::new();
    for row in payloads {
        if !mappings.contains_key(&row.document_id) {
            let rows = sqlx::query!(
                "SELECT comment_id, message_id FROM migrated_comment_id WHERE document_id = $1",
                row.document_id,
            )
            .fetch_all(&mut **tx)
            .await?;
            mappings.insert(
                row.document_id.clone(),
                rows.into_iter()
                    .map(|mapping| (mapping.comment_id, mapping.message_id))
                    .collect(),
            );
        }
        let mut payload = row.payload;
        let stats = remap_comment_ids(&mut payload, &mappings[&row.document_id]);
        unmapped += stats.unmapped;
        if stats.remapped > 0 {
            sqlx::query!(
                r#"UPDATE "DocumentInstanceModificationData" SET "modificationData" = $1 WHERE id = $2"#,
                payload,
                row.id,
            )
            .execute(&mut **tx)
            .await?;
            remapped += 1;
        }
    }
    Ok((remapped, unmapped))
}

#[derive(Debug, Default, PartialEq, Eq)]
struct RemapStats {
    remapped: u64,
    unmapped: u64,
}

/// Rewrite every `comments[].id` holding a legacy comment id, at any depth.
fn remap_comment_ids(value: &mut serde_json::Value, mappings: &HashMap<i64, Uuid>) -> RemapStats {
    let mut stats = RemapStats::default();
    match value {
        serde_json::Value::Array(items) => {
            for item in items {
                let inner = remap_comment_ids(item, mappings);
                stats.remapped += inner.remapped;
                stats.unmapped += inner.unmapped;
            }
        }
        serde_json::Value::Object(fields) => {
            for (key, child) in fields.iter_mut() {
                if key == "comments" && child.is_array() {
                    for comment in child.as_array_mut().into_iter().flatten() {
                        if let Some(id) = comment.get("id").and_then(legacy_comment_id) {
                            match mappings.get(&id) {
                                Some(message_id) => {
                                    comment["id"] =
                                        serde_json::Value::String(message_id.to_string());
                                    stats.remapped += 1;
                                }
                                None => stats.unmapped += 1,
                            }
                        }
                        // A comments array may nest inside a comment object.
                        let inner = remap_comment_ids(comment, mappings);
                        stats.remapped += inner.remapped;
                        stats.unmapped += inner.unmapped;
                    }
                } else {
                    let inner = remap_comment_ids(child, mappings);
                    stats.remapped += inner.remapped;
                    stats.unmapped += inner.unmapped;
                }
            }
        }
        _ => {}
    }
    stats
}

fn legacy_comment_id(id: &serde_json::Value) -> Option<i64> {
    match id {
        serde_json::Value::Number(number) => number.as_i64(),
        serde_json::Value::String(text) if text.bytes().all(|byte| byte.is_ascii_digit()) => {
            text.parse().ok()
        }
        _ => None,
    }
}

async fn count_invalid_mark_ids(
    tx: &mut Transaction<'_, Postgres>,
    documents: &[String],
) -> Result<u64, sqlx::Error> {
    let count = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM "Thread" t
           WHERE t."documentId" = ANY($1) AND t."deletedAt" IS NULL
             AND t.metadata->>'markId' IS NOT NULL
             AND t.metadata->>'markId' !~ $2
             AND t.metadata->>'markId' NOT LIKE $3
             AND NOT EXISTS (SELECT 1 FROM "PdfPlaceableCommentAnchor" p WHERE p."threadId" = t.id AND NOT p."wasDeleted")
             AND NOT EXISTS (SELECT 1 FROM "PdfHighlightAnchor" h
                             WHERE h."threadId" = t.id AND h."deletedAt" IS NULL)"#,
        documents,
        UUID_PATTERN,
        format!("{DISCUSSION_MARK_PREFIX}%"),
    )
    .fetch_one(&mut **tx)
    .await?;
    Ok(count as u64)
}

/// Roots are fixed at first import; a legacy reorder afterwards is reported, not applied.
async fn count_root_order_drift(
    tx: &mut Transaction<'_, Postgres>,
    documents: &[String],
) -> Result<u64, sqlx::Error> {
    let count = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM "Thread" t
           JOIN migrated_comment_thread_id tm ON tm.thread_id = t.id
           JOIN LATERAL (
               SELECT cm.message_id FROM "Comment" c
               JOIN migrated_comment_id cm ON cm.comment_id = c.id
               WHERE c."threadId" = t.id
               ORDER BY c."order" NULLS LAST, c."createdAt", c.id LIMIT 1
           ) first ON true
           WHERE t."documentId" = ANY($1) AND first.message_id <> tm.root_id"#,
        documents,
    )
    .fetch_one(&mut **tx)
    .await?;
    Ok(count as u64)
}

#[cfg(test)]
#[path = "test.rs"]
mod test;
