//! PostgreSQL implementation of the orphaned attachment scan's storage
//! ([`OrphanedAttachmentRepo`]).
//!
//! The walk pages through `entity_properties` in `entity_id` order. No index
//! leads with the Source property's definition and orders its rows, so a page
//! is a window of `page_size` rows of every property, read through
//! `idx_entity_properties_entity_id`, and each entity in it is probed by
//! `(entity_id, entity_type)` for its rows; the Source row is picked from
//! those behind an `OFFSET 0` fence. A page's cost follows from its size
//! wherever the Source rows thin out, such as across a database import's
//! cells. Neither a range over the window nor a probe naming the definition
//! survives stale statistics: both let the planner take
//! `idx_entity_properties_property_definition_id` and read every Source row,
//! once a page or once an entity.

use super::{PgReleasedAttachmentRepo, classify, decide, queue_stats};
use crate::domain::released_attachments::orphans::{Orphan, OrphanPage, OrphanedAttachmentRepo};
use crate::domain::released_attachments::{ReleaseQueue, ReleasedBatch};
use std::num::NonZeroU32;

#[cfg(test)]
mod test;

impl OrphanedAttachmentRepo for PgReleasedAttachmentRepo {
    type Err = sqlx::Error;

    #[tracing::instrument(skip(self), err)]
    async fn orphan_page(
        &self,
        after: &str,
        page_size: NonZeroU32,
    ) -> Result<OrphanPage, Self::Err> {
        let mut transaction = self.pool.begin().await?;
        sqlx::query!("SET LOCAL statement_timeout = '10s'")
            .execute(&mut *transaction)
            .await?;

        let mut window = sqlx::query_scalar!(
            r#"
            SELECT ep.entity_id
            FROM entity_properties ep
            WHERE ep.entity_id > $1
            ORDER BY ep.entity_id
            LIMIT $2
            "#,
            after,
            i64::from(page_size.get()),
        )
        .fetch_all(&mut *transaction)
        .await?;
        window.dedup();
        let Some(last_entity_id) = window.last().cloned() else {
            transaction.commit().await?;
            return Ok(OrphanPage::default());
        };

        // Each entity's Source row naming an email thread, then the liveness
        // and no-link probes and what is left of its mail, every one a probe
        // by key behind an OFFSET fence. The definition is matched outside the
        // entity's fence so no plan can probe through its index. The import always writes UUIDs;
        // anything else reads as a thread and message that are gone rather
        // than failing the page.
        //
        // The import wrote the Source row when the document's Recipients row
        // was inserted by the same statement (the import always writes both,
        // so they share its transaction's timestamp) and the Source row was
        // never updated (the import only inserts). Setting a property by hand
        // writes one row per statement and an edit moves `updated_at`. The
        // document's own creation time can't tell: an import dates a
        // backfilled document by its mail.
        let orphans = sqlx::query_as!(
            Orphan,
            r#"
            SELECT
                d.id AS "document_id!",
                source.from_import AS "source_from_import!",
                EXISTS (
                    SELECT 1 FROM email_links l WHERE l.macro_id = d.owner OFFSET 0
                ) AS "mailbox_kept!",
                EXISTS (
                    SELECT 1
                    FROM email_links l
                    WHERE l.macro_id = d.owner AND l.created_at < d."createdAt"
                    OFFSET 0
                ) AS "mailbox_predates_document!",
                EXISTS (
                    SELECT 1 FROM email_threads t WHERE t.id = source.thread_id OFFSET 0
                ) AS "thread_kept!",
                EXISTS (
                    SELECT 1 FROM email_messages m WHERE m.id = source.message_id OFFSET 0
                ) AS "message_kept!"
            FROM (
                SELECT
                    ep.entity_id,
                    CASE
                        WHEN ep.values->'value'->0->>'entity_id'
                            ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                        THEN (ep.values->'value'->0->>'entity_id')::uuid
                    END AS thread_id,
                    CASE
                        WHEN ep.values->'value'->0->>'specific_message_id'
                            ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                        THEN (ep.values->'value'->0->>'specific_message_id')::uuid
                    END AS message_id,
                    ep.updated_at = ep.created_at
                        AND EXISTS (
                            SELECT 1
                            FROM (
                                SELECT r.property_definition_id, r.created_at
                                FROM entity_properties r
                                WHERE r.entity_id = ep.entity_id AND r.entity_type = 'DOCUMENT'
                                OFFSET 0
                            ) r
                            WHERE r.property_definition_id = '00000001-0000-0000-0000-00000000000e'
                                AND r.created_at = ep.created_at
                        ) AS from_import
                FROM unnest($1::text[]) AS scanned(entity_id)
                CROSS JOIN LATERAL (
                    SELECT ep.entity_id, ep.property_definition_id, ep.values, ep.created_at, ep.updated_at
                    FROM entity_properties ep
                    WHERE ep.entity_id = scanned.entity_id AND ep.entity_type = 'DOCUMENT'
                    OFFSET 0
                ) ep
                WHERE ep.property_definition_id = '00000001-0000-0000-0000-00000000000b'
                    AND ep.values->'value'->0->>'entity_type' = 'THREAD'
            ) source
            CROSS JOIN LATERAL (
                SELECT d.id, d.owner, d."createdAt"
                FROM "Document" d
                WHERE d.id = source.entity_id AND d."deletedAt" IS NULL
                OFFSET 0
            ) d
            WHERE NOT EXISTS (
                SELECT 1 FROM document_email de WHERE de.document_id = d.id OFFSET 0
            )
            ORDER BY d.id
            "#,
            &window,
        )
        .fetch_all(&mut *transaction)
        .await?;
        transaction.commit().await?;

        Ok(OrphanPage {
            last_entity_id: Some(last_entity_id),
            orphans,
        })
    }

    #[tracing::instrument(skip_all, fields(documents = document_ids.len()), err)]
    async fn preview_drain(&self, document_ids: &[String]) -> Result<ReleasedBatch, Self::Err> {
        let mut transaction = self.pool.begin().await?;
        sqlx::query!("SET LOCAL statement_timeout = '30s'")
            .execute(&mut *transaction)
            .await?;
        let releases = classify(&mut *transaction, document_ids).await?;
        transaction.commit().await?;

        let missing = document_ids.len().saturating_sub(releases.len());
        Ok(decide(document_ids.len(), missing, releases))
    }

    #[tracing::instrument(skip_all, fields(documents = document_ids.len()), err)]
    async fn enqueue(&self, document_ids: &[String]) -> Result<usize, Self::Err> {
        let mut transaction = self.pool.begin().await?;
        sqlx::query!("SET LOCAL statement_timeout = '10s'")
            .execute(&mut *transaction)
            .await?;
        // A row the drain is deleting holds this insert until the drain
        // commits, and while it waits the rows it already inserted hold back
        // the release trigger of whoever deletes their mail. As in the drain,
        // it gives up under the deadlock detector's 1 s and the scan stops.
        sqlx::query!("SET LOCAL lock_timeout = '500ms'")
            .execute(&mut *transaction)
            .await?;

        // In id order, as the release trigger inserts, so the two never take
        // the same rows' locks in opposite orders.
        let queued = sqlx::query_scalar!(
            r#"
            INSERT INTO released_email_attachment_documents (document_id)
            SELECT orphan.id
            FROM unnest($1::text[]) AS orphan(id)
            ORDER BY orphan.id
            ON CONFLICT (document_id) DO NOTHING
            RETURNING document_id
            "#,
            document_ids,
        )
        .fetch_all(&mut *transaction)
        .await?;
        transaction.commit().await?;

        Ok(queued.len())
    }

    #[tracing::instrument(skip(self), err)]
    async fn notify_drain(&self) -> Result<(), Self::Err> {
        sqlx::query!("SELECT pg_notify('email_attachment_documents_released', '')")
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn queue_depth(&self) -> Result<i64, Self::Err> {
        let mut transaction = self.pool.begin().await?;
        sqlx::query!("SET LOCAL statement_timeout = '10s'")
            .execute(&mut *transaction)
            .await?;
        let ReleaseQueue { depth, .. } = queue_stats(&mut *transaction).await?;
        transaction.commit().await?;

        Ok(depth)
    }
}
