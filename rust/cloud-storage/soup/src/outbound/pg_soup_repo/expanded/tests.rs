use crate::outbound::pg_soup_repo::expanded::{
    by_cursor::{expanded_generic_cursor_soup, no_frecency_expanded_generic_soup},
    by_ids::expanded_soup_by_ids,
    dynamic::{ExpandedDynamicCursorArgs, expanded_dynamic_cursor_soup},
};
use item_filters::ast::EntityFilterAst;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model_entity::EntityType;
use models_pagination::Identify;
use models_pagination::{Frecency, PaginateOn, Query, SimpleSortMethod};
use models_soup::item::SoupItem;
use sqlx::{PgPool, Pool, Postgres};
use std::collections::HashSet;
use uuid::Uuid;

macro_rules! unwrap_enum {
    // Base case: single variant
    ($value:expr, $variant:path) => {
        match $value {
            $variant(inner) => inner,
            _ => panic!(
                "called `unwrap_enum!` on variant that didn't match `{}`",
                stringify!($variant)
            ),
        }
    };

    // Recursive case: peel off first variant and recurse
    ($value:expr, $variant:path => $($rest:path)=>+) => {
        match $value {
            $variant(inner) => unwrap_enum!(inner, $($rest)=>+),
            _ => panic!(
                "called `unwrap_enum!` on nested variant that didn't match `{} => ...`",
                stringify!($variant)
            ),
        }
    };
}
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
    let returned_ids: HashSet<Uuid> = items.iter().map(|item| item.id()).collect();

    let expected_ids: HashSet<Uuid> = [
        "22222222-0000-0000-0000-000000000000", // chat-standalone
        "11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb", // doc-in-B
        "11111111-dddd-dddd-dddd-dddddddddddd", // doc-in-D
        "cccccccc-ffff-ffff-ffff-ffffffffffff", // project-C
        "dddddddd-ffff-ffff-ffff-ffffffffffff", // project-D
        "11111111-cccc-cccc-cccc-cccccccccccc", // doc-in-C
        "22222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb", // chat-in-B
        "aaaaaaaa-ffff-ffff-ffff-ffffffffffff", // project-A
        "22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa", // chat-in-A
        "11111111-0000-0000-0000-000000000000", // doc-standalone
        "22222222-cccc-cccc-cccc-cccccccccccc", // chat-in-C
        "bbbbbbbb-ffff-ffff-ffff-ffffffffffff", // project-B
        "11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa", // doc-in-A
    ]
    .iter()
    .map(|&s| Uuid::parse_str(s).unwrap())
    .collect();

    assert_eq!(
        returned_ids, expected_ids,
        "Should get the right set of items that have been viewed"
    );

    // Check that items are ordered by their UserHistory.updatedAt timestamp.
    let ordered_ids: Vec<Uuid> = items.iter().map(|item| item.id()).collect();

    let expected_order: Vec<Uuid> = vec![
        Uuid::parse_str("11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb").unwrap(), // doc-in-B - 2024-01-10
        Uuid::parse_str("22222222-0000-0000-0000-000000000000").unwrap(), // chat-standalone - 2024-01-09
        Uuid::parse_str("11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa").unwrap(), // doc-in-A - 2024-01-08
        Uuid::parse_str("22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa").unwrap(), // chat-in-A - 2024-01-07
        Uuid::parse_str("11111111-0000-0000-0000-000000000000").unwrap(), // doc-standalone - 2024-01-06
        Uuid::parse_str("11111111-dddd-dddd-dddd-dddddddddddd").unwrap(), // doc-in-D - 2023-01-05
        Uuid::parse_str("22222222-cccc-cccc-cccc-cccccccccccc").unwrap(), // chat-in-C - 2023-01-04
        // Null viewed_at items, tiebroken by id DESC:
        Uuid::parse_str("dddddddd-ffff-ffff-ffff-ffffffffffff").unwrap(), // project-D - null
        Uuid::parse_str("cccccccc-ffff-ffff-ffff-ffffffffffff").unwrap(), // project-C - null
        Uuid::parse_str("bbbbbbbb-ffff-ffff-ffff-ffffffffffff").unwrap(), // project-B - null
        Uuid::parse_str("aaaaaaaa-ffff-ffff-ffff-ffffffffffff").unwrap(), // project-A - null
        Uuid::parse_str("22222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb").unwrap(), // chat-in-B - null
        Uuid::parse_str("11111111-cccc-cccc-cccc-cccccccccccc").unwrap(), // doc-in-C - null
    ];
    assert_eq!(
        ordered_ids, expected_order,
        "Wrong item order based on UserHistory"
    );

    // Map for easier lookup when checking item details
    let items_map: std::collections::HashMap<Uuid, &SoupItem> =
        items.iter().map(|item| (item.id(), item)).collect();

    // Check a standalone item that is still present
    let chat_uuid = Uuid::parse_str("22222222-0000-0000-0000-000000000000").unwrap(); // chat-standalone
    if let Some(SoupItem::Chat(chat)) = items_map.get(&chat_uuid) {
        assert_eq!(chat.name, "Standalone Chat");
        assert_eq!(chat.project_id, None, "Standalone shouldn't have project");
    } else {
        panic!("Missing chat-standalone");
    }

    // Check an item with both inherited and direct access that is still present
    let doc_uuid = Uuid::parse_str("11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb").unwrap(); // doc-in-B
    if let Some(SoupItem::Document(doc)) = items_map.get(&doc_uuid) {
        assert_eq!(doc.name, "Document in B");
        assert_eq!(
            doc.project_id.as_ref(),
            Some(&Uuid::parse_str("bbbbbbbb-ffff-ffff-ffff-ffffffffffff").unwrap()), // project-B
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
            let expected_uuid = Uuid::parse_str("11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb").unwrap(); // doc-in-B
            assert_eq!(
                doc.id, expected_uuid,
                "First item should be document with ID doc-in-B"
            );
        }
        _ => panic!("First item should be a document"),
    }

    let items = expanded_generic_cursor_soup(
        &pool,
        user_id.copied(),
        1,
        Query::new(
            result.next_cursor.map(|s| {
                let decoded = s.decode_json().unwrap();
                models_pagination::Cursor {
                    id: decoded.id,
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

    assert_eq!(items.len(), 1, "Should get 1 item");

    match &items[0] {
        SoupItem::Chat(chat) => {
            let expected_uuid = Uuid::parse_str("22222222-0000-0000-0000-000000000000").unwrap(); // chat-standalone
            assert_eq!(
                chat.id, expected_uuid,
                "Second item should be chat with ID chat-standalone"
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
    let get_item_ids =
        |items: &[SoupItem]| -> Vec<Uuid> { items.iter().map(|item| item.id()).collect() };

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
        let expected_ids: Vec<Uuid> = [
            "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", // doc-A
            "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", // doc-B
            "aaaaaaaa-cccc-cccc-cccc-cccccccccccc", // chat-A
            "bbbbbbbb-ffff-ffff-ffff-ffffffffffff", // project-B (epoch, tiebroken by id DESC)
            "bbbbbbbb-cccc-cccc-cccc-cccccccccccc", // chat-B (epoch, tiebroken by id DESC)
            "aaaaaaaa-ffff-ffff-ffff-ffffffffffff", // project-A (epoch, tiebroken by id DESC)
        ]
        .iter()
        .map(|&s| Uuid::parse_str(s).unwrap())
        .collect();
        assert_eq!(
            item_ids, expected_ids,
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
        let expected_ids: Vec<Uuid> = [
            "aaaaaaaa-cccc-cccc-cccc-cccccccccccc", // chat-A
            "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", // doc-A
            "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", // doc-B
            "bbbbbbbb-cccc-cccc-cccc-cccccccccccc", // chat-B
            "bbbbbbbb-ffff-ffff-ffff-ffffffffffff", // project-B
            "aaaaaaaa-ffff-ffff-ffff-ffffffffffff", // project-A
        ]
        .iter()
        .map(|&s| Uuid::parse_str(s).unwrap())
        .collect();
        assert_eq!(
            item_ids, expected_ids,
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
        let expected_ids: Vec<Uuid> = [
            "bbbbbbbb-cccc-cccc-cccc-cccccccccccc", // chat-B
            "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", // doc-B
            "aaaaaaaa-cccc-cccc-cccc-cccccccccccc", // chat-A
            "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", // doc-A
            "bbbbbbbb-ffff-ffff-ffff-ffffffffffff", // project-B
            "aaaaaaaa-ffff-ffff-ffff-ffffffffffff", // project-A
        ]
        .iter()
        .map(|&s| Uuid::parse_str(s).unwrap())
        .collect();
        assert_eq!(
            item_ids, expected_ids,
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
        EntityType::Document.with_entity_str("11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa"), // doc-in-A
        EntityType::Chat.with_entity_str("22222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),     // chat-in-B
        EntityType::Document.with_entity_str("11111111-0000-0000-0000-000000000000"), // doc-standalone
        EntityType::Chat.with_entity_str("22222222-0000-0000-0000-000000000000"), // chat-standalone
        EntityType::Project.with_entity_str("aaaaaaaa-ffff-ffff-ffff-ffffffffffff"), // project-A - Should be ignored in expanded soup
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
            SoupItem::Chat(_)
            | SoupItem::Project(_)
            | SoupItem::EmailThread(_)
            | SoupItem::Channel(_) => None,
        })
        .expect("The document should exist");
    let expected_doc_id = Uuid::parse_str("11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa").unwrap(); // doc-in-A
    let expected_project_id = Uuid::parse_str("aaaaaaaa-ffff-ffff-ffff-ffffffffffff").unwrap(); // project-A
    assert_eq!(doc.id, expected_doc_id);
    assert_eq!(doc.name, "Document in A");
    assert_eq!(doc.project_id, Some(expected_project_id));

    // chat-in-B is in project-B which is a child of project-A
    let chat = items
        .iter()
        .find_map(|x| match x {
            SoupItem::Chat(soup_chat) => Some(soup_chat),
            _ => None,
        })
        .expect("The chat should exist");
    let expected_chat_id = Uuid::parse_str("22222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb").unwrap(); // chat-in-B
    let expected_project_id = Uuid::parse_str("bbbbbbbb-ffff-ffff-ffff-ffffffffffff").unwrap(); // project-B
    assert_eq!(chat.id, expected_chat_id);
    assert_eq!(chat.name, "Chat in B");
    assert_eq!(chat.project_id.as_ref(), Some(&expected_project_id));
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
        EntityType::Document.with_entity_str("00000000-0000-0000-0000-000000000000"), // non-existent-doc
        EntityType::Chat.with_entity_str("00000000-0000-0000-000000000001"), // non-existent-chat
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
        EntityType::Project.with_entity_str("aaaaaaaa-ffff-ffff-ffff-ffffffffffff"), // project-A
        EntityType::Project.with_entity_str("bbbbbbbb-ffff-ffff-ffff-ffffffffffff"), // project-B
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

    let get_item_ids =
        |items: &[SoupItem]| -> Vec<Uuid> { items.iter().map(|item| item.id()).collect() };

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
        // chat-no-frecency-1 (2/08), chat-no-frecency-2 (2/07), project-no-frecency (1/01)
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
        // doc-no-frecency-2 (1/14), doc-no-frecency-1 (1/13), project-no-frecency (1/01)
        let expected_ids = vec![
            Uuid::parse_str("77777777-7777-7777-7777-777777777777").unwrap(), // chat-no-frecency-2
            Uuid::parse_str("66666666-6666-6666-6666-666666666666").unwrap(), // chat-no-frecency-1
            Uuid::parse_str("55555555-5555-5555-5555-555555555555").unwrap(), // doc-no-frecency-2
            Uuid::parse_str("44444444-4444-4444-4444-444444444444").unwrap(), // doc-no-frecency-1
            Uuid::parse_str("88888888-8888-8888-8888-888888888888").unwrap(), // project-no-frecency
        ];
        assert_eq!(
            item_ids, expected_ids,
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
                doc.id,
                Uuid::parse_str("44444444-4444-4444-4444-444444444444").unwrap(),
                "First item should be doc-no-frecency-1"
            );
        }
        _ => panic!("First item should be a document"),
    }

    match &result.items[1] {
        SoupItem::Document(doc) => {
            assert_eq!(
                doc.id,
                Uuid::parse_str("55555555-5555-5555-5555-555555555555").unwrap(),
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
            result.next_cursor.map(|s| {
                let decoded = s.decode_json().unwrap();
                models_pagination::Cursor {
                    id: decoded.id,
                    limit: decoded.limit,
                    val: decoded.val,
                    filter: decoded.filter,
                }
            }),
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
                chat.id,
                Uuid::parse_str("66666666-6666-6666-6666-666666666666").unwrap(),
                "Third item should be chat-no-frecency-1"
            );
        }
        _ => panic!("Third item should be a chat"),
    }

    match &items[1] {
        SoupItem::Chat(chat) => {
            assert_eq!(
                chat.id,
                Uuid::parse_str("77777777-7777-7777-7777-777777777777").unwrap(),
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
    let ast_ids: Vec<Uuid> = ast_res.iter().map(|item| item.id()).collect();

    let static_ids: Vec<Uuid> = static_res.iter().map(|item| item.id()).collect();

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
            _ => {
                unimplemented!("encountered an unexpected value");
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
    let mut document_ids: HashSet<Uuid> = HashSet::new();
    let mut chat_count = 0;
    let mut project_count = 0;

    for item in &items {
        match item {
            SoupItem::Document(d) => {
                document_ids.insert(d.id);
            }
            SoupItem::Chat(_) => {
                chat_count += 1;
            }
            SoupItem::Project(_) => {
                project_count += 1;
            }
            _ => unimplemented!("encountered unexpected entity"),
        }
    }

    assert_eq!(document_ids.len(), 2, "Should get exactly 2 documents");
    assert_eq!(chat_count, 4, "Should get all chats");
    assert_eq!(project_count, 4, "Should get all projects");

    let returned_ids = document_ids;

    let expected_ids: HashSet<Uuid> = [
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
    ]
    .iter()
    .map(|&s| Uuid::parse_str(s).unwrap())
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
                    doc.project_id.as_ref(),
                    Some(&Uuid::parse_str("11111111-1111-1111-1111-111111111111").unwrap())
                );
                found_doc_id = Some(doc.id);
                doc_count += 1;
            }
            SoupItem::Chat(_) => {
                chat_count += 1;
            }
            SoupItem::Project(_) => {
                project_count += 1;
            }
            _ => unimplemented!("encounted unexpected entity"),
        }
    }

    assert_eq!(doc_count, 1, "Should get 1 document in project-A");
    assert_eq!(
        found_doc_id.as_ref(),
        Some(&Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa").unwrap())
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
                    chat.project_id.as_ref(),
                    Some(&Uuid::parse_str("22222222-2222-2222-2222-222222222222").unwrap())
                );
                found_chat_id = Some(chat.id);
                chat_count += 1;
            }
            SoupItem::Project(_) => {
                project_count += 1;
            }
            _ => unimplemented!("encounted unexpected entity"),
        }
    }

    assert_eq!(chat_count, 1, "Should get 1 chat in project-B");
    assert_eq!(
        found_chat_id.as_ref(),
        Some(&Uuid::parse_str("b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2").unwrap())
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
    let mut chat_ids: HashSet<Uuid> = HashSet::new();
    let mut doc_count = 0;
    let mut project_count = 0;

    for item in &items {
        match item {
            SoupItem::Chat(c) => {
                chat_ids.insert(c.id);
            }
            SoupItem::Document(_) => {
                doc_count += 1;
            }
            SoupItem::Project(_) => {
                project_count += 1;
            }
            _ => unimplemented!("encounted unexpected entity"),
        }
    }

    assert_eq!(chat_ids.len(), 2, "Should get exactly 2 chats");
    assert_eq!(doc_count, 5, "Should get all documents");
    assert_eq!(project_count, 4, "Should get all projects");

    let returned_ids = chat_ids;

    let expected_ids: HashSet<Uuid> = [
        "a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1",
        "d4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4",
    ]
    .iter()
    .map(|&s| Uuid::parse_str(s).unwrap())
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
    let mut project_ids: HashSet<Uuid> = HashSet::new();
    let mut doc_count = 0;
    let mut chat_count = 0;

    for item in &items {
        match item {
            SoupItem::Project(p) => {
                project_ids.insert(p.id);
            }
            SoupItem::Document(_) => {
                doc_count += 1;
            }
            SoupItem::Chat(_) => {
                chat_count += 1;
            }
            _ => unimplemented!("encounted unexpected entity"),
        }
    }

    assert_eq!(
        project_ids.len(),
        1,
        "Should get exactly 1 project (project-B, child of project-A)"
    );
    assert_eq!(doc_count, 5, "Should get all documents");
    assert_eq!(chat_count, 4, "Should get all chats");

    let returned_ids = project_ids;

    let expected_ids: HashSet<Uuid> = [
        "22222222-2222-2222-2222-222222222222", // Project B (parentId = project-A)
    ]
    .iter()
    .map(|&s| Uuid::parse_str(s).unwrap())
    .collect();

    assert_eq!(
        returned_ids, expected_ids,
        "Should get project-B (child of project-A)"
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

    // Should get: doc-in-A, doc-in-B, chat-standalone = 3 items
    // Note: project filter for project-D returns 0 projects (no children of project-D exist)
    assert_eq!(
        items.len(),
        3,
        "Should get 3 items total (2 docs + 1 chat, no projects match parentId filter)"
    );

    let mut doc_count = 0;
    let mut chat_count = 0;
    let mut project_count = 0;

    for item in &items {
        match item {
            SoupItem::Document(doc) => {
                doc_count += 1;
                let doc_a = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa").unwrap();
                let doc_b = Uuid::parse_str("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb").unwrap();
                assert!(
                    doc.id == doc_a || doc.id == doc_b,
                    "Document should be in project-A or project-B"
                );
            }
            SoupItem::Chat(chat) => {
                chat_count += 1;
                assert_eq!(
                    chat.id,
                    Uuid::parse_str("d4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4").unwrap(),
                    "Should only get standalone chat"
                );
            }
            SoupItem::Project(_project) => {
                project_count += 1;
            }
            _ => unimplemented!("encounted unexpected entity"),
        }
    }

    assert_eq!(doc_count, 2, "Should get 2 documents");
    assert_eq!(chat_count, 1, "Should get 1 chat");
    assert_eq!(
        project_count, 0,
        "Should get 0 projects (no children of project-D)"
    );

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
    let mut document_ids: HashSet<Uuid> = HashSet::new();
    let mut chat_count = 0;
    let mut project_count = 0;

    for item in &items {
        match item {
            SoupItem::Document(d) => {
                document_ids.insert(d.id);
            }
            SoupItem::Chat(_) => {
                chat_count += 1;
            }
            SoupItem::Project(_) => {
                project_count += 1;
            }
            _ => unimplemented!("encounted unexpected entity"),
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

    let expected_ids: HashSet<Uuid> = [
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    ]
    .iter()
    .map(|&s| Uuid::parse_str(s).unwrap())
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
            _ => unimplemented!("encounted unexpected entity"),
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
                    doc.owner_id.as_ref(),
                    "macro|user-1@test.com",
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
            _ => unimplemented!("encounted unexpected entity"),
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
            _ => unimplemented!("encounted unexpected entity"),
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

    assert!(
        !second_page_items.is_empty(),
        "Second page should have items"
    );

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
            _ => unimplemented!("encounted unexpected entity"),
        }
    }

    // Verify no duplicate items between pages
    let first_page_ids: HashSet<Uuid> = first_page_items.iter().map(|item| item.id()).collect();

    for item in &second_page_items {
        let id = item.id();
        assert!(
            !first_page_ids.contains(&id),
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
                    let project_id = doc.project_id.as_ref().unwrap();
                    let proj_a = Uuid::parse_str("11111111-1111-1111-1111-111111111111").unwrap();
                    let proj_b = Uuid::parse_str("22222222-2222-2222-2222-222222222222").unwrap();
                    assert!(
                        *project_id == proj_a || *project_id == proj_b,
                        "Documents should be in filtered projects"
                    );
                }
                SoupItem::Chat(chat) => {
                    assert_eq!(
                        chat.id,
                        Uuid::parse_str("a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1").unwrap(),
                        "Only the filtered chat should appear"
                    );
                }
                SoupItem::Project(_) => {
                    // All projects should be included
                }
                _ => unimplemented!("encountered an unknown entity"),
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
    let expected_doc_ids: HashSet<Uuid> = [
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    ]
    .iter()
    .map(|&s| Uuid::parse_str(s).unwrap())
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
    let all_ids: Vec<Uuid> = all_items.iter().map(|item| item.id()).collect();

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
    let expected_chat_id = Uuid::parse_str("a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1").unwrap();
    let chat_count_page1 = result
        .items
        .iter()
        .filter(|item| matches!(item, SoupItem::Chat(c) if c.id == expected_chat_id))
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
            .filter(|item| matches!(item, SoupItem::Chat(c) if c.id == expected_chat_id))
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
                "44444444-ffff-ffff-ffff-ffffffffffff".to_string(), // doc-with-frecency-1
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
    // - 44444444-ffff-ffff-ffff-ffffffffffff (has frecency) - excluded by frecency filter
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
    let returned_ids: HashSet<Uuid> = items
        .iter()
        .map(|item| match item {
            SoupItem::Document(d) => d.id,
            _ => unreachable!(),
        })
        .collect();

    let expected_ids: HashSet<Uuid> = [
        "44444444-4444-4444-4444-444444444444",
        "55555555-5555-5555-5555-555555555555",
    ]
    .iter()
    .map(|&s| Uuid::parse_str(s).unwrap())
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

    let returned_with_frecency_ids: HashSet<Uuid> = items_with_frecency
        .iter()
        .map(|item| match item {
            SoupItem::Document(d) => d.id,
            _ => unreachable!(),
        })
        .collect();

    let expected_with_frecency_ids: HashSet<Uuid> = [
        "44444444-4444-4444-4444-444444444444",
        "55555555-5555-5555-5555-555555555555",
        "44444444-ffff-ffff-ffff-ffffffffffff",
    ]
    .iter()
    .map(|&s| Uuid::parse_str(s).unwrap())
    .collect();

    assert_eq!(
        returned_with_frecency_ids, expected_with_frecency_ids,
        "Should get all documents matching AST filter regardless of frecency"
    );

    Ok(())
}

// Test filtering documents by importance
// The fixture has:
//   doc-in-A: task, assigned to user-1 (important)
//   doc-in-B: task, assigned to other-user (NOT important)
//   doc-in-C: task, assigned to user-1 (important)
//   doc-in-D: not a task (important - non-tasks are always important)
//   standalone doc: not a task (important)
#[sqlx::test(
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("entity_filter_tests")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn test_filter_documents_by_importance(db: PgPool) -> anyhow::Result<()> {
    use item_filters::{DocumentFilters, EntityFilters};

    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();

    // importance=true: non-tasks + tasks assigned to user
    {
        let entity_filters = EntityFilters {
            document_filters: DocumentFilters {
                importance: Some(true),
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

        let mut doc_ids: HashSet<Uuid> = HashSet::new();
        let mut chat_count = 0;
        let mut project_count = 0;

        for item in &items {
            match item {
                SoupItem::Document(doc) => {
                    doc_ids.insert(doc.id);
                }
                SoupItem::Chat(_) => chat_count += 1,
                SoupItem::Project(_) => project_count += 1,
                _ => unimplemented!("encountered unexpected entity"),
            }
        }

        let expected_ids: HashSet<Uuid> = [
            "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", // doc-in-A (task, assigned to user)
            "cccccccc-cccc-cccc-cccc-cccccccccccc", // doc-in-C (task, assigned to user)
            "dddddddd-dddd-dddd-dddd-dddddddddddd", // doc-in-D (not a task)
            "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", // standalone doc (not a task)
        ]
        .iter()
        .map(|&s| Uuid::parse_str(s).unwrap())
        .collect();

        assert_eq!(
            doc_ids, expected_ids,
            "Should get the correct important documents"
        );
        assert_eq!(chat_count, 4, "Should get all chats");
        assert_eq!(project_count, 4, "Should get all projects");
    }

    // importance=false: only tasks NOT assigned to user
    {
        let entity_filters = EntityFilters {
            document_filters: DocumentFilters {
                importance: Some(false),
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

        let mut doc_ids: HashSet<Uuid> = HashSet::new();
        let mut chat_count = 0;
        let mut project_count = 0;

        for item in &items {
            match item {
                SoupItem::Document(doc) => {
                    doc_ids.insert(doc.id);
                }
                SoupItem::Chat(_) => chat_count += 1,
                SoupItem::Project(_) => project_count += 1,
                _ => unimplemented!("encountered unexpected entity"),
            }
        }

        let expected_ids: HashSet<Uuid> = [
            "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", // doc-in-B (task, assigned to other user)
        ]
        .iter()
        .map(|&s| Uuid::parse_str(s).unwrap())
        .collect();

        assert_eq!(
            doc_ids, expected_ids,
            "Should get the correct unimportant documents"
        );
        assert_eq!(chat_count, 4, "Should get all chats");
        assert_eq!(project_count, 4, "Should get all projects");
    }

    Ok(())
}

// Test filtering chats by importance
// importance=true is a no-op (returns all chats)
// importance=false short-circuits to match nothing (1=0)
#[sqlx::test(
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("entity_filter_tests")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn test_filter_chats_by_importance(db: PgPool) -> anyhow::Result<()> {
    use item_filters::{ChatFilters, EntityFilters};

    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();

    // importance=true: no-op, should return all chats
    {
        let entity_filters = EntityFilters {
            chat_filters: ChatFilters {
                importance: Some(true),
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

        let mut doc_count = 0;
        let mut chat_count = 0;
        let mut project_count = 0;

        for item in &items {
            match item {
                SoupItem::Document(_) => doc_count += 1,
                SoupItem::Chat(_) => chat_count += 1,
                SoupItem::Project(_) => project_count += 1,
                _ => unimplemented!("encountered unexpected entity"),
            }
        }

        assert_eq!(chat_count, 4, "importance=true should return all chats");
        assert_eq!(doc_count, 5, "Should get all documents");
        assert_eq!(project_count, 4, "Should get all projects");
    }

    // importance=false: 1=0, should return no chats
    {
        let entity_filters = EntityFilters {
            chat_filters: ChatFilters {
                importance: Some(false),
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

        let mut doc_count = 0;
        let mut chat_count = 0;
        let mut project_count = 0;

        for item in &items {
            match item {
                SoupItem::Document(_) => doc_count += 1,
                SoupItem::Chat(_) => chat_count += 1,
                SoupItem::Project(_) => project_count += 1,
                _ => unimplemented!("encountered unexpected entity"),
            }
        }

        assert_eq!(chat_count, 0, "importance=false should return no chats");
        assert_eq!(doc_count, 5, "Should get all documents");
        assert_eq!(project_count, 4, "Should get all projects");
    }

    Ok(())
}

// Test filtering projects by importance
// importance=true is a no-op (returns all projects)
// importance=false short-circuits to match nothing (1=0)
#[sqlx::test(
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("entity_filter_tests")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn test_filter_projects_by_importance(db: PgPool) -> anyhow::Result<()> {
    use item_filters::{EntityFilters, ProjectFilters};

    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();

    // importance=true: no-op, should return all projects
    {
        let entity_filters = EntityFilters {
            project_filters: ProjectFilters {
                importance: Some(true),
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

        let mut doc_count = 0;
        let mut chat_count = 0;
        let mut project_count = 0;

        for item in &items {
            match item {
                SoupItem::Document(_) => doc_count += 1,
                SoupItem::Chat(_) => chat_count += 1,
                SoupItem::Project(_) => project_count += 1,
                _ => unimplemented!("encountered unexpected entity"),
            }
        }

        assert_eq!(
            project_count, 4,
            "importance=true should return all projects"
        );
        assert_eq!(doc_count, 5, "Should get all documents");
        assert_eq!(chat_count, 4, "Should get all chats");
    }

    // importance=false: 1=0, should return no projects
    {
        let entity_filters = EntityFilters {
            project_filters: ProjectFilters {
                importance: Some(false),
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

        let mut doc_count = 0;
        let mut chat_count = 0;
        let mut project_count = 0;

        for item in &items {
            match item {
                SoupItem::Document(_) => doc_count += 1,
                SoupItem::Chat(_) => chat_count += 1,
                SoupItem::Project(_) => project_count += 1,
                _ => unimplemented!("encountered unexpected entity"),
            }
        }

        assert_eq!(
            project_count, 0,
            "importance=false should return no projects"
        );
        assert_eq!(doc_count, 5, "Should get all documents");
        assert_eq!(chat_count, 4, "Should get all chats");
    }

    Ok(())
}

/// Test that system properties are populated on SoupItems (Documents and Projects)
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("soup_items_with_properties")
    )
)]
async fn test_expanded_dynamic_cursor_populates_properties(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();

    let items = expanded_dynamic_cursor_soup(
        &pool,
        ExpandedDynamicCursorArgs {
            user_id: user_id.copied(),
            limit: 20,
            cursor: Query::Sort(SimpleSortMethod::UpdatedAt, EntityFilterAst::mock_empty()),
            exclude_frecency: false,
        },
    )
    .await?;

    // Should get 2 documents and 2 projects (A and B)
    assert!(!items.is_empty(), "Should return some items");

    // Check that Document in A has properties populated
    let doc_a_uuid = Uuid::parse_str("11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa").unwrap();
    let doc_a = items
        .iter()
        .find(|item| item.id() == doc_a_uuid)
        .expect("doc a shoul exist");

    let doc = unwrap_enum!(doc_a, SoupItem::Document);
    assert_eq!(
        doc.properties.len(),
        2,
        "Document in A should have 2 properties"
    );

    // Check that Document in B has properties populated
    let doc_b_uuid = Uuid::parse_str("11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb").unwrap();
    let doc_b = items.iter().find(|item| item.id() == doc_b_uuid);
    assert!(doc_b.is_some(), "Should find Document in B");

    let doc = unwrap_enum!(doc_b, Some => SoupItem::Document);
    // Document in B has Priority and Due Date properties
    assert_eq!(
        doc.properties.len(),
        2,
        "Document in B should have 2 properties"
    );

    // Check that Project A has properties populated
    let proj_a_uuid = Uuid::parse_str("aaaaaaaa-ffff-ffff-ffff-ffffffffffff").unwrap();
    let proj_a = items.iter().find(|item| item.id() == proj_a_uuid);
    assert!(proj_a.is_some(), "Should find Project A");

    let proj = unwrap_enum!(proj_a, Some => SoupItem::Project);
    assert!(
        !proj.properties.is_empty(),
        "Project A should have properties populated"
    );
    // Project A has Priority property
    assert_eq!(proj.properties.len(), 1, "Project A should have 1 property");

    // Check that Project B has no properties (none were added in fixture)
    let proj_b_uuid = Uuid::parse_str("bbbbbbbb-ffff-ffff-ffff-ffffffffffff").unwrap();
    let proj_b = items.iter().find(|item| item.id() == proj_b_uuid);
    assert!(proj_b.is_some(), "Should find Project B");

    let proj = unwrap_enum!(proj_b, Some => SoupItem::Project);
    // Project B has no properties in the fixture, so it should be empty or None
    let props_count = proj.properties.len();
    assert_eq!(props_count, 0, "Project B should have 0 properties");

    Ok(())
}

// ============================================================================
// Exhaustive expanded_generic_cursor_soup tests
// ============================================================================

// Fixture constants for expanded_cursor_soup_exhaustive
const EX_PROJECT_ROOT: &str = "aa000001-ffff-ffff-ffff-ffffffffffff";
const EX_PROJECT_MID: &str = "aa000002-ffff-ffff-ffff-ffffffffffff";
const EX_PROJECT_DEEP: &str = "aa000003-ffff-ffff-ffff-ffffffffffff";
const EX_PROJECT_ISOLATED: &str = "aa000004-ffff-ffff-ffff-ffffffffffff";
const EX_DOC_ROOT: &str = "bb000001-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const EX_DOC_MID: &str = "bb000002-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const EX_DOC_DEEP: &str = "bb000003-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const EX_DOC_STANDALONE: &str = "bb000004-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const EX_DOC_DELETED: &str = "bb000005-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const EX_DOC_TASK_COMPLETED: &str = "bb000006-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const EX_DOC_TASK_INCOMPLETE: &str = "bb000007-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const EX_DOC_TASK_NO_STATUS: &str = "bb000008-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const EX_DOC_ISOLATED: &str = "bb000009-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const EX_CHAT_ROOT: &str = "cc000001-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const EX_CHAT_STANDALONE: &str = "cc000002-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const EX_CHAT_DELETED: &str = "cc000003-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const EX_CHAT_ISOLATED: &str = "cc000004-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

fn uuid(s: &str) -> Uuid {
    Uuid::parse_str(s).unwrap()
}

/// Deleted documents and chats must not appear in results
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("expanded_cursor_soup_exhaustive")
    )
)]
async fn test_exhaustive_deleted_items_excluded(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();
    let items = expanded_generic_cursor_soup(
        &pool,
        user_id.copied(),
        50,
        Query::Sort(SimpleSortMethod::UpdatedAt, ()),
    )
    .await?;

    let ids: HashSet<Uuid> = items.iter().map(|i| i.id()).collect();

    assert!(
        !ids.contains(&uuid(EX_DOC_DELETED)),
        "Deleted document must not appear"
    );
    assert!(
        !ids.contains(&uuid(EX_CHAT_DELETED)),
        "Deleted chat must not appear"
    );

    Ok(())
}

/// Items in isolated project must not appear for user-1.
/// Isolated project, doc, and chat should all be excluded.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("expanded_cursor_soup_exhaustive")
    )
)]
async fn test_exhaustive_access_control_excludes_isolated(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();
    let items = expanded_generic_cursor_soup(
        &pool,
        user_id.copied(),
        50,
        Query::Sort(SimpleSortMethod::UpdatedAt, ()),
    )
    .await?;

    let ids: HashSet<Uuid> = items.iter().map(|i| i.id()).collect();

    assert!(
        !ids.contains(&uuid(EX_PROJECT_ISOLATED)),
        "Isolated project must not appear for user-1"
    );
    assert!(
        !ids.contains(&uuid(EX_DOC_ISOLATED)),
        "Isolated doc must not appear for user-1"
    );
    assert!(
        !ids.contains(&uuid(EX_CHAT_ISOLATED)),
        "Isolated chat must not appear for user-1"
    );

    Ok(())
}

/// User-2 only has access to the isolated project and its children.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("expanded_cursor_soup_exhaustive")
    )
)]
async fn test_exhaustive_user_isolation(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserIdStr::parse_from_str("macro|user-2@test.com").unwrap();
    let items = expanded_generic_cursor_soup(
        &pool,
        user_id.copied(),
        50,
        Query::Sort(SimpleSortMethod::UpdatedAt, ()),
    )
    .await?;

    let ids: HashSet<Uuid> = items.iter().map(|i| i.id()).collect();

    let expected: HashSet<Uuid> = [EX_PROJECT_ISOLATED, EX_DOC_ISOLATED, EX_CHAT_ISOLATED]
        .iter()
        .map(|s| uuid(s))
        .collect();

    assert_eq!(
        ids, expected,
        "User-2 should only see isolated project, its doc, and its chat"
    );

    Ok(())
}

/// Documents 3 levels deep in the hierarchy (root -> mid -> deep) are accessible
/// through inherited project permissions.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("expanded_cursor_soup_exhaustive")
    )
)]
async fn test_exhaustive_deep_hierarchy_access(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();
    let items = expanded_generic_cursor_soup(
        &pool,
        user_id.copied(),
        50,
        Query::Sort(SimpleSortMethod::UpdatedAt, ()),
    )
    .await?;

    let ids: HashSet<Uuid> = items.iter().map(|i| i.id()).collect();

    // All hierarchy items should be present
    assert!(ids.contains(&uuid(EX_PROJECT_ROOT)), "project-root");
    assert!(ids.contains(&uuid(EX_PROJECT_MID)), "project-mid");
    assert!(ids.contains(&uuid(EX_PROJECT_DEEP)), "project-deep");
    assert!(ids.contains(&uuid(EX_DOC_ROOT)), "doc-in-root");
    assert!(ids.contains(&uuid(EX_DOC_MID)), "doc-in-mid");
    assert!(ids.contains(&uuid(EX_DOC_DEEP)), "doc-in-deep (3 levels)");
    assert!(ids.contains(&uuid(EX_CHAT_ROOT)), "chat-in-root");

    // Standalone items with direct access
    assert!(ids.contains(&uuid(EX_DOC_STANDALONE)), "doc-standalone");
    assert!(ids.contains(&uuid(EX_CHAT_STANDALONE)), "chat-standalone");

    // Task documents in root
    assert!(
        ids.contains(&uuid(EX_DOC_TASK_COMPLETED)),
        "doc-task-completed"
    );
    assert!(
        ids.contains(&uuid(EX_DOC_TASK_INCOMPLETE)),
        "doc-task-incomplete"
    );
    assert!(
        ids.contains(&uuid(EX_DOC_TASK_NO_STATUS)),
        "doc-task-no-status"
    );

    // Total should be 12: 3 projects + 7 docs + 2 chats
    assert_eq!(items.len(), 12, "User-1 should see exactly 12 items");

    Ok(())
}

/// Task documents should have correct is_completed values:
/// - Completed task -> Some(Task { is_completed: true })
/// - Incomplete task -> Some(Task { is_completed: false })
/// - Task with no status property -> Some(Task { is_completed: false })
/// - Non-task documents -> sub_type is None
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("expanded_cursor_soup_exhaustive")
    )
)]
async fn test_exhaustive_task_completion_status(pool: Pool<Postgres>) -> anyhow::Result<()> {
    use models_soup::document::SoupDocumentSubType;

    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();
    let items = expanded_generic_cursor_soup(
        &pool,
        user_id.copied(),
        50,
        Query::Sort(SimpleSortMethod::UpdatedAt, ()),
    )
    .await?;

    let items_map: std::collections::HashMap<Uuid, &SoupItem> =
        items.iter().map(|i| (i.id(), i)).collect();

    // Completed task
    let doc = unwrap_enum!(items_map[&uuid(EX_DOC_TASK_COMPLETED)], SoupItem::Document);
    match &doc.sub_type {
        Some(SoupDocumentSubType::Task { is_completed }) => {
            assert!(is_completed, "Completed task should have is_completed=true");
        }
        other => panic!("Expected Task sub_type, got {:?}", other),
    }

    // Incomplete task (status = In Progress)
    let doc = unwrap_enum!(items_map[&uuid(EX_DOC_TASK_INCOMPLETE)], SoupItem::Document);
    match &doc.sub_type {
        Some(SoupDocumentSubType::Task { is_completed }) => {
            assert!(
                !is_completed,
                "Incomplete task should have is_completed=false"
            );
        }
        other => panic!("Expected Task sub_type, got {:?}", other),
    }

    // Task with no status property
    let doc = unwrap_enum!(items_map[&uuid(EX_DOC_TASK_NO_STATUS)], SoupItem::Document);
    match &doc.sub_type {
        Some(SoupDocumentSubType::Task { is_completed }) => {
            assert!(
                !is_completed,
                "Task with no status should have is_completed=false"
            );
        }
        other => panic!("Expected Task sub_type, got {:?}", other),
    }

    // Non-task document
    let doc = unwrap_enum!(items_map[&uuid(EX_DOC_ROOT)], SoupItem::Document);
    assert!(
        doc.sub_type.is_none(),
        "Non-task document should have sub_type=None"
    );

    Ok(())
}

/// Test UpdatedAt sort ordering.
/// Items sorted by updatedAt DESC, tiebreaker by updatedAt DESC.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("expanded_cursor_soup_exhaustive")
    )
)]
async fn test_exhaustive_sort_updated_at(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();
    let items = expanded_generic_cursor_soup(
        &pool,
        user_id.copied(),
        50,
        Query::Sort(SimpleSortMethod::UpdatedAt, ()),
    )
    .await?;

    let ids: Vec<Uuid> = items.iter().map(|i| i.id()).collect();

    // updatedAt DESC:
    // chat-standalone    2024-03-11
    // doc-in-deep        2024-03-10
    // project-deep       2024-02-12
    // project-mid        2024-02-11
    // project-root       2024-02-10
    // chat-in-root       2024-02-08
    // doc-task-no-status 2024-02-07
    // doc-task-incomplete 2024-02-06
    // doc-task-completed 2024-02-05
    // doc-standalone     2024-02-04
    // doc-in-mid         2024-02-02
    // doc-in-root        2024-02-01
    let expected: Vec<Uuid> = [
        EX_CHAT_STANDALONE,
        EX_DOC_DEEP,
        EX_PROJECT_DEEP,
        EX_PROJECT_MID,
        EX_PROJECT_ROOT,
        EX_CHAT_ROOT,
        EX_DOC_TASK_NO_STATUS,
        EX_DOC_TASK_INCOMPLETE,
        EX_DOC_TASK_COMPLETED,
        EX_DOC_STANDALONE,
        EX_DOC_MID,
        EX_DOC_ROOT,
    ]
    .iter()
    .map(|s| uuid(s))
    .collect();

    assert_eq!(ids, expected, "UpdatedAt sort order is wrong");

    Ok(())
}

/// Test CreatedAt sort ordering.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("expanded_cursor_soup_exhaustive")
    )
)]
async fn test_exhaustive_sort_created_at(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();
    let items = expanded_generic_cursor_soup(
        &pool,
        user_id.copied(),
        50,
        Query::Sort(SimpleSortMethod::CreatedAt, ()),
    )
    .await?;

    let ids: Vec<Uuid> = items.iter().map(|i| i.id()).collect();

    // createdAt DESC:
    // project-deep       2024-01-12
    // project-mid        2024-01-11
    // project-root       2024-01-10
    // chat-standalone    2024-01-09
    // chat-in-root       2024-01-08
    // doc-task-no-status 2024-01-07
    // doc-task-incomplete 2024-01-06
    // doc-task-completed 2024-01-05
    // doc-standalone     2024-01-04
    // doc-in-deep        2024-01-03
    // doc-in-mid         2024-01-02
    // doc-in-root        2024-01-01
    let expected: Vec<Uuid> = [
        EX_PROJECT_DEEP,
        EX_PROJECT_MID,
        EX_PROJECT_ROOT,
        EX_CHAT_STANDALONE,
        EX_CHAT_ROOT,
        EX_DOC_TASK_NO_STATUS,
        EX_DOC_TASK_INCOMPLETE,
        EX_DOC_TASK_COMPLETED,
        EX_DOC_STANDALONE,
        EX_DOC_DEEP,
        EX_DOC_MID,
        EX_DOC_ROOT,
    ]
    .iter()
    .map(|s| uuid(s))
    .collect();

    assert_eq!(ids, expected, "CreatedAt sort order is wrong");

    Ok(())
}

/// Test ViewedAt sort ordering.
/// Items with history sorted by UserHistory.updatedAt DESC.
/// Items without history get sort_ts = epoch, tiebroken by id DESC.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("expanded_cursor_soup_exhaustive")
    )
)]
async fn test_exhaustive_sort_viewed_at(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();
    let items = expanded_generic_cursor_soup(
        &pool,
        user_id.copied(),
        50,
        Query::Sort(SimpleSortMethod::ViewedAt, ()),
    )
    .await?;

    let ids: Vec<Uuid> = items.iter().map(|i| i.id()).collect();

    // With history (by UserHistory.updatedAt DESC):
    //   doc-in-mid         2024-03-08
    //   doc-task-no-status 2024-03-07
    //   doc-standalone     2024-03-06
    //   doc-in-root        2024-03-05
    //   doc-task-completed 2024-03-04
    //   chat-in-root       2024-03-03
    //   project-root       2024-03-02
    //   project-deep       2024-03-01
    // Without history (sort_ts = epoch, tiebroken by id DESC):
    //   chat-standalone     (epoch, id cc000002)
    //   doc-task-incomplete (epoch, id bb000007)
    //   doc-in-deep         (epoch, id bb000003)
    //   project-mid         (epoch, id aa000002)
    let expected: Vec<Uuid> = [
        EX_DOC_MID,
        EX_DOC_TASK_NO_STATUS,
        EX_DOC_STANDALONE,
        EX_DOC_ROOT,
        EX_DOC_TASK_COMPLETED,
        EX_CHAT_ROOT,
        EX_PROJECT_ROOT,
        EX_PROJECT_DEEP,
        EX_CHAT_STANDALONE,
        EX_DOC_TASK_INCOMPLETE,
        EX_DOC_DEEP,
        EX_PROJECT_MID,
    ]
    .iter()
    .map(|s| uuid(s))
    .collect();

    assert_eq!(ids, expected, "ViewedAt sort order is wrong");

    Ok(())
}

/// Test ViewedUpdated sort ordering.
/// Uses COALESCE(uh.updatedAt, item.updatedAt) instead of falling back to epoch.
/// This means items without history use their updatedAt, which produces a
/// different ordering than ViewedAt for items with high updatedAt but no history.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("expanded_cursor_soup_exhaustive")
    )
)]
async fn test_exhaustive_sort_viewed_updated(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();
    let items = expanded_generic_cursor_soup(
        &pool,
        user_id.copied(),
        50,
        Query::Sort(SimpleSortMethod::ViewedUpdated, ()),
    )
    .await?;

    let ids: Vec<Uuid> = items.iter().map(|i| i.id()).collect();

    // COALESCE(uh.updatedAt, item.updatedAt) DESC:
    //   chat-standalone      no history -> updatedAt 2024-03-11
    //   doc-in-deep          no history -> updatedAt 2024-03-10
    //   doc-in-mid           history 2024-03-08
    //   doc-task-no-status   history 2024-03-07
    //   doc-standalone       history 2024-03-06
    //   doc-in-root          history 2024-03-05
    //   doc-task-completed   history 2024-03-04
    //   chat-in-root         history 2024-03-03
    //   project-root         history 2024-03-02
    //   project-deep         history 2024-03-01
    //   project-mid          no history -> updatedAt 2024-02-11
    //   doc-task-incomplete  no history -> updatedAt 2024-02-06
    let expected: Vec<Uuid> = [
        EX_CHAT_STANDALONE,
        EX_DOC_DEEP,
        EX_DOC_MID,
        EX_DOC_TASK_NO_STATUS,
        EX_DOC_STANDALONE,
        EX_DOC_ROOT,
        EX_DOC_TASK_COMPLETED,
        EX_CHAT_ROOT,
        EX_PROJECT_ROOT,
        EX_PROJECT_DEEP,
        EX_PROJECT_MID,
        EX_DOC_TASK_INCOMPLETE,
    ]
    .iter()
    .map(|s| uuid(s))
    .collect();

    assert_eq!(ids, expected, "ViewedUpdated sort order is wrong");

    // Verify viewed_updated produces a DIFFERENT order than viewed_at
    let viewed_at_items = expanded_generic_cursor_soup(
        &pool,
        user_id.copied(),
        50,
        Query::Sort(SimpleSortMethod::ViewedAt, ()),
    )
    .await?;
    let viewed_at_ids: Vec<Uuid> = viewed_at_items.iter().map(|i| i.id()).collect();

    assert_ne!(
        ids, viewed_at_ids,
        "ViewedUpdated and ViewedAt should produce different orderings"
    );

    Ok(())
}

/// Walking through all items one at a time with limit=1 should yield every item
/// exactly once, in the correct order, with no duplicates.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("expanded_cursor_soup_exhaustive")
    )
)]
async fn test_exhaustive_paginate_one_at_a_time(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();
    let sort = SimpleSortMethod::UpdatedAt;

    let mut all_ids: Vec<Uuid> = Vec::new();
    let mut current_query: Query<Uuid, SimpleSortMethod, ()> = Query::Sort(sort, ());

    loop {
        let result = expanded_generic_cursor_soup(&pool, user_id.copied(), 1, current_query)
            .await?
            .into_iter()
            .paginate_on(1, sort)
            .into_page();

        all_ids.extend(result.items.iter().map(|i| i.id()));

        match result.next_cursor {
            Some(cursor) => {
                let decoded = cursor.decode_json().unwrap();
                current_query = Query::new(
                    Some(models_pagination::Cursor {
                        id: decoded.id,
                        limit: decoded.limit,
                        val: decoded.val,
                        filter: decoded.filter,
                    }),
                    sort,
                    (),
                );
            }
            None => break,
        }
    }

    assert_eq!(all_ids.len(), 12, "Should walk through all 12 items");

    let unique: HashSet<Uuid> = all_ids.iter().copied().collect();
    assert_eq!(
        unique.len(),
        12,
        "No duplicates when paginating one at a time"
    );

    // Verify order matches a single large fetch
    let all_at_once =
        expanded_generic_cursor_soup(&pool, user_id.copied(), 50, Query::Sort(sort, ())).await?;
    let expected_ids: Vec<Uuid> = all_at_once.iter().map(|i| i.id()).collect();
    assert_eq!(
        all_ids, expected_ids,
        "Paginated order should match single-fetch order"
    );

    Ok(())
}

/// Full pagination walk with page size of 3. Verifies no duplicates
/// and correct total count across all pages for each sort method.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("expanded_cursor_soup_exhaustive")
    )
)]
async fn test_exhaustive_paginate_all_sort_methods(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();
    let page_size: u16 = 3;

    for sort in [
        SimpleSortMethod::ViewedAt,
        SimpleSortMethod::UpdatedAt,
        SimpleSortMethod::CreatedAt,
        SimpleSortMethod::ViewedUpdated,
    ] {
        let mut all_ids: Vec<Uuid> = Vec::new();
        let mut current_query: Query<Uuid, SimpleSortMethod, ()> = Query::Sort(sort, ());
        let mut page_count = 0;

        loop {
            let result =
                expanded_generic_cursor_soup(&pool, user_id.copied(), page_size, current_query)
                    .await?
                    .into_iter()
                    .paginate_on(page_size as usize, sort)
                    .into_page();

            all_ids.extend(result.items.iter().map(|i| i.id()));
            page_count += 1;

            match result.next_cursor {
                Some(cursor) => {
                    let decoded = cursor.decode_json().unwrap();
                    current_query = Query::new(
                        Some(models_pagination::Cursor {
                            id: decoded.id,
                            limit: decoded.limit,
                            val: decoded.val,
                            filter: decoded.filter,
                        }),
                        sort,
                        (),
                    );
                }
                None => break,
            }
        }

        assert_eq!(
            all_ids.len(),
            12,
            "Sort {:?}: should get all 12 items across pages",
            sort
        );

        let unique: HashSet<Uuid> = all_ids.iter().copied().collect();
        assert_eq!(
            unique.len(),
            12,
            "Sort {:?}: no duplicates across pages",
            sort
        );
    }

    Ok(())
}

/// Limit larger than total items returns everything in one page.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("expanded_cursor_soup_exhaustive")
    )
)]
async fn test_exhaustive_limit_larger_than_total(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();
    let items = expanded_generic_cursor_soup(
        &pool,
        user_id.copied(),
        1000,
        Query::Sort(SimpleSortMethod::UpdatedAt, ()),
    )
    .await?;

    assert_eq!(
        items.len(),
        12,
        "Should return all 12 items with large limit"
    );

    Ok(())
}

/// Standalone items (no project) are correctly returned with project_id = None.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("expanded_cursor_soup_exhaustive")
    )
)]
async fn test_exhaustive_standalone_items_have_no_project(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();
    let items = expanded_generic_cursor_soup(
        &pool,
        user_id.copied(),
        50,
        Query::Sort(SimpleSortMethod::UpdatedAt, ()),
    )
    .await?;

    let items_map: std::collections::HashMap<Uuid, &SoupItem> =
        items.iter().map(|i| (i.id(), i)).collect();

    let doc = unwrap_enum!(items_map[&uuid(EX_DOC_STANDALONE)], SoupItem::Document);
    assert_eq!(
        doc.project_id, None,
        "Standalone doc should have no project"
    );
    assert_eq!(doc.name, "Doc Standalone");

    let chat = unwrap_enum!(items_map[&uuid(EX_CHAT_STANDALONE)], SoupItem::Chat);
    assert_eq!(
        chat.project_id, None,
        "Standalone chat should have no project"
    );
    assert_eq!(chat.name, "Chat Standalone");

    Ok(())
}

/// Documents in projects should carry the correct project_id, and projects
/// in the hierarchy should carry the correct parent_id.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("expanded_cursor_soup_exhaustive")
    )
)]
async fn test_exhaustive_hierarchy_project_ids(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();
    let items = expanded_generic_cursor_soup(
        &pool,
        user_id.copied(),
        50,
        Query::Sort(SimpleSortMethod::UpdatedAt, ()),
    )
    .await?;

    let items_map: std::collections::HashMap<Uuid, &SoupItem> =
        items.iter().map(|i| (i.id(), i)).collect();

    // doc-in-deep should reference project-deep
    let doc = unwrap_enum!(items_map[&uuid(EX_DOC_DEEP)], SoupItem::Document);
    assert_eq!(doc.project_id, Some(uuid(EX_PROJECT_DEEP)));

    // doc-in-mid should reference project-mid
    let doc = unwrap_enum!(items_map[&uuid(EX_DOC_MID)], SoupItem::Document);
    assert_eq!(doc.project_id, Some(uuid(EX_PROJECT_MID)));

    // project-deep should have parent_id = project-mid
    let proj = unwrap_enum!(items_map[&uuid(EX_PROJECT_DEEP)], SoupItem::Project);
    assert_eq!(proj.parent_id, Some(uuid(EX_PROJECT_MID)));

    // project-mid should have parent_id = project-root
    let proj = unwrap_enum!(items_map[&uuid(EX_PROJECT_MID)], SoupItem::Project);
    assert_eq!(proj.parent_id, Some(uuid(EX_PROJECT_ROOT)));

    // project-root should have parent_id = None
    let proj = unwrap_enum!(items_map[&uuid(EX_PROJECT_ROOT)], SoupItem::Project);
    assert_eq!(proj.parent_id, None);

    Ok(())
}

/// Items correctly report their viewed_at from UserHistory.
/// Items without history should have viewed_at = None.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("expanded_cursor_soup_exhaustive")
    )
)]
async fn test_exhaustive_viewed_at_values(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();
    let items = expanded_generic_cursor_soup(
        &pool,
        user_id.copied(),
        50,
        Query::Sort(SimpleSortMethod::UpdatedAt, ()),
    )
    .await?;

    let items_map: std::collections::HashMap<Uuid, &SoupItem> =
        items.iter().map(|i| (i.id(), i)).collect();

    // Items WITH history should have Some(viewed_at)
    let doc = unwrap_enum!(items_map[&uuid(EX_DOC_MID)], SoupItem::Document);
    assert!(
        doc.viewed_at.is_some(),
        "doc-in-mid has history and should have viewed_at"
    );

    let doc = unwrap_enum!(items_map[&uuid(EX_DOC_ROOT)], SoupItem::Document);
    assert!(
        doc.viewed_at.is_some(),
        "doc-in-root has history and should have viewed_at"
    );

    // Items WITHOUT history should have None
    let doc = unwrap_enum!(items_map[&uuid(EX_DOC_DEEP)], SoupItem::Document);
    assert!(
        doc.viewed_at.is_none(),
        "doc-in-deep has no history and should have viewed_at=None"
    );

    let chat = unwrap_enum!(items_map[&uuid(EX_CHAT_STANDALONE)], SoupItem::Chat);
    assert!(
        chat.viewed_at.is_none(),
        "chat-standalone has no history and should have viewed_at=None"
    );

    let proj = unwrap_enum!(items_map[&uuid(EX_PROJECT_MID)], SoupItem::Project);
    assert!(
        proj.viewed_at.is_none(),
        "project-mid has no history and should have viewed_at=None"
    );

    Ok(())
}

/// Documents should carry their file_type and sha from the latest DocumentInstance.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("expanded_cursor_soup_exhaustive")
    )
)]
async fn test_exhaustive_document_fields(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();
    let items = expanded_generic_cursor_soup(
        &pool,
        user_id.copied(),
        50,
        Query::Sort(SimpleSortMethod::UpdatedAt, ()),
    )
    .await?;

    let items_map: std::collections::HashMap<Uuid, &SoupItem> =
        items.iter().map(|i| (i.id(), i)).collect();

    let doc = unwrap_enum!(items_map[&uuid(EX_DOC_ROOT)], SoupItem::Document);
    assert_eq!(doc.file_type.as_deref(), Some("pdf"));
    assert_eq!(doc.sha.as_deref(), Some("sha-root"));
    assert_eq!(doc.name, "Doc In Root");

    let doc = unwrap_enum!(items_map[&uuid(EX_DOC_MID)], SoupItem::Document);
    assert_eq!(doc.file_type.as_deref(), Some("docx"));
    assert_eq!(doc.sha.as_deref(), Some("sha-mid"));

    let doc = unwrap_enum!(items_map[&uuid(EX_DOC_STANDALONE)], SoupItem::Document);
    assert_eq!(doc.file_type.as_deref(), Some("txt"));
    assert_eq!(doc.sha.as_deref(), Some("sha-standalone"));

    Ok(())
}

/// All returned items should have the correct entity type variant.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("expanded_cursor_soup_exhaustive")
    )
)]
async fn test_exhaustive_entity_type_counts(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();
    let items = expanded_generic_cursor_soup(
        &pool,
        user_id.copied(),
        50,
        Query::Sort(SimpleSortMethod::UpdatedAt, ()),
    )
    .await?;

    let mut doc_count = 0;
    let mut chat_count = 0;
    let mut project_count = 0;

    for item in &items {
        match item {
            SoupItem::Document(_) => doc_count += 1,
            SoupItem::Chat(_) => chat_count += 1,
            SoupItem::Project(_) => project_count += 1,
            _ => panic!("Unexpected entity type"),
        }
    }

    assert_eq!(doc_count, 7, "Should have 7 documents");
    assert_eq!(chat_count, 2, "Should have 2 chats");
    assert_eq!(project_count, 3, "Should have 3 projects");

    Ok(())
}

// ============================================================================
// Exhaustive expanded_dynamic_cursor_soup tests
// Uses dynamic_query_exhaustive fixture.
// ============================================================================

// Fixture constants for dynamic_query_exhaustive
const DYN_PROJECT_ROOT: &str = "aa000001-ffff-ffff-ffff-ffffffffffff";
const DYN_PROJECT_MID: &str = "aa000002-ffff-ffff-ffff-ffffffffffff";
const DYN_PROJECT_DEEP: &str = "aa000003-ffff-ffff-ffff-ffffffffffff";
const DYN_PROJECT_ISOLATED: &str = "aa000004-ffff-ffff-ffff-ffffffffffff";
const DYN_DOC_ROOT_PDF: &str = "bb000001-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DYN_DOC_MID_DOCX: &str = "bb000002-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DYN_DOC_DEEP_PDF: &str = "bb000003-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DYN_DOC_STANDALONE_TXT: &str = "bb000004-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DYN_DOC_DELETED: &str = "bb000005-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DYN_DOC_TASK_COMPLETED: &str = "bb000006-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DYN_DOC_TASK_INCOMPLETE: &str = "bb000007-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DYN_DOC_TASK_NO_STATUS: &str = "bb000008-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DYN_DOC_ISOLATED: &str = "bb000009-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DYN_DOC_SHARED_MD: &str = "bb000010-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DYN_CHAT_ROOT: &str = "cc000001-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DYN_CHAT_STANDALONE: &str = "cc000002-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DYN_CHAT_DELETED: &str = "cc000003-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DYN_CHAT_ISOLATED: &str = "cc000004-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DYN_CHAT_SHARED: &str = "cc000005-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

/// Helper to call expanded_dynamic_cursor_soup with common defaults
async fn dyn_fetch(
    db: &PgPool,
    user: &str,
    limit: u16,
    sort: SimpleSortMethod,
    filters: EntityFilterAst,
    exclude_frecency: bool,
) -> Result<Vec<SoupItem>, sqlx::Error> {
    let user_id = MacroUserIdStr::parse_from_str(user).unwrap();
    expanded_dynamic_cursor_soup(
        db,
        ExpandedDynamicCursorArgs {
            user_id: user_id.copied(),
            limit,
            cursor: Query::Sort(sort, filters),
            exclude_frecency,
        },
    )
    .await
}

// ---- Sort methods (4 tests) ----

/// 1. Verify UpdatedAt sort order through the dynamic query.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("dynamic_query_exhaustive")
    )
)]
async fn test_dyn_sort_updated_at(db: PgPool) -> anyhow::Result<()> {
    let items = dyn_fetch(
        &db,
        "macro|user-1@test.com",
        50,
        SimpleSortMethod::UpdatedAt,
        EntityFilterAst::mock_empty(),
        false,
    )
    .await?;

    let ids: Vec<Uuid> = items.iter().map(|i| i.id()).collect();

    // updatedAt DESC:
    // chat-standalone    2024-03-11
    // doc-deep-pdf       2024-03-10
    // chat-shared        2024-02-18
    // project-deep       2024-02-12
    // project-mid        2024-02-11
    // project-root       2024-02-10
    // chat-root          2024-02-09
    // doc-shared-md      2024-02-08
    // doc-task-no-status 2024-02-07
    // doc-task-incomplete 2024-02-06
    // doc-task-completed 2024-02-05
    // doc-standalone-txt 2024-02-04
    // doc-mid-docx       2024-02-02
    // doc-root-pdf       2024-02-01
    let expected: Vec<Uuid> = [
        DYN_CHAT_STANDALONE,
        DYN_DOC_DEEP_PDF,
        DYN_CHAT_SHARED,
        DYN_PROJECT_DEEP,
        DYN_PROJECT_MID,
        DYN_PROJECT_ROOT,
        DYN_CHAT_ROOT,
        DYN_DOC_SHARED_MD,
        DYN_DOC_TASK_NO_STATUS,
        DYN_DOC_TASK_INCOMPLETE,
        DYN_DOC_TASK_COMPLETED,
        DYN_DOC_STANDALONE_TXT,
        DYN_DOC_MID_DOCX,
        DYN_DOC_ROOT_PDF,
    ]
    .iter()
    .map(|s| uuid(s))
    .collect();

    assert_eq!(ids, expected, "UpdatedAt sort order is wrong");
    Ok(())
}

/// 2. Verify CreatedAt sort order through the dynamic query.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("dynamic_query_exhaustive")
    )
)]
async fn test_dyn_sort_created_at(db: PgPool) -> anyhow::Result<()> {
    let items = dyn_fetch(
        &db,
        "macro|user-1@test.com",
        50,
        SimpleSortMethod::CreatedAt,
        EntityFilterAst::mock_empty(),
        false,
    )
    .await?;

    let ids: Vec<Uuid> = items.iter().map(|i| i.id()).collect();

    // createdAt DESC:
    // chat-shared        2024-01-18
    // project-deep       2024-01-12
    // project-mid        2024-01-11
    // project-root       2024-01-10
    // chat-standalone    2024-01-09
    // chat-root          2024-01-08 (id cc000001 > bb000010)
    // doc-shared-md      2024-01-08
    // doc-task-no-status 2024-01-07
    // doc-task-incomplete 2024-01-06
    // doc-task-completed 2024-01-05
    // doc-standalone-txt 2024-01-04
    // doc-deep-pdf       2024-01-03
    // doc-mid-docx       2024-01-02
    // doc-root-pdf       2024-01-01
    let expected: Vec<Uuid> = [
        DYN_CHAT_SHARED,
        DYN_PROJECT_DEEP,
        DYN_PROJECT_MID,
        DYN_PROJECT_ROOT,
        DYN_CHAT_STANDALONE,
        DYN_CHAT_ROOT,
        DYN_DOC_SHARED_MD,
        DYN_DOC_TASK_NO_STATUS,
        DYN_DOC_TASK_INCOMPLETE,
        DYN_DOC_TASK_COMPLETED,
        DYN_DOC_STANDALONE_TXT,
        DYN_DOC_DEEP_PDF,
        DYN_DOC_MID_DOCX,
        DYN_DOC_ROOT_PDF,
    ]
    .iter()
    .map(|s| uuid(s))
    .collect();

    assert_eq!(ids, expected, "CreatedAt sort order is wrong");
    Ok(())
}

/// 3. Verify ViewedAt sort order through the dynamic query.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("dynamic_query_exhaustive")
    )
)]
async fn test_dyn_sort_viewed_at(db: PgPool) -> anyhow::Result<()> {
    let items = dyn_fetch(
        &db,
        "macro|user-1@test.com",
        50,
        SimpleSortMethod::ViewedAt,
        EntityFilterAst::mock_empty(),
        false,
    )
    .await?;

    let ids: Vec<Uuid> = items.iter().map(|i| i.id()).collect();

    // With history (UserHistory.updatedAt DESC):
    //   doc-mid-docx         2024-03-08
    //   doc-task-no-status   2024-03-07
    //   doc-standalone-txt   2024-03-06
    //   doc-root-pdf         2024-03-05
    //   doc-task-completed   2024-03-04
    //   chat-root            2024-03-03
    //   project-root         2024-03-02
    //   project-deep         2024-03-01
    // Without history (epoch, tie by id DESC):
    //   cc000005 chat-shared
    //   cc000002 chat-standalone
    //   bb000010 doc-shared-md
    //   bb000007 doc-task-incomplete
    //   bb000003 doc-deep-pdf
    //   aa000002 project-mid
    let expected: Vec<Uuid> = [
        DYN_DOC_MID_DOCX,
        DYN_DOC_TASK_NO_STATUS,
        DYN_DOC_STANDALONE_TXT,
        DYN_DOC_ROOT_PDF,
        DYN_DOC_TASK_COMPLETED,
        DYN_CHAT_ROOT,
        DYN_PROJECT_ROOT,
        DYN_PROJECT_DEEP,
        DYN_CHAT_SHARED,
        DYN_CHAT_STANDALONE,
        DYN_DOC_SHARED_MD,
        DYN_DOC_TASK_INCOMPLETE,
        DYN_DOC_DEEP_PDF,
        DYN_PROJECT_MID,
    ]
    .iter()
    .map(|s| uuid(s))
    .collect();

    assert_eq!(ids, expected, "ViewedAt sort order is wrong");
    Ok(())
}

/// 4. Verify ViewedUpdated sort order through the dynamic query.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("dynamic_query_exhaustive")
    )
)]
async fn test_dyn_sort_viewed_updated(db: PgPool) -> anyhow::Result<()> {
    let items = dyn_fetch(
        &db,
        "macro|user-1@test.com",
        50,
        SimpleSortMethod::ViewedUpdated,
        EntityFilterAst::mock_empty(),
        false,
    )
    .await?;

    let ids: Vec<Uuid> = items.iter().map(|i| i.id()).collect();

    // COALESCE(uh.updatedAt, item.updatedAt) DESC:
    //   chat-standalone      no history -> updatedAt 2024-03-11
    //   doc-deep-pdf         no history -> updatedAt 2024-03-10
    //   doc-mid-docx         history 2024-03-08
    //   doc-task-no-status   history 2024-03-07
    //   doc-standalone-txt   history 2024-03-06
    //   doc-root-pdf         history 2024-03-05
    //   doc-task-completed   history 2024-03-04
    //   chat-root            history 2024-03-03
    //   project-root         history 2024-03-02
    //   project-deep         history 2024-03-01
    //   chat-shared          no history -> updatedAt 2024-02-18
    //   project-mid          no history -> updatedAt 2024-02-11
    //   doc-shared-md        no history -> updatedAt 2024-02-08
    //   doc-task-incomplete  no history -> updatedAt 2024-02-06
    let expected: Vec<Uuid> = [
        DYN_CHAT_STANDALONE,
        DYN_DOC_DEEP_PDF,
        DYN_DOC_MID_DOCX,
        DYN_DOC_TASK_NO_STATUS,
        DYN_DOC_STANDALONE_TXT,
        DYN_DOC_ROOT_PDF,
        DYN_DOC_TASK_COMPLETED,
        DYN_CHAT_ROOT,
        DYN_PROJECT_ROOT,
        DYN_PROJECT_DEEP,
        DYN_CHAT_SHARED,
        DYN_PROJECT_MID,
        DYN_DOC_SHARED_MD,
        DYN_DOC_TASK_INCOMPLETE,
    ]
    .iter()
    .map(|s| uuid(s))
    .collect();

    assert_eq!(ids, expected, "ViewedUpdated sort order is wrong");
    Ok(())
}

// ---- Access control & deleted items (3 tests) ----

/// 5. Deleted doc and chat never appear in dynamic query results.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("dynamic_query_exhaustive")
    )
)]
async fn test_dyn_deleted_items_excluded(db: PgPool) -> anyhow::Result<()> {
    let items = dyn_fetch(
        &db,
        "macro|user-1@test.com",
        50,
        SimpleSortMethod::UpdatedAt,
        EntityFilterAst::mock_empty(),
        false,
    )
    .await?;

    let ids: HashSet<Uuid> = items.iter().map(|i| i.id()).collect();

    assert!(
        !ids.contains(&uuid(DYN_DOC_DELETED)),
        "Deleted document must not appear"
    );
    assert!(
        !ids.contains(&uuid(DYN_CHAT_DELETED)),
        "Deleted chat must not appear"
    );

    Ok(())
}

/// 6. Isolated project/doc/chat excluded for user-1 in dynamic query.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("dynamic_query_exhaustive")
    )
)]
async fn test_dyn_access_control_excludes_isolated(db: PgPool) -> anyhow::Result<()> {
    let items = dyn_fetch(
        &db,
        "macro|user-1@test.com",
        50,
        SimpleSortMethod::UpdatedAt,
        EntityFilterAst::mock_empty(),
        false,
    )
    .await?;

    let ids: HashSet<Uuid> = items.iter().map(|i| i.id()).collect();

    assert!(
        !ids.contains(&uuid(DYN_PROJECT_ISOLATED)),
        "Isolated project must not appear for user-1"
    );
    assert!(
        !ids.contains(&uuid(DYN_DOC_ISOLATED)),
        "Isolated doc must not appear for user-1"
    );
    assert!(
        !ids.contains(&uuid(DYN_CHAT_ISOLATED)),
        "Isolated chat must not appear for user-1"
    );

    Ok(())
}

/// 7. User-2 only sees isolated items through the dynamic query.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("dynamic_query_exhaustive")
    )
)]
async fn test_dyn_user_isolation(db: PgPool) -> anyhow::Result<()> {
    let items = dyn_fetch(
        &db,
        "macro|user-2@test.com",
        50,
        SimpleSortMethod::UpdatedAt,
        EntityFilterAst::mock_empty(),
        false,
    )
    .await?;

    let ids: HashSet<Uuid> = items.iter().map(|i| i.id()).collect();

    let expected: HashSet<Uuid> = [DYN_PROJECT_ISOLATED, DYN_DOC_ISOLATED, DYN_CHAT_ISOLATED]
        .iter()
        .map(|s| uuid(s))
        .collect();

    assert_eq!(
        ids, expected,
        "User-2 should only see isolated project, its doc, and its chat"
    );

    Ok(())
}

// ---- Filter types (3 tests) ----

/// 8. Filter documents by owner (user-2) returns only doc-shared-md.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("dynamic_query_exhaustive")
    )
)]
async fn test_dyn_filter_doc_by_owner(db: PgPool) -> anyhow::Result<()> {
    use item_filters::{DocumentFilters, EntityFilters};

    let entity_filters = EntityFilters {
        document_filters: DocumentFilters {
            owners: vec!["macro|user-2@test.com".to_string()],
            ..Default::default()
        },
        ..Default::default()
    };

    let filters = EntityFilterAst::new_from_filters(entity_filters)?.unwrap();

    let items = dyn_fetch(
        &db,
        "macro|user-1@test.com",
        50,
        SimpleSortMethod::UpdatedAt,
        filters,
        false,
    )
    .await?;

    let doc_ids: Vec<Uuid> = items
        .iter()
        .filter_map(|i| match i {
            SoupItem::Document(d) => Some(d.id),
            _ => None,
        })
        .collect();

    // Only doc-shared-md is owned by user-2 and accessible to user-1
    assert_eq!(doc_ids.len(), 1, "Should get exactly 1 document");
    assert_eq!(doc_ids[0], uuid(DYN_DOC_SHARED_MD));

    // Chats and projects should still be present (unfiltered)
    let chat_count = items
        .iter()
        .filter(|i| matches!(i, SoupItem::Chat(_)))
        .count();
    let project_count = items
        .iter()
        .filter(|i| matches!(i, SoupItem::Project(_)))
        .count();
    assert_eq!(chat_count, 3, "Should get all 3 chats");
    assert_eq!(project_count, 3, "Should get all 3 projects");

    Ok(())
}

/// 9. Filter documents by project ID returns only docs in that project.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("dynamic_query_exhaustive")
    )
)]
async fn test_dyn_filter_doc_by_project(db: PgPool) -> anyhow::Result<()> {
    use item_filters::{DocumentFilters, EntityFilters};

    // Filter for documents in project-deep only
    let entity_filters = EntityFilters {
        document_filters: DocumentFilters {
            project_ids: vec![DYN_PROJECT_DEEP.to_string()],
            ..Default::default()
        },
        ..Default::default()
    };

    let filters = EntityFilterAst::new_from_filters(entity_filters)?.unwrap();

    let items = dyn_fetch(
        &db,
        "macro|user-1@test.com",
        50,
        SimpleSortMethod::UpdatedAt,
        filters,
        false,
    )
    .await?;

    let doc_ids: Vec<Uuid> = items
        .iter()
        .filter_map(|i| match i {
            SoupItem::Document(d) => Some(d.id),
            _ => None,
        })
        .collect();

    assert_eq!(doc_ids.len(), 1, "Should get exactly 1 document in deep");
    assert_eq!(doc_ids[0], uuid(DYN_DOC_DEEP_PDF));

    Ok(())
}

/// 10. Filter documents by multiple file types (pdf + docx).
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("dynamic_query_exhaustive")
    )
)]
async fn test_dyn_filter_multiple_file_types(db: PgPool) -> anyhow::Result<()> {
    use item_filters::{DocumentFilters, EntityFilters};

    let entity_filters = EntityFilters {
        document_filters: DocumentFilters {
            file_types: vec!["pdf".to_string(), "docx".to_string()],
            ..Default::default()
        },
        ..Default::default()
    };

    let filters = EntityFilterAst::new_from_filters(entity_filters)?.unwrap();

    let items = dyn_fetch(
        &db,
        "macro|user-1@test.com",
        50,
        SimpleSortMethod::UpdatedAt,
        filters,
        false,
    )
    .await?;

    let doc_ids: HashSet<Uuid> = items
        .iter()
        .filter_map(|i| match i {
            SoupItem::Document(d) => Some(d.id),
            _ => None,
        })
        .collect();

    // Accessible pdf docs: doc-root-pdf, doc-deep-pdf
    // Accessible docx docs: doc-mid-docx
    let expected_docs: HashSet<Uuid> = [DYN_DOC_ROOT_PDF, DYN_DOC_MID_DOCX, DYN_DOC_DEEP_PDF]
        .iter()
        .map(|s| uuid(s))
        .collect();

    assert_eq!(
        doc_ids, expected_docs,
        "Should get exactly the pdf and docx documents"
    );

    Ok(())
}

// ---- Task completion & document fields (2 tests) ----

/// 11. Task documents should have correct is_completed values.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("dynamic_query_exhaustive")
    )
)]
async fn test_dyn_task_completion_status(db: PgPool) -> anyhow::Result<()> {
    use models_soup::document::SoupDocumentSubType;

    let items = dyn_fetch(
        &db,
        "macro|user-1@test.com",
        50,
        SimpleSortMethod::UpdatedAt,
        EntityFilterAst::mock_empty(),
        false,
    )
    .await?;

    let items_map: std::collections::HashMap<Uuid, &SoupItem> =
        items.iter().map(|i| (i.id(), i)).collect();

    // Completed task
    let doc = unwrap_enum!(items_map[&uuid(DYN_DOC_TASK_COMPLETED)], SoupItem::Document);
    match &doc.sub_type {
        Some(SoupDocumentSubType::Task { is_completed }) => {
            assert!(is_completed, "Completed task should have is_completed=true");
        }
        other => panic!("Expected Task sub_type, got {:?}", other),
    }

    // Incomplete task (status = In Progress)
    let doc = unwrap_enum!(
        items_map[&uuid(DYN_DOC_TASK_INCOMPLETE)],
        SoupItem::Document
    );
    match &doc.sub_type {
        Some(SoupDocumentSubType::Task { is_completed }) => {
            assert!(
                !is_completed,
                "Incomplete task should have is_completed=false"
            );
        }
        other => panic!("Expected Task sub_type, got {:?}", other),
    }

    // Task with no status property
    let doc = unwrap_enum!(items_map[&uuid(DYN_DOC_TASK_NO_STATUS)], SoupItem::Document);
    match &doc.sub_type {
        Some(SoupDocumentSubType::Task { is_completed }) => {
            assert!(
                !is_completed,
                "Task with no status should have is_completed=false"
            );
        }
        other => panic!("Expected Task sub_type, got {:?}", other),
    }

    // Non-task document
    let doc = unwrap_enum!(items_map[&uuid(DYN_DOC_ROOT_PDF)], SoupItem::Document);
    assert!(
        doc.sub_type.is_none(),
        "Non-task document should have sub_type=None"
    );

    Ok(())
}

/// 12. Document fields (sha, file_type, viewed_at, project_id) populated correctly.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("dynamic_query_exhaustive")
    )
)]
async fn test_dyn_document_fields(db: PgPool) -> anyhow::Result<()> {
    let items = dyn_fetch(
        &db,
        "macro|user-1@test.com",
        50,
        SimpleSortMethod::UpdatedAt,
        EntityFilterAst::mock_empty(),
        false,
    )
    .await?;

    let items_map: std::collections::HashMap<Uuid, &SoupItem> =
        items.iter().map(|i| (i.id(), i)).collect();

    // doc-root-pdf: pdf, sha-root-pdf, has history, in project-root
    let doc = unwrap_enum!(items_map[&uuid(DYN_DOC_ROOT_PDF)], SoupItem::Document);
    assert_eq!(doc.file_type.as_deref(), Some("pdf"));
    assert_eq!(doc.sha.as_deref(), Some("sha-root-pdf"));
    assert!(doc.viewed_at.is_some(), "doc-root-pdf has history");
    assert_eq!(doc.project_id, Some(uuid(DYN_PROJECT_ROOT)));

    // doc-mid-docx: docx, sha-mid-docx, has history, in project-mid
    let doc = unwrap_enum!(items_map[&uuid(DYN_DOC_MID_DOCX)], SoupItem::Document);
    assert_eq!(doc.file_type.as_deref(), Some("docx"));
    assert_eq!(doc.sha.as_deref(), Some("sha-mid-docx"));
    assert!(doc.viewed_at.is_some(), "doc-mid-docx has history");
    assert_eq!(doc.project_id, Some(uuid(DYN_PROJECT_MID)));

    // doc-standalone-txt: txt, sha-standalone-txt, has history, no project
    let doc = unwrap_enum!(items_map[&uuid(DYN_DOC_STANDALONE_TXT)], SoupItem::Document);
    assert_eq!(doc.file_type.as_deref(), Some("txt"));
    assert_eq!(doc.sha.as_deref(), Some("sha-standalone-txt"));
    assert!(doc.viewed_at.is_some(), "doc-standalone-txt has history");
    assert_eq!(doc.project_id, None);

    // doc-deep-pdf: pdf, no history
    let doc = unwrap_enum!(items_map[&uuid(DYN_DOC_DEEP_PDF)], SoupItem::Document);
    assert_eq!(doc.file_type.as_deref(), Some("pdf"));
    assert!(doc.viewed_at.is_none(), "doc-deep-pdf has no history");
    assert_eq!(doc.project_id, Some(uuid(DYN_PROJECT_DEEP)));

    // doc-shared-md: md, owned by user-2
    let doc = unwrap_enum!(items_map[&uuid(DYN_DOC_SHARED_MD)], SoupItem::Document);
    assert_eq!(doc.file_type.as_deref(), Some("md"));
    assert_eq!(doc.sha.as_deref(), Some("sha-shared-md"));
    assert_eq!(doc.project_id, Some(uuid(DYN_PROJECT_ROOT)));

    Ok(())
}

// ---- Pagination (2 tests) ----

/// 13. Walk all items limit=1, verify no dupes, matches bulk fetch order.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("dynamic_query_exhaustive")
    )
)]
async fn test_dyn_paginate_one_at_a_time(db: PgPool) -> anyhow::Result<()> {
    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();
    let sort = SimpleSortMethod::UpdatedAt;
    let filters = EntityFilterAst::mock_empty();

    let mut all_ids: Vec<Uuid> = Vec::new();
    let mut current_query: Query<Uuid, SimpleSortMethod, EntityFilterAst> =
        Query::Sort(sort, filters.clone());

    loop {
        let result = expanded_dynamic_cursor_soup(
            &db,
            ExpandedDynamicCursorArgs {
                user_id: user_id.copied(),
                limit: 1,
                cursor: current_query,
                exclude_frecency: false,
            },
        )
        .await?
        .into_iter()
        .paginate_on(1, sort)
        .filter_on(filters.clone())
        .into_page();

        all_ids.extend(result.items.iter().map(|i| i.id()));

        match result.next_cursor {
            Some(cursor) => {
                let decoded = cursor.decode_json().unwrap();
                current_query = Query::Cursor(models_pagination::Cursor {
                    id: decoded.id,
                    limit: decoded.limit,
                    val: decoded.val,
                    filter: decoded.filter,
                });
            }
            None => break,
        }
    }

    assert_eq!(all_ids.len(), 14, "Should walk through all 14 items");

    let unique: HashSet<Uuid> = all_ids.iter().copied().collect();
    assert_eq!(
        unique.len(),
        14,
        "No duplicates when paginating one at a time"
    );

    // Verify order matches a single large fetch
    let all_at_once = dyn_fetch(
        &db,
        "macro|user-1@test.com",
        50,
        sort,
        EntityFilterAst::mock_empty(),
        false,
    )
    .await?;
    let expected_ids: Vec<Uuid> = all_at_once.iter().map(|i| i.id()).collect();
    assert_eq!(
        all_ids, expected_ids,
        "Paginated order should match single-fetch order"
    );

    Ok(())
}

/// 14. Paginate through filtered results, verify filter consistency and no dupes.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("dynamic_query_exhaustive")
    )
)]
async fn test_dyn_paginate_with_filters(db: PgPool) -> anyhow::Result<()> {
    use item_filters::{DocumentFilters, EntityFilters};

    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();
    let sort = SimpleSortMethod::CreatedAt;
    let page_size: u16 = 3;

    let entity_filters = EntityFilters {
        document_filters: DocumentFilters {
            file_types: vec!["pdf".to_string()],
            ..Default::default()
        },
        ..Default::default()
    };

    let make_filters = || {
        EntityFilterAst::new_from_filters(entity_filters.clone())
            .unwrap()
            .unwrap()
    };

    let mut all_items: Vec<SoupItem> = Vec::new();
    let mut current_query: Query<Uuid, SimpleSortMethod, EntityFilterAst> =
        Query::Sort(sort, make_filters());

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
        .paginate_on(page_size as usize, sort)
        .filter_on(make_filters())
        .into_page();

        all_items.extend(result.items);

        match result.next_cursor {
            Some(cursor) => {
                let decoded = cursor.decode_json()?;
                current_query = Query::Cursor(models_pagination::Cursor {
                    id: decoded.id,
                    limit: decoded.limit,
                    val: decoded.val,
                    filter: decoded.filter,
                });
            }
            None => break,
        }
    }

    // Verify all documents are PDFs (filter consistency)
    for item in &all_items {
        if let SoupItem::Document(doc) = item {
            assert_eq!(
                doc.file_type.as_deref(),
                Some("pdf"),
                "All documents should be PDFs"
            );
        }
    }

    // Verify no duplicates
    let all_ids: Vec<Uuid> = all_items.iter().map(|i| i.id()).collect();
    let unique: HashSet<Uuid> = all_ids.iter().copied().collect();
    assert_eq!(
        all_ids.len(),
        unique.len(),
        "Should have no duplicate items across pages"
    );

    // Should get 2 pdf docs + 3 chats + 3 projects = 8 total
    let doc_count = all_items
        .iter()
        .filter(|i| matches!(i, SoupItem::Document(_)))
        .count();
    assert_eq!(doc_count, 2, "Should get exactly 2 PDF documents");

    Ok(())
}

// ---- Frecency (2 tests) ----

/// 15. exclude_frecency=true removes items with frecency records.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("dynamic_query_exhaustive")
    )
)]
async fn test_dyn_exclude_frecency(db: PgPool) -> anyhow::Result<()> {
    let items = dyn_fetch(
        &db,
        "macro|user-1@test.com",
        50,
        SimpleSortMethod::UpdatedAt,
        EntityFilterAst::mock_empty(),
        true, // exclude_frecency
    )
    .await?;

    let ids: HashSet<Uuid> = items.iter().map(|i| i.id()).collect();

    // doc-root-pdf and chat-root have frecency records and should be excluded
    assert!(
        !ids.contains(&uuid(DYN_DOC_ROOT_PDF)),
        "doc-root-pdf should be excluded (has frecency)"
    );
    assert!(
        !ids.contains(&uuid(DYN_CHAT_ROOT)),
        "chat-root should be excluded (has frecency)"
    );

    // All other accessible items should still be present (14 - 2 = 12)
    assert_eq!(
        items.len(),
        12,
        "Should get 12 items after frecency exclusion"
    );

    // Verify a non-frecency item is still present
    assert!(
        ids.contains(&uuid(DYN_DOC_MID_DOCX)),
        "doc-mid-docx should still be present"
    );

    Ok(())
}

/// 16. exclude_frecency works with all 4 sort methods.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("dynamic_query_exhaustive")
    )
)]
async fn test_dyn_exclude_frecency_all_sort_methods(db: PgPool) -> anyhow::Result<()> {
    let frecency_ids: HashSet<Uuid> = [DYN_DOC_ROOT_PDF, DYN_CHAT_ROOT]
        .iter()
        .map(|s| uuid(s))
        .collect();

    for sort in [
        SimpleSortMethod::UpdatedAt,
        SimpleSortMethod::CreatedAt,
        SimpleSortMethod::ViewedAt,
        SimpleSortMethod::ViewedUpdated,
    ] {
        let items = dyn_fetch(
            &db,
            "macro|user-1@test.com",
            50,
            sort,
            EntityFilterAst::mock_empty(),
            true,
        )
        .await?;

        let ids: HashSet<Uuid> = items.iter().map(|i| i.id()).collect();

        for fid in &frecency_ids {
            assert!(
                !ids.contains(fid),
                "Sort {:?}: item {} should be excluded by frecency filter",
                sort,
                fid
            );
        }

        assert_eq!(
            items.len(),
            12,
            "Sort {:?}: should get 12 items after frecency exclusion",
            sort
        );
    }

    Ok(())
}

// ---- Edge cases (1 test) ----

/// 17. All 3 entity types filtered to nothing returns empty vec.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("dynamic_query_exhaustive")
    )
)]
async fn test_dyn_all_types_filtered_to_empty(db: PgPool) -> anyhow::Result<()> {
    use item_filters::{ChatFilters, DocumentFilters, EntityFilters, ProjectFilters};

    let entity_filters = EntityFilters {
        document_filters: DocumentFilters {
            document_ids: vec!["00000000-0000-0000-0000-000000000000".to_string()],
            ..Default::default()
        },
        chat_filters: ChatFilters {
            chat_ids: vec!["00000000-0000-0000-0000-000000000000".to_string()],
            ..Default::default()
        },
        project_filters: ProjectFilters {
            project_ids: vec!["00000000-0000-0000-0000-000000000000".to_string()],
            ..Default::default()
        },
        ..Default::default()
    };

    let filters = EntityFilterAst::new_from_filters(entity_filters)?.unwrap();

    let items = dyn_fetch(
        &db,
        "macro|user-1@test.com",
        50,
        SimpleSortMethod::UpdatedAt,
        filters,
        false,
    )
    .await?;

    assert!(
        items.is_empty(),
        "All types filtered to nothing should return empty"
    );

    Ok(())
}
