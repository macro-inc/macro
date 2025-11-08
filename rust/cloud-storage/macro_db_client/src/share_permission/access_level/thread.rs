use models_permissions::share_permission::access_level::AccessLevel;
use std::str::FromStr;

/// Calculates the highest effective access level a user has for a thread.
///
/// This function determines the best possible permission by considering two sources:
/// 1.  **Explicit Grants**: Any `UserItemAccess` records for the specified user, applied either
///     directly to the thread or inherited from its entire project hierarchy.
/// 2.  **Public Access**: Any `SharePermission` records marked as `isPublic=true`, applied either
///     directly to the thread or inherited from its project hierarchy.
///
/// It combines all possible access levels from these sources, sorts them from highest (`Owner`)
/// to lowest (`View`), and returns the single highest level.
///
/// # Arguments
/// * `db` - A reference to the `sqlx` database connection pool.
/// * `thread_id` - The ID of the thread to check.
/// * `user_id` - The ID of the user whose access is being checked.
///
/// # Returns
/// A `Result` containing an `Option<AccessLevel>`:
/// - `Ok(Some(AccessLevel))` if the user has any level of access.
/// - `Ok(None)` if the user has no access at all.
/// - `Err(_)` if a database error occurs.
#[tracing::instrument(skip(db))]
pub async fn get_highest_access_level_for_thread(
    db: &sqlx::Pool<sqlx::Postgres>,
    thread_id: &str,
    user_id: &str,
) -> anyhow::Result<Option<AccessLevel>> {
    // have to use strings because the SharePermission and UserItemAccess access_level rows use different sql types
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
mod tests {
    use super::*;

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("highest_access_level_for_thread")))]
    async fn test_highest_level_is_from_explicit_access_on_thread(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        // SCENARIO: Get highest access for 'user-1' on 'thread-nested'.
        // EXPLICIT ACCESS: view (direct), owner (inherited from p-grandparent). Max is 'owner'.
        // PUBLIC ACCESS: view (from p-parent), edit (from p-grandparent). Max is 'edit'.
        // EXPECTATION: The overall highest level should be 'owner' from the explicit grant.

        let highest_level =
            get_highest_access_level_for_thread(&pool, "thread-nested", "user-1").await?;

        assert_eq!(
            highest_level,
            Some(AccessLevel::Owner),
            "Expected highest level to be 'owner' from an inherited UserItemAccess record"
        );

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("highest_access_level_for_thread")))]
    async fn test_highest_level_is_from_public_access_on_thread(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        // SCENARIO: Get highest access for 'user-public-access-only' on 'thread-nested'.
        // This user has no explicit access grants.
        // PUBLIC ACCESS: view (from p-parent), edit (from p-grandparent). Max is 'edit'.
        // EXPECTATION: The overall highest level must be 'edit' from a public SharePermission.

        let highest_level =
            get_highest_access_level_for_thread(&pool, "thread-nested", "user-public-access-only")
                .await?;

        assert_eq!(
            highest_level,
            Some(AccessLevel::Edit),
            "Expected highest level to be 'edit' from a public SharePermission record"
        );

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("highest_access_level_for_thread")))]
    async fn test_user_scoping_is_correct_on_thread(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        // SCENARIO: Get highest access for 'user-2' on 'thread-nested'.
        // EXPLICIT ACCESS: 'user-2' has 'comment' access inherited from p-parent.
        // PUBLIC ACCESS: view (from p-parent), edit (from p-grandparent). Max is 'edit'.
        // EXPECTATION: The overall highest level is 'edit' (from public), which is higher than
        // the user's explicit 'comment' grant.

        let highest_level =
            get_highest_access_level_for_thread(&pool, "thread-nested", "user-2").await?;

        assert_eq!(
            highest_level,
            Some(AccessLevel::Edit),
            "User-2's highest access should be 'edit' from public, which is higher than their explicit 'comment' grant"
        );

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("highest_access_level_for_thread")))]
    async fn test_private_share_permissions_are_ignored_on_thread(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        // SCENARIO: A private 'owner' SharePermission is attached directly to 'thread-nested'.
        // Get access for a user who would otherwise only have public access.
        // EXPECTATION: The private permission must be ignored.

        let highest_level =
            get_highest_access_level_for_thread(&pool, "thread-nested", "user-public-access-only")
                .await?;

        assert_ne!(
            highest_level,
            Some(AccessLevel::Owner),
            "A private SharePermission should not grant owner access"
        );
        assert_eq!(
            highest_level,
            Some(AccessLevel::Edit),
            "The highest access should still come from the public grandparent permission"
        );

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("highest_access_level_for_thread")))]
    async fn test_no_permissions_returns_none_for_thread(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        // SCENARIO: Get access for any user on 'thread-private'.
        // This thread has no project and no other permissions attached.
        // EXPECTATION: The query should return an empty list, resulting in `None`.

        let highest_level =
            get_highest_access_level_for_thread(&pool, "thread-private", "user-1").await?;

        assert_eq!(
            highest_level, None,
            "Expected None for a thread with no permissions for the user"
        );

        Ok(())
    }
}
