use model::project::Project;
use model_owner::Owner;
use sqlx::{Pool, Postgres};

/// Fetch a project row for search indexing. Soft-deleted rows are returned
/// so the caller can turn the upsert into a
/// removal, and a missing row maps to `None` instead of an error.
#[tracing::instrument(skip(db), err)]
pub async fn get_project_for_search(
    db: &Pool<Postgres>,
    project_id: &str,
) -> anyhow::Result<Option<Project>> {
    let result = sqlx::query!(
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
    .try_map(|row| {
        Ok(Project {
            id: row.id,
            name: row.name,
            user_id: Owner::from_principal_str(&row.user_id)
                .map_err(|error| sqlx::Error::Decode(Box::new(error)))?,
            parent_id: row.parent_id,
            created_at: row.created_at,
            updated_at: row.updated_at,
            deleted_at: row.deleted_at,
        })
    })
    .fetch_optional(db)
    .await?;

    Ok(result)
}
