#[cfg(not(test))]
use cached::proc_macro::cached;

use model::item::{ShareableItem, ShareableItemType, UserAccessibleItem};
use sqlx::{Pool, Postgres};

/// given a list of shareable items, returns all accessible items for a user, traversing nested project structure
#[tracing::instrument(skip(db, items))]
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
        WITH RECURSIVE ProjectHierarchy AS (
            -- Find direct user access to ALL projects (not filtered) as starting point
            SELECT
                p.id,
                uia.access_level
            FROM "Project" p
            JOIN "UserItemAccess" uia ON p.id = uia.item_id AND uia.item_type = 'project'
            WHERE uia.user_id = $1 AND p."deletedAt" IS NULL

            UNION ALL

            -- Then walk down the project tree and grab child projects, keeping parent's access
            SELECT
                p.id,
                ph.access_level
            FROM "Project" p
            JOIN ProjectHierarchy ph ON p."parentId" = ph.id
            WHERE p."deletedAt" IS NULL
        ),
        -- Now build up all the ways a user can have access to stuff
        AllAccessGrants AS (
            -- Explicit access to documents via UserItemAccess table
            SELECT uia.item_id, uia.item_type, uia.access_level
            FROM "UserItemAccess" uia
            LEFT JOIN "Document" d ON uia.item_type = 'document' AND uia.item_id = d.id
            WHERE uia.user_id = $1
              AND uia.item_type = 'document'
              AND uia.item_id = ANY($2)
              AND d."deletedAt" IS NULL

            UNION ALL

            -- Explicit access to chats via UserItemAccess table
            SELECT uia.item_id, uia.item_type, uia.access_level
            FROM "UserItemAccess" uia
            LEFT JOIN "Chat" c ON uia.item_type = 'chat' AND uia.item_id = c.id
            WHERE uia.user_id = $1
              AND uia.item_type = 'chat'
              AND uia.item_id = ANY($3)
              AND c."deletedAt" IS NULL

            UNION ALL

            -- Explicit access to projects via UserItemAccess table
            SELECT uia.item_id, uia.item_type, uia.access_level
            FROM "UserItemAccess" uia
            LEFT JOIN "Project" p ON uia.item_type = 'project' AND uia.item_id = p.id
            WHERE uia.user_id = $1
              AND uia.item_type = 'project'
              AND uia.item_id = ANY($4)
              AND p."deletedAt" IS NULL

            UNION ALL

            -- Access to docs in visible projects (only filter by requested doc IDs)
            SELECT
                d.id AS item_id,
                'document' AS item_type,
                ph.access_level
            FROM "Document" d
            JOIN ProjectHierarchy ph ON d."projectId" = ph.id
            WHERE d.id = ANY($2)
              AND d."projectId" IS NOT NULL 
              AND d."deletedAt" IS NULL

            UNION ALL

            -- Access to chats in visible projects (only filter by requested chat IDs)
            SELECT
                c.id AS item_id,
                'chat' AS item_type,
                ph.access_level
            FROM "Chat" c
            JOIN ProjectHierarchy ph ON c."projectId" = ph.id
            WHERE c.id = ANY($3)
              AND c."projectId" IS NOT NULL 
              AND c."deletedAt" IS NULL

            UNION ALL

            -- Include the projects we found earlier (only filter by requested project IDs)
            SELECT
                ph.id AS item_id,
                'project' AS item_type,
                ph.access_level
            FROM ProjectHierarchy ph
            WHERE ph.id = ANY($4)
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
                item_id: "project-owned".to_string(),
                item_type: ShareableItemType::Project,
            },
            ShareableItem {
                item_id: "chat-owned".to_string(),
                item_type: ShareableItemType::Chat,
            },
            ShareableItem {
                item_id: "doc-owned".to_string(),
                item_type: ShareableItemType::Document,
            },
            ShareableItem {
                item_id: "project-shared".to_string(),
                item_type: ShareableItemType::Project,
            },
            ShareableItem {
                item_id: "chat-shared".to_string(),
                item_type: ShareableItemType::Chat,
            },
            ShareableItem {
                item_id: "doc-shared".to_string(),
                item_type: ShareableItemType::Document,
            },
        ];
        {
            let items = validate_user_accessible_items(&pool, user_id, items).await?;
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
            assert_eq!(item_ids, expected_ids, "all accessible items failed");
        }

        // Only includes what you pass in
        let items: Vec<ShareableItem> = vec![
            ShareableItem {
                item_id: "project-owned".to_string(),
                item_type: ShareableItemType::Project,
            },
            ShareableItem {
                item_id: "chat-owned".to_string(),
                item_type: ShareableItemType::Chat,
            },
            ShareableItem {
                item_id: "doc-owned".to_string(),
                item_type: ShareableItemType::Document,
            },
        ];
        {
            let items = validate_user_accessible_items(&pool, user_id, items).await?;
            let item_ids: HashSet<String> = items.into_iter().map(|item| item.item_id).collect();
            let expected_ids: HashSet<String> = ["project-owned", "chat-owned", "doc-owned"]
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
                item_id: "doc-owned".to_string(),
                item_type: ShareableItemType::Document,
            },
            ShareableItem {
                item_id: "doc-shared".to_string(),
                item_type: ShareableItemType::Document,
            },
        ];

        {
            let items = validate_user_accessible_items(&pool, user_id, items).await?;
            let item_ids: HashSet<String> = items.into_iter().map(|item| item.item_id).collect();
            let expected_ids: HashSet<String> = ["doc-owned", "doc-shared"]
                .into_iter()
                .map(String::from)
                .collect();
            assert_eq!(item_ids, expected_ids, "only test documents failed");
        }

        // Only test chats
        let items: Vec<ShareableItem> = vec![
            ShareableItem {
                item_id: "chat-owned".to_string(),
                item_type: ShareableItemType::Chat,
            },
            ShareableItem {
                item_id: "chat-shared".to_string(),
                item_type: ShareableItemType::Chat,
            },
        ];

        {
            let items = validate_user_accessible_items(&pool, user_id, items).await?;
            let item_ids: HashSet<String> = items.into_iter().map(|item| item.item_id).collect();
            let expected_ids: HashSet<String> = ["chat-owned", "chat-shared"]
                .into_iter()
                .map(String::from)
                .collect();
            assert_eq!(item_ids, expected_ids, "only test chats failed");
        }

        // Only test projects
        let items: Vec<ShareableItem> = vec![
            ShareableItem {
                item_id: "project-owned".to_string(),
                item_type: ShareableItemType::Project,
            },
            ShareableItem {
                item_id: "project-shared".to_string(),
                item_type: ShareableItemType::Project,
            },
        ];

        {
            let items = validate_user_accessible_items(&pool, user_id, items).await?;
            let item_ids: HashSet<String> = items.into_iter().map(|item| item.item_id).collect();
            let expected_ids: HashSet<String> = ["project-owned", "project-shared"]
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
                item_id: "project-A".to_string(),
                item_type: ShareableItemType::Project,
            },
            ShareableItem {
                item_id: "project-B".to_string(),
                item_type: ShareableItemType::Project,
            },
            ShareableItem {
                item_id: "chat-A".to_string(),
                item_type: ShareableItemType::Chat,
            },
            ShareableItem {
                item_id: "doc-A".to_string(),
                item_type: ShareableItemType::Document,
            },
        ];
        {
            let items = validate_user_accessible_items(&pool, user_id, items).await?;
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

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("get_user_accessible_items_nested")))]
    async fn test_accessible_items_deep_hierarchy(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let user_id = "user-1"; // This user has implicit access via the top-level project

        // --- Core Function: include_owned ---
        let items: Vec<ShareableItem> = vec![
            ShareableItem {
                item_id: "project-A".to_string(),
                item_type: ShareableItemType::Project,
            },
            ShareableItem {
                item_id: "project-B".to_string(),
                item_type: ShareableItemType::Project,
            },
            ShareableItem {
                item_id: "project-C".to_string(),
                item_type: ShareableItemType::Project,
            },
            ShareableItem {
                item_id: "chat-C".to_string(),
                item_type: ShareableItemType::Chat,
            },
            ShareableItem {
                item_id: "doc-C".to_string(),
                item_type: ShareableItemType::Document,
            },
        ];
        {
            let items = validate_user_accessible_items(&pool, user_id, items).await?;
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
                item_id: "project-A-iso".to_string(),
                item_type: ShareableItemType::Project,
            },
            ShareableItem {
                item_id: "project-B-iso".to_string(),
                item_type: ShareableItemType::Project,
            },
            ShareableItem {
                item_id: "chat-A-iso".to_string(),
                item_type: ShareableItemType::Chat,
            },
            ShareableItem {
                item_id: "doc-B-iso".to_string(),
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
