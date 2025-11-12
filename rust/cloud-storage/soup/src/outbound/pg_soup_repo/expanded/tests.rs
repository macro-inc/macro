use crate::outbound::pg_soup_repo::expanded::{
    by_cursor::{expanded_generic_cursor_soup, no_frecency_expanded_generic_soup},
    by_ids::expanded_soup_by_ids,
};
use item_filters::ast::EntityFilterAst;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model_entity::EntityType;
use models_pagination::{PaginateOn, Query, SimpleSortMethod};
use models_soup::item::SoupItem;
use sqlx::{Pool, Postgres};
use std::collections::HashSet;

// 2 items have no viewing history, so they should be last in the response when sorting by viewed_at
#[sqlx::test(
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("mixed_items_expanded")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn test_viewed_at_orders_nulls_last(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();
    let items =
        expanded_generic_cursor_soup(&pool, user_id, 20, Query::Sort(SimpleSortMethod::ViewedAt))
            .await?;

    assert_eq!(items.len(), 13, "Should get 13 total items");

    // Make sure we got only the items with a history entry.
    let returned_ids: HashSet<String> = items
        .iter()
        .map(|item| match item {
            SoupItem::Chat(c) => c.id.clone(),
            SoupItem::Document(d) => d.id.clone(),
            SoupItem::Project(p) => p.id.clone(),
        })
        .collect();

    let expected_ids: HashSet<String> = [
        "chat-standalone",
        "doc-in-B",
        "doc-in-D",
        "project-C",
        "project-D",
        "doc-in-C",
        "chat-in-B",
        "project-A",
        "chat-in-A",
        "doc-standalone",
        "chat-in-C",
        "project-B",
        "doc-in-A",
    ]
    .iter()
    .map(|&s| s.to_string())
    .collect();

    assert_eq!(
        returned_ids, expected_ids,
        "Should get the right set of items that have been viewed"
    );

    // Check that items are ordered by their UserHistory.updatedAt timestamp.
    let ordered_ids: Vec<&str> = items
        .iter()
        .map(|item| match item {
            SoupItem::Chat(c) => c.id.as_str(),
            SoupItem::Document(d) => d.id.as_str(),
            SoupItem::Project(p) => p.id.as_str(),
        })
        .collect();

    let expected_order = vec![
        "doc-in-B",        // 2024-01-10
        "chat-standalone", // 2024-01-09
        "doc-in-A",        // 2024-01-08
        "chat-in-A",       // 2024-01-07
        "doc-standalone",  // 2024-01-06
        "doc-in-D",        // 2023-01-05
        "chat-in-C",       // 2023-01-04
        "chat-in-B",       // null - coalesces to epoch in query, then sorts by updated_at
        "doc-in-C",        // null - coalesces to epoch in query, then sorts by updated_at
        "project-D",       // null - coalesces to epoch in query, then sorts by updated_at
        "project-C",       // null - coalesces to epoch in query, then sorts by updated_at
        "project-B",       // null - coalesces to epoch in query, then sorts by updated_at
        "project-A",       // null - coalesces to epoch in query, then sorts by updated_at
    ];
    assert_eq!(
        ordered_ids, expected_order,
        "Wrong item order based on UserHistory"
    );

    // Map for easier lookup when checking item details
    let items_map: std::collections::HashMap<&str, &SoupItem> = items
        .iter()
        .map(|item| {
            (
                match item {
                    SoupItem::Chat(c) => c.id.as_str(),
                    SoupItem::Document(d) => d.id.as_str(),
                    SoupItem::Project(p) => p.id.as_str(),
                },
                item,
            )
        })
        .collect();

    // Check a standalone item that is still present
    if let Some(SoupItem::Chat(chat)) = items_map.get("chat-standalone") {
        assert_eq!(chat.name, "Standalone Chat");
        assert_eq!(chat.project_id, None, "Standalone shouldn't have project");
    } else {
        panic!("Missing chat-standalone");
    }

    // Check an item with both inherited and direct access that is still present
    if let Some(SoupItem::Document(doc)) = items_map.get("doc-in-B") {
        assert_eq!(doc.name, "Document in B");
        assert_eq!(
            doc.project_id.as_deref(),
            Some("project-B"),
            "Wrong project on mixed access doc"
        );
    } else {
        panic!("Missing doc-in-B");
    }

    Ok(())
}

// testing that the cursor based pagination works
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("mixed_items_expanded")
    )
)]
async fn test_get_user_items_expanded_cursor(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();
    let result = expanded_generic_cursor_soup(
        &pool,
        user_id.copied(),
        1,
        Query::Sort(SimpleSortMethod::ViewedAt),
    )
    .await?
    .into_iter()
    .paginate_filter_on(1, SimpleSortMethod::ViewedAt, EntityFilterAst::default())
    .into_page();
    let items = result.items;

    assert_eq!(items.len(), 1, "Should get 1 item");

    match &items[0] {
        SoupItem::Document(doc) => {
            assert_eq!(
                doc.id, "doc-in-B",
                "First item should be document with ID test-document"
            );
        }
        _ => panic!("First item should be a document"),
    }

    let items = expanded_generic_cursor_soup(
        &pool,
        user_id,
        1,
        Query::new(
            result.next_cursor.map(|s| s.decode_json().unwrap()),
            SimpleSortMethod::ViewedAt,
        ),
    )
    .await?;

    assert_eq!(items.len(), 1, "Should get 1 item");

    match &items[0] {
        SoupItem::Chat(chat) => {
            assert_eq!(
                chat.id, "chat-standalone",
                "Second item should be chat with ID test-chat"
            );
        }
        _ => panic!("Second item should be a chat"),
    }

    Ok(())
}

// testing the sorting methods work as expected
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("sorting_expanded_items")
    )
)]
async fn test_expanded_generic_sorting_methods(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();

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
    // Should FILTER to only the 3 items with a history entry.
    {
        let items = expanded_generic_cursor_soup(
            &pool,
            user_id.copied(),
            10,
            Query::Sort(SimpleSortMethod::ViewedAt),
        )
        .await?;
        assert_eq!(
            items.len(),
            6,
            "LastViewed should filter to only 6 viewed items"
        );

        let item_ids = get_item_ids(&items);
        assert_eq!(
            item_ids,
            vec![
                "doc-A",
                "doc-B",
                "chat-A",
                "chat-B",
                "project-B",
                "project-A"
            ],
            "Failed to sort correctly by LastViewed"
        );
    }

    // --- Case 2: Test SortMethod::UpdatedAt ---
    // Should return all 4 accessible items.
    {
        let items = expanded_generic_cursor_soup(
            &pool,
            user_id.copied(),
            10,
            Query::Sort(SimpleSortMethod::UpdatedAt),
        )
        .await?;
        assert_eq!(items.len(), 6, "UpdatedAt should return all 6 items");

        let item_ids = get_item_ids(&items);
        assert_eq!(
            item_ids,
            vec![
                "chat-A",
                "doc-A",
                "doc-B",
                "chat-B",
                "project-B",
                "project-A"
            ],
            "Failed to sort correctly by UpdatedAt"
        );
    }

    // --- Case 3: Test SortMethod::CreatedAt ---
    // Should return all 4 accessible items.
    {
        let items = expanded_generic_cursor_soup(
            &pool,
            user_id,
            10,
            Query::Sort(SimpleSortMethod::CreatedAt),
        )
        .await?;
        assert_eq!(items.len(), 6, "CreatedAt should return all 6 items");

        let item_ids = get_item_ids(&items);
        assert_eq!(
            item_ids,
            vec![
                "chat-B",
                "doc-B",
                "chat-A",
                "doc-A",
                "project-B",
                "project-A"
            ],
            "Failed to sort correctly by CreatedAt"
        );
    }

    Ok(())
}

// Test that expanded_soup_by_ids returns items in the correct order and includes items with implicit access
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("mixed_items_expanded")
    )
)]
async fn test_expanded_soup_by_ids(pool: Pool<Postgres>) {
    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();

    // Request specific items, including some we have implicit access to through projects
    let entities = [
        EntityType::Document.with_entity_str("doc-in-A"),
        EntityType::Chat.with_entity_str("chat-in-B"),
        EntityType::Document.with_entity_str("doc-standalone"),
        EntityType::Chat.with_entity_str("chat-standalone"),
        EntityType::Project.with_entity_str("project-A"), // Should be ignored in expanded soup
    ];

    let items = expanded_soup_by_ids(&pool, user_id, &entities)
        .await
        .unwrap();

    // Should get 4 items (projects are excluded from expanded soup)
    assert_eq!(items.len(), 4, "Should get 4 items (excluding project)");

    // Verify we can access items through project inheritance
    // doc-in-A is in project-A which user-1 has access to
    let doc = items
        .iter()
        .find_map(|x| match x {
            SoupItem::Document(soup_document) => Some(soup_document),
            SoupItem::Chat(_) | SoupItem::Project(_) => None,
        })
        .expect("The document should exist");
    assert_eq!(doc.id, "doc-in-A");
    assert_eq!(doc.name, "Document in A");
    assert_eq!(doc.project_id.as_deref(), Some("project-A"));

    // chat-in-B is in project-B which is a child of project-A
    let chat = items
        .iter()
        .find_map(|x| match x {
            SoupItem::Chat(soup_chat) => Some(soup_chat),
            SoupItem::Document(_) | SoupItem::Project(_) => None,
        })
        .expect("The chat should exist");
    assert_eq!(chat.id, "chat-in-B");
    assert_eq!(chat.name, "Chat in B");
    assert_eq!(chat.project_id.as_deref(), Some("project-B"));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("mixed_items_expanded")
    )
)]
async fn it_should_be_empty(pool: Pool<Postgres>) {
    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();
    // Test with non-existent items
    let non_existent_entities = [
        EntityType::Document.with_entity_str("non-existent-doc"),
        EntityType::Chat.with_entity_str("non-existent-chat"),
    ];

    let empty_result = expanded_soup_by_ids(&pool, user_id.copied(), &non_existent_entities)
        .await
        .unwrap();
    assert_eq!(
        empty_result.len(),
        0,
        "Should return empty for non-existent items"
    );

    // Test with only projects (should return empty)
    let project_only_entities = [
        EntityType::Project.with_entity_str("project-A"),
        EntityType::Project.with_entity_str("project-B"),
    ];

    let project_result = expanded_soup_by_ids(&pool, user_id, &project_only_entities)
        .await
        .unwrap();
    assert_eq!(
        project_result.len(),
        0,
        "Should return empty for project-only request"
    );
}

// Test that no_frecency_expanded_generic_soup excludes items with frecency records
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("no_frecency_items")
    )
)]
async fn test_no_frecency_expanded_filters_out_frecency_items(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();

    // Test with UpdatedAt sort - should return only items without frecency
    let items = no_frecency_expanded_generic_soup(
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
        "project-A",
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
        "doc-with-frecency-3",
        "chat-with-frecency-1",
        "chat-with-frecency-2",
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

// Test sorting methods work correctly for no_frecency query
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("no_frecency_items")
    )
)]
async fn test_no_frecency_expanded_sorting_methods(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();

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
        let items = no_frecency_expanded_generic_soup(
            &pool,
            user_id.copied(),
            20,
            Query::Sort(SimpleSortMethod::UpdatedAt),
        )
        .await?;
        assert_eq!(items.len(), 5, "UpdatedAt should return 5 items");

        let item_ids = get_item_ids(&items);
        // Ordered by updatedAt DESC: doc-no-frecency-1 (2/12), doc-no-frecency-2 (2/11),
        // chat-no-frecency-1 (2/08), chat-no-frecency-2 (2/07), project-A (1/01)
        assert_eq!(
            item_ids,
            vec![
                "doc-no-frecency-1",
                "doc-no-frecency-2",
                "chat-no-frecency-1",
                "chat-no-frecency-2",
                "project-A"
            ],
            "Failed to sort correctly by UpdatedAt"
        );
    }

    // Test CreatedAt sorting
    {
        let items = no_frecency_expanded_generic_soup(
            &pool,
            user_id.copied(),
            20,
            Query::Sort(SimpleSortMethod::CreatedAt),
        )
        .await?;
        assert_eq!(items.len(), 5, "CreatedAt should return 5 items");

        let item_ids = get_item_ids(&items);
        // Ordered by createdAt DESC: chat-no-frecency-2 (1/18), chat-no-frecency-1 (1/17),
        // doc-no-frecency-2 (1/14), doc-no-frecency-1 (1/13), project-A (1/01)
        assert_eq!(
            item_ids,
            vec![
                "chat-no-frecency-2",
                "chat-no-frecency-1",
                "doc-no-frecency-2",
                "doc-no-frecency-1",
                "project-A"
            ],
            "Failed to sort correctly by CreatedAt"
        );
    }

    // Test ViewedAt sorting
    {
        let items = no_frecency_expanded_generic_soup(
            &pool,
            user_id,
            20,
            Query::Sort(SimpleSortMethod::ViewedAt),
        )
        .await?;
        assert_eq!(items.len(), 5, "ViewedAt should return 5 items");

        let item_ids = get_item_ids(&items);
        // Ordered by UserHistory.updatedAt DESC: doc-no-frecency-1 (3/15), doc-no-frecency-2 (3/14),
        // chat-no-frecency-1 (3/13), chat-no-frecency-2 (3/12), project-A (no history - coalesces to epoch)
        assert_eq!(
            item_ids,
            vec![
                "doc-no-frecency-1",
                "doc-no-frecency-2",
                "chat-no-frecency-1",
                "chat-no-frecency-2",
                "project-A"
            ],
            "Failed to sort correctly by ViewedAt"
        );
    }

    Ok(())
}

// Test cursor-based pagination for no_frecency query
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("no_frecency_items")
    )
)]
async fn test_no_frecency_expanded_cursor_pagination(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();

    // Get first page with limit of 2
    let result = no_frecency_expanded_generic_soup(
        &pool,
        user_id.copied(),
        2,
        Query::Sort(SimpleSortMethod::UpdatedAt),
    )
    .await?
    .into_iter()
    .paginate_filter_on(2, SimpleSortMethod::UpdatedAt, EntityFilterAst::default())
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
    let items = no_frecency_expanded_generic_soup(
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
