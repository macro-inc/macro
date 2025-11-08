use crate::outbound::pg_soup_repo::unexpanded::{
    by_cursor::{no_frecency_unexpanded_generic_cursor_soup, unexpanded_generic_cursor_soup},
    by_ids::unexpanded_soup_by_ids,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model_entity::EntityType;
use models_pagination::{PaginateOn, Query, SimpleSortMethod};
use models_soup::item::SoupItem;
use sqlx::{Pool, Postgres};
use std::collections::HashSet;

// testing the sorting methods work as expected
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("simple_items")
    )
)]
async fn test_unexpanded_generic_sorting_methods(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserIdStr::parse_from_str("macro|user@user.com").unwrap();

    let get_item_ids = |items: &[SoupItem]| -> Vec<String> {
        items
            .iter()
            .map(|item| match item {
                SoupItem::Document(d) => d.id.clone(),
                SoupItem::Chat(c) => c.id.clone(),
                SoupItem::Project(p) => p.id.clone(),
            })
            .collect()
    };

    {
        let result = unexpanded_generic_cursor_soup(
            &pool,
            user_id.copied(),
            10,
            Query::Sort(SimpleSortMethod::ViewedAt),
        )
        .await?;
        assert_eq!(result.len(), 3, "LastViewed should return 3 items");

        let item_ids = get_item_ids(&result);
        assert_eq!(
            item_ids,
            vec!["doc-A", "doc-B", "doc-C"],
            "Failed to sort correctly by LastViewed"
        );
    }

    {
        let result = unexpanded_generic_cursor_soup(
            &pool,
            user_id.copied(),
            10,
            Query::Sort(SimpleSortMethod::UpdatedAt),
        )
        .await?;
        assert_eq!(result.len(), 3, "UpdatedAt should return 3 items");

        let item_ids = get_item_ids(&result);
        assert_eq!(
            item_ids,
            vec!["doc-C", "doc-A", "doc-B"],
            "Failed to sort correctly by UpdatedAt"
        );
    }

    {
        let result = unexpanded_generic_cursor_soup(
            &pool,
            user_id,
            10,
            Query::Sort(SimpleSortMethod::CreatedAt),
        )
        .await?;
        assert_eq!(result.len(), 3, "CreatedAt should return 3 items");

        let item_ids = get_item_ids(&result);
        assert_eq!(
            item_ids,
            vec!["doc-B", "doc-C", "doc-A"],
            "Failed to sort correctly by CreatedAt"
        );
    }

    Ok(())
}

// testing the sorting with mixed item types works as expected
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("mixed_items_unexpanded")
    )
)]
async fn test_unexpanded_generic_mixed_types_sorting(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserIdStr::parse_from_str("macro|user@user.com").unwrap();

    // --- Helper to extract IDs for easy comparison ---
    let get_item_ids = |items: &[SoupItem]| -> Vec<String> {
        items
            .iter()
            .map(|item| match item {
                SoupItem::Document(d) => d.id.clone(),
                SoupItem::Chat(c) => c.id.clone(),
                SoupItem::Project(p) => p.id.clone(),
            })
            .collect()
    };

    // --- Case 1: Test SortMethod::LastViewed ---
    {
        let result = unexpanded_generic_cursor_soup(
            &pool,
            user_id.copied(),
            10,
            Query::Sort(SimpleSortMethod::ViewedAt),
        )
        .await?;
        assert_eq!(result.len(), 3, "LastViewed should return 3 items");

        let item_ids = get_item_ids(&result);
        assert_eq!(
            item_ids,
            vec!["test-document", "test-project", "test-chat"],
            "Failed to sort correctly by LastViewed"
        );

        // Perform detailed property checks once, since the set of items is the same.
        let items_map: std::collections::HashMap<String, &SoupItem> = result
            .iter()
            .map(|item| {
                let id = match item {
                    SoupItem::Document(d) => d.id.clone(),
                    SoupItem::Chat(c) => c.id.clone(),
                    SoupItem::Project(p) => p.id.clone(),
                };
                (id, item)
            })
            .collect();

        if let Some(SoupItem::Document(doc)) = items_map.get("test-document") {
            assert_eq!(doc.name, "Document Charlie");
            assert_eq!(doc.file_type.as_deref(), Some("pdf"));
        } else {
            panic!("Missing test-document");
        }
        if let Some(SoupItem::Chat(chat)) = items_map.get("test-chat") {
            assert_eq!(chat.name, "Chat Bravo");
        } else {
            panic!("Missing test-chat");
        }
        if let Some(SoupItem::Project(project)) = items_map.get("test-project") {
            assert_eq!(project.name, "Project Alpha");
        } else {
            panic!("Missing test-project");
        }
    }

    // --- Case 2: Test SortMethod::UpdatedAt ---
    {
        let result = unexpanded_generic_cursor_soup(
            &pool,
            user_id.copied(),
            10,
            Query::Sort(SimpleSortMethod::UpdatedAt),
        )
        .await?;
        assert_eq!(result.len(), 3, "UpdatedAt should return 3 items");

        let item_ids = get_item_ids(&result);
        assert_eq!(
            item_ids,
            vec!["test-chat", "test-document", "test-project"],
            "Failed to sort correctly by UpdatedAt"
        );
    }

    // --- Case 3: Test SortMethod::CreatedAt ---
    {
        let result = unexpanded_generic_cursor_soup(
            &pool,
            user_id,
            10,
            Query::Sort(SimpleSortMethod::CreatedAt),
        )
        .await?;
        assert_eq!(result.len(), 3, "CreatedAt should return 3 items");

        let item_ids = get_item_ids(&result);
        assert_eq!(
            item_ids,
            vec!["test-project", "test-chat", "test-document"],
            "Failed to sort correctly by CreatedAt"
        );
    }

    Ok(())
}

// testing the cursor based pagination works as expected
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("mixed_items_unexpanded_history")
    )
)]
async fn test_get_user_items_unexpanded_cursor(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserIdStr::parse_from_str("macro|user@user.com").unwrap();
    let result = unexpanded_generic_cursor_soup(
        &pool,
        user_id.copied(),
        1,
        Query::Sort(SimpleSortMethod::ViewedAt),
    )
    .await?
    .into_iter()
    .paginate_on(1, SimpleSortMethod::ViewedAt)
    .into_page();

    assert_eq!(result.items.len(), 1, "Should get 1 item");

    match &result.items[0] {
        SoupItem::Document(doc) => {
            assert_eq!(
                doc.id, "test-document",
                "First item should be document with ID test-document"
            );
        }
        _ => panic!("First item should be a document"),
    }

    let result = unexpanded_generic_cursor_soup(
        &pool,
        user_id,
        1,
        Query::new(
            result.next_cursor.map(|s| s.decode_json().unwrap()),
            SimpleSortMethod::ViewedAt,
        ),
    )
    .await?;

    assert_eq!(result.len(), 1, "Should get 1 item");

    match &result[0] {
        SoupItem::Project(project) => {
            assert_eq!(
                project.id, "test-project",
                "Second item should be project with ID test-project"
            );
        }
        _ => panic!("Second item should be a project"),
    }

    Ok(())
}

// Test that unexpanded_soup_by_ids returns items in the correct order and only includes explicit access
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("mixed_items_unexpanded")
    )
)]
async fn test_unexpanded_soup_by_ids(pool: Pool<Postgres>) {
    let user_id = MacroUserIdStr::parse_from_str("macro|user@user.com").unwrap();

    // Request specific items in a specific order
    let entities = [
        EntityType::Chat.with_entity_str("test-chat"),
        EntityType::Document.with_entity_str("test-document"),
        EntityType::Project.with_entity_str("test-project"),
        EntityType::Document.with_entity_str("non-existent"), // Should not appear in results
    ];

    let items = unexpanded_soup_by_ids(&pool, user_id, &entities)
        .await
        .unwrap();

    // Should get 3 items (the non-existent one is excluded)
    assert_eq!(
        items.len(),
        3,
        "Should get 3 items (excluding non-existent)"
    );

    // all 3 types should exist
    items
        .iter()
        .find(|x| matches!(x, SoupItem::Document(_)))
        .unwrap();
    items
        .iter()
        .find(|x| matches!(x, SoupItem::Chat(_)))
        .unwrap();
    items
        .iter()
        .find(|x| matches!(x, SoupItem::Project(_)))
        .unwrap();
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("mixed_items_unexpanded")
    )
)]
async fn it_should_be_empty(pool: Pool<Postgres>) {
    let user_id = MacroUserIdStr::parse_from_str("macro|user@user.com").unwrap();
    // Test with empty entity list
    let empty_result = unexpanded_soup_by_ids(&pool, user_id.copied(), [])
        .await
        .unwrap();
    assert_eq!(empty_result.len(), 0, "Should return empty for empty input");

    // Test with only non-existent items
    let non_existent_entities = [
        EntityType::Document.with_entity_str("non-existent-doc"),
        EntityType::Chat.with_entity_str("non-existent-chat"),
        EntityType::Project.with_entity_str("non-existent-project"),
    ];

    let empty_result = unexpanded_soup_by_ids(&pool, user_id, &non_existent_entities)
        .await
        .unwrap();
    assert_eq!(
        empty_result.len(),
        0,
        "Should return empty for non-existent items"
    );
}

// Test that unexpanded_soup_by_ids correctly handles mixed entity types
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("simple_items")
    )
)]
async fn test_unexpanded_soup_by_ids_simple(pool: Pool<Postgres>) {
    let user_id = MacroUserIdStr::parse_from_str("macro|user@user.com").unwrap();

    // Request documents in a specific order
    let entities = [
        EntityType::Document.with_entity_str("doc-C"),
        EntityType::Document.with_entity_str("doc-A"),
        EntityType::Document.with_entity_str("doc-B"),
    ];

    let items = unexpanded_soup_by_ids(&pool, user_id.copied(), &entities)
        .await
        .unwrap();

    assert_eq!(items.len(), 3, "Should get all 3 documents");

    // Test with duplicate entity IDs (should still return unique items)
    let entities_with_duplicates = [
        EntityType::Document.with_entity_str("doc-A"),
        EntityType::Document.with_entity_str("doc-B"),
        EntityType::Document.with_entity_str("doc-A"), // Duplicate
        EntityType::Document.with_entity_str("doc-C"),
    ];

    let items = unexpanded_soup_by_ids(&pool, user_id.copied(), &entities_with_duplicates)
        .await
        .unwrap();

    assert_eq!(
        items.len(),
        3,
        "Should get 3 unique documents despite duplicates"
    );
}

// Test that unexpanded_soup_by_ids respects access control
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("mixed_items_unexpanded_history")
    )
)]
async fn test_unexpanded_soup_by_ids_access_control(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserIdStr::parse_from_str("macro|user@user.com").unwrap();

    // Request all items, but only those with explicit access should be returned
    let entities = [
        EntityType::Document.with_entity_str("test-document"),
        EntityType::Chat.with_entity_str("test-chat"),
        EntityType::Project.with_entity_str("test-project"),
    ];

    let items = unexpanded_soup_by_ids(&pool, user_id, &entities).await?;

    // User should have access to all three items based on the fixture
    assert_eq!(items.len(), 3, "Should have access to all three items");

    // Test with a different user who might not have access
    let other_user_id = MacroUserIdStr::parse_from_str("macro|other@user.com").unwrap();
    let other_items = unexpanded_soup_by_ids(&pool, other_user_id, &entities).await?;

    // Other user shouldn't have access to any items (based on typical fixture setup)
    assert_eq!(
        other_items.len(),
        0,
        "Other user should not have access to any items"
    );

    Ok(())
}

// Test that no_frecency_unexpanded_generic_cursor_soup excludes items with frecency records
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("no_frecency_items_unexpanded")
    )
)]
async fn test_no_frecency_unexpanded_filters_out_frecency_items(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let user_id = MacroUserIdStr::parse_from_str("macro|user@user.com").unwrap();

    // Test with UpdatedAt sort - should return only items without frecency
    let items = no_frecency_unexpanded_generic_cursor_soup(
        &pool,
        user_id,
        20,
        Query::Sort(SimpleSortMethod::UpdatedAt),
    )
    .await?;

    // Should get 5 items (2 docs + 2 chats + 1 project without frecency)
    assert_eq!(
        items.len(),
        5,
        "Should only return items without frecency records"
    );

    // Verify the returned items are the ones WITHOUT frecency
    let returned_ids: HashSet<String> = items
        .iter()
        .map(|item| match item {
            SoupItem::Chat(c) => c.id.clone(),
            SoupItem::Document(d) => d.id.clone(),
            SoupItem::Project(p) => p.id.clone(),
        })
        .collect();

    let expected_ids: HashSet<String> = [
        "doc-no-frecency-1",
        "doc-no-frecency-2",
        "chat-no-frecency-1",
        "chat-no-frecency-2",
        "project-no-frecency",
    ]
    .iter()
    .map(|&s| s.to_string())
    .collect();

    assert_eq!(
        returned_ids, expected_ids,
        "Should only get items without frecency records"
    );

    // Verify none of the frecency items are returned
    let frecency_items = [
        "doc-with-frecency-1",
        "doc-with-frecency-2",
        "chat-with-frecency-1",
        "project-with-frecency",
    ];
    for frecency_id in &frecency_items {
        assert!(
            !returned_ids.contains(*frecency_id),
            "Should not return item with frecency: {}",
            frecency_id
        );
    }

    Ok(())
}

// Test sorting methods work correctly for no_frecency unexpanded query
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("no_frecency_items_unexpanded")
    )
)]
async fn test_no_frecency_unexpanded_sorting_methods(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserIdStr::parse_from_str("macro|user@user.com").unwrap();

    let get_item_ids = |items: &[SoupItem]| -> Vec<String> {
        items
            .iter()
            .map(|item| match item {
                SoupItem::Document(d) => d.id.clone(),
                SoupItem::Chat(c) => c.id.clone(),
                SoupItem::Project(p) => p.id.clone(),
            })
            .collect()
    };

    // Test UpdatedAt sorting
    {
        let items = no_frecency_unexpanded_generic_cursor_soup(
            &pool,
            user_id.copied(),
            20,
            Query::Sort(SimpleSortMethod::UpdatedAt),
        )
        .await?;
        assert_eq!(items.len(), 5, "UpdatedAt should return 5 items");

        let item_ids = get_item_ids(&items);
        // Ordered by updatedAt DESC: doc-no-frecency-1 (2/13), doc-no-frecency-2 (2/12),
        // chat-no-frecency-1 (2/10), chat-no-frecency-2 (2/09), project-no-frecency (2/07)
        assert_eq!(
            item_ids,
            vec![
                "doc-no-frecency-1",
                "doc-no-frecency-2",
                "chat-no-frecency-1",
                "chat-no-frecency-2",
                "project-no-frecency"
            ],
            "Failed to sort correctly by UpdatedAt"
        );
    }

    // Test CreatedAt sorting
    {
        let items = no_frecency_unexpanded_generic_cursor_soup(
            &pool,
            user_id.copied(),
            20,
            Query::Sort(SimpleSortMethod::CreatedAt),
        )
        .await?;
        assert_eq!(items.len(), 5, "CreatedAt should return 5 items");

        let item_ids = get_item_ids(&items);
        // Ordered by createdAt DESC: project-no-frecency (1/18), chat-no-frecency-2 (1/16),
        // chat-no-frecency-1 (1/15), doc-no-frecency-2 (1/13), doc-no-frecency-1 (1/12)
        assert_eq!(
            item_ids,
            vec![
                "project-no-frecency",
                "chat-no-frecency-2",
                "chat-no-frecency-1",
                "doc-no-frecency-2",
                "doc-no-frecency-1"
            ],
            "Failed to sort correctly by CreatedAt"
        );
    }

    // Test ViewedAt sorting
    {
        let items = no_frecency_unexpanded_generic_cursor_soup(
            &pool,
            user_id,
            20,
            Query::Sort(SimpleSortMethod::ViewedAt),
        )
        .await?;
        assert_eq!(items.len(), 5, "ViewedAt should return 5 items");

        let item_ids = get_item_ids(&items);
        // Ordered by UserHistory.updatedAt DESC: doc-no-frecency-1 (3/17), doc-no-frecency-2 (3/16),
        // chat-no-frecency-1 (3/15), chat-no-frecency-2 (3/14), project-no-frecency (3/13)
        assert_eq!(
            item_ids,
            vec![
                "doc-no-frecency-1",
                "doc-no-frecency-2",
                "chat-no-frecency-1",
                "chat-no-frecency-2",
                "project-no-frecency"
            ],
            "Failed to sort correctly by ViewedAt"
        );
    }

    Ok(())
}

// Test cursor-based pagination for no_frecency unexpanded query
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("no_frecency_items_unexpanded")
    )
)]
async fn test_no_frecency_unexpanded_cursor_pagination(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserIdStr::parse_from_str("macro|user@user.com").unwrap();

    // Get first page with limit of 2
    let result = no_frecency_unexpanded_generic_cursor_soup(
        &pool,
        user_id.copied(),
        2,
        Query::Sort(SimpleSortMethod::UpdatedAt),
    )
    .await?
    .into_iter()
    .paginate_on(2, SimpleSortMethod::UpdatedAt)
    .into_page();

    assert_eq!(result.items.len(), 2, "Should get 2 items in first page");

    // First two items should be the most recently updated
    match &result.items[0] {
        SoupItem::Document(doc) => {
            assert_eq!(
                doc.id, "doc-no-frecency-1",
                "First item should be doc-no-frecency-1"
            );
        }
        _ => panic!("First item should be a document"),
    }

    match &result.items[1] {
        SoupItem::Document(doc) => {
            assert_eq!(
                doc.id, "doc-no-frecency-2",
                "Second item should be doc-no-frecency-2"
            );
        }
        _ => panic!("Second item should be a document"),
    }

    // Get second page using cursor
    let items = no_frecency_unexpanded_generic_cursor_soup(
        &pool,
        user_id,
        2,
        Query::new(
            result.next_cursor.map(|s| s.decode_json().unwrap()),
            SimpleSortMethod::UpdatedAt,
        ),
    )
    .await?;

    assert_eq!(items.len(), 2, "Should get 2 items in second page");

    // Next two items should be the chats
    match &items[0] {
        SoupItem::Chat(chat) => {
            assert_eq!(
                chat.id, "chat-no-frecency-1",
                "Third item should be chat-no-frecency-1"
            );
        }
        _ => panic!("Third item should be a chat"),
    }

    match &items[1] {
        SoupItem::Chat(chat) => {
            assert_eq!(
                chat.id, "chat-no-frecency-2",
                "Fourth item should be chat-no-frecency-2"
            );
        }
        _ => panic!("Fourth item should be a chat"),
    }

    Ok(())
}
