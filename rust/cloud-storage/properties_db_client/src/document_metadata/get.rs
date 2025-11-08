//! Get document metadata from macrodb.

use crate::error::PropertiesDatabaseError;
use models_properties::service::document_metadata::DocumentMetadata;
use sqlx::{Pool, Postgres};

type Result<T> = std::result::Result<T, PropertiesDatabaseError>;

/// Get document metadata by document ID from macrodb
#[tracing::instrument(skip(db))]
pub async fn get_document_metadata(
    db: &Pool<Postgres>,
    document_id: &str,
) -> Result<Option<DocumentMetadata>> {
    let result = sqlx::query!(
        r#"
        SELECT
            d.id,
            d.name,
            d.owner,
            d."fileType" as "file_type",
            d."projectId" as "project_id",
            d."createdAt"::timestamptz as "created_at!",
            d."updatedAt"::timestamptz as "updated_at!"
        FROM
            "Document" d
        WHERE
            d.id = $1 AND d."deletedAt" IS NULL
        "#,
        document_id
    )
    .fetch_optional(db)
    .await
    .map_err(|e| {
        tracing::error!(
            error = ?e,
            document_id = %document_id,
            "failed to fetch document metadata"
        );
        PropertiesDatabaseError::Query(e)
    })?;

    Ok(result.map(|row| DocumentMetadata {
        id: row.id,
        name: row.name,
        owner: row.owner,
        file_type: row.file_type,
        project_id: row.project_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }))
}
