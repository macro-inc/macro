//! PostgreSQL adapter for markdown lifecycle backfill.

use crate::domain::markdown_backfill::{MarkdownBackfillCandidate, MarkdownBackfillRepo};
use crate::outbound::pg_document_repo::PgDocumentRepo;

impl MarkdownBackfillRepo for PgDocumentRepo {
    #[tracing::instrument(err, skip(self))]
    async fn fetch_markdown_backfill_candidates(
        &self,
        start_after: Option<&str>,
        limit: i64,
    ) -> anyhow::Result<Vec<MarkdownBackfillCandidate>> {
        let rows =
            sqlx::query_as::<_, (String, String, Option<i64>, bool, String, Option<String>)>(
                r#"
            SELECT
                d.id,
                d.owner,
                di.id AS document_instance_id,
                d.uploaded,
                d."contentState" AS content_state,
                d."contentLocation" AS content_location
            FROM "Document" d
            LEFT JOIN LATERAL (
                SELECT i.id
                FROM "DocumentInstance" i
                WHERE i."documentId" = d.id
                ORDER BY i."createdAt" DESC
                LIMIT 1
            ) di ON TRUE
            WHERE d."fileType" = 'md'
              AND (
                  d."contentState" IS DISTINCT FROM 'ready'
                  OR d."contentLocation" IS DISTINCT FROM 'sync_service'
              )
              AND ($1::text IS NULL OR d.id > $1)
            ORDER BY d.id
            LIMIT $2
            "#,
            )
            .bind(start_after)
            .bind(limit)
            .fetch_all(&self.pool)
            .await?;

        Ok(rows
            .into_iter()
            .map(
                |(id, owner, document_instance_id, uploaded, content_state, content_location)| {
                    MarkdownBackfillCandidate {
                        id,
                        owner,
                        document_instance_id,
                        uploaded,
                        content_state,
                        content_location,
                    }
                },
            )
            .collect())
    }

    #[tracing::instrument(err, skip(self, candidates), fields(count = candidates.len()))]
    async fn mark_markdown_sync_service_ready(
        &self,
        candidates: &[MarkdownBackfillCandidate],
    ) -> anyhow::Result<u64> {
        if candidates.is_empty() {
            return Ok(0);
        }

        let ids = candidates
            .iter()
            .map(|candidate| candidate.id.clone())
            .collect::<Vec<_>>();
        let document_instance_ids = candidates
            .iter()
            .map(|candidate| candidate.document_instance_id)
            .collect::<Vec<_>>();
        let content_states = candidates
            .iter()
            .map(|candidate| candidate.content_state.clone())
            .collect::<Vec<_>>();
        let content_locations = candidates
            .iter()
            .map(|candidate| candidate.content_location.clone())
            .collect::<Vec<_>>();

        sqlx::query(
            r#"
            WITH input AS (
                SELECT *
                FROM UNNEST(
                    $1::text[],
                    $2::bigint[],
                    $3::text[],
                    $4::text[]
                ) AS input(id, document_instance_id, content_state, content_location)
            )
            UPDATE "Document" d
            SET "contentState" = 'ready',
                "contentLocation" = 'sync_service',
                "updatedAt" = NOW()
            FROM input
            WHERE d.id = input.id
              AND d."contentState" IS NOT DISTINCT FROM input.content_state
              AND d."contentLocation" IS NOT DISTINCT FROM input.content_location
              AND (
                  SELECT i.id
                  FROM "DocumentInstance" i
                  WHERE i."documentId" = d.id
                  ORDER BY i."createdAt" DESC
                  LIMIT 1
              ) IS NOT DISTINCT FROM input.document_instance_id
            "#,
        )
        .bind(ids)
        .bind(document_instance_ids)
        .bind(content_states)
        .bind(content_locations)
        .execute(&self.pool)
        .await
        .map(|result| result.rows_affected())
        .map_err(Into::into)
    }
}
