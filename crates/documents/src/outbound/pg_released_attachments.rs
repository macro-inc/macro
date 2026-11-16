//! PostgreSQL implementation of the released-attachment queue
//! ([`ReleasedAttachmentRepo`]).

use crate::domain::released_attachments::{
    QUEUE_DEPTH_CAP, ReleaseQueue, ReleasedAttachmentRepo, ReleasedBatch,
};
use sqlx::PgPool;

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

/// A claimed document that is still live, and what its owner did with it.
struct LiveRelease {
    id: String,
    relinked: bool,
    adopted: bool,
}

impl ReleasedAttachmentRepo for PgReleasedAttachmentRepo {
    type Err = sqlx::Error;

    #[tracing::instrument(skip(self), err)]
    async fn trash_released_batch(&self, limit: u32) -> Result<ReleasedBatch, Self::Err> {
        let mut transaction = self.pool.begin().await?;
        sqlx::query!("SET LOCAL statement_timeout = '30s'")
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

        // Lock the live documents in id order. Linking a document takes a key
        // lock on its row, so none can be linked again until this commits, and
        // the checks below see the final state. Each id is its own index probe.
        let live = sqlx::query_scalar!(
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
                WHERE d.id = released.id AND d."deletedAt" IS NULL
                FOR UPDATE
            ) locked
            "#,
            &claimed,
        )
        .fetch_all(&mut *transaction)
        .await?;

        // Adopted: moved into a folder, shared (a grant to anyone but the owner,
        // or sharing changed after import), or edited (a second version, a PDF
        // highlight or placed comment, a comment thread). The OFFSET fences keep
        // each check a probe per document; without them stale statistics turn
        // a check into a hash of its whole table.
        let checked = sqlx::query_as!(
            LiveRelease,
            r#"
            SELECT
                d.id AS "id!",
                EXISTS (
                    SELECT 1 FROM document_email de WHERE de.document_id = d.id OFFSET 0
                ) AS "relinked!",
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
                        SELECT 1 FROM "DocumentInstance" i WHERE i."documentId" = d.id OFFSET 1
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
                SELECT d.id, d.owner, d."projectId"
                FROM "Document" d
                WHERE d.id = live.id
                OFFSET 0
            ) d
            "#,
            &live,
        )
        .fetch_all(&mut *transaction)
        .await?;

        let relinked = checked.iter().filter(|release| release.relinked).count();
        let adopted = checked
            .iter()
            .filter(|release| !release.relinked && release.adopted)
            .count();
        let trashed: Vec<String> = checked
            .into_iter()
            .filter(|release| !release.relinked && !release.adopted)
            .map(|release| release.id)
            .collect();

        if !trashed.is_empty() {
            trash(&mut transaction, &trashed).await?;
        }
        transaction.commit().await?;

        Ok(ReleasedBatch {
            claimed: claimed.len(),
            missing: claimed.len() - live.len(),
            relinked,
            adopted,
            trashed,
        })
    }

    #[tracing::instrument(skip(self), err)]
    async fn queue(&self) -> Result<ReleaseQueue, Self::Err> {
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
        .fetch_one(&self.pool)
        .await?;

        Ok(ReleaseQueue {
            depth: row.depth,
            oldest_age_seconds: row.oldest_age_seconds,
        })
    }
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
