//! Query for users with access to a project via UserItemAccess.

use sqlx::PgPool;

/// Get all user IDs that have access to a project via `UserItemAccess`.
///
/// Includes users with direct access to the project and users with access
/// to any parent project in the hierarchy.
#[tracing::instrument(err, skip(pool))]
pub async fn get_project_users(
    pool: &PgPool,
    project_id: &str,
) -> Result<Vec<String>, sqlx::Error> {
    let users: Vec<String> = sqlx::query_scalar!(
        r#"
        WITH RECURSIVE project_hierarchy AS (
            SELECT id as project_id
            FROM "Project"
            WHERE id = $1 AND "deletedAt" IS NULL
            UNION ALL
            SELECT parent.id as project_id
            FROM project_hierarchy ph
            JOIN "Project" parent ON parent.id = (
                SELECT "parentId" FROM "Project" WHERE id = ph.project_id AND "parentId" IS NOT NULL AND "deletedAt" IS NULL
            )
        )
        SELECT DISTINCT user_id FROM "UserItemAccess"
        WHERE item_id IN (
            SELECT project_id FROM project_hierarchy
        )
        "#,
        project_id
    )
    .fetch_all(pool)
    .await?;

    Ok(users)
}
