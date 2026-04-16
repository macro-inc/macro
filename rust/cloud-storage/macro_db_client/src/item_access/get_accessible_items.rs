#[cfg(not(test))]
use cached::proc_macro::cached;

use model::item::UserAccessibleItem;
use sqlx::{Pool, Postgres};

/// gets all accessible items for a user, traversing nested project structure
#[tracing::instrument(skip(db))]
#[cfg_attr(
    not(test),
    cached(
        time = 30,
        result = true,
        key = "String",
        convert = r#"{ format!("{}-{}-{}", user_id, item_type_filter.as_deref().unwrap_or("all"), exclude_owned) }"#
    )
)]
pub async fn get_user_accessible_items(
    db: &Pool<Postgres>,
    user_id: &str,
    item_type_filter: Option<String>,
    exclude_owned: bool,
) -> anyhow::Result<Vec<UserAccessibleItem>> {
    let results = sqlx::query!(
        r#"
        WITH RECURSIVE ProjectHierarchy AS (
            -- Find direct user access to projects first as starting point
            SELECT
                p.id,
                uia.access_level
            FROM "Project" p
            JOIN "UserItemAccess" uia ON p.id = uia.item_id AND uia.item_type = 'project'
            WHERE uia.user_id = $1 AND p."deletedAt" IS NULL
              AND ($3 = false OR p."userId" != $1)  -- Exclude owned projects if exclude_owned = true

            UNION ALL

            -- Then walk down the project tree and grab child projects, keeping parent's access
            SELECT
                p.id,
                ph.access_level
            FROM "Project" p
            JOIN ProjectHierarchy ph ON p."parentId" = ph.id
            WHERE p."deletedAt" IS NULL
              AND ($3 = false OR p."userId" != $1)  -- Exclude owned projects if exclude_owned = true
        ),
        -- Now build up all the ways a user can have access to stuff
        AllAccessGrants AS (
            -- Explicit access to items via UserItemAccess table
            SELECT uia.item_id, uia.item_type, uia.access_level
            FROM "UserItemAccess" uia
            -- We join to each table to check its "deletedAt" status.
            -- This is more explicit and robust than using subqueries.
            LEFT JOIN "Document" d ON uia.item_type = 'document' AND uia.item_id = d.id
            LEFT JOIN "Chat" c ON uia.item_type = 'chat' AND uia.item_id = c.id
            LEFT JOIN "Project" p ON uia.item_type = 'project' AND uia.item_id = p.id
            WHERE uia.user_id = $1
              AND ($2::text IS NULL OR uia.item_type = $2)
              -- Rule: The item must not be deleted.
              AND (
                  (uia.item_type = 'document' AND d."deletedAt" IS NULL) OR
                  (uia.item_type = 'chat' AND c."deletedAt" IS NULL) OR
                  (uia.item_type = 'project' AND p."deletedAt" IS NULL)
              )
              -- Rule: If exclude_owned is true, the user must not be the creator of the item.
              AND ($3 = false OR (
                  (uia.item_type = 'document' AND d.owner != $1) OR
                  (uia.item_type = 'chat' AND c."userId" != $1) OR
                  (uia.item_type = 'project' AND p."userId" != $1)
              ))

            -- The rest of the unions are to get implicit access to items via project access
            UNION ALL

            -- Access to docs in visible projects 
            SELECT
                d.id AS item_id,
                'document' AS item_type,
                ph.access_level
            FROM "Document" d
            JOIN ProjectHierarchy ph ON d."projectId" = ph.id
            WHERE ($2::text IS NULL OR 'document' = $2)
              AND d."projectId" IS NOT NULL AND d."deletedAt" IS NULL
              AND ($3 = false OR d.owner != $1)

            UNION ALL

            -- Access to chats in visible projects
            SELECT
                c.id AS item_id,
                'chat' AS item_type,
                ph.access_level
            FROM "Chat" c
            JOIN ProjectHierarchy ph ON c."projectId" = ph.id
            WHERE ($2::text IS NULL OR 'chat' = $2)
              AND c."projectId" IS NOT NULL AND c."deletedAt" IS NULL
              AND ($3 = false OR c."userId" != $1)

            UNION ALL

            -- Include the projects we found earlier
            SELECT
                ph.id AS item_id,
                'project' AS item_type,
                ph.access_level
            FROM ProjectHierarchy ph
            WHERE ($2::text IS NULL OR 'project' = $2)
        ),
        UserAccessibleItems AS (
            SELECT
                item_id,
                item_type
            FROM AllAccessGrants
            GROUP BY item_id, item_type
        )
        SELECT item_id as "item_id!", item_type as "item_type!" FROM UserAccessibleItems
        "#,
        user_id,
        item_type_filter,
        exclude_owned
    )
    .map(|r| UserAccessibleItem {
        item_id: r.item_id,
        item_type: r.item_type,
    })
        .fetch_all(db)
        .await?;

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    // testing correct items get returned for items that user has explicit permission for
    #[sqlx::test(fixtures(path = "../../fixtures", scripts("get_user_accessible_items_explicit")))]
    async fn test_accessible_items_explicit(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let user_id = "user-1";

        // --- Core Function: include_owned ---
        {
            let items = get_user_accessible_items(&pool, user_id, None, false).await?;
            let item_ids: HashSet<String> = items.into_iter().map(|item| item.item_id).collect();
            let expected_ids: HashSet<String> = [
                "project-owned",
                "chat-owned",
                "doc-owned",
                "project-shared",
                "chat-shared",
                "doc-shared",
            ]
            .into_iter()
            .map(String::from)
            .collect();
            assert_eq!(
                item_ids, expected_ids,
                "Core function (include owned) failed"
            );
        }

        // --- Core Function: exclude_owned ---
        {
            let items = get_user_accessible_items(&pool, user_id, None, true).await?;
            let item_ids: HashSet<String> = items.into_iter().map(|item| item.item_id).collect();
            let expected_ids: HashSet<String> = ["project-shared", "chat-shared", "doc-shared"]
                .into_iter()
                .map(String::from)
                .collect();
            assert_eq!(
                item_ids, expected_ids,
                "Core function (exclude owned) failed"
            );
        }

        // --- Documents Wrapper: include_owned ---
        {
            let items =
                get_user_accessible_items(&pool, user_id, Some("document".to_string()), false)
                    .await?;
            let id_set: HashSet<String> = items.into_iter().map(|item| item.item_id).collect();
            let expected_ids: HashSet<String> = ["doc-owned", "doc-shared"]
                .into_iter()
                .map(String::from)
                .collect();
            assert_eq!(
                id_set, expected_ids,
                "Documents wrapper (include owned) failed"
            );
        }

        // --- Documents Wrapper: exclude_owned ---
        {
            let items =
                get_user_accessible_items(&pool, user_id, Some("document".to_string()), true)
                    .await?;
            let ids: Vec<String> = items.into_iter().map(|item| item.item_id).collect();
            assert_eq!(
                ids,
                vec!["doc-shared"],
                "Documents wrapper (exclude owned) failed"
            );
        }

        // --- Chats Wrapper: include_owned ---
        {
            let items =
                get_user_accessible_items(&pool, user_id, Some("chat".to_string()), false).await?;
            let id_set: HashSet<String> = items.into_iter().map(|item| item.item_id).collect();
            let expected_ids: HashSet<String> = ["chat-owned", "chat-shared"]
                .into_iter()
                .map(String::from)
                .collect();
            assert_eq!(id_set, expected_ids, "Chats wrapper (include owned) failed");
        }

        // --- Chats Wrapper: exclude_owned ---
        {
            let items =
                get_user_accessible_items(&pool, user_id, Some("chat".to_string()), true).await?;
            let ids: Vec<String> = items.into_iter().map(|item| item.item_id).collect();
            assert_eq!(
                ids,
                vec!["chat-shared"],
                "Chats wrapper (exclude owned) failed"
            );
        }

        // --- Projects Wrapper: include_owned ---
        {
            let items =
                get_user_accessible_items(&pool, user_id, Some("project".to_string()), false)
                    .await?;
            let id_set: HashSet<String> = items.into_iter().map(|item| item.item_id).collect();
            let expected_ids: HashSet<String> = ["project-owned", "project-shared"]
                .into_iter()
                .map(String::from)
                .collect();
            assert_eq!(
                id_set, expected_ids,
                "Projects wrapper (include owned) failed"
            );
        }

        // --- Projects Wrapper: exclude_owned ---
        {
            let items =
                get_user_accessible_items(&pool, user_id, Some("project".to_string()), true)
                    .await?;
            let ids: Vec<String> = items.into_iter().map(|item| item.item_id).collect();
            assert_eq!(
                ids,
                vec!["project-shared"],
                "Projects wrapper (exclude owned) failed"
            );
        }

        Ok(())
    }
    #[sqlx::test(fixtures(path = "../../fixtures", scripts("get_user_accessible_items_implicit")))]
    async fn test_accessible_items_hierarchical(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let user_id = "user-1"; // This user has implicit access to items owned by user-2

        // --- Core Function: include_owned ---
        // Since user-1 owns nothing, this should return all 4 accessible items.
        {
            let items = get_user_accessible_items(&pool, user_id, None, false).await?;
            let item_ids: HashSet<String> = items.into_iter().map(|item| item.item_id).collect();
            let expected_ids: HashSet<String> = ["project-A", "project-B", "chat-A", "doc-A"]
                .into_iter()
                .map(String::from)
                .collect();
            assert_eq!(
                item_ids, expected_ids,
                "Core function (include owned) failed on hierarchical permissions"
            );
        }

        // --- Core Function: exclude_owned ---
        // Since user-1 owns nothing, excluding their items should have no effect.
        {
            let items = get_user_accessible_items(&pool, user_id, None, true).await?;
            let item_ids: HashSet<String> = items.into_iter().map(|item| item.item_id).collect();
            let expected_ids: HashSet<String> = ["project-A", "project-B", "chat-A", "doc-A"]
                .into_iter()
                .map(String::from)
                .collect();
            assert_eq!(
                item_ids, expected_ids,
                "Core function (exclude owned) should not change the result when the user owns nothing"
            );
        }

        // --- Documents Wrapper: include_owned ---
        {
            let items =
                get_user_accessible_items(&pool, user_id, Some("document".to_string()), false)
                    .await?;
            let ids: Vec<String> = items.into_iter().map(|item| item.item_id).collect();
            assert_eq!(
                ids,
                vec!["doc-A"],
                "Documents wrapper (include owned) failed on hierarchical"
            );
        }

        // --- Documents Wrapper: exclude_owned ---
        {
            let items =
                get_user_accessible_items(&pool, user_id, Some("document".to_string()), true)
                    .await?;
            let ids: Vec<String> = items.into_iter().map(|item| item.item_id).collect();
            assert_eq!(
                ids,
                vec!["doc-A"],
                "Documents wrapper (exclude owned) failed on hierarchical"
            );
        }

        // --- Chats Wrapper: include_owned ---
        {
            let items =
                get_user_accessible_items(&pool, user_id, Some("chat".to_string()), false).await?;
            let ids: Vec<String> = items.into_iter().map(|item| item.item_id).collect();
            assert_eq!(
                ids,
                vec!["chat-A"],
                "Chats wrapper (include owned) failed on hierarchical"
            );
        }

        // --- Chats Wrapper: exclude_owned ---
        {
            let items =
                get_user_accessible_items(&pool, user_id, Some("chat".to_string()), true).await?;
            let ids: Vec<String> = items.into_iter().map(|item| item.item_id).collect();
            assert_eq!(
                ids,
                vec!["chat-A"],
                "Chats wrapper (exclude owned) failed on hierarchical"
            );
        }

        // --- Projects Wrapper: include_owned ---
        {
            let items =
                get_user_accessible_items(&pool, user_id, Some("project".to_string()), false)
                    .await?;
            let id_set: HashSet<String> = items.into_iter().map(|item| item.item_id).collect();
            let expected_ids: HashSet<String> = ["project-A", "project-B"]
                .into_iter()
                .map(String::from)
                .collect();
            assert_eq!(
                id_set, expected_ids,
                "Projects wrapper (include owned) failed on hierarchical"
            );
        }

        // --- Projects Wrapper: exclude_owned ---
        {
            let items =
                get_user_accessible_items(&pool, user_id, Some("project".to_string()), true)
                    .await?;
            let id_set: HashSet<String> = items.into_iter().map(|item| item.item_id).collect();
            let expected_ids: HashSet<String> = ["project-A", "project-B"]
                .into_iter()
                .map(String::from)
                .collect();
            assert_eq!(
                id_set, expected_ids,
                "Projects wrapper (exclude owned) failed on hierarchical"
            );
        }

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("get_user_accessible_items_nested")))]
    async fn test_accessible_items_deep_hierarchy(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let user_id = "user-1"; // This user has implicit access via the top-level project

        // --- Core Function: include_owned ---
        // Should discover all 5 items in the hierarchy (3 projects, 1 chat, 1 document).
        {
            let items = get_user_accessible_items(&pool, user_id, None, false).await?;
            let item_ids: HashSet<String> = items.into_iter().map(|item| item.item_id).collect();
            let expected_ids: HashSet<String> =
                ["project-A", "project-B", "project-C", "chat-C", "doc-C"]
                    .into_iter()
                    .map(String::from)
                    .collect();
            assert_eq!(
                item_ids, expected_ids,
                "Core function (include owned) failed on deep hierarchy"
            );
        }

        // --- Core Function: exclude_owned ---
        // Since user-1 owns none of the items, the result should be identical.
        {
            let items = get_user_accessible_items(&pool, user_id, None, true).await?;
            let item_ids: HashSet<String> = items.into_iter().map(|item| item.item_id).collect();
            let expected_ids: HashSet<String> =
                ["project-A", "project-B", "project-C", "chat-C", "doc-C"]
                    .into_iter()
                    .map(String::from)
                    .collect();
            assert_eq!(
                item_ids, expected_ids,
                "Core function (exclude owned) failed on deep hierarchy"
            );
        }

        // --- Documents Wrapper: include_owned ---
        {
            let items =
                get_user_accessible_items(&pool, user_id, Some("document".to_string()), false)
                    .await?;
            let ids: Vec<String> = items.into_iter().map(|item| item.item_id).collect();
            assert_eq!(
                ids,
                vec!["doc-C"],
                "Documents wrapper (include owned) failed on deep hierarchy"
            );
        }

        // --- Documents Wrapper: exclude_owned ---
        {
            let items =
                get_user_accessible_items(&pool, user_id, Some("document".to_string()), true)
                    .await?;
            let ids: Vec<String> = items.into_iter().map(|item| item.item_id).collect();
            assert_eq!(
                ids,
                vec!["doc-C"],
                "Documents wrapper (exclude owned) failed on deep hierarchy"
            );
        }

        // --- Chats Wrapper: include_owned ---
        {
            let items =
                get_user_accessible_items(&pool, user_id, Some("chat".to_string()), false).await?;
            let ids: Vec<String> = items.into_iter().map(|item| item.item_id).collect();
            assert_eq!(
                ids,
                vec!["chat-C"],
                "Chats wrapper (include owned) failed on deep hierarchy"
            );
        }

        // --- Chats Wrapper: exclude_owned ---
        {
            let items =
                get_user_accessible_items(&pool, user_id, Some("chat".to_string()), true).await?;
            let ids: Vec<String> = items.into_iter().map(|item| item.item_id).collect();
            assert_eq!(
                ids,
                vec!["chat-C"],
                "Chats wrapper (exclude owned) failed on deep hierarchy"
            );
        }

        // --- Projects Wrapper: include_owned ---
        {
            let items =
                get_user_accessible_items(&pool, user_id, Some("project".to_string()), false)
                    .await?;
            let id_set: HashSet<String> = items.into_iter().map(|item| item.item_id).collect();
            let expected_ids: HashSet<String> = ["project-A", "project-B", "project-C"]
                .into_iter()
                .map(String::from)
                .collect();
            assert_eq!(
                id_set, expected_ids,
                "Projects wrapper (include owned) failed on deep hierarchy"
            );
        }

        // --- Projects Wrapper: exclude_owned ---
        {
            let items =
                get_user_accessible_items(&pool, user_id, Some("project".to_string()), true)
                    .await?;
            let id_set: HashSet<String> = items.into_iter().map(|item| item.item_id).collect();
            let expected_ids: HashSet<String> = ["project-A", "project-B", "project-C"]
                .into_iter()
                .map(String::from)
                .collect();
            assert_eq!(
                id_set, expected_ids,
                "Projects wrapper (exclude owned) failed on deep hierarchy"
            );
        }

        Ok(())
    }

    // ensure a user doesn't get access to items they shouldn't.
    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("get_user_accessible_items_unaccessible")
    ))]
    async fn test_accessible_items_isolation(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let user_id = "user-3"; // This user has no permissions to any items in the fixture.

        // --- Core Function: include_owned ---
        {
            let items = get_user_accessible_items(&pool, user_id, None, false).await?;
            assert!(
                items.is_empty(),
                "Core (include owned) should return no items for an isolated user"
            );
        }

        // --- Core Function: exclude_owned ---
        {
            let items = get_user_accessible_items(&pool, user_id, None, true).await?;
            assert!(
                items.is_empty(),
                "Core (exclude owned) should return no items for an isolated user"
            );
        }

        // --- Documents Wrapper: include_owned ---
        {
            let items =
                get_user_accessible_items(&pool, user_id, Some("document".to_string()), false)
                    .await?;
            assert!(
                items.is_empty(),
                "Documents (include owned) should be empty for an isolated user"
            );
        }

        // --- Documents Wrapper: exclude_owned ---
        {
            let items =
                get_user_accessible_items(&pool, user_id, Some("document".to_string()), true)
                    .await?;
            assert!(
                items.is_empty(),
                "Documents (exclude owned) should be empty for an isolated user"
            );
        }

        // --- Chats Wrapper: include_owned ---
        {
            let items =
                get_user_accessible_items(&pool, user_id, Some("chat".to_string()), false).await?;
            assert!(
                items.is_empty(),
                "Chats (include owned) should be empty for an isolated user"
            );
        }

        // --- Chats Wrapper: exclude_owned ---
        {
            let items =
                get_user_accessible_items(&pool, user_id, Some("chat".to_string()), true).await?;
            assert!(
                items.is_empty(),
                "Chats (exclude owned) should be empty for an isolated user"
            );
        }

        // --- Projects Wrapper: include_owned ---
        {
            let items =
                get_user_accessible_items(&pool, user_id, Some("project".to_string()), false)
                    .await?;
            assert!(
                items.is_empty(),
                "Projects (include owned) should be empty for an isolated user"
            );
        }

        // --- Projects Wrapper: exclude_owned ---
        {
            let items =
                get_user_accessible_items(&pool, user_id, Some("project".to_string()), true)
                    .await?;
            assert!(
                items.is_empty(),
                "Projects (exclude owned) should be empty for an isolated user"
            );
        }

        Ok(())
    }
}
