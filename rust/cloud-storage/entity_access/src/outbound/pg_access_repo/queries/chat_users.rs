//! Query for users with access to a chat via UserItemAccess.

use sqlx::PgPool;

/// Get all user IDs that have access to a chat via `UserItemAccess`.
///
/// Includes users with direct access to the chat and users with access
/// to any parent project in the hierarchy.
#[tracing::instrument(err, skip(pool))]
pub async fn get_chat_users(pool: &PgPool, chat_id: &str) -> Result<Vec<String>, sqlx::Error> {
    let users: Vec<String> = sqlx::query_scalar!(
        r#"
        WITH RECURSIVE project_hierarchy AS (
            SELECT p.id as project_id
            FROM "Chat" c
            JOIN "Project" p ON c."projectId" = p.id AND p."deletedAt" IS NULL
            WHERE c.id = $1 AND c."deletedAt" IS NULL
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
        chat_id
    )
    .fetch_all(pool)
    .await?;

    Ok(users)
}
