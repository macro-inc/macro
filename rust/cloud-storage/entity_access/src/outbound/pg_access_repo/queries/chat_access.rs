//! Query for chat access level.

use crate::domain::models::AccessLevel;
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use sqlx::PgPool;
use std::str::FromStr;

/// Get the highest access level a user has for a chat.
///
/// Considers both explicit grants (UserItemAccess) and public access
/// (SharePermission) inherited through the project hierarchy.
#[tracing::instrument(err, skip(pool))]
pub async fn get_chat_access(
    pool: &PgPool,
    chat_id: &str,
    user_id: &MacroUserId<Lowercase<'_>>,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    let user_id = user_id.as_ref();
    let all_level_strings: Vec<Option<String>> = sqlx::query_scalar!(
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
        SELECT access_level FROM (
            -- Source 1: Cast the AccessLevel enum to text.
            SELECT access_level::text FROM "UserItemAccess"
            WHERE user_id = $2 AND item_id IN (
                SELECT $1 -- The chat itself
                UNION
                SELECT project_id FROM project_hierarchy -- All parent projects
            )
            UNION ALL
            -- Source 2: Select the publicAccessLevel (which is already text).
            SELECT "publicAccessLevel" as access_level
            FROM "SharePermission"
            WHERE "isPublic" = true AND "publicAccessLevel" IS NOT NULL AND id IN (
                SELECT "sharePermissionId" FROM "ChatPermission" WHERE "chatId" = $1
                UNION
                SELECT "sharePermissionId" FROM "ProjectPermission" WHERE "projectId" IN (SELECT project_id FROM project_hierarchy)
            )
        ) as all_levels
        "#,
        chat_id,
        user_id
    )
    .fetch_all(pool)
    .await?;

    let highest_level = all_level_strings
        .iter()
        .filter_map(|opt| opt.as_ref().and_then(|s| AccessLevel::from_str(s).ok()))
        .max();

    Ok(highest_level)
}
