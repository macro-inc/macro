#[cfg(not(test))]
use cached::proc_macro::cached;

use model::item::{ShareableItem, ShareableItemType, UserAccessibleItem};
use sqlx::{Pool, Postgres};

/// Given a list of shareable items, returns the subset that are accessible to the user,
/// querying entity_access with the user's source IDs (user ID, team memberships, channel participations).
#[tracing::instrument(skip(db, items), err)]
#[cfg_attr(
    not(test),
    cached(
        time = 30,
        result = true,
        key = "String",
        convert = r#"{ format!("{}-{}", user_id, items.iter().map(|i| format!("{}-{}", i.item_type, i.item_id)).collect::<Vec<_>>().join("_")) }"#
    )
)]
pub async fn validate_user_accessible_items(
    db: &Pool<Postgres>,
    user_id: &str,
    items: Vec<ShareableItem>,
) -> anyhow::Result<Vec<UserAccessibleItem>> {
    let document_ids: Vec<String> = items
        .iter()
        .filter_map(|i| match i.item_type {
            ShareableItemType::Document => Some(i.item_id.clone()),
            _ => None,
        })
        .collect();

    let chat_ids: Vec<String> = items
        .iter()
        .filter_map(|i| match i.item_type {
            ShareableItemType::Chat => Some(i.item_id.clone()),
            _ => None,
        })
        .collect();

    let project_ids: Vec<String> = items
        .iter()
        .filter_map(|i| match i.item_type {
            ShareableItemType::Project => Some(i.item_id.clone()),
            _ => None,
        })
        .collect();

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
        -- Get all entities the user has access to via entity_access, filtered to requested items
        AllAccessGrants AS (
            -- Documents the user has access to
            SELECT ea.entity_id::text as item_id, ea.entity_type as item_type
            FROM entity_access ea
            LEFT JOIN "Document" d ON ea.entity_type = 'document' AND ea.entity_id::text = d.id
            WHERE ea.source_id = ANY(SELECT source_id FROM user_source_ids)
              AND ea.entity_type = 'document'
              AND ea.entity_id::text = ANY($2)
              AND d."deletedAt" IS NULL

            UNION ALL

            -- Chats the user has access to
            SELECT ea.entity_id::text as item_id, ea.entity_type as item_type
            FROM entity_access ea
            LEFT JOIN "Chat" c ON ea.entity_type = 'chat' AND ea.entity_id::text = c.id
            WHERE ea.source_id = ANY(SELECT source_id FROM user_source_ids)
              AND ea.entity_type = 'chat'
              AND ea.entity_id::text = ANY($3)
              AND c."deletedAt" IS NULL

            UNION ALL

            -- Projects the user has access to
            SELECT ea.entity_id::text as item_id, ea.entity_type as item_type
            FROM entity_access ea
            LEFT JOIN "Project" p ON ea.entity_type = 'project' AND ea.entity_id::text = p.id
            WHERE ea.source_id = ANY(SELECT source_id FROM user_source_ids)
              AND ea.entity_type = 'project'
              AND ea.entity_id::text = ANY($4)
              AND p."deletedAt" IS NULL
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
        &document_ids,
        &chat_ids,
        &project_ids,
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

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("get_user_accessible_items_explicit")))]
    async fn test_validate_accessible_items(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let user_id = "user-1";

        // All accessible items
        let items: Vec<ShareableItem> = vec![
            ShareableItem {
                item_id: "a0000000-0000-0000-0000-0000000e0001".to_string(),
                item_type: ShareableItemType::Project,
            },
            ShareableItem {
                item_id: "a0000000-0000-0000-0000-0000000e0002".to_string(),
                item_type: ShareableItemType::Chat,
            },
            ShareableItem {
                item_id: "a0000000-0000-0000-0000-0000000e0003".to_string(),
                item_type: ShareableItemType::Document,
            },
            ShareableItem {
                item_id: "a0000000-0000-0000-0000-0000000e0004".to_string(),
                item_type: ShareableItemType::Project,
            },
            ShareableItem {
                item_id: "a0000000-0000-0000-0000-0000000e0005".to_string(),
                item_type: ShareableItemType::Chat,
            },
            ShareableItem {
                item_id: "a0000000-0000-0000-0000-0000000e0006".to_string(),
                item_type: ShareableItemType::Document,
            },
        ];
        {
            let items = validate_user_accessible_items(&pool, user_id, items).await?;
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
            assert_eq!(item_ids, expected_ids, "all accessible items failed");
        }

        // Only includes what you pass in
        let items: Vec<ShareableItem> = vec![
            ShareableItem {
                item_id: "a0000000-0000-0000-0000-0000000e0001".to_string(),
                item_type: ShareableItemType::Project,
            },
            ShareableItem {
                item_id: "a0000000-0000-0000-0000-0000000e0002".to_string(),
                item_type: ShareableItemType::Chat,
            },
            ShareableItem {
                item_id: "a0000000-0000-0000-0000-0000000e0003".to_string(),
                item_type: ShareableItemType::Document,
            },
        ];
        {
            let items = validate_user_accessible_items(&pool, user_id, items).await?;
            let item_ids: HashSet<String> = items.into_iter().map(|item| item.item_id).collect();
            let expected_ids: HashSet<String> = [
                "a0000000-0000-0000-0000-0000000e0001",
                "a0000000-0000-0000-0000-0000000e0002",
                "a0000000-0000-0000-0000-0000000e0003",
            ]
            .into_iter()
            .map(String::from)
            .collect();
            assert_eq!(
                item_ids, expected_ids,
                "only include what you pass in failed"
            );
        }

        // Only test documents
        let items: Vec<ShareableItem> = vec![
            ShareableItem {
                item_id: "a0000000-0000-0000-0000-0000000e0003".to_string(),
                item_type: ShareableItemType::Document,
            },
            ShareableItem {
                item_id: "a0000000-0000-0000-0000-0000000e0006".to_string(),
                item_type: ShareableItemType::Document,
            },
        ];

        {
            let items = validate_user_accessible_items(&pool, user_id, items).await?;
            let item_ids: HashSet<String> = items.into_iter().map(|item| item.item_id).collect();
            let expected_ids: HashSet<String> = [
                "a0000000-0000-0000-0000-0000000e0003",
                "a0000000-0000-0000-0000-0000000e0006",
            ]
            .into_iter()
            .map(String::from)
            .collect();
            assert_eq!(item_ids, expected_ids, "only test documents failed");
        }

        // Only test chats
        let items: Vec<ShareableItem> = vec![
            ShareableItem {
                item_id: "a0000000-0000-0000-0000-0000000e0002".to_string(),
                item_type: ShareableItemType::Chat,
            },
            ShareableItem {
                item_id: "a0000000-0000-0000-0000-0000000e0005".to_string(),
                item_type: ShareableItemType::Chat,
            },
        ];

        {
            let items = validate_user_accessible_items(&pool, user_id, items).await?;
            let item_ids: HashSet<String> = items.into_iter().map(|item| item.item_id).collect();
            let expected_ids: HashSet<String> = [
                "a0000000-0000-0000-0000-0000000e0002",
                "a0000000-0000-0000-0000-0000000e0005",
            ]
            .into_iter()
            .map(String::from)
            .collect();
            assert_eq!(item_ids, expected_ids, "only test chats failed");
        }

        // Only test projects
        let items: Vec<ShareableItem> = vec![
            ShareableItem {
                item_id: "a0000000-0000-0000-0000-0000000e0001".to_string(),
                item_type: ShareableItemType::Project,
            },
            ShareableItem {
                item_id: "a0000000-0000-0000-0000-0000000e0004".to_string(),
                item_type: ShareableItemType::Project,
            },
        ];

        {
            let items = validate_user_accessible_items(&pool, user_id, items).await?;
            let item_ids: HashSet<String> = items.into_iter().map(|item| item.item_id).collect();
            let expected_ids: HashSet<String> = [
                "a0000000-0000-0000-0000-0000000e0001",
                "a0000000-0000-0000-0000-0000000e0004",
            ]
            .into_iter()
            .map(String::from)
            .collect();
            assert_eq!(item_ids, expected_ids, "only test projects failed");
        }

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("get_user_accessible_items_implicit")))]
    async fn test_accessible_items_hierarchical(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let user_id = "user-1"; // This user has implicit access to items owned by user-2

        // --- Core Function: include_owned ---
        // Since user-1 owns nothing, this should return all 4 accessible items.
        let items: Vec<ShareableItem> = vec![
            ShareableItem {
                item_id: "b0000000-0000-0000-0000-0000000e0001".to_string(),
                item_type: ShareableItemType::Project,
            },
            ShareableItem {
                item_id: "b0000000-0000-0000-0000-0000000e0002".to_string(),
                item_type: ShareableItemType::Project,
            },
            ShareableItem {
                item_id: "b0000000-0000-0000-0000-0000000e0003".to_string(),
                item_type: ShareableItemType::Chat,
            },
            ShareableItem {
                item_id: "b0000000-0000-0000-0000-0000000e0004".to_string(),
                item_type: ShareableItemType::Document,
            },
        ];
        {
            let items = validate_user_accessible_items(&pool, user_id, items).await?;
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

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("get_user_accessible_items_nested")))]
    async fn test_accessible_items_deep_hierarchy(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let user_id = "user-1"; // This user has implicit access via the top-level project

        // --- Core Function: include_owned ---
        let items: Vec<ShareableItem> = vec![
            ShareableItem {
                item_id: "c0000000-0000-0000-0000-0000000e0001".to_string(),
                item_type: ShareableItemType::Project,
            },
            ShareableItem {
                item_id: "c0000000-0000-0000-0000-0000000e0002".to_string(),
                item_type: ShareableItemType::Project,
            },
            ShareableItem {
                item_id: "c0000000-0000-0000-0000-0000000e0003".to_string(),
                item_type: ShareableItemType::Project,
            },
            ShareableItem {
                item_id: "c0000000-0000-0000-0000-0000000e0004".to_string(),
                item_type: ShareableItemType::Chat,
            },
            ShareableItem {
                item_id: "c0000000-0000-0000-0000-0000000e0005".to_string(),
                item_type: ShareableItemType::Document,
            },
        ];
        {
            let items = validate_user_accessible_items(&pool, user_id, items).await?;
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

        Ok(())
    }

    // ensure a user doesn't get access to items they shouldn't.
    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("get_user_accessible_items_unaccessible")
    ))]
    async fn test_accessible_items_isolation(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let user_id = "user-4"; // This user has no permissions to any items in the fixture.

        // --- Core Function: include_owned ---
        let items: Vec<ShareableItem> = vec![
            ShareableItem {
                item_id: "d0000000-0000-0000-0000-0000000e0001".to_string(),
                item_type: ShareableItemType::Project,
            },
            ShareableItem {
                item_id: "d0000000-0000-0000-0000-0000000e0002".to_string(),
                item_type: ShareableItemType::Project,
            },
            ShareableItem {
                item_id: "d0000000-0000-0000-0000-0000000e0003".to_string(),
                item_type: ShareableItemType::Chat,
            },
            ShareableItem {
                item_id: "d0000000-0000-0000-0000-0000000e0004".to_string(),
                item_type: ShareableItemType::Document,
            },
        ];
        {
            let items = validate_user_accessible_items(&pool, user_id, items).await?;
            let item_ids: HashSet<String> = items.into_iter().map(|item| item.item_id).collect();
            assert!(item_ids.is_empty());
        }

        Ok(())
    }
}
