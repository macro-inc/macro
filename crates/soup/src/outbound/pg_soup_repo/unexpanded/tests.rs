use crate::outbound::pg_soup_repo::unexpanded::{
    by_cursor::unexpanded_generic_cursor_soup, by_ids::unexpanded_soup_by_ids,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model_entity::EntityType;
use models_pagination::Identify;
use models_pagination::{PaginateOn, Query, SimpleSortMethod};
use models_soup::item::SoupItem;
use sqlx::{Pool, Postgres};
use std::collections::HashMap;
use uuid::Uuid;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("team_share"))
)]
async fn canonical_team_share_visibility_unexpanded(pool: Pool<Postgres>) {
    use models_permissions::share_permission::{
        access_level::AccessLevel,
        team_share::{TeamShareLevel, TeamShareRequest, authorize_team_share},
    };
    use share_permission_db_utils::team_share;
    use std::collections::HashSet;

    let owner = MacroUserIdStr::parse_from_str("macro|owner@soup.test").unwrap();
    let viewer = MacroUserIdStr::parse_from_str("macro|viewer@soup.test").unwrap();
    let other = MacroUserIdStr::parse_from_str("macro|other@soup.test").unwrap();
    let entities: Vec<_> = [
        (EntityType::Project, 1),
        (EntityType::Document, 2),
        (EntityType::Chat, 3),
        (EntityType::Document, 4),
        (EntityType::Document, 5),
    ]
    .into_iter()
    .map(|(kind, id)| kind.with_entity_string(format!("20000000-0000-0000-0000-{id:012}")))
    .collect();
    let all_ids: HashSet<_> = entities
        .iter()
        .map(|e| Uuid::parse_str(&e.entity_id).unwrap())
        .collect();
    let mut visible = HashSet::new();
    for level in [
        Some(AccessLevel::View),
        Some(AccessLevel::Comment),
        Some(AccessLevel::Edit),
        None,
    ] {
        for entity in &entities {
            assert_team_share_unexpanded_ids(&pool, viewer.copied(), &entities, &visible).await;
            let mut tx = pool.begin().await.unwrap();
            let facts = team_share::load_facts(&mut tx, entity).await.unwrap();
            let command = authorize_team_share(
                Some(&owner),
                &facts,
                TeamShareRequest {
                    access_level: Some(level),
                    legacy_enabled: None,
                },
                TeamShareLevel::View,
            )
            .unwrap()
            .unwrap();
            team_share::apply(&mut tx, &command).await.unwrap();
            tx.commit().await.unwrap();
            let id = Uuid::parse_str(&entity.entity_id).unwrap();
            if level.is_some() {
                visible.insert(id);
            } else {
                visible.remove(&id);
            }
            assert_team_share_unexpanded_ids(&pool, viewer.copied(), &entities, &visible).await;
            assert_team_share_unexpanded_ids(&pool, owner.copied(), &entities, &all_ids).await;
            assert_team_share_unexpanded_ids(&pool, other.copied(), &entities, &HashSet::new())
                .await;
        }
    }
    // Visibility from inherited canonical project grants is also denormalized
    // into entity_access; "unexpanded" must not discard those rows.
    sqlx::query!(r#"UPDATE "Document" SET "projectId" = '20000000-0000-0000-0000-000000000001'"#)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query!(r#"UPDATE "Chat" SET "projectId" = '20000000-0000-0000-0000-000000000001'"#)
        .execute(&pool)
        .await
        .unwrap();
    let mut tx = pool.begin().await.unwrap();
    let facts = team_share::load_facts(&mut tx, &entities[0]).await.unwrap();
    let command = authorize_team_share(
        Some(&owner),
        &facts,
        TeamShareRequest {
            access_level: Some(Some(AccessLevel::View)),
            legacy_enabled: None,
        },
        TeamShareLevel::View,
    )
    .unwrap()
    .unwrap();
    team_share::apply(&mut tx, &command).await.unwrap();
    tx.commit().await.unwrap();
    assert_team_share_unexpanded_ids(&pool, viewer.copied(), &entities, &all_ids).await;
    sqlx::query!("INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level) VALUES ('20000000-0000-0000-0000-000000000002', 'document', 'macro|viewer@soup.test', 'user', 'view')").execute(&pool).await.unwrap();
    sqlx::query!("DELETE FROM team_user WHERE user_id = 'macro|viewer@soup.test'")
        .execute(&pool)
        .await
        .unwrap();
    let retained = HashSet::from([Uuid::parse_str(&entities[1].entity_id).unwrap()]);
    assert_team_share_unexpanded_ids(&pool, viewer.copied(), &entities, &retained).await;
    assert_team_share_unexpanded_ids(&pool, owner, &entities, &all_ids).await;
    sqlx::query!("DELETE FROM entity_access WHERE source_id = 'macro|viewer@soup.test'")
        .execute(&pool)
        .await
        .unwrap();
    assert_team_share_unexpanded_ids(&pool, viewer, &entities, &HashSet::new()).await;
}

async fn assert_team_share_unexpanded_ids(
    pool: &Pool<Postgres>,
    user: MacroUserIdStr<'_>,
    entities: &[model_entity::Entity<'_>],
    expected: &std::collections::HashSet<Uuid>,
) {
    let cursor_items = unexpanded_generic_cursor_soup(
        pool,
        user.copied(),
        100,
        Query::Sort(SimpleSortMethod::UpdatedAt, ()),
    )
    .await
    .unwrap();
    let by_id_items = unexpanded_soup_by_ids(pool, user, entities).await.unwrap();
    for items in [cursor_items, by_id_items] {
        let ids: std::collections::HashSet<_> = items.iter().map(|item| item.id()).collect();
        assert_eq!(&ids, expected);
        assert_eq!(
            items.len(),
            ids.len(),
            "multiple access paths must not duplicate items"
        );
    }
}

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

// Test that unexpanded_soup_by_ids only includes explicit access
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

// Test that is_completed field is correctly set based on task status
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("tasks_with_is_completed")
    )
)]
async fn test_is_completed_field(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserIdStr::parse_from_str("macro|user@user.com").unwrap();

    let result = unexpanded_generic_cursor_soup(
        &pool,
        user_id,
        10,
        Query::Sort(SimpleSortMethod::UpdatedAt, ()),
    )
    .await?;

    assert_eq!(result.len(), 4, "Should return 4 documents");

    // Create a map of document IDs to their is_completed values
    let mut is_completed_map: HashMap<Uuid, Option<bool>> = HashMap::new();

    for item in &result {
        if let SoupItem::Document(doc) = item {
            is_completed_map.insert(
                doc.id,
                doc.sub_type.as_ref().and_then(|st| st.is_task_completed()),
            );
        }
    }

    // Verify is_completed values
    let completed_task_id = Uuid::parse_str("11111111-1111-1111-1111-111111111111").unwrap();
    let incomplete_task_id = Uuid::parse_str("22222222-2222-2222-2222-222222222222").unwrap();
    let task_no_status_id = Uuid::parse_str("33333333-3333-3333-3333-333333333333").unwrap();
    let regular_doc_id = Uuid::parse_str("44444444-4444-4444-4444-444444444444").unwrap();

    assert_eq!(
        is_completed_map.get(&completed_task_id),
        Some(&Some(true)),
        "Completed task should have is_completed = true"
    );

    assert_eq!(
        is_completed_map.get(&incomplete_task_id),
        Some(&Some(false)),
        "Incomplete task should have is_completed = false"
    );

    assert_eq!(
        is_completed_map.get(&task_no_status_id),
        Some(&Some(false)),
        "Task without status should have is_completed = false"
    );

    assert_eq!(
        is_completed_map.get(&regular_doc_id),
        Some(&None),
        "Regular document should have is_completed = None"
    );

    Ok(())
}
