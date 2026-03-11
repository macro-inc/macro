//! Query for users with access to an email thread via UserItemAccess.

use sqlx::PgPool;

/// Get all user IDs that have access to an email thread via `UserItemAccess`.
///
/// Includes users with direct access to the thread and users with access
/// to any parent project in the hierarchy.
#[tracing::instrument(err, skip(pool))]
pub async fn get_thread_users(pool: &PgPool, thread_id: &str) -> Result<Vec<String>, sqlx::Error> {
    let users: Vec<String> = sqlx::query_scalar!(
        r#"
        WITH RECURSIVE project_hierarchy AS (
            SELECT p.id as project_id
            FROM "EmailThreadPermission" etp
            JOIN "Project" p ON etp."projectId" = p.id AND p."deletedAt" IS NULL
            WHERE etp."threadId" = $1
            UNION ALL
            SELECT parent.id as project_id
            FROM project_hierarchy ph
            JOIN "Project" parent ON parent.id = (
                SELECT "parentId" FROM "Project" WHERE id = ph.project_id AND "parentId" IS NOT NULL AND "deletedAt" IS NULL
            )
        )
        SELECT DISTINCT user_id FROM "UserItemAccess"
        WHERE item_id IN (
            SELECT $1
            UNION
            SELECT project_id FROM project_hierarchy
        )
        "#,
        thread_id
    )
    .fetch_all(pool)
    .await?;

    Ok(users)
}
