//! Query for email thread access level.

use crate::domain::models::AccessLevel;
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use sqlx::PgPool;
use std::str::FromStr;

/// Get the highest access level a user has for an email thread.
///
/// Considers both explicit grants (UserItemAccess) and public access
/// (SharePermission) inherited through the project hierarchy.
#[tracing::instrument(err, skip(pool))]
pub async fn get_thread_access(
    pool: &PgPool,
    thread_id: &str,
    user_id: &MacroUserId<Lowercase<'_>>,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    let user_id = user_id.as_ref();
    let all_level_strings: Vec<Option<String>> = sqlx::query_scalar!(
        r#"
        -- CTE to recursively find all parent projects for the given email thread.
        WITH RECURSIVE project_hierarchy AS (
            -- Base case: Start with the project directly associated with the thread.
            SELECT
                p.id as project_id
            FROM
                "EmailThreadPermission" etp
            JOIN "Project" p ON etp."projectId" = p.id AND p."deletedAt" IS NULL
            WHERE
                etp."threadId" = $1
            UNION ALL
            -- Recursive case: Find the parent of the project from the previous step.
            SELECT
                parent.id as project_id
            FROM
                project_hierarchy ph
            JOIN "Project" parent ON parent.id = (
                SELECT "parentId" FROM "Project" WHERE id = ph.project_id AND "parentId" IS NOT NULL AND "deletedAt" IS NULL
            )
        )
        -- The subquery now gathers all levels as plain text.
        SELECT access_level FROM (
            -- Source 1: Cast the AccessLevel enum to text.
            SELECT access_level::text FROM "UserItemAccess"
            WHERE user_id = $2 AND item_id IN (
                SELECT $1 -- The thread ID itself
                UNION
                SELECT project_id FROM project_hierarchy -- All parent projects
            )
            UNION ALL
            -- Source 2: Select the publicAccessLevel (which is already text).
            SELECT "publicAccessLevel" as access_level
            FROM "SharePermission"
            WHERE "isPublic" = true AND "publicAccessLevel" IS NOT NULL AND id IN (
                SELECT "sharePermissionId" FROM "EmailThreadPermission" WHERE "threadId" = $1
                UNION
                SELECT "sharePermissionId" FROM "ProjectPermission" WHERE "projectId" IN (SELECT project_id FROM project_hierarchy)
            )
        ) as all_levels
        "#,
        thread_id,
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
