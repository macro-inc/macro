use sqlx::{Pool, Postgres};

use model::project::Project;

/// Fetch a project row for search indexing. Soft-deleted rows are returned
/// so the caller can turn the upsert into a
/// removal, and a missing row maps to `None` instead of an error.
#[tracing::instrument(skip(db), err)]
pub async fn get_project_for_search(
    db: &Pool<Postgres>,
    project_id: &str,
) -> anyhow::Result<Option<Project>> {
    let result = sqlx::query_as!(
        Project,
        r#"
            SELECT
                p.id,
                p.name,
                p."userId" as user_id,
                p."parentId" as parent_id,
                p."createdAt"::timestamptz as created_at,
                p."updatedAt"::timestamptz as updated_at,
                p."deletedAt"::timestamptz as deleted_at
            FROM "Project" p
            WHERE id = $1
        "#,
        project_id
    )
    .fetch_optional(db)
    .await?;

    Ok(result)
}
