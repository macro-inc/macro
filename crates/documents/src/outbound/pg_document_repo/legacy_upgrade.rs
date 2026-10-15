//! Persistence for swapping a legacy Office document to its OpenXML upgrade.

use entity_registry::BotFacts;
use model::document::FileType;

use crate::domain::content::DocumentContent;
use crate::domain::legacy_office_upgrade::LegacyOfficeUpgradeRepoPort;
use crate::domain::models::DocumentError;
use crate::domain::ports::DocumentRepo;

use super::PgDocumentRepo;

fn internal(error: sqlx::Error) -> DocumentError {
    DocumentError::Internal(error.into())
}

impl<B: BotFacts + 'static> LegacyOfficeUpgradeRepoPort for PgDocumentRepo<B> {
    #[tracing::instrument(err, skip(self))]
    async fn create_document_instance(
        &self,
        document_id: &str,
        sha: &str,
    ) -> Result<i64, DocumentError> {
        sqlx::query_scalar!(
            r#"
            INSERT INTO "DocumentInstance" ("documentId", "sha", "createdAt", "updatedAt")
            VALUES ($1, $2, NOW(), NOW())
            RETURNING id
            "#,
            document_id,
            sha,
        )
        .fetch_one(&self.pool)
        .await
        .map_err(internal)
    }

    #[tracing::instrument(err, skip(self))]
    async fn delete_document_instance(&self, version_id: i64) -> Result<(), DocumentError> {
        sqlx::query!(
            r#"DELETE FROM "DocumentInstance" WHERE id = $1"#,
            version_id,
        )
        .execute(&self.pool)
        .await
        .map_err(internal)?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn create_document_bom(&self, document_id: &str) -> Result<i64, DocumentError> {
        sqlx::query_scalar!(
            r#"
            INSERT INTO "DocumentBom" ("documentId", "createdAt", "updatedAt")
            VALUES ($1, NOW(), NOW())
            RETURNING id
            "#,
            document_id,
        )
        .fetch_one(&self.pool)
        .await
        .map_err(internal)
    }

    #[tracing::instrument(err, skip(self))]
    async fn delete_document_bom(&self, bom_id: i64) -> Result<(), DocumentError> {
        sqlx::query!(r#"DELETE FROM "DocumentBom" WHERE id = $1"#, bom_id)
            .execute(&self.pool)
            .await
            .map_err(internal)?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn swap_document_file_type(
        &self,
        document_id: &str,
        from: FileType,
        to: FileType,
    ) -> Result<bool, DocumentError> {
        entity_access_db_utils::transaction_retry::on_conflict(
            || async {
                let mut transaction = self.pool.begin().await?;
                // Stored file types can carry the upload's casing, so compare
                // case-insensitively and always write the canonical lowercase type.
                let result = sqlx::query!(
                    r#"
                    UPDATE "Document"
                    SET "fileType" = $3,
                        "updatedAt" = NOW()
                    WHERE id = $1 AND LOWER("fileType") = $2
                    "#,
                    document_id,
                    from.as_str(),
                    to.as_str(),
                )
                .execute(transaction.as_mut())
                .await
                .map_err(internal)?;
                source_items::sync_one(
                    transaction.as_mut(),
                    model_entity::EntityType::Document,
                    document_id,
                )
                .await?;
                transaction.commit().await?;
                Ok(result.rows_affected() == 1)
            },
            |error: &DocumentError| {
                entity_access_db_utils::transaction_retry::is_transaction_conflict(error)
            },
        )
        .await
    }

    #[tracing::instrument(err, skip(self, content))]
    async fn set_document_content(
        &self,
        document_id: &str,
        content: DocumentContent,
    ) -> Result<(), DocumentError> {
        DocumentRepo::set_document_content(self, document_id, content)
            .await
            .map_err(internal)
    }
}

#[cfg(test)]
mod tests;
