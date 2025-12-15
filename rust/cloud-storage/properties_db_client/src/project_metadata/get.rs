//! Get project metadata from macrodb.

use crate::error::PropertiesDatabaseError;
use models_properties::service::project_metadata::ProjectMetadata;
use sqlx::{Pool, Postgres};

type Result<T> = std::result::Result<T, PropertiesDatabaseError>;

/// Get project metadata by project ID from macrodb
#[tracing::instrument(skip(db), err)]
pub async fn get_project_metadata(
    db: &Pool<Postgres>,
    project_id: &str,
) -> Result<Option<ProjectMetadata>> {
    sqlx::query_as!(
        ProjectMetadata,
        r#"
        SELECT
            p.id,
            p.name,
            p."userId" as "owner",
            p."parentId" as "parent_id",
            p."createdAt"::timestamptz as "created_at!",
            p."updatedAt"::timestamptz as "updated_at!"
        FROM
            "Project" p
        WHERE
            p.id = $1 AND p."deletedAt" IS NULL
        "#,
        project_id
    )
    .fetch_optional(db)
    .await
    .map_err(PropertiesDatabaseError::Query)
}
