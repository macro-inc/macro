//! PostgreSQL implementation of the released-attachment queue
//! ([`ReleasedAttachmentRepo`]).

use crate::domain::released_attachments::{
    QUEUE_DEPTH_CAP, ReleaseQueue, ReleasedAttachmentRepo, ReleasedBatch,
};
use sqlx::PgPool;

mod orphans;
#[cfg(test)]
mod test;

/// The released-attachment queue in MacroDB.
#[derive(Clone)]
pub struct PgReleasedAttachmentRepo {
    pool: PgPool,
}

impl PgReleasedAttachmentRepo {
    /// Build the repository over the primary pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

/// A claimed document that still exists, and what became of it.
struct Release {
    id: String,
    relinked: bool,
    in_trash: bool,
    adopted: bool,
}

/// What a batch does with one released document.
enum Outcome {
    Relinked,
    Trash,
    KeepAdopted,
    KeepInTrash,
}

impl Release {
    fn outcome(&self) -> Outcome {
        if self.relinked {
            Outcome::Relinked
        } else if self.in_trash {
            Outcome::KeepInTrash
        } else if self.adopted {
            Outcome::KeepAdopted
        } else {
            Outcome::Trash
        }
    }
}

impl ReleasedAttachmentRepo for PgReleasedAttachmentRepo {
    type Err = sqlx::Error;

    #[tracing::instrument(skip(self), err)]
    async fn trash_released_batch(&self, limit: u32) -> Result<ReleasedBatch, Self::Err> {
        let mut transaction = self.pool.begin().await?;
        sqlx::query!("SET LOCAL statement_timeout = '30s'")
            .execute(&mut *transaction)
            .await?;
        // Under the deadlock detector's 1 s, so in a lock cycle with a user's
        // transaction the batch gives up first; its rows go back to the queue
        // and the next round retries them.
        sqlx::query!("SET LOCAL lock_timeout = '500ms'")
            .execute(&mut *transaction)
            .await?;

        // Every claimed row leaves the queue, whatever the batch decides. The
        // claimed ids are matched as an array so a generic plan, which cannot
        // see the limit, still deletes by key instead of hashing the queue.
        let claimed = sqlx::query_scalar!(
            r#"
            DELETE FROM released_email_attachment_documents
            WHERE document_id = ANY(ARRAY(
                SELECT document_id
                FROM released_email_attachment_documents
                ORDER BY released_at
                LIMIT $1
                FOR UPDATE SKIP LOCKED
            ))
            RETURNING document_id
            "#,
            i64::from(limit),
        )
        .fetch_all(&mut *transaction)
        .await?;
        if claimed.is_empty() {
            transaction.commit().await?;
            return Ok(ReleasedBatch::default());
        }

        // Lock the documents in id order, those already in the Trash included.
        // Linking a document takes a key lock on its row, so none can be linked
        // again until this commits, and the checks below see the final state.
        // Each id is its own index probe.
        let existing = sqlx::query_scalar!(
            r#"
            SELECT locked.id AS "id!"
            FROM (
                SELECT DISTINCT released.id
                FROM unnest($1::text[]) AS released(id)
                ORDER BY released.id
            ) released
            CROSS JOIN LATERAL (
                SELECT d.id
                FROM "Document" d
                WHERE d.id = released.id
                FOR UPDATE
            ) locked
            "#,
            &claimed,
        )
        .fetch_all(&mut *transaction)
        .await?;

        let checked = classify(&mut *transaction, &existing).await?;
        let batch = decide(
            claimed.len(),
            claimed.len().saturating_sub(existing.len()),
            checked,
        );

        if !batch.trashed.is_empty() {
            trash(&mut transaction, &batch.trashed).await?;
        }
        transaction.commit().await?;

        Ok(batch)
    }

    #[tracing::instrument(skip(self), err)]
    async fn queue(&self) -> Result<ReleaseQueue, Self::Err> {
        queue_stats(&self.pool).await
    }
}

/// The queue's depth, counted up to [`QUEUE_DEPTH_CAP`], and the age of its
/// oldest row.
async fn queue_stats<'e>(executor: impl sqlx::PgExecutor<'e>) -> Result<ReleaseQueue, sqlx::Error> {
    let row = sqlx::query!(
        r#"
            SELECT
                (
                    SELECT COUNT(*)
                    FROM (SELECT 1 FROM released_email_attachment_documents LIMIT $1) waiting
                ) AS "depth!",
                (
                    SELECT EXTRACT(EPOCH FROM now() - MIN(released_at))::bigint
                    FROM released_email_attachment_documents
                ) AS "oldest_age_seconds"
            "#,
        QUEUE_DEPTH_CAP,
    )
    .fetch_one(executor)
    .await?;

    Ok(ReleaseQueue {
        depth: row.depth,
        oldest_age_seconds: row.oldest_age_seconds,
    })
}

/// What the drain decides about each of `document_ids` that still exists.
///
/// It only reads. The drain runs it on the documents it has just locked, so
/// what it reads is final; the orphan scan runs it on documents it has not
/// queued yet, to preview the drain.
async fn classify<'e>(
    executor: impl sqlx::PgExecutor<'e>,
    document_ids: &[String],
) -> Result<Vec<Release>, sqlx::Error> {
    // Adopted: moved into a folder, shared (a grant to anyone but the owner,
    // or sharing changed after import), renamed, moved or reshared through
    // `edit_document` (recorded as an `edited` activity), or edited (a second
    // version with content of its own, a placeable added, changed or removed
    // in the PDF viewer, a PDF highlight or placed comment, a comment thread).
    // Opening is not adopting: the PDF viewer saves a version holding only its
    // modification data on the first open by anyone who can edit, and again
    // when it closes. The OFFSET fences keep each check a probe per document;
    // without them stale statistics turn a check into a hash of its whole
    // table.
    sqlx::query_as!(
        Release,
        r#"
            SELECT
                d.id AS "id!",
                EXISTS (
                    SELECT 1 FROM document_email de WHERE de.document_id = d.id OFFSET 0
                ) AS "relinked!",
                d."deletedAt" IS NOT NULL AS "in_trash!",
                (
                    d."projectId" IS NOT NULL
                    OR EXISTS (
                        SELECT 1
                        FROM entity_access ea
                        WHERE ea.entity_id::text = d.id
                            AND ea.entity_type = 'document'
                            AND ea.source_id <> d.owner
                        OFFSET 0
                    )
                    OR EXISTS (
                        SELECT 1
                        FROM "DocumentPermission" dp
                        JOIN "SharePermission" sp ON sp.id = dp."sharePermissionId"
                        WHERE dp."documentId" = d.id AND sp."updatedAt" > sp."createdAt"
                        OFFSET 0
                    )
                    OR EXISTS (
                        SELECT 1
                        FROM activity_events a
                        WHERE a.entity_type = 'document'
                            AND a.entity_id = d.id
                            AND a.action = 'edited'
                        OFFSET 0
                    )
                    OR EXISTS (
                        SELECT 1
                        FROM "DocumentInstance" i
                        WHERE i."documentId" = d.id
                            AND NOT EXISTS (
                                SELECT 1
                                FROM "DocumentInstanceModificationData" m
                                WHERE m."documentInstanceId" = i.id
                                OFFSET 0
                            )
                        OFFSET 1
                    )
                    OR EXISTS (
                        SELECT 1
                        FROM (
                            SELECT saved.placeables
                            FROM "DocumentInstance" i
                            CROSS JOIN LATERAL (
                                SELECT CASE
                                    WHEN jsonb_typeof(m."modificationData"->'placeables') = 'array'
                                    THEN m."modificationData"->'placeables'
                                    ELSE '[]'::jsonb
                                END AS placeables
                                FROM "DocumentInstanceModificationData" m
                                WHERE m."documentInstanceId" = i.id
                                OFFSET 0
                            ) saved
                            WHERE i."documentId" = d.id
                            OFFSET 0
                        ) saved
                        HAVING COUNT(DISTINCT jsonb_array_length(saved.placeables)) > 1
                            OR BOOL_OR(EXISTS (
                                SELECT 1
                                FROM jsonb_array_elements(saved.placeables) p
                                WHERE p->'originalIndex' = '-1'::jsonb
                                    OR p->'wasEdited' = 'true'::jsonb
                            ))
                    )
                    OR EXISTS (
                        SELECT 1 FROM "PdfHighlightAnchor" h WHERE h."documentId" = d.id OFFSET 0
                    )
                    OR EXISTS (
                        SELECT 1
                        FROM "PdfPlaceableCommentAnchor" c
                        WHERE c."documentId" = d.id
                        OFFSET 0
                    )
                    OR EXISTS (
                        SELECT 1
                        FROM comms_message_threads t
                        WHERE t.parent_entity_type = 'document' AND t.parent_entity_id = d.id
                        OFFSET 0
                    )
                ) AS "adopted!"
            FROM unnest($1::text[]) AS live(id)
            CROSS JOIN LATERAL (
                SELECT d.id, d.owner, d."projectId", d."deletedAt"
                FROM "Document" d
                WHERE d.id = live.id
                OFFSET 0
            ) d
            "#,
        document_ids,
    )
    .fetch_all(executor)
    .await
}

/// Sort checked documents by what the drain does with them, for `claimed`
/// queue rows of which `missing` named no document.
fn decide(claimed: usize, missing: usize, releases: Vec<Release>) -> ReleasedBatch {
    let mut batch = ReleasedBatch {
        claimed,
        missing,
        ..ReleasedBatch::default()
    };
    for release in releases {
        match release.outcome() {
            Outcome::Relinked => batch.relinked += 1,
            Outcome::Trash => batch.trashed.push(release.id),
            Outcome::KeepAdopted => {
                batch.adopted += 1;
                batch.kept.push(release.id);
            }
            Outcome::KeepInTrash => batch.kept.push(release.id),
        }
    }

    batch
}

/// What a document's own trash writes (`PgDocumentRepo::soft_delete_document`),
/// for a whole batch: pins and view history go, `deletedAt` is set, and the
/// entity registry marks the documents deleted.
async fn trash(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    document_ids: &[String],
) -> Result<(), sqlx::Error> {
    // Each document's pins are found through Pin_pinnedItemId_idx; a plain
    // join lets stale statistics read every document pin instead.
    sqlx::query!(
        r#"
        DELETE FROM "Pin" p
        USING (
            SELECT pin.ctid AS pin_ctid
            FROM unnest($1::text[]) AS trashed(id)
            CROSS JOIN LATERAL (
                SELECT ctid
                FROM "Pin"
                WHERE "pinnedItemId" = trashed.id AND "pinnedItemType" = 'document'
                OFFSET 0
            ) pin
        ) found
        WHERE p.ctid = found.pin_ctid
        "#,
        document_ids,
    )
    .execute(&mut **transaction)
    .await?;
    sqlx::query!(
        r#"
        DELETE FROM "UserHistory" h
        USING unnest($1::text[]) AS trashed(id)
        WHERE h."itemId" = trashed.id AND h."itemType" = 'document'
        "#,
        document_ids,
    )
    .execute(&mut **transaction)
    .await?;
    sqlx::query!(
        r#"
        UPDATE "Document" d
        SET "deletedAt" = NOW()
        FROM unnest($1::text[]) AS trashed(id)
        WHERE d.id = trashed.id
        "#,
        document_ids,
    )
    .execute(&mut **transaction)
    .await?;

    let entity_ids: Vec<uuid::Uuid> = document_ids
        .iter()
        .filter_map(|id| macro_uuid::string_to_uuid(id).ok())
        .collect();
    entity_registry_db_utils::mark_deleted_many(transaction, &entity_ids, chrono::Utc::now())
        .await
        .map_err(|error| sqlx::Error::Protocol(error.to_string()))?;

    Ok(())
}
