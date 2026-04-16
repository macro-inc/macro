use models_permissions::share_permission::access_level::AccessLevel;
use std::str::FromStr;

/// Gets the public access level for a project (no user required).
///
/// This function checks only public `SharePermission` records (where `isPublic=true`),
/// applied either directly to the project or inherited from its parent hierarchy.
/// It does NOT check user-specific `UserItemAccess` records.
///
/// Use this for unauthenticated access to publicly shared projects.
///
/// # Arguments
/// * `db` - A reference to the `sqlx` database connection pool.
/// * `project_id` - The ID of the project to check.
///
/// # Returns
/// A `Result` containing an `Option<AccessLevel>`:
/// - `Ok(Some(AccessLevel))` if there is public access.
/// - `Ok(None)` if there is no public access.
/// - `Err(_)` if a database error occurs.
#[tracing::instrument(skip(db), err)]
pub async fn get_public_access_level_for_project(
    db: &sqlx::Pool<sqlx::Postgres>,
    project_id: &str,
) -> anyhow::Result<Option<AccessLevel>> {
    let public_levels: Vec<Option<String>> = sqlx::query_scalar!(
        r#"
        WITH RECURSIVE project_hierarchy AS (
            SELECT id as project_id
            FROM "Project"
            WHERE id = $1 AND "deletedAt" IS NULL
            UNION ALL
            SELECT parent.id as project_id
            FROM project_hierarchy ph
            JOIN "Project" parent ON parent.id = (
                SELECT "parentId" FROM "Project" WHERE id = ph.project_id
                AND "parentId" IS NOT NULL AND "deletedAt" IS NULL
            )
        )
        SELECT "publicAccessLevel" as access_level
        FROM "SharePermission"
        WHERE "isPublic" = true AND "publicAccessLevel" IS NOT NULL AND id IN (
            SELECT "sharePermissionId" FROM "ProjectPermission"
            WHERE "projectId" IN (SELECT project_id FROM project_hierarchy)
        )
        "#,
        project_id
    )
    .fetch_all(db)
    .await?;

    let highest_level = public_levels
        .iter()
        .filter_map(|opt| opt.as_ref().and_then(|s| AccessLevel::from_str(s).ok()))
        .max();

    Ok(highest_level)
}

/// Calculates the highest effective access level a user has for a project.
///
/// This function determines the best possible permission by considering two sources:
/// 1.  **Explicit Grants**: Any `UserItemAccess` records for the specified user, applied either
///     directly to the project or inherited from its entire project hierarchy.
/// 2.  **Public Access**: Any `SharePermission` records marked as `isPublic=true`, applied either
///     directly to the project or inherited from its project hierarchy.
///
/// It combines all possible access levels from these sources, sorts them from highest (`Owner`)
/// to lowest (`View`), and returns the single highest level.
///
/// # Arguments
/// * `db` - A reference to the `sqlx` database connection pool.
/// * `project_id` - The ID of the project to check.
/// * `user_id` - The ID of the user whose access is being checked.
///
/// # Returns
/// A `Result` containing an `Option<AccessLevel>`:
/// - `Ok(Some(AccessLevel))` if the user has any level of access.
/// - `Ok(None)` if the user has no access at all.
/// - `Err(_)` if a database error occurs.
#[tracing::instrument(skip(db), err)]
pub async fn get_highest_access_level_for_project(
    db: &sqlx::Pool<sqlx::Postgres>,
    project_id: &str,
    user_id: &str,
) -> anyhow::Result<Option<AccessLevel>> {
    // have to use strings because the SharePermission and UserItemAccess access_level rows use different sql types
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
        .fetch_all(db)
        .await?;

    let highest_level = all_level_strings
        .iter()
        .filter_map(|optional_string| {
            // `optional_string` is &Option<String>.
            // We use `and_then` to proceed only if it's Some.
            optional_string
                .as_ref()
                .and_then(|s| AccessLevel::from_str(s).ok())
        })
        .max();

    Ok(highest_level)
}

#[cfg(test)]
#[path = "project_tests.rs"]
mod tests;
