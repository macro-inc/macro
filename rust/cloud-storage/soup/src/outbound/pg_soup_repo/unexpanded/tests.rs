use crate::outbound::pg_soup_repo::unexpanded::{
    by_cursor::{no_frecency_unexpanded_generic_cursor_soup, unexpanded_generic_cursor_soup},
    by_ids::unexpanded_soup_by_ids,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model_entity::EntityType;
use models_pagination::Identify;
use models_pagination::{PaginateOn, Query, SimpleSortMethod};
use models_soup::item::SoupItem;
use sqlx::{Pool, Postgres};
use std::collections::HashSet;
use uuid::Uuid;

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

    let get_item_ids =
        |items: &[SoupItem]| -> Vec<Uuid> { items.iter().map(|item| item.id()).collect() };

    {
        let result = unexpanded_generic_cursor_soup(
            &pool,
            user_id.copied(),
            10,
            Query::Sort(SimpleSortMethod::ViewedAt, ()),
        )
        .await?;
        assert_eq!(result.len(), 3, "LastViewed should return 3 items");

        let item_ids = get_item_ids(&result);
        let expected_ids = vec![
            Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa").unwrap(),
            Uuid::parse_str("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb").unwrap(),
            Uuid::parse_str("cccccccc-cccc-cccc-cccc-cccccccccccc").unwrap(),
        ];
        assert_eq!(
            item_ids, expected_ids,
            "Failed to sort correctly by LastViewed"
        );
    }

    {
        let result = unexpanded_generic_cursor_soup(
            &pool,
            user_id.copied(),
            10,
            Query::Sort(SimpleSortMethod::UpdatedAt, ()),
        )
        .await?;
        assert_eq!(result.len(), 3, "UpdatedAt should return 3 items");

        let item_ids = get_item_ids(&result);
        let expected_ids = vec![
            Uuid::parse_str("cccccccc-cccc-cccc-cccc-cccccccccccc").unwrap(),
            Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa").unwrap(),
            Uuid::parse_str("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb").unwrap(),
        ];
        assert_eq!(
            item_ids, expected_ids,
            "Failed to sort correctly by UpdatedAt"
        );
    }

    {
        let result = unexpanded_generic_cursor_soup(
            &pool,
            user_id,
            10,
            Query::Sort(SimpleSortMethod::CreatedAt, ()),
        )
        .await?;
        assert_eq!(result.len(), 3, "CreatedAt should return 3 items");

        let item_ids = get_item_ids(&result);
        let expected_ids = vec![
            Uuid::parse_str("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb").unwrap(),
            Uuid::parse_str("cccccccc-cccc-cccc-cccc-cccccccccccc").unwrap(),
            Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa").unwrap(),
        ];
        assert_eq!(
            item_ids, expected_ids,
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
    let get_item_ids =
        |items: &[SoupItem]| -> Vec<Uuid> { items.iter().map(|item| item.id()).collect() };

    // --- Case 1: Test SortMethod::LastViewed ---
    {
        let result = unexpanded_generic_cursor_soup(
            &pool,
            user_id.copied(),
            10,
            Query::Sort(SimpleSortMethod::ViewedAt, ()),
        )
        .await?;
        assert_eq!(result.len(), 3, "LastViewed should return 3 items");

        let item_ids = get_item_ids(&result);
        let expected_ids = vec![
            Uuid::parse_str("dddddddd-dddd-dddd-dddd-dddddddddddd").unwrap(),
            Uuid::parse_str("ffffffff-ffff-ffff-ffff-ffffffffffff").unwrap(),
            Uuid::parse_str("cccccccc-1111-1111-1111-111111111111").unwrap(),
        ];
        assert_eq!(
            item_ids, expected_ids,
            "Failed to sort correctly by LastViewed"
        );

        // Perform detailed property checks once, since the set of items is the same.
        let items_map: std::collections::HashMap<Uuid, &SoupItem> = result
            .iter()
            .map(|item| {
                let id = item.id();
                (id, item)
            })
            .collect();

        let test_doc_uuid = Uuid::parse_str("dddddddd-dddd-dddd-dddd-dddddddddddd").unwrap(); // test-document
        let test_chat_uuid = Uuid::parse_str("cccccccc-1111-1111-1111-111111111111").unwrap(); // test-chat
        let test_project_uuid = Uuid::parse_str("ffffffff-ffff-ffff-ffff-ffffffffffff").unwrap(); // test-project

        if let Some(SoupItem::Document(doc)) = items_map.get(&test_doc_uuid) {
            assert_eq!(doc.name, "Document Charlie");
            assert_eq!(doc.file_type.as_deref(), Some("pdf"));
        } else {
            panic!("Missing test-document");
        }
        if let Some(SoupItem::Chat(chat)) = items_map.get(&test_chat_uuid) {
            assert_eq!(chat.name, "Chat Bravo");
        } else {
            panic!("Missing test-chat");
        }
        if let Some(SoupItem::Project(project)) = items_map.get(&test_project_uuid) {
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
            Query::Sort(SimpleSortMethod::UpdatedAt, ()),
        )
        .await?;
        assert_eq!(result.len(), 3, "UpdatedAt should return 3 items");

        let item_ids = get_item_ids(&result);
        let expected_ids = vec![
            Uuid::parse_str("cccccccc-1111-1111-1111-111111111111").unwrap(),
            Uuid::parse_str("dddddddd-dddd-dddd-dddd-dddddddddddd").unwrap(),
            Uuid::parse_str("ffffffff-ffff-ffff-ffff-ffffffffffff").unwrap(),
        ];
        assert_eq!(
            item_ids, expected_ids,
            "Failed to sort correctly by UpdatedAt"
        );
    }

    // --- Case 3: Test SortMethod::CreatedAt ---
    {
        let result = unexpanded_generic_cursor_soup(
            &pool,
            user_id,
            10,
            Query::Sort(SimpleSortMethod::CreatedAt, ()),
        )
        .await?;
        assert_eq!(result.len(), 3, "CreatedAt should return 3 items");

        let item_ids = get_item_ids(&result);
        let expected_ids = vec![
            Uuid::parse_str("ffffffff-ffff-ffff-ffff-ffffffffffff").unwrap(),
            Uuid::parse_str("cccccccc-1111-1111-1111-111111111111").unwrap(),
            Uuid::parse_str("dddddddd-dddd-dddd-dddd-dddddddddddd").unwrap(),
        ];
        assert_eq!(
            item_ids, expected_ids,
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
        Query::Sort(SimpleSortMethod::ViewedAt, ()),
    )
    .await?
    .into_iter()
    .paginate_on(1, SimpleSortMethod::ViewedAt)
    .into_page();

    assert_eq!(result.items.len(), 1, "Should get 1 item");

    let expected_doc_uuid = Uuid::parse_str("dddddddd-dddd-dddd-dddd-dddddddddddd").unwrap();
    match &result.items[0] {
        SoupItem::Document(doc) => {
            assert_eq!(
                doc.id, expected_doc_uuid,
                "First item should be document with ID test-document"
            );
        }
        _ => panic!("First item should be a document"),
    }

    let items_page2 = unexpanded_generic_cursor_soup(
        &pool,
        user_id,
        1,
        Query::new(
            result.next_cursor.map(|s| {
                let decoded = s.decode_json().unwrap();
                models_pagination::Cursor {
                    id: decoded.id.to_string(),
                    limit: decoded.limit,
                    val: decoded.val,
                    filter: decoded.filter,
                }
            }),
            SimpleSortMethod::ViewedAt,
            (),
        ),
    )
    .await?;

    assert_eq!(items_page2.len(), 1, "Should get 1 item");

    let expected_proj_uuid = Uuid::parse_str("ffffffff-ffff-ffff-ffff-ffffffffffff").unwrap();
    match &items_page2[0] {
        SoupItem::Project(project) => {
            assert_eq!(
                project.id, expected_proj_uuid,
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
        EntityType::Chat.with_entity_str("cccccccc-1111-1111-1111-111111111111"),
        EntityType::Document.with_entity_str("dddddddd-dddd-dddd-dddd-dddddddddddd"),
        EntityType::Project.with_entity_str("ffffffff-ffff-ffff-ffff-ffffffffffff"),
        EntityType::Document.with_entity_str("00000000-0000-0000-0000-000000000000"), // Should not appear in results
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
        EntityType::Document.with_entity_str("00000000-0000-0000-0000-000000000001"),
        EntityType::Chat.with_entity_str("00000000-0000-0000-0000-000000000002"),
        EntityType::Project.with_entity_str("00000000-0000-0000-0000-000000000003"),
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
        EntityType::Document.with_entity_str("cccccccc-cccc-cccc-cccc-cccccccccccc"),
        EntityType::Document.with_entity_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
        EntityType::Document.with_entity_str("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
    ];

    let items = unexpanded_soup_by_ids(&pool, user_id.copied(), &entities)
        .await
        .unwrap();

    assert_eq!(items.len(), 3, "Should get all 3 documents");

    // Test with duplicate entity IDs (should still return unique items)
    let entities_with_duplicates = [
        EntityType::Document.with_entity_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
        EntityType::Document.with_entity_str("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
        EntityType::Document.with_entity_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"), // Duplicate
        EntityType::Document.with_entity_str("cccccccc-cccc-cccc-cccc-cccccccccccc"),
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
        EntityType::Document.with_entity_str("dddddddd-dddd-dddd-dddd-dddddddddddd"),
        EntityType::Chat.with_entity_str("cccccccc-1111-1111-1111-111111111111"),
        EntityType::Project.with_entity_str("ffffffff-ffff-ffff-ffff-ffffffffffff"),
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
        Query::Sort(SimpleSortMethod::UpdatedAt, ()),
    )
    .await?;

    // Should get 5 items (2 docs + 2 chats + 1 project without frecency)
    assert_eq!(
        items.len(),
        5,
        "Should only return items without frecency records"
    );

    // Verify the returned items are the ones WITHOUT frecency
    let returned_ids: HashSet<Uuid> = items.iter().map(|item| item.id()).collect();

    let expected_ids: HashSet<Uuid> = [
        "44444444-4444-4444-4444-444444444444", // doc-no-frecency-1
        "55555555-5555-5555-5555-555555555555", // doc-no-frecency-2
        "66666666-6666-6666-6666-666666666666", // chat-no-frecency-1
        "77777777-7777-7777-7777-777777777777", // chat-no-frecency-2
        "88888888-8888-8888-8888-888888888888", // project-no-frecency
    ]
    .iter()
    .map(|&s| Uuid::parse_str(s).unwrap())
    .collect();

    assert_eq!(
        returned_ids, expected_ids,
        "Should only get items without frecency records"
    );

    // Verify none of the frecency items are returned
    let frecency_items = [
        Uuid::parse_str("44444444-ffff-ffff-ffff-ffffffffffff").unwrap(), // doc-with-frecency-1
        Uuid::parse_str("55555555-ffff-ffff-ffff-ffffffffffff").unwrap(), // doc-with-frecency-2
        Uuid::parse_str("66666666-ffff-ffff-ffff-ffffffffffff").unwrap(), // chat-with-frecency-1
        Uuid::parse_str("88888888-ffff-ffff-ffff-ffffffffffff").unwrap(), // project-with-frecency
    ];
    for frecency_id in &frecency_items {
        assert!(
            !returned_ids.contains(frecency_id),
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

    let get_item_ids =
        |items: &[SoupItem]| -> Vec<Uuid> { items.iter().map(|item| item.id()).collect() };

    // Test UpdatedAt sorting
    {
        let items = no_frecency_unexpanded_generic_cursor_soup(
            &pool,
            user_id.copied(),
            20,
            Query::Sort(SimpleSortMethod::UpdatedAt, ()),
        )
        .await?;
        assert_eq!(items.len(), 5, "UpdatedAt should return 5 items");

        let item_ids = get_item_ids(&items);
        // Ordered by updatedAt DESC: doc-no-frecency-1 (2/13), doc-no-frecency-2 (2/12),
        // chat-no-frecency-1 (2/10), chat-no-frecency-2 (2/09), project-no-frecency (2/07)
        let expected_ids = vec![
            Uuid::parse_str("44444444-4444-4444-4444-444444444444").unwrap(), // doc-no-frecency-1
            Uuid::parse_str("55555555-5555-5555-5555-555555555555").unwrap(), // doc-no-frecency-2
            Uuid::parse_str("66666666-6666-6666-6666-666666666666").unwrap(), // chat-no-frecency-1
            Uuid::parse_str("77777777-7777-7777-7777-777777777777").unwrap(), // chat-no-frecency-2
            Uuid::parse_str("88888888-8888-8888-8888-888888888888").unwrap(), // project-no-frecency
        ];
        assert_eq!(
            item_ids, expected_ids,
            "Failed to sort correctly by UpdatedAt"
        );
    }

    // Test CreatedAt sorting
    {
        let items = no_frecency_unexpanded_generic_cursor_soup(
            &pool,
            user_id.copied(),
            20,
            Query::Sort(SimpleSortMethod::CreatedAt, ()),
        )
        .await?;
        assert_eq!(items.len(), 5, "CreatedAt should return 5 items");

        let item_ids = get_item_ids(&items);
        // Ordered by createdAt DESC: project-no-frecency (1/18), chat-no-frecency-2 (1/16),
        // chat-no-frecency-1 (1/15), doc-no-frecency-2 (1/13), doc-no-frecency-1 (1/12)
        let expected_ids = vec![
            Uuid::parse_str("88888888-8888-8888-8888-888888888888").unwrap(), // project-no-frecency
            Uuid::parse_str("77777777-7777-7777-7777-777777777777").unwrap(), // chat-no-frecency-2
            Uuid::parse_str("66666666-6666-6666-6666-666666666666").unwrap(), // chat-no-frecency-1
            Uuid::parse_str("55555555-5555-5555-5555-555555555555").unwrap(), // doc-no-frecency-2
            Uuid::parse_str("44444444-4444-4444-4444-444444444444").unwrap(), // doc-no-frecency-1
        ];
        assert_eq!(
            item_ids, expected_ids,
            "Failed to sort correctly by CreatedAt"
        );
    }

    // Test ViewedAt sorting
    {
        let items = no_frecency_unexpanded_generic_cursor_soup(
            &pool,
            user_id,
            20,
            Query::Sort(SimpleSortMethod::ViewedAt, ()),
        )
        .await?;
        assert_eq!(items.len(), 5, "ViewedAt should return 5 items");

        let item_ids = get_item_ids(&items);
        // Ordered by UserHistory.updatedAt DESC: doc-no-frecency-1 (3/17), doc-no-frecency-2 (3/16),
        // chat-no-frecency-1 (3/15), chat-no-frecency-2 (3/14), project-no-frecency (3/13)
        let expected_ids = vec![
            Uuid::parse_str("44444444-4444-4444-4444-444444444444").unwrap(), // doc-no-frecency-1
            Uuid::parse_str("55555555-5555-5555-5555-555555555555").unwrap(), // doc-no-frecency-2
            Uuid::parse_str("66666666-6666-6666-6666-666666666666").unwrap(), // chat-no-frecency-1
            Uuid::parse_str("77777777-7777-7777-7777-777777777777").unwrap(), // chat-no-frecency-2
            Uuid::parse_str("88888888-8888-8888-8888-888888888888").unwrap(), // project-no-frecency
        ];
        assert_eq!(
            item_ids, expected_ids,
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
        Query::Sort(SimpleSortMethod::UpdatedAt, ()),
    )
    .await?
    .into_iter()
    .paginate_on(2, SimpleSortMethod::UpdatedAt)
    .into_page();

    assert_eq!(result.items.len(), 2, "Should get 2 items in first page");

    // First two items should be the most recently updated
    let doc1_uuid = Uuid::parse_str("44444444-4444-4444-4444-444444444444").unwrap();
    let doc2_uuid = Uuid::parse_str("55555555-5555-5555-5555-555555555555").unwrap();

    match &result.items[0] {
        SoupItem::Document(doc) => {
            assert_eq!(doc.id, doc1_uuid, "First item should be doc-no-frecency-1");
        }
        _ => panic!("First item should be a document"),
    }

    match &result.items[1] {
        SoupItem::Document(doc) => {
            assert_eq!(doc.id, doc2_uuid, "Second item should be doc-no-frecency-2");
        }
        _ => panic!("Second item should be a document"),
    }

    // Get second page using cursor
    let items = no_frecency_unexpanded_generic_cursor_soup(
        &pool,
        user_id,
        2,
        Query::new(
            result.next_cursor.map(|s| {
                let decoded = s.decode_json().unwrap();
                models_pagination::Cursor {
                    id: decoded.id.to_string(),
                    limit: decoded.limit,
                    val: decoded.val,
                    filter: decoded.filter,
                }
            }),
            SimpleSortMethod::UpdatedAt,
            (),
        ),
    )
    .await?;

    assert_eq!(items.len(), 2, "Should get 2 items in second page");

    // Next two items should be the chats
    let chat1_uuid = Uuid::parse_str("66666666-6666-6666-6666-666666666666").unwrap();
    let chat2_uuid = Uuid::parse_str("77777777-7777-7777-7777-777777777777").unwrap();

    match &items[0] {
        SoupItem::Chat(chat) => {
            assert_eq!(
                chat.id, chat1_uuid,
                "Third item should be chat-no-frecency-1"
            );
        }
        _ => panic!("Third item should be a chat"),
    }

    match &items[1] {
        SoupItem::Chat(chat) => {
            assert_eq!(
                chat.id, chat2_uuid,
                "Fourth item should be chat-no-frecency-2"
            );
        }
        _ => panic!("Fourth item should be a chat"),
    }

    Ok(())
}
