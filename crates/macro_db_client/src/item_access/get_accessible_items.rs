#[cfg(not(test))]
use cached::proc_macro::cached;

use model::item::UserAccessibleItem;
use sqlx::{Pool, Postgres};

/// Gets all accessible items for a user by querying entity_access with the user's source IDs
/// (user ID, team memberships, and channel participations).
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
        WITH user_source_ids AS (
            SELECT cp.channel_id::text as source_id FROM comms_channel_participants cp
                WHERE cp.user_id = $1 AND cp.left_at IS NULL
            UNION ALL
            SELECT t.team_id::text FROM team_user t
                WHERE t.user_id = $1
            UNION ALL
            SELECT $1
        ),
        -- Get all entities the user has access to via entity_access
        UserAccessibleEntities AS (
            SELECT DISTINCT
                ea.entity_id,
                ea.entity_type
            FROM entity_access ea
            WHERE ea.source_id = ANY(SELECT source_id FROM user_source_ids)
            AND ($2::text IS NULL OR ea.entity_type = $2)
        ),
        -- Filter out deleted items and optionally exclude owned
        FilteredItems AS (
            SELECT uae.entity_id::text as item_id, uae.entity_type as item_type
            FROM UserAccessibleEntities uae
            LEFT JOIN "Document" d ON uae.entity_type = 'document' AND uae.entity_id::text = d.id
            LEFT JOIN "Chat" c ON uae.entity_type = 'chat' AND uae.entity_id::text = c.id
            LEFT JOIN "Project" p ON uae.entity_type = 'project' AND uae.entity_id::text = p.id
            WHERE
                (uae.entity_type = 'document' AND d."deletedAt" IS NULL
                    AND ($3 = false OR d.owner != $1)) OR
                (uae.entity_type = 'chat' AND c."deletedAt" IS NULL
                    AND ($3 = false OR c."userId" != $1)) OR
                (uae.entity_type = 'project' AND p."deletedAt" IS NULL
                    AND ($3 = false OR p."userId" != $1))
        )
        SELECT item_id as "item_id!", item_type as "item_type!" FROM FilteredItems
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
                "a0000000-0000-0000-0000-0000000e0001",
                "a0000000-0000-0000-0000-0000000e0002",
                "a0000000-0000-0000-0000-0000000e0003",
                "a0000000-0000-0000-0000-0000000e0004",
                "a0000000-0000-0000-0000-0000000e0005",
                "a0000000-0000-0000-0000-0000000e0006",
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
            let expected_ids: HashSet<String> = [
                "a0000000-0000-0000-0000-0000000e0004",
                "a0000000-0000-0000-0000-0000000e0005",
                "a0000000-0000-0000-0000-0000000e0006",
            ]
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
            let expected_ids: HashSet<String> = [
                "a0000000-0000-0000-0000-0000000e0003",
                "a0000000-0000-0000-0000-0000000e0006",
            ]
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
                vec!["a0000000-0000-0000-0000-0000000e0006"],
                "Documents wrapper (exclude owned) failed"
            );
        }

        // --- Chats Wrapper: include_owned ---
        {
            let items =
                get_user_accessible_items(&pool, user_id, Some("chat".to_string()), false).await?;
            let id_set: HashSet<String> = items.into_iter().map(|item| item.item_id).collect();
            let expected_ids: HashSet<String> = [
                "a0000000-0000-0000-0000-0000000e0002",
                "a0000000-0000-0000-0000-0000000e0005",
            ]
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
                vec!["a0000000-0000-0000-0000-0000000e0005"],
                "Chats wrapper (exclude owned) failed"
            );
        }

        // --- Projects Wrapper: include_owned ---
        {
            let items =
                get_user_accessible_items(&pool, user_id, Some("project".to_string()), false)
                    .await?;
            let id_set: HashSet<String> = items.into_iter().map(|item| item.item_id).collect();
            let expected_ids: HashSet<String> = [
                "a0000000-0000-0000-0000-0000000e0001",
                "a0000000-0000-0000-0000-0000000e0004",
            ]
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
                vec!["a0000000-0000-0000-0000-0000000e0004"],
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
            let expected_ids: HashSet<String> = [
                "b0000000-0000-0000-0000-0000000e0001",
                "b0000000-0000-0000-0000-0000000e0002",
                "b0000000-0000-0000-0000-0000000e0003",
                "b0000000-0000-0000-0000-0000000e0004",
            ]
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
            let expected_ids: HashSet<String> = [
                "b0000000-0000-0000-0000-0000000e0001",
                "b0000000-0000-0000-0000-0000000e0002",
                "b0000000-0000-0000-0000-0000000e0003",
                "b0000000-0000-0000-0000-0000000e0004",
            ]
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
                vec!["b0000000-0000-0000-0000-0000000e0004"],
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
                vec!["b0000000-0000-0000-0000-0000000e0004"],
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
                vec!["b0000000-0000-0000-0000-0000000e0003"],
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
                vec!["b0000000-0000-0000-0000-0000000e0003"],
                "Chats wrapper (exclude owned) failed on hierarchical"
            );
        }

        // --- Projects Wrapper: include_owned ---
        {
            let items =
                get_user_accessible_items(&pool, user_id, Some("project".to_string()), false)
                    .await?;
            let id_set: HashSet<String> = items.into_iter().map(|item| item.item_id).collect();
            let expected_ids: HashSet<String> = [
                "b0000000-0000-0000-0000-0000000e0001",
                "b0000000-0000-0000-0000-0000000e0002",
            ]
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
            let expected_ids: HashSet<String> = [
                "b0000000-0000-0000-0000-0000000e0001",
                "b0000000-0000-0000-0000-0000000e0002",
            ]
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
            let expected_ids: HashSet<String> = [
                "c0000000-0000-0000-0000-0000000e0001",
                "c0000000-0000-0000-0000-0000000e0002",
                "c0000000-0000-0000-0000-0000000e0003",
                "c0000000-0000-0000-0000-0000000e0004",
                "c0000000-0000-0000-0000-0000000e0005",
            ]
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
            let expected_ids: HashSet<String> = [
                "c0000000-0000-0000-0000-0000000e0001",
                "c0000000-0000-0000-0000-0000000e0002",
                "c0000000-0000-0000-0000-0000000e0003",
                "c0000000-0000-0000-0000-0000000e0004",
                "c0000000-0000-0000-0000-0000000e0005",
            ]
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
                vec!["c0000000-0000-0000-0000-0000000e0005"],
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
                vec!["c0000000-0000-0000-0000-0000000e0005"],
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
                vec!["c0000000-0000-0000-0000-0000000e0004"],
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
                vec!["c0000000-0000-0000-0000-0000000e0004"],
                "Chats wrapper (exclude owned) failed on deep hierarchy"
            );
        }

        // --- Projects Wrapper: include_owned ---
        {
            let items =
                get_user_accessible_items(&pool, user_id, Some("project".to_string()), false)
                    .await?;
            let id_set: HashSet<String> = items.into_iter().map(|item| item.item_id).collect();
            let expected_ids: HashSet<String> = [
                "c0000000-0000-0000-0000-0000000e0001",
                "c0000000-0000-0000-0000-0000000e0002",
                "c0000000-0000-0000-0000-0000000e0003",
            ]
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
            let expected_ids: HashSet<String> = [
                "c0000000-0000-0000-0000-0000000e0001",
                "c0000000-0000-0000-0000-0000000e0002",
                "c0000000-0000-0000-0000-0000000e0003",
            ]
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
