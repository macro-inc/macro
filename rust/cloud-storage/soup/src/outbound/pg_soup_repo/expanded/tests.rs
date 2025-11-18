use crate::outbound::pg_soup_repo::expanded::{
    by_cursor::{expanded_generic_cursor_soup, no_frecency_expanded_generic_soup},
    by_ids::expanded_soup_by_ids,
    dynamic::{ExpandedDynamicCursorArgs, expanded_dynamic_cursor_soup},
};
use item_filters::ast::EntityFilterAst;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model_entity::EntityType;
use models_pagination::{Frecency, PaginateOn, Query, SimpleSortMethod};
use models_soup::item::SoupItem;
use sqlx::{PgPool, Pool, Postgres};
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
    let items = expanded_generic_cursor_soup(
        &pool,
        user_id.copied(),
        20,
        Query::Sort(SimpleSortMethod::ViewedAt, ()),
    )
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
        Query::Sort(SimpleSortMethod::ViewedAt, ()),
    )
    .await?
    .into_iter()
    .paginate_on(1, SimpleSortMethod::ViewedAt)
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
        user_id.copied(),
        1,
        Query::new(
            result.next_cursor.map(|s| s.decode_json().unwrap()),
            SimpleSortMethod::ViewedAt,
            (),
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
            Query::Sort(SimpleSortMethod::ViewedAt, ()),
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
            Query::Sort(SimpleSortMethod::UpdatedAt, ()),
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
            user_id.copied(),
            10,
            Query::Sort(SimpleSortMethod::CreatedAt, ()),
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
        user_id.copied(),
        20,
        Query::Sort(SimpleSortMethod::UpdatedAt, Frecency),
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
        "44444444-4444-4444-4444-444444444444", // doc-no-frecency-1
        "55555555-5555-5555-5555-555555555555", // doc-no-frecency-2
        "88888888-8888-8888-8888-888888888888", // chat-no-frecency-1
        "99999999-9999-9999-9999-999999999999", // chat-no-frecency-2
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", // project-A
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
        "11111111-1111-1111-1111-111111111111", // doc-with-frecency-1
        "22222222-2222-2222-2222-222222222222", // doc-with-frecency-2
        "33333333-3333-3333-3333-333333333333", // doc-with-frecency-3
        "66666666-6666-6666-6666-666666666666", // chat-with-frecency-1
        "77777777-7777-7777-7777-777777777777", // chat-with-frecency-2
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
            Query::Sort(SimpleSortMethod::UpdatedAt, Frecency),
        )
        .await?;
        assert_eq!(items.len(), 5, "UpdatedAt should return 5 items");

        let item_ids = get_item_ids(&items);
        // Ordered by updatedAt DESC: doc-no-frecency-1 (2/12), doc-no-frecency-2 (2/11),
        // chat-no-frecency-1 (2/08), chat-no-frecency-2 (2/07), project-A (1/01)
        assert_eq!(
            item_ids,
            vec![
                "44444444-4444-4444-4444-444444444444", // doc-no-frecency-1
                "55555555-5555-5555-5555-555555555555", // doc-no-frecency-2
                "88888888-8888-8888-8888-888888888888", // chat-no-frecency-1
                "99999999-9999-9999-9999-999999999999", // chat-no-frecency-2
                "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", // project-A
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
            Query::Sort(SimpleSortMethod::CreatedAt, Frecency),
        )
        .await?;
        assert_eq!(items.len(), 5, "CreatedAt should return 5 items");

        let item_ids = get_item_ids(&items);
        // Ordered by createdAt DESC: chat-no-frecency-2 (1/18), chat-no-frecency-1 (1/17),
        // doc-no-frecency-2 (1/14), doc-no-frecency-1 (1/13), project-A (1/01)
        assert_eq!(
            item_ids,
            vec![
                "99999999-9999-9999-9999-999999999999", // chat-no-frecency-2
                "88888888-8888-8888-8888-888888888888", // chat-no-frecency-1
                "55555555-5555-5555-5555-555555555555", // doc-no-frecency-2
                "44444444-4444-4444-4444-444444444444", // doc-no-frecency-1
                "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", // project-A
            ],
            "Failed to sort correctly by CreatedAt"
        );
    }

    // Test ViewedAt sorting
    {
        let items = no_frecency_expanded_generic_soup(
            &pool,
            user_id.copied(),
            20,
            Query::Sort(SimpleSortMethod::ViewedAt, Frecency),
        )
        .await?;
        assert_eq!(items.len(), 5, "ViewedAt should return 5 items");

        let item_ids = get_item_ids(&items);
        // Ordered by UserHistory.updatedAt DESC: doc-no-frecency-1 (3/15), doc-no-frecency-2 (3/14),
        // chat-no-frecency-1 (3/13), chat-no-frecency-2 (3/12), project-A (no history - coalesces to epoch)
        assert_eq!(
            item_ids,
            vec![
                "44444444-4444-4444-4444-444444444444", // doc-no-frecency-1
                "55555555-5555-5555-5555-555555555555", // doc-no-frecency-2
                "88888888-8888-8888-8888-888888888888", // chat-no-frecency-1
                "99999999-9999-9999-9999-999999999999", // chat-no-frecency-2
                "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", // project-A
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
        Query::Sort(SimpleSortMethod::UpdatedAt, Frecency),
    )
    .await?
    .into_iter()
    .paginate_on(2, SimpleSortMethod::UpdatedAt)
    .filter_on(Frecency)
    .into_page();

    assert_eq!(result.items.len(), 2, "Should get 2 items in first page");

    // First two items should be the most recently updated
    match &result.items[0] {
        SoupItem::Document(doc) => {
            assert_eq!(
                doc.id, "44444444-4444-4444-4444-444444444444",
                "First item should be doc-no-frecency-1"
            );
        }
        _ => panic!("First item should be a document"),
    }

    match &result.items[1] {
        SoupItem::Document(doc) => {
            assert_eq!(
                doc.id, "55555555-5555-5555-5555-555555555555",
                "Second item should be doc-no-frecency-2"
            );
        }
        _ => panic!("Second item should be a document"),
    }

    // Get second page using cursor
    let items = no_frecency_expanded_generic_soup(
        &pool,
        user_id.copied(),
        2,
        Query::new(
            result.next_cursor.map(|s| s.decode_json().unwrap()),
            SimpleSortMethod::UpdatedAt,
            Frecency,
        ),
    )
    .await?;

    assert_eq!(items.len(), 2, "Should get 2 items in second page");

    // Next two items should be the chats
    match &items[0] {
        SoupItem::Chat(chat) => {
            assert_eq!(
                chat.id, "88888888-8888-8888-8888-888888888888",
                "Third item should be chat-no-frecency-1"
            );
        }
        _ => panic!("Third item should be a chat"),
    }

    match &items[1] {
        SoupItem::Chat(chat) => {
            assert_eq!(
                chat.id, "99999999-9999-9999-9999-999999999999",
                "Fourth item should be chat-no-frecency-2"
            );
        }
        _ => panic!("Fourth item should be a chat"),
    }

    Ok(())
}

#[sqlx::test(
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("mixed_items_expanded")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn empty_ast_returns_same_as_static_query(db: PgPool) {
    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();
    let ast_res = expanded_dynamic_cursor_soup(
        &db,
        ExpandedDynamicCursorArgs {
            user_id: user_id.clone(),
            limit: 20,
            cursor: Query::Sort(SimpleSortMethod::CreatedAt, EntityFilterAst::mock_empty()),
            exclude_frecency: false,
        },
    )
    .await
    .unwrap();
    let static_res = expanded_generic_cursor_soup(
        &db,
        user_id.copied(),
        20,
        Query::Sort(SimpleSortMethod::CreatedAt, ()),
    )
    .await
    .unwrap();

    // Compare the IDs since SoupItem doesn't implement PartialEq
    let ast_ids: Vec<String> = ast_res
        .iter()
        .map(|item| match item {
            SoupItem::Chat(c) => c.id.clone(),
            SoupItem::Document(d) => d.id.clone(),
            SoupItem::Project(p) => p.id.clone(),
        })
        .collect();

    let static_ids: Vec<String> = static_res
        .iter()
        .map(|item| match item {
            SoupItem::Chat(c) => c.id.clone(),
            SoupItem::Document(d) => d.id.clone(),
            SoupItem::Project(p) => p.id.clone(),
        })
        .collect();

    assert_eq!(ast_ids, static_ids);
}

// ============================================================================
// EntityFilter Tests with UUID-based fixture
// ============================================================================

// Test filtering by document file type
#[sqlx::test(
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("entity_filter_tests")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn test_filter_by_document_file_type(db: PgPool) -> anyhow::Result<()> {
    use item_filters::{DocumentFilters, EntityFilters};

    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();

    // Filter for only PDF documents
    let entity_filters = EntityFilters {
        document_filters: DocumentFilters {
            file_types: vec!["pdf".to_string()],
            ..Default::default()
        },
        ..Default::default()
    };

    let filters = EntityFilterAst::new_from_filters(entity_filters)?.unwrap();

    let items = expanded_dynamic_cursor_soup(
        &db,
        ExpandedDynamicCursorArgs {
            user_id: user_id.copied(),
            limit: 20,
            cursor: Query::Sort(SimpleSortMethod::CreatedAt, filters),
            exclude_frecency: false,
        },
    )
    .await?;

    // Should get PDF documents (filtered), and all chats and all projects
    let mut pdf_count = 0;
    let mut chat_count = 0;
    let mut project_count = 0;

    for item in &items {
        match item {
            SoupItem::Document(doc) => {
                assert_eq!(
                    doc.file_type.as_deref(),
                    Some("pdf"),
                    "All documents should be PDFs"
                );
                pdf_count += 1;
            }
            SoupItem::Chat(_) => {
                chat_count += 1;
            }
            SoupItem::Project(_) => {
                project_count += 1;
            }
        }
    }

    // Should get 4 accessible PDF documents (doc-in-C is MD, doc-isolated not accessible)
    assert_eq!(pdf_count, 4, "Should get 4 PDF documents");
    // Should get all 4 accessible chats
    assert_eq!(chat_count, 4, "Should get all chats");
    // Should get all 2 accessible projects
    assert_eq!(project_count, 4, "Should get all projects");

    Ok(())
}

// Test filtering by specific document IDs
#[sqlx::test(
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("entity_filter_tests")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn test_filter_by_document_ids(db: PgPool) -> anyhow::Result<()> {
    use item_filters::{DocumentFilters, EntityFilters};

    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();

    // Filter for specific document IDs
    let entity_filters = EntityFilters {
        document_filters: DocumentFilters {
            document_ids: vec![
                "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa".to_string(),
                "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee".to_string(),
            ],
            ..Default::default()
        },
        ..Default::default()
    };

    let filters = EntityFilterAst::new_from_filters(entity_filters)?.unwrap();

    let items = expanded_dynamic_cursor_soup(
        &db,
        ExpandedDynamicCursorArgs {
            user_id: user_id.copied(),
            limit: 20,
            cursor: Query::Sort(SimpleSortMethod::CreatedAt, filters),
            exclude_frecency: false,
        },
    )
    .await?;

    // Should get 2 documents (filtered), all chats, and all projects
    let mut document_ids: HashSet<String> = HashSet::new();
    let mut chat_count = 0;
    let mut project_count = 0;

    for item in &items {
        match item {
            SoupItem::Document(d) => {
                document_ids.insert(d.id.clone());
            }
            SoupItem::Chat(_) => {
                chat_count += 1;
            }
            SoupItem::Project(_) => {
                project_count += 1;
            }
        }
    }

    assert_eq!(document_ids.len(), 2, "Should get exactly 2 documents");
    assert_eq!(chat_count, 4, "Should get all chats");
    assert_eq!(project_count, 4, "Should get all projects");

    let returned_ids = document_ids;

    let expected_ids: HashSet<String> = [
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
    ]
    .iter()
    .map(|&s| s.to_string())
    .collect();

    assert_eq!(
        returned_ids, expected_ids,
        "Should get the correct documents"
    );

    Ok(())
}

// Test filtering by project ID (documents)
#[sqlx::test(
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("entity_filter_tests")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn test_filter_documents_by_project_id(db: PgPool) -> anyhow::Result<()> {
    use item_filters::{DocumentFilters, EntityFilters};

    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();

    // Filter documents in project-A only
    let entity_filters = EntityFilters {
        document_filters: DocumentFilters {
            project_ids: vec!["11111111-1111-1111-1111-111111111111".to_string()],
            ..Default::default()
        },
        ..Default::default()
    };

    let filters = EntityFilterAst::new_from_filters(entity_filters)?.unwrap();

    let items = expanded_dynamic_cursor_soup(
        &db,
        ExpandedDynamicCursorArgs {
            user_id: user_id.copied(),
            limit: 20,
            cursor: Query::Sort(SimpleSortMethod::CreatedAt, filters),
            exclude_frecency: false,
        },
    )
    .await?;

    // Should get 1 document in project-A, all chats, and all projects
    let mut doc_count = 0;
    let mut chat_count = 0;
    let mut project_count = 0;
    let mut found_doc_id = None;

    for item in &items {
        match item {
            SoupItem::Document(doc) => {
                assert_eq!(
                    doc.project_id.as_deref(),
                    Some("11111111-1111-1111-1111-111111111111")
                );
                found_doc_id = Some(doc.id.clone());
                doc_count += 1;
            }
            SoupItem::Chat(_) => {
                chat_count += 1;
            }
            SoupItem::Project(_) => {
                project_count += 1;
            }
        }
    }

    assert_eq!(doc_count, 1, "Should get 1 document in project-A");
    assert_eq!(
        found_doc_id.as_deref(),
        Some("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
    );
    assert_eq!(chat_count, 4, "Should get all chats");
    assert_eq!(project_count, 4, "Should get all projects");

    Ok(())
}

// Test filtering chats by project ID
#[sqlx::test(
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("entity_filter_tests")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn test_filter_chats_by_project_id(db: PgPool) -> anyhow::Result<()> {
    use item_filters::{ChatFilters, EntityFilters};

    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();

    // Filter chats in project-B
    let entity_filters = EntityFilters {
        chat_filters: ChatFilters {
            project_ids: vec!["22222222-2222-2222-2222-222222222222".to_string()],
            ..Default::default()
        },
        ..Default::default()
    };

    let filters = EntityFilterAst::new_from_filters(entity_filters)?.unwrap();

    let items = expanded_dynamic_cursor_soup(
        &db,
        ExpandedDynamicCursorArgs {
            user_id: user_id.copied(),
            limit: 20,
            cursor: Query::Sort(SimpleSortMethod::CreatedAt, filters),
            exclude_frecency: false,
        },
    )
    .await?;

    // Should get 1 chat in project-B, all documents, and all projects
    let mut doc_count = 0;
    let mut chat_count = 0;
    let mut project_count = 0;
    let mut found_chat_id = None;

    for item in &items {
        match item {
            SoupItem::Document(_) => {
                doc_count += 1;
            }
            SoupItem::Chat(chat) => {
                assert_eq!(
                    chat.project_id.as_deref(),
                    Some("22222222-2222-2222-2222-222222222222")
                );
                found_chat_id = Some(chat.id.clone());
                chat_count += 1;
            }
            SoupItem::Project(_) => {
                project_count += 1;
            }
        }
    }

    assert_eq!(chat_count, 1, "Should get 1 chat in project-B");
    assert_eq!(
        found_chat_id.as_deref(),
        Some("b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2")
    );
    assert_eq!(doc_count, 5, "Should get all documents");
    assert_eq!(project_count, 4, "Should get all projects");

    Ok(())
}

// Test filtering by specific chat IDs
#[sqlx::test(
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("entity_filter_tests")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn test_filter_by_chat_ids(db: PgPool) -> anyhow::Result<()> {
    use item_filters::{ChatFilters, EntityFilters};

    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();

    // Filter for specific chat IDs
    let entity_filters = EntityFilters {
        chat_filters: ChatFilters {
            chat_ids: vec![
                "a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1".to_string(),
                "d4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4".to_string(),
            ],
            ..Default::default()
        },
        ..Default::default()
    };

    let filters = EntityFilterAst::new_from_filters(entity_filters)?.unwrap();

    let items = expanded_dynamic_cursor_soup(
        &db,
        ExpandedDynamicCursorArgs {
            user_id: user_id.copied(),
            limit: 20,
            cursor: Query::Sort(SimpleSortMethod::CreatedAt, filters),
            exclude_frecency: false,
        },
    )
    .await?;

    // Should get 2 chats (filtered), all documents, and all projects
    let mut chat_ids: HashSet<String> = HashSet::new();
    let mut doc_count = 0;
    let mut project_count = 0;

    for item in &items {
        match item {
            SoupItem::Chat(c) => {
                chat_ids.insert(c.id.clone());
            }
            SoupItem::Document(_) => {
                doc_count += 1;
            }
            SoupItem::Project(_) => {
                project_count += 1;
            }
        }
    }

    assert_eq!(chat_ids.len(), 2, "Should get exactly 2 chats");
    assert_eq!(doc_count, 5, "Should get all documents");
    assert_eq!(project_count, 4, "Should get all projects");

    let returned_ids = chat_ids;

    let expected_ids: HashSet<String> = [
        "a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1",
        "d4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4",
    ]
    .iter()
    .map(|&s| s.to_string())
    .collect();

    assert_eq!(returned_ids, expected_ids, "Should get the correct chats");

    Ok(())
}

// Test filtering projects by specific project IDs
#[sqlx::test(
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("entity_filter_tests")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn test_filter_by_project_ids(db: PgPool) -> anyhow::Result<()> {
    use item_filters::{EntityFilters, ProjectFilters};

    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();

    // Filter for specific project IDs
    let entity_filters = EntityFilters {
        project_filters: ProjectFilters {
            project_ids: vec![
                "11111111-1111-1111-1111-111111111111".to_string(),
                "44444444-4444-4444-4444-444444444444".to_string(),
            ],
            ..Default::default()
        },
        ..Default::default()
    };

    let filters = EntityFilterAst::new_from_filters(entity_filters)?.unwrap();

    let items = expanded_dynamic_cursor_soup(
        &db,
        ExpandedDynamicCursorArgs {
            user_id: user_id.copied(),
            limit: 20,
            cursor: Query::Sort(SimpleSortMethod::CreatedAt, filters),
            exclude_frecency: false,
        },
    )
    .await?;

    // Should get 2 projects (filtered), all documents, and all chats
    let mut project_ids: HashSet<String> = HashSet::new();
    let mut doc_count = 0;
    let mut chat_count = 0;

    for item in &items {
        match item {
            SoupItem::Project(p) => {
                project_ids.insert(p.id.clone());
            }
            SoupItem::Document(_) => {
                doc_count += 1;
            }
            SoupItem::Chat(_) => {
                chat_count += 1;
            }
        }
    }

    assert_eq!(project_ids.len(), 2, "Should get exactly 2 projects");
    assert_eq!(doc_count, 5, "Should get all documents");
    assert_eq!(chat_count, 4, "Should get all chats");

    let returned_ids = project_ids;

    let expected_ids: HashSet<String> = [
        "11111111-1111-1111-1111-111111111111",
        "44444444-4444-4444-4444-444444444444",
    ]
    .iter()
    .map(|&s| s.to_string())
    .collect();

    assert_eq!(
        returned_ids, expected_ids,
        "Should get the correct projects"
    );

    Ok(())
}

// Test combined filters across multiple entity types
#[sqlx::test(
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("entity_filter_tests")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn test_combined_entity_filters(db: PgPool) -> anyhow::Result<()> {
    use item_filters::{ChatFilters, DocumentFilters, EntityFilters, ProjectFilters};

    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();

    // Filter for:
    // - Documents in project-A OR project-B
    // - Chat with ID chat-standalone
    // - Project with ID project-D
    let entity_filters = EntityFilters {
        document_filters: DocumentFilters {
            project_ids: vec![
                "11111111-1111-1111-1111-111111111111".to_string(),
                "22222222-2222-2222-2222-222222222222".to_string(),
            ],
            ..Default::default()
        },
        chat_filters: ChatFilters {
            chat_ids: vec!["d4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4".to_string()],
            ..Default::default()
        },
        project_filters: ProjectFilters {
            project_ids: vec!["44444444-4444-4444-4444-444444444444".to_string()],
            ..Default::default()
        },
        ..Default::default()
    };

    let filters = EntityFilterAst::new_from_filters(entity_filters)?.unwrap();

    let items = expanded_dynamic_cursor_soup(
        &db,
        ExpandedDynamicCursorArgs {
            user_id: user_id.copied(),
            limit: 20,
            cursor: Query::Sort(SimpleSortMethod::CreatedAt, filters),
            exclude_frecency: false,
        },
    )
    .await?;

    // Should get: doc-in-A, doc-in-B, chat-standalone, project-D = 4 items
    assert_eq!(items.len(), 4, "Should get 4 items total");

    let mut doc_count = 0;
    let mut chat_count = 0;
    let mut project_count = 0;

    for item in &items {
        match item {
            SoupItem::Document(doc) => {
                doc_count += 1;
                assert!(
                    doc.id == "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
                        || doc.id == "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                    "Document should be in project-A or project-B"
                );
            }
            SoupItem::Chat(chat) => {
                chat_count += 1;
                assert_eq!(
                    chat.id, "d4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4",
                    "Should only get standalone chat"
                );
            }
            SoupItem::Project(project) => {
                project_count += 1;
                assert_eq!(
                    project.id, "44444444-4444-4444-4444-444444444444",
                    "Should only get project-D"
                );
            }
        }
    }

    assert_eq!(doc_count, 2, "Should get 2 documents");
    assert_eq!(chat_count, 1, "Should get 1 chat");
    assert_eq!(project_count, 1, "Should get 1 project");

    Ok(())
}

// Test filtering by multiple criteria on documents (AND logic)
#[sqlx::test(
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("entity_filter_tests")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn test_multiple_filter_criteria_documents(db: PgPool) -> anyhow::Result<()> {
    use item_filters::{DocumentFilters, EntityFilters};

    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();

    // Filter for documents: specific IDs AND in specific projects AND specific file type
    // This uses AND logic across different filter criteria
    let entity_filters = EntityFilters {
        document_filters: DocumentFilters {
            document_ids: vec![
                "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa".to_string(),
                "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb".to_string(),
            ],
            project_ids: vec![
                "11111111-1111-1111-1111-111111111111".to_string(),
                "22222222-2222-2222-2222-222222222222".to_string(),
            ],
            file_types: vec!["pdf".to_string()],
            ..Default::default()
        },
        ..Default::default()
    };

    let filters = EntityFilterAst::new_from_filters(entity_filters)?.unwrap();

    let items = expanded_dynamic_cursor_soup(
        &db,
        ExpandedDynamicCursorArgs {
            user_id: user_id.copied(),
            limit: 20,
            cursor: Query::Sort(SimpleSortMethod::CreatedAt, filters),
            exclude_frecency: false,
        },
    )
    .await?;

    // Should get 2 documents matching all criteria, all chats, and all projects
    let mut document_ids: HashSet<String> = HashSet::new();
    let mut chat_count = 0;
    let mut project_count = 0;

    for item in &items {
        match item {
            SoupItem::Document(d) => {
                document_ids.insert(d.id.clone());
            }
            SoupItem::Chat(_) => {
                chat_count += 1;
            }
            SoupItem::Project(_) => {
                project_count += 1;
            }
        }
    }

    assert_eq!(
        document_ids.len(),
        2,
        "Should get 2 documents matching all criteria"
    );
    assert_eq!(chat_count, 4, "Should get all chats");
    assert_eq!(project_count, 4, "Should get all projects");

    let returned_ids = document_ids;

    let expected_ids: HashSet<String> = [
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    ]
    .iter()
    .map(|&s| s.to_string())
    .collect();

    assert_eq!(returned_ids, expected_ids);

    Ok(())
}

// Test that inaccessible items are filtered out
#[sqlx::test(
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("entity_filter_tests")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn test_filters_respect_access_control(db: PgPool) -> anyhow::Result<()> {
    use item_filters::{DocumentFilters, EntityFilters};

    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();

    // Try to request doc-isolated (which user doesn't have access to)
    let entity_filters = EntityFilters {
        document_filters: DocumentFilters {
            document_ids: vec!["ffffffff-ffff-ffff-ffff-ffffffffffff".to_string()],
            ..Default::default()
        },
        ..Default::default()
    };

    let filters = EntityFilterAst::new_from_filters(entity_filters)?.unwrap();

    let items = expanded_dynamic_cursor_soup(
        &db,
        ExpandedDynamicCursorArgs {
            user_id: user_id.copied(),
            limit: 20,
            cursor: Query::Sort(SimpleSortMethod::CreatedAt, filters),
            exclude_frecency: false,
        },
    )
    .await?;

    // Should get 0 documents (inaccessible), but all chats and all projects
    let mut doc_count = 0;
    let mut chat_count = 0;
    let mut project_count = 0;

    for item in &items {
        match item {
            SoupItem::Document(_) => {
                doc_count += 1;
            }
            SoupItem::Chat(_) => {
                chat_count += 1;
            }
            SoupItem::Project(_) => {
                project_count += 1;
            }
        }
    }

    assert_eq!(
        doc_count, 0,
        "Should not return inaccessible documents even when filtered"
    );
    assert_eq!(chat_count, 4, "Should get all chats");
    assert_eq!(project_count, 4, "Should get all projects");

    Ok(())
}

// Test filtering by owner
#[sqlx::test(
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("entity_filter_tests")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn test_filter_by_owner(db: PgPool) -> anyhow::Result<()> {
    use item_filters::{DocumentFilters, EntityFilters};

    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();

    // Filter documents by owner
    let entity_filters = EntityFilters {
        document_filters: DocumentFilters {
            owners: vec!["macro|user-1@test.com".to_string()],
            ..Default::default()
        },
        ..Default::default()
    };

    let filters = EntityFilterAst::new_from_filters(entity_filters)?.unwrap();

    let items = expanded_dynamic_cursor_soup(
        &db,
        ExpandedDynamicCursorArgs {
            user_id: user_id.copied(),
            limit: 20,
            cursor: Query::Sort(SimpleSortMethod::CreatedAt, filters),
            exclude_frecency: false,
        },
    )
    .await?;

    // Should get 5 documents owned by user-1, all chats, and all projects
    let mut doc_count = 0;
    let mut chat_count = 0;
    let mut project_count = 0;

    for item in &items {
        match item {
            SoupItem::Document(doc) => {
                assert_eq!(
                    doc.owner_id, "macro|user-1@test.com",
                    "All documents should be owned by user-1"
                );
                doc_count += 1;
            }
            SoupItem::Chat(_) => {
                chat_count += 1;
            }
            SoupItem::Project(_) => {
                project_count += 1;
            }
        }
    }

    assert_eq!(doc_count, 5, "Should get 5 documents owned by user-1");
    assert_eq!(chat_count, 4, "Should get all chats");
    assert_eq!(project_count, 4, "Should get all projects");

    Ok(())
}

// Test filtering for non-existent items returns empty
#[sqlx::test(
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("entity_filter_tests")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn test_filter_non_existent_items(db: PgPool) -> anyhow::Result<()> {
    use item_filters::{ChatFilters, EntityFilters};

    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();

    // Filter for non-existent chat IDs
    let entity_filters = EntityFilters {
        chat_filters: ChatFilters {
            chat_ids: vec!["00000000-0000-0000-0000-000000000000".to_string()],
            ..Default::default()
        },
        ..Default::default()
    };

    let filters = EntityFilterAst::new_from_filters(entity_filters)?.unwrap();

    let items = expanded_dynamic_cursor_soup(
        &db,
        ExpandedDynamicCursorArgs {
            user_id: user_id.copied(),
            limit: 20,
            cursor: Query::Sort(SimpleSortMethod::CreatedAt, filters),
            exclude_frecency: false,
        },
    )
    .await?;

    // Should get 0 chats (non-existent), but all documents and all projects
    let mut doc_count = 0;
    let mut chat_count = 0;
    let mut project_count = 0;

    for item in &items {
        match item {
            SoupItem::Document(_) => {
                doc_count += 1;
            }
            SoupItem::Chat(_) => {
                chat_count += 1;
            }
            SoupItem::Project(_) => {
                project_count += 1;
            }
        }
    }

    assert_eq!(chat_count, 0, "Should return 0 chats for non-existent IDs");
    assert_eq!(doc_count, 5, "Should get all documents");
    assert_eq!(project_count, 4, "Should get all projects");

    Ok(())
}

// Test cursor-based pagination with document filters
#[sqlx::test(
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("entity_filter_tests")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn test_cursor_pagination_with_document_filter(db: PgPool) -> anyhow::Result<()> {
    use item_filters::{DocumentFilters, EntityFilters};

    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();

    // Filter for only PDF documents
    let entity_filters = EntityFilters {
        document_filters: DocumentFilters {
            file_types: vec!["pdf".to_string()],
            ..Default::default()
        },
        ..Default::default()
    };

    let filters = EntityFilterAst::new_from_filters(entity_filters.clone())?.unwrap();

    // First page - get 3 items
    let result = expanded_dynamic_cursor_soup(
        &db,
        ExpandedDynamicCursorArgs {
            user_id: user_id.copied(),
            limit: 3,
            cursor: Query::Sort(SimpleSortMethod::CreatedAt, filters.clone()),
            exclude_frecency: false,
        },
    )
    .await?
    .into_iter()
    .paginate_on(3, SimpleSortMethod::CreatedAt)
    .into_page();

    let first_page_items = result.items;
    assert_eq!(first_page_items.len(), 3, "First page should have 3 items");

    // Verify any documents on first page are PDFs
    for item in &first_page_items {
        if let SoupItem::Document(doc) = item {
            assert_eq!(
                doc.file_type.as_deref(),
                Some("pdf"),
                "All documents should be PDFs"
            );
        }
    }

    // Get second page using cursor
    let next_cursor = result.next_cursor.expect("Should have a next cursor");
    let cursor_decoded = next_cursor.decode_json()?;

    let filters_for_cursor = EntityFilterAst::new_from_filters(entity_filters)?.unwrap();

    let second_page_items = expanded_dynamic_cursor_soup(
        &db,
        ExpandedDynamicCursorArgs {
            user_id: user_id.copied(),
            limit: 3,
            cursor: Query::Cursor(models_pagination::Cursor {
                id: cursor_decoded.id,
                limit: cursor_decoded.limit,
                val: cursor_decoded.val,
                filter: filters_for_cursor,
            }),
            exclude_frecency: false,
        },
    )
    .await?;

    assert!(second_page_items.len() > 0, "Second page should have items");

    // Verify filter still applies on second page
    for item in &second_page_items {
        match item {
            SoupItem::Document(doc) => {
                assert_eq!(
                    doc.file_type.as_deref(),
                    Some("pdf"),
                    "All documents should be PDFs on second page"
                );
            }
            SoupItem::Chat(_) => {
                // Chats are fine
            }
            SoupItem::Project(_) => {
                // Projects are fine
            }
        }
    }

    // Verify no duplicate items between pages
    let first_page_ids: HashSet<String> = first_page_items
        .iter()
        .map(|item| match item {
            SoupItem::Document(d) => d.id.clone(),
            SoupItem::Chat(c) => c.id.clone(),
            SoupItem::Project(p) => p.id.clone(),
        })
        .collect();

    for item in &second_page_items {
        let id = match item {
            SoupItem::Document(d) => &d.id,
            SoupItem::Chat(c) => &c.id,
            SoupItem::Project(p) => &p.id,
        };
        assert!(
            !first_page_ids.contains(id),
            "No item should appear on both pages"
        );
    }

    Ok(())
}

// Test cursor-based pagination with multiple entity filters
#[sqlx::test(
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("entity_filter_tests")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn test_cursor_pagination_with_combined_filters(db: PgPool) -> anyhow::Result<()> {
    use item_filters::{ChatFilters, DocumentFilters, EntityFilters};

    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();

    // Filter for documents in specific projects AND specific chats
    let entity_filters = EntityFilters {
        document_filters: DocumentFilters {
            project_ids: vec![
                "11111111-1111-1111-1111-111111111111".to_string(),
                "22222222-2222-2222-2222-222222222222".to_string(),
            ],
            ..Default::default()
        },
        chat_filters: ChatFilters {
            chat_ids: vec!["a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1".to_string()],
            ..Default::default()
        },
        ..Default::default()
    };

    let filters = EntityFilterAst::new_from_filters(entity_filters.clone())?.unwrap();

    // First page - get 2 items
    let result = expanded_dynamic_cursor_soup(
        &db,
        ExpandedDynamicCursorArgs {
            user_id: user_id.copied(),
            limit: 2,
            cursor: Query::Sort(SimpleSortMethod::CreatedAt, filters.clone()),
            exclude_frecency: false,
        },
    )
    .await?
    .into_iter()
    .paginate_on(2, SimpleSortMethod::CreatedAt)
    .into_page();

    assert_eq!(result.items.len(), 2, "First page should have 2 items");

    // Get second page
    if let Some(next_cursor) = result.next_cursor {
        let cursor_decoded = next_cursor.decode_json()?;
        let filters_for_cursor = EntityFilterAst::new_from_filters(entity_filters)?.unwrap();

        let second_page_items = expanded_dynamic_cursor_soup(
            &db,
            ExpandedDynamicCursorArgs {
                user_id: user_id.copied(),
                limit: 2,
                cursor: Query::Cursor(models_pagination::Cursor {
                    id: cursor_decoded.id,
                    limit: cursor_decoded.limit,
                    val: cursor_decoded.val,
                    filter: filters_for_cursor,
                }),
                exclude_frecency: false,
            },
        )
        .await?;

        // Verify filters still apply on second page
        for item in &second_page_items {
            match item {
                SoupItem::Document(doc) => {
                    let project_id = doc.project_id.as_deref().unwrap();
                    assert!(
                        project_id == "11111111-1111-1111-1111-111111111111"
                            || project_id == "22222222-2222-2222-2222-222222222222",
                        "Documents should be in filtered projects"
                    );
                }
                SoupItem::Chat(chat) => {
                    assert_eq!(
                        chat.id, "a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1",
                        "Only the filtered chat should appear"
                    );
                }
                SoupItem::Project(_) => {
                    // All projects should be included
                }
            }
        }
    }

    Ok(())
}

// Test cursor pagination maintains filter consistency across pages
#[sqlx::test(
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("entity_filter_tests")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn test_cursor_pagination_filter_consistency(db: PgPool) -> anyhow::Result<()> {
    use item_filters::{DocumentFilters, EntityFilters};

    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();

    // Filter for documents by specific IDs
    let entity_filters = EntityFilters {
        document_filters: DocumentFilters {
            document_ids: vec![
                "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa".to_string(),
                "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb".to_string(),
            ],
            ..Default::default()
        },
        ..Default::default()
    };

    let filters = EntityFilterAst::new_from_filters(entity_filters.clone())?.unwrap();

    // Collect all items across multiple pages with small page size
    let mut all_items = Vec::new();
    let mut current_query = Query::Sort(SimpleSortMethod::CreatedAt, filters.clone());
    let page_size: u16 = 2;

    loop {
        let result = expanded_dynamic_cursor_soup(
            &db,
            ExpandedDynamicCursorArgs {
                user_id: user_id.copied(),
                limit: page_size,
                cursor: current_query,
                exclude_frecency: false,
            },
        )
        .await?
        .into_iter()
        .paginate_on(page_size as usize, SimpleSortMethod::CreatedAt)
        .into_page();

        all_items.extend(result.items);

        match result.next_cursor {
            Some(cursor) => {
                let cursor_decoded = cursor.decode_json()?;
                let filters_for_cursor =
                    EntityFilterAst::new_from_filters(entity_filters.clone())?.unwrap();
                current_query = Query::Cursor(models_pagination::Cursor {
                    id: cursor_decoded.id,
                    limit: cursor_decoded.limit,
                    val: cursor_decoded.val,
                    filter: filters_for_cursor,
                });
            }
            None => break,
        }
    }

    // Count filtered documents across all pages
    let mut filtered_doc_count = 0;
    let expected_doc_ids: HashSet<String> = [
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    ]
    .iter()
    .map(|&s| s.to_string())
    .collect();

    for item in &all_items {
        if let SoupItem::Document(doc) = item {
            assert!(
                expected_doc_ids.contains(&doc.id),
                "Document {} should be in the filtered set",
                doc.id
            );
            filtered_doc_count += 1;
        }
    }

    // Should get exactly the 2 filtered documents
    assert_eq!(
        filtered_doc_count, 2,
        "Should get exactly 2 filtered documents across all pages"
    );

    // Verify no duplicate items
    let all_ids: Vec<String> = all_items
        .iter()
        .map(|item| match item {
            SoupItem::Document(d) => d.id.clone(),
            SoupItem::Chat(c) => c.id.clone(),
            SoupItem::Project(p) => p.id.clone(),
        })
        .collect();

    let unique_ids: HashSet<_> = all_ids.iter().collect();
    assert_eq!(
        all_ids.len(),
        unique_ids.len(),
        "Should have no duplicate items across pages"
    );

    Ok(())
}

// Test cursor pagination with empty filter results on subsequent pages
#[sqlx::test(
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("entity_filter_tests")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn test_cursor_pagination_with_single_item_filter(db: PgPool) -> anyhow::Result<()> {
    use item_filters::{ChatFilters, EntityFilters};

    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();

    // Filter for a single chat ID
    let entity_filters = EntityFilters {
        chat_filters: ChatFilters {
            chat_ids: vec!["a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1".to_string()],
            ..Default::default()
        },
        ..Default::default()
    };

    let filters = EntityFilterAst::new_from_filters(entity_filters.clone())?.unwrap();

    // Get first page with limit 5
    let result = expanded_dynamic_cursor_soup(
        &db,
        ExpandedDynamicCursorArgs {
            user_id: user_id.copied(),
            limit: 5,
            cursor: Query::Sort(SimpleSortMethod::CreatedAt, filters.clone()),
            exclude_frecency: false,
        },
    )
    .await?
    .into_iter()
    .paginate_on(5, SimpleSortMethod::CreatedAt)
    .into_page();

    // Count the filtered chat in first page
    let chat_count_page1 = result
        .items
        .iter()
        .filter(|item| matches!(item, SoupItem::Chat(c) if c.id == "a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1"))
        .count();

    // We should see the filtered chat (it might be on page 1 or later depending on sort order)
    if let Some(next_cursor) = result.next_cursor {
        let cursor_decoded = next_cursor.decode_json()?;
        let filters_for_cursor = EntityFilterAst::new_from_filters(entity_filters)?.unwrap();

        let second_page_items = expanded_dynamic_cursor_soup(
            &db,
            ExpandedDynamicCursorArgs {
                user_id: user_id.copied(),
                limit: 5,
                cursor: Query::Cursor(models_pagination::Cursor {
                    id: cursor_decoded.id,
                    limit: cursor_decoded.limit,
                    val: cursor_decoded.val,
                    filter: filters_for_cursor,
                }),
                exclude_frecency: false,
            },
        )
        .await?;

        // Count the filtered chat in second page
        let chat_count_page2 = second_page_items
            .iter()
            .filter(|item| matches!(item, SoupItem::Chat(c) if c.id == "a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1"))
            .count();

        // Across both pages, we should see exactly 1 instance of the filtered chat
        assert_eq!(
            chat_count_page1 + chat_count_page2,
            1,
            "Should see the filtered chat exactly once across pages"
        );
    } else {
        // If no second page, the chat should be on the first page
        assert_eq!(
            chat_count_page1, 1,
            "Should see the filtered chat on first page"
        );
    }

    Ok(())
}

// Test that exclude_frecency=true works together with AST filters
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("no_frecency_items")
    )
)]
async fn test_dynamic_query_with_ast_and_frecency_exclusion(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    use item_filters::{ChatFilters, DocumentFilters, EntityFilters, ProjectFilters};

    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();

    // Create an AST filter that only returns specific document IDs
    // We'll filter for two docs without frecency and one with frecency
    // We'll also filter out all chats and projects to isolate the document filtering
    let entity_filters = EntityFilters {
        document_filters: DocumentFilters {
            document_ids: vec![
                "44444444-4444-4444-4444-444444444444".to_string(), // doc-no-frecency-1
                "55555555-5555-5555-5555-555555555555".to_string(), // doc-no-frecency-2
                "11111111-1111-1111-1111-111111111111".to_string(), // doc-with-frecency-1
            ],
            ..Default::default()
        },
        // Filter out all chats by using a non-existent ID
        chat_filters: ChatFilters {
            chat_ids: vec!["00000000-0000-0000-0000-000000000000".to_string()],
            ..Default::default()
        },
        // Filter out all projects by using a non-existent ID
        project_filters: ProjectFilters {
            project_ids: vec!["00000000-0000-0000-0000-000000000000".to_string()],
            ..Default::default()
        },
        ..Default::default()
    };

    let filters = EntityFilterAst::new_from_filters(entity_filters)?.unwrap();

    // Call with exclude_frecency=true
    let items = expanded_dynamic_cursor_soup(
        &pool,
        ExpandedDynamicCursorArgs {
            user_id: user_id.copied(),
            limit: 20,
            cursor: Query::Sort(SimpleSortMethod::UpdatedAt, filters.clone()),
            exclude_frecency: true,
        },
    )
    .await?;

    // The no_frecency_items fixture has:
    // - 44444444-4444-4444-4444-444444444444 (no frecency) - should be included
    // - 55555555-5555-5555-5555-555555555555 (no frecency) - should be included
    // - 11111111-1111-1111-1111-111111111111 (has frecency) - excluded by frecency filter
    // So we should only get 2 documents
    assert_eq!(
        items.len(),
        2,
        "Should return only documents without frecency that match the AST filter"
    );

    // Verify all returned items are documents
    for item in &items {
        assert!(
            matches!(item, SoupItem::Document(_)),
            "All returned items should be documents"
        );
    }

    // Verify the returned document IDs
    let returned_ids: HashSet<String> = items
        .iter()
        .map(|item| match item {
            SoupItem::Document(d) => d.id.clone(),
            _ => unreachable!(),
        })
        .collect();

    let expected_ids: HashSet<String> = [
        "44444444-4444-4444-4444-444444444444",
        "55555555-5555-5555-5555-555555555555",
    ]
    .iter()
    .map(|&s| s.to_string())
    .collect();

    assert_eq!(
        returned_ids, expected_ids,
        "Should only get documents without frecency records that match AST filter"
    );

    // Now test with exclude_frecency=false to verify both filters work independently
    let items_with_frecency = expanded_dynamic_cursor_soup(
        &pool,
        ExpandedDynamicCursorArgs {
            user_id: user_id.copied(),
            limit: 20,
            cursor: Query::Sort(SimpleSortMethod::UpdatedAt, filters),
            exclude_frecency: false,
        },
    )
    .await?;

    // Should get 3 documents (2 without frecency + 1 with frecency, all matching the AST filter)
    assert_eq!(
        items_with_frecency.len(),
        3,
        "Should return all documents matching AST filter when frecency is not excluded"
    );

    let returned_with_frecency_ids: HashSet<String> = items_with_frecency
        .iter()
        .map(|item| match item {
            SoupItem::Document(d) => d.id.clone(),
            _ => unreachable!(),
        })
        .collect();

    let expected_with_frecency_ids: HashSet<String> = [
        "44444444-4444-4444-4444-444444444444",
        "55555555-5555-5555-5555-555555555555",
        "11111111-1111-1111-1111-111111111111",
    ]
    .iter()
    .map(|&s| s.to_string())
    .collect();

    assert_eq!(
        returned_with_frecency_ids, expected_with_frecency_ids,
        "Should get all documents matching AST filter regardless of frecency"
    );

    Ok(())
}
