//! Reads of `document_email`, the links from documents to the email
//! attachments they were imported from.

use rootcause::Report;
use sqlx::PgPool;

use crate::domain::email_attachment_status::{LinkedDocument, LinkedDocumentSource, PageSize};

/// Whether a `document_email` row links the document to an email attachment:
/// one probe of the primary key, which leads with `document_id`.
#[tracing::instrument(skip(db), err)]
pub async fn is_email_attachment(db: &PgPool, document_id: &str) -> sqlx::Result<bool> {
    sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM document_email WHERE document_id = $1) AS "is_email_attachment!""#,
        document_id
    )
    .fetch_one(db)
    .await
}

/// Linked documents for the email attachment status backfill, read from the
/// primary: a lagging replica could still show a link a release removed.
pub struct PgLinkedDocuments {
    db: PgPool,
}

impl PgLinkedDocuments {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
}

impl LinkedDocumentSource for PgLinkedDocuments {
    #[tracing::instrument(skip(self, limit), fields(limit = limit.get()), err(Debug))]
    async fn page_after(
        &self,
        after_document_id: Option<&str>,
        limit: PageSize,
    ) -> Result<Vec<LinkedDocument>, Report> {
        let mut transaction = self.db.begin().await?;

        // A page is one bounded walk of the `document_email` primary key and
        // one `Document` probe per row, a few milliseconds. Give up well
        // before a slow page holds the job.
        sqlx::query!("SET LOCAL statement_timeout = '10s'")
            .execute(&mut *transaction)
            .await?;

        // The page is limited before liveness is checked, and the check is a
        // LATERAL subquery with its own LIMIT so it stays one index probe per
        // row: as a join or an EXISTS, a generic or stale-statistics plan
        // merges or hashes the whole `Document` table instead.
        let rows = sqlx::query!(
            r#"
            SELECT
                page.document_id AS "document_id!",
                live.id IS NOT NULL AS "is_live!"
            FROM (
                SELECT DISTINCT de.document_id
                FROM document_email de
                WHERE de.document_id > COALESCE($1, '')
                ORDER BY de.document_id
                LIMIT $2
            ) page
            LEFT JOIN LATERAL (
                SELECT d.id
                FROM "Document" d
                WHERE d.id = page.document_id AND d."deletedAt" IS NULL
                LIMIT 1
            ) live ON true
            ORDER BY page.document_id
            "#,
            after_document_id,
            i64::from(limit.get()),
        )
        .fetch_all(&mut *transaction)
        .await?;

        transaction.commit().await?;

        Ok(rows
            .into_iter()
            .map(|row| LinkedDocument {
                document_id: row.document_id,
                is_live: row.is_live,
            })
            .collect())
    }
}

#[cfg(test)]
mod test;
