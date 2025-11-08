use models_permissions::share_permission::access_level::AccessLevel;
use std::str::FromStr;

/// Calculates the highest effective access level a user has for a document.
///
/// This function determines the best possible permission by considering two sources:
/// 1.  **Explicit Grants**: Any `UserItemAccess` records for the specified user, applied either
///     directly to the document or inherited from its entire project hierarchy.
/// 2.  **Public Access**: Any `SharePermission` records marked as `isPublic=true`, applied either
///     directly to the document or inherited from its project hierarchy.
///
/// It combines all possible access levels from these sources, sorts them from highest (`Owner`)
/// to lowest (`View`), and returns the single highest level.
///
/// # Arguments
/// * `db` - A reference to the `sqlx` database connection pool.
/// * `document_id` - The ID of the document to check.
/// * `user_id` - The ID of the user whose access is being checked.
///
/// # Returns
/// A `Result` containing an `Option<AccessLevel>`:
/// - `Ok(Some(AccessLevel))` if the user has any level of access.
/// - `Ok(None)` if the user has no access at all.
/// - `Err(_)` if a database error occurs.
#[tracing::instrument(skip(db))]
pub async fn get_highest_access_level_for_document(
    db: &sqlx::Pool<sqlx::Postgres>,
    document_id: &str,
    user_id: &str,
) -> anyhow::Result<Option<AccessLevel>> {
    // have to use strings because the SharePermission and UserItemAccess access_level rows use different sql types
    let all_level_strings: Vec<Option<String>> = sqlx::query_scalar!(
        r#"
        WITH RECURSIVE project_hierarchy AS (
            SELECT p.id as project_id
            FROM "Document" d
            JOIN "Project" p ON d."projectId" = p.id AND p."deletedAt" IS NULL
            WHERE d.id = $1 AND d."deletedAt" IS NULL
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
                SELECT $1
                UNION
                SELECT project_id FROM project_hierarchy
            )
            UNION ALL
            -- Source 2: Select the publicAccessLevel (which is already text).
            SELECT "publicAccessLevel" as access_level
            FROM "SharePermission"
            WHERE "isPublic" = true AND "publicAccessLevel" IS NOT NULL AND id IN (
                SELECT "sharePermissionId" FROM "DocumentPermission" WHERE "documentId" = $1
                UNION
                SELECT "sharePermissionId" FROM "ProjectPermission" WHERE "projectId" IN (SELECT project_id FROM project_hierarchy)
            )
        ) as all_levels
        "#,
        document_id,
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

    #[sqlx::test(fixtures(
        path = "../../../fixtures",
        scripts("highest_access_level_for_document")
    ))]
    async fn test_highest_level_is_from_explicit_access(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        // SCENARIO: Get highest access for 'user-1' on 'd-child'.
        // EXPLICIT ACCESS: view (direct), edit (parent), owner (grandparent). Max is 'owner'.
        // PUBLIC ACCESS: view (parent), edit (grandparent). Max is 'edit'.
        // EXPECTATION: The overall highest level should be 'owner' from the explicit grant.

        let highest_level =
            get_highest_access_level_for_document(&pool, "d-child", "user-1").await?;

        assert_eq!(
            highest_level,
            Some(AccessLevel::Owner),
            "Expected highest level to be 'owner' from an explicit UserItemAccess record"
        );

        // highest public access is edit via grandparent

        let highest_level =
            get_highest_access_level_for_document(&pool, "d-child", "user-public-access-only")
                .await?;

        assert_eq!(
            highest_level,
            Some(AccessLevel::Edit),
            "Expected highest level to be 'edit' from a public SharePermission record"
        );

        Ok(())
    }

    #[sqlx::test(fixtures(
        path = "../../../fixtures",
        scripts("highest_access_level_for_document")
    ))]
    async fn test_user_scoping_is_correct(pool: sqlx::Pool<sqlx::Postgres>) -> anyhow::Result<()> {
        // SCENARIO: Get highest access for 'user-2' on 'd-child'.
        // EXPLICIT ACCESS: 'user-2' only has 'view' access.
        // PUBLIC ACCESS: view (parent), edit (grandparent). Max is 'edit'.
        // EXPECTATION: The overall highest level is 'edit' (from public), not 'owner' (from user-1's grant).

        let highest_level =
            get_highest_access_level_for_document(&pool, "d-child", "user-2").await?;

        assert_eq!(
            highest_level,
            Some(AccessLevel::Edit),
            "User-2's highest access should be 'edit' from public, not 'owner' from user-1's explicit grant"
        );

        Ok(())
    }

    #[sqlx::test(fixtures(
        path = "../../../fixtures",
        scripts("highest_access_level_for_document")
    ))]
    async fn test_simple_uia_case(pool: sqlx::Pool<sqlx::Postgres>) -> anyhow::Result<()> {
        // SCENARIO: User has edit UIA access on private document
        // EXPECTATION: The user should have edit access to document

        let highest_level =
            get_highest_access_level_for_document(&pool, "d-standalone", "user-3").await?;

        assert_eq!(
            highest_level,
            Some(AccessLevel::Edit),
            "User-3's highest access should be 'edit' from explicit grant"
        );

        Ok(())
    }

    #[sqlx::test(fixtures(
        path = "../../../fixtures",
        scripts("highest_access_level_for_document")
    ))]
    async fn test_no_permissions_returns_none(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        // SCENARIO: Get access for any user on 'd-private'.
        // This document has no project, no UserItemAccess, and no SharePermission records.
        // EXPECTATION: The query should return an empty list, resulting in `None`.

        let highest_level =
            get_highest_access_level_for_document(&pool, "d-private", "user-1").await?;

        assert_eq!(
            highest_level, None,
            "Expected None for a document with no permissions"
        );

        Ok(())
    }
}
