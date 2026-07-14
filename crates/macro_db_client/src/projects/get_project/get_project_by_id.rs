use sqlx::{Pool, Postgres};

use model::project::Project;

/// Fetch a project row for search indexing. Unlike [`get_project_by_id`],
/// soft-deleted rows are returned so the caller can turn the upsert into a
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

#[tracing::instrument(skip(db))]
pub async fn get_project_by_id(
    db: Pool<Postgres>,
    project_id: &str,
) -> Result<Project, sqlx::Error> {
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
            WHERE id = $1 AND p."deletedAt" IS NULL
        "#,
        project_id
    )
    .fetch_one(&db)
    .await?;

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("users", "projects")))]
    async fn test_get_project_by_id(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let project = get_project_by_id(pool.clone(), &"p1").await?;
        assert_eq!(project.id, "p1".to_string());
        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("users", "projects")))]
    async fn test_get_project_by_id_not_found(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let result = get_project_by_id(pool.clone(), &"project-bad").await;
        assert!(result.is_err());
        assert!(matches!(result, Err(sqlx::Error::RowNotFound)));
        Ok(())
    }
}
