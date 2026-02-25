//! Query for project access level.

use crate::domain::models::AccessLevel;
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use sqlx::PgPool;
use std::str::FromStr;

/// Get the highest access level a user has for a project.
///
/// Considers both explicit grants (UserItemAccess) and public access
/// (SharePermission) inherited through the project hierarchy.
#[tracing::instrument(err, skip(pool))]
pub async fn get_project_access(
    pool: &PgPool,
    project_id: &str,
    user_id: Option<&MacroUserId<Lowercase<'_>>>,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    let user_id = user_id.map(AsRef::as_ref).unwrap_or("");
    let all_level_strings: Vec<Option<String>> = sqlx::query_scalar!(
        r#"
        -- CTE to recursively find all parent projects, starting from the given project.
        WITH RECURSIVE project_hierarchy AS (
            -- Base case: Start with the project ID provided.
            SELECT id as project_id
            FROM "Project"
            WHERE id = $1 AND "deletedAt" IS NULL
            UNION ALL
            -- Recursive case: Find the parent of the project from the previous step.
            SELECT parent.id as project_id
            FROM project_hierarchy ph
            JOIN "Project" parent ON parent.id = (
                SELECT "parentId" FROM "Project" WHERE id = ph.project_id AND "parentId" IS NOT NULL AND "deletedAt" IS NULL
            )
        )
        -- The subquery now gathers all levels as plain text.
        SELECT access_level FROM (
            -- Source 1: Cast the AccessLevel enum to text.
            SELECT access_level::text FROM "UserItemAccess"
            WHERE user_id = $2 AND item_id IN (
                -- The hierarchy CTE includes the starting project, so this is all we need.
                SELECT project_id FROM project_hierarchy
            )
            UNION ALL
            -- Source 2: Select the publicAccessLevel (which is already text).
            SELECT "publicAccessLevel" as access_level
            FROM "SharePermission"
            WHERE "isPublic" = true AND "publicAccessLevel" IS NOT NULL AND id IN (
                -- We only need to check ProjectPermission for the items in the hierarchy.
                SELECT "sharePermissionId" FROM "ProjectPermission"
                WHERE "projectId" IN (SELECT project_id FROM project_hierarchy)
            )
        ) as all_levels
        "#,
        project_id,
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
