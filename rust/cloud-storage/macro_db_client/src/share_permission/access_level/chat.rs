use models_permissions::share_permission::access_level::AccessLevel;
use std::collections::HashMap;
use std::str::FromStr;

/// Calculates the highest effective access level a user has for a chat.
///
/// This function determines the best possible permission by considering two sources:
/// 1.  **Explicit Grants**: Any `UserItemAccess` records for the specified user, applied either
///     directly to the chat or inherited from its entire project hierarchy.
/// 2.  **Public Access**: Any `SharePermission` records marked as `isPublic=true`, applied either
///     directly to the chat or inherited from its project hierarchy.
///
/// It combines all possible access levels from these sources, sorts them from highest (`Owner`)
/// to lowest (`View`), and returns the single highest level.
///
/// # Arguments
/// * `db` - A reference to the `sqlx` database connection pool.
/// * `chat_id` - The ID of the chat to check.
/// * `user_id` - The ID of the user whose access is being checked.
///
/// # Returns
/// A `Result` containing an `Option<AccessLevel>`:
/// - `Ok(Some(AccessLevel))` if the user has any level of access.
/// - `Ok(None)` if the user has no access at all.
/// - `Err(_)` if a database error occurs.
#[tracing::instrument(skip(db))]
pub async fn get_highest_access_level_for_chat(
    db: &sqlx::Pool<sqlx::Postgres>,
    chat_id: &str,
    user_id: &str,
) -> anyhow::Result<Option<AccessLevel>> {
    // have to use strings because the SharePermission and UserItemAccess access_level rows use different sql types
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

/// Calculates the highest effective access level a user has for multiple chats.
///
/// This is a batch version of `get_highest_access_level_for_chat` that processes
/// multiple chat IDs in a single database query for better performance.
///
/// # Arguments
/// * `db` - A reference to the `sqlx` database connection pool.
/// * `chat_ids` - A slice of chat IDs to check.
/// * `user_id` - The ID of the user whose access is being checked.
///
/// # Returns
/// A `Result` containing a `HashMap<String, Option<AccessLevel>>`:
/// - Keys are chat IDs from the input
/// - Values are `Some(AccessLevel)` if the user has access, `None` if no access
/// - `Err(_)` if a database error occurs.
#[tracing::instrument(skip(db))]
pub async fn get_highest_access_level_for_chats(
    db: &sqlx::Pool<sqlx::Postgres>,
    chat_ids: &[String],
    user_id: &str,
) -> anyhow::Result<HashMap<String, Option<AccessLevel>>> {
    if chat_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let records = sqlx::query!(
        r#"
        WITH RECURSIVE project_hierarchy AS (
            SELECT c.id as chat_id, p.id as project_id
            FROM "Chat" c
            JOIN "Project" p ON c."projectId" = p.id AND p."deletedAt" IS NULL
            WHERE c.id = ANY($1) AND c."deletedAt" IS NULL
            UNION ALL
            SELECT ph.chat_id, parent.id as project_id
            FROM project_hierarchy ph
            JOIN "Project" parent ON parent.id = (
                SELECT "parentId" FROM "Project" WHERE id = ph.project_id AND "parentId" IS NOT NULL AND "deletedAt" IS NULL
            )
        )
        SELECT 
            chat_id,
            access_level
        FROM (
            -- Source 1: Cast the AccessLevel enum to text.
            SELECT 
                ph.chat_id,
                uia.access_level::text as access_level
            FROM project_hierarchy ph
            JOIN "UserItemAccess" uia ON uia.user_id = $2 AND (
                uia.item_id = ph.chat_id OR uia.item_id = ph.project_id
            )
            UNION ALL
            -- Source 2: Select the publicAccessLevel (which is already text).
            SELECT 
                ph.chat_id,
                sp."publicAccessLevel" as access_level
            FROM project_hierarchy ph
            JOIN "ProjectPermission" pp ON pp."projectId" = ph.project_id
            JOIN "SharePermission" sp ON sp.id = pp."sharePermissionId" 
                AND sp."isPublic" = true 
                AND sp."publicAccessLevel" IS NOT NULL
            UNION ALL
            -- Source 3: Direct chat permissions
            SELECT 
                c.id as chat_id,
                uia.access_level::text as access_level
            FROM "Chat" c
            JOIN "UserItemAccess" uia ON uia.user_id = $2 AND uia.item_id = c.id
            WHERE c.id = ANY($1) AND c."deletedAt" IS NULL
            UNION ALL
            -- Source 4: Direct chat public permissions
            SELECT 
                c.id as chat_id,
                sp."publicAccessLevel" as access_level
            FROM "Chat" c
            JOIN "ChatPermission" cp ON cp."chatId" = c.id
            JOIN "SharePermission" sp ON sp.id = cp."sharePermissionId"
                AND sp."isPublic" = true 
                AND sp."publicAccessLevel" IS NOT NULL
            WHERE c.id = ANY($1) AND c."deletedAt" IS NULL
        ) as all_levels
        "#,
        chat_ids,
        user_id
    )
    .fetch_all(db)
    .await?;

    // Group by chat_id and find highest access level for each
    let mut chat_access_levels: HashMap<String, Vec<Option<String>>> = HashMap::new();

    for record in records {
        if let Some(chat_id) = record.chat_id {
            chat_access_levels
                .entry(chat_id)
                .or_default()
                .push(record.access_level);
        }
    }

    // Convert to final result with highest access level per chat
    let mut result = HashMap::new();

    // Initialize all chat IDs with None (no access)
    for chat_id in chat_ids {
        result.insert(chat_id.clone(), None);
    }

    // Update with actual access levels
    for (chat_id, level_strings) in chat_access_levels {
        let highest_level = level_strings
            .iter()
            .filter_map(|optional_string| {
                optional_string
                    .as_ref()
                    .and_then(|s| AccessLevel::from_str(s).ok())
            })
            .max();

        result.insert(chat_id, highest_level);
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("highest_access_level_for_chat")))]
    async fn test_highest_level_is_from_explicit_access(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        // SCENARIO: Get highest access for 'user-1' on 'd-child'.
        // EXPLICIT ACCESS: view (direct), edit (parent), owner (grandparent). Max is 'owner'.
        // PUBLIC ACCESS: view (parent), edit (grandparent). Max is 'edit'.
        // EXPECTATION: The overall highest level should be 'owner' from the explicit grant.

        let highest_level = get_highest_access_level_for_chat(&pool, "d-child", "user-1").await?;

        assert_eq!(
            highest_level,
            Some(AccessLevel::Owner),
            "Expected highest level to be 'owner' from an explicit UserItemAccess record"
        );

        // highest public access is edit via grandparent

        let highest_level =
            get_highest_access_level_for_chat(&pool, "d-child", "user-public-access-only").await?;

        assert_eq!(
            highest_level,
            Some(AccessLevel::Edit),
            "Expected highest level to be 'edit' from a public SharePermission record"
        );

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("highest_access_level_for_chat")))]
    async fn test_user_scoping_is_correct(pool: sqlx::Pool<sqlx::Postgres>) -> anyhow::Result<()> {
        // SCENARIO: Get highest access for 'user-2' on 'd-child'.
        // EXPLICIT ACCESS: 'user-2' only has 'view' access.
        // PUBLIC ACCESS: view (parent), edit (grandparent). Max is 'edit'.
        // EXPECTATION: The overall highest level is 'edit' (from public), not 'owner' (from user-1's grant).

        let highest_level = get_highest_access_level_for_chat(&pool, "d-child", "user-2").await?;

        assert_eq!(
            highest_level,
            Some(AccessLevel::Edit),
            "User-2's highest access should be 'edit' from public, not 'owner' from user-1's explicit grant"
        );

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("highest_access_level_for_chat")))]
    async fn test_simple_uia_case(pool: sqlx::Pool<sqlx::Postgres>) -> anyhow::Result<()> {
        // SCENARIO: User has edit UIA access on private chat
        // EXPECTATION: The user should have edit access to chat

        let highest_level =
            get_highest_access_level_for_chat(&pool, "d-standalone", "user-3").await?;

        assert_eq!(
            highest_level,
            Some(AccessLevel::Edit),
            "User-3's highest access should be 'edit' from explicit grant"
        );

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("highest_access_level_for_chat")))]
    async fn test_no_permissions_returns_none(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        // SCENARIO: Get access for any user on 'd-private'.
        // This chat has no project, no UserItemAccess, and no SharePermission records.
        // EXPECTATION: The query should return an empty list, resulting in `None`.

        let highest_level = get_highest_access_level_for_chat(&pool, "d-private", "user-1").await?;

        assert_eq!(
            highest_level, None,
            "Expected None for a chat with no permissions"
        );

        Ok(())
    }

    // Tests for the batch function get_highest_access_level_for_chats

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("highest_access_level_for_chat")))]
    async fn test_batch_multiple_chats_different_access_levels(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        // SCENARIO: Get access for 'user-1' on multiple chats with different access levels
        let chat_ids = vec![
            "d-child".to_string(),
            "d-standalone".to_string(),
            "d-private".to_string(),
        ];

        let access_levels = get_highest_access_level_for_chats(&pool, &chat_ids, "user-1").await?;

        // d-child: user-1 has owner access (from explicit grants)
        assert_eq!(
            access_levels.get("d-child"),
            Some(&Some(AccessLevel::Owner)),
            "Expected 'owner' access for d-child"
        );

        // d-standalone: Check what user-1 actually has (test shows Comment access)
        // We'll verify consistency with individual function rather than hardcode expectation
        let individual_access =
            get_highest_access_level_for_chat(&pool, "d-standalone", "user-1").await?;
        assert_eq!(
            access_levels.get("d-standalone"),
            Some(&individual_access),
            "Expected batch result to match individual function result for d-standalone"
        );

        // d-private: user-1 should have no access (private chat with no permissions)
        assert_eq!(
            access_levels.get("d-private"),
            Some(&None),
            "Expected no access for d-private"
        );

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("highest_access_level_for_chat")))]
    async fn test_batch_public_access_user(pool: sqlx::Pool<sqlx::Postgres>) -> anyhow::Result<()> {
        // SCENARIO: Get access for 'user-public-access-only' on multiple chats
        // This user has no explicit grants but should get public access where available
        let chat_ids = vec!["d-child".to_string(), "d-private".to_string()];

        let access_levels =
            get_highest_access_level_for_chats(&pool, &chat_ids, "user-public-access-only").await?;

        // d-child: public access is edit via grandparent
        assert_eq!(
            access_levels.get("d-child"),
            Some(&Some(AccessLevel::Edit)),
            "Expected 'edit' access from public permissions"
        );

        // d-private: no public or explicit access
        assert_eq!(
            access_levels.get("d-private"),
            Some(&None),
            "Expected no access for d-private"
        );

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("highest_access_level_for_chat")))]
    async fn test_batch_user_with_mixed_access(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        // SCENARIO: Get access for 'user-2' who has limited explicit access but benefits from public access
        let chat_ids = vec!["d-child".to_string()];

        let access_levels = get_highest_access_level_for_chats(&pool, &chat_ids, "user-2").await?;

        // user-2 has view explicit access, but public access is edit, so should get edit
        assert_eq!(
            access_levels.get("d-child"),
            Some(&Some(AccessLevel::Edit)),
            "Expected 'edit' access from higher public permissions"
        );

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("highest_access_level_for_chat")))]
    async fn test_batch_empty_input(pool: sqlx::Pool<sqlx::Postgres>) -> anyhow::Result<()> {
        // SCENARIO: Test with empty chat_ids vector
        let chat_ids: Vec<String> = vec![];

        let access_levels = get_highest_access_level_for_chats(&pool, &chat_ids, "user-1").await?;

        assert!(
            access_levels.is_empty(),
            "Expected empty result for empty input"
        );

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("highest_access_level_for_chat")))]
    async fn test_batch_nonexistent_chats(pool: sqlx::Pool<sqlx::Postgres>) -> anyhow::Result<()> {
        // SCENARIO: Test with chat IDs that don't exist
        let chat_ids = vec!["nonexistent-1".to_string(), "nonexistent-2".to_string()];

        let access_levels = get_highest_access_level_for_chats(&pool, &chat_ids, "user-1").await?;

        // Should return None for each nonexistent chat
        assert_eq!(
            access_levels.get("nonexistent-1"),
            Some(&None),
            "Expected no access for nonexistent chat"
        );
        assert_eq!(
            access_levels.get("nonexistent-2"),
            Some(&None),
            "Expected no access for nonexistent chat"
        );

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("highest_access_level_for_chat")))]
    async fn test_batch_consistency_with_single_function(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        // SCENARIO: Ensure batch function returns same results as individual calls
        let chat_ids = vec!["d-child".to_string(), "d-standalone".to_string()];
        let user_id = "user-1";

        // Get results from batch function
        let batch_results = get_highest_access_level_for_chats(&pool, &chat_ids, user_id).await?;

        // Get results from individual function calls
        let individual_d_child =
            get_highest_access_level_for_chat(&pool, "d-child", user_id).await?;
        let individual_d_standalone =
            get_highest_access_level_for_chat(&pool, "d-standalone", user_id).await?;

        // Compare results
        assert_eq!(
            batch_results.get("d-child"),
            Some(&individual_d_child),
            "Batch and individual results should match for d-child"
        );
        assert_eq!(
            batch_results.get("d-standalone"),
            Some(&individual_d_standalone),
            "Batch and individual results should match for d-standalone"
        );

        Ok(())
    }
}
