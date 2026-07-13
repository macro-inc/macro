use macro_db_migrator::MACRO_DB_MIGRATIONS;
use model_entity::EntityType;
use models_permissions::share_permission::access_level::AccessLevel;
use sqlx::{Pool, Postgres};
use uuid::Uuid;

use super::PgRepository;
use crate::domain::models::EntityAccessSourceType;
use crate::domain::ports::EntityAccessManagementRepository;

const ROOT_PROJECT_ID: Uuid = Uuid::from_u128(0x11111111_1111_1111_1111_111111111111);
const CHILD_PROJECT_ID: Uuid = Uuid::from_u128(0x22222222_2222_2222_2222_222222222222);
const GRANDCHILD_PROJECT_ID: Uuid = Uuid::from_u128(0x33333333_3333_3333_3333_333333333333);

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("project_tree_test_data"))
)]
async fn walk_up_from_grandchild_returns_all_ancestors(pool: Pool<Postgres>) {
    let repo = PgRepository::new(pool.clone());
    let mut tx = pool.begin().await.unwrap();

    let result = repo
        .walk_up_project_tree(&mut tx, &GRANDCHILD_PROJECT_ID)
        .await
        .unwrap();

    assert_eq!(result.len(), 3);
    assert!(result.contains(&GRANDCHILD_PROJECT_ID));
    assert!(result.contains(&CHILD_PROJECT_ID));
    assert!(result.contains(&ROOT_PROJECT_ID));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("project_tree_test_data"))
)]
async fn walk_up_from_root_returns_only_self(pool: Pool<Postgres>) {
    let repo = PgRepository::new(pool.clone());
    let mut tx = pool.begin().await.unwrap();

    let result = repo
        .walk_up_project_tree(&mut tx, &ROOT_PROJECT_ID)
        .await
        .unwrap();

    assert_eq!(result.len(), 1);
    assert_eq!(result[0], ROOT_PROJECT_ID);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("project_tree_test_data"))
)]
async fn walk_up_nonexistent_project_returns_empty(pool: Pool<Postgres>) {
    let repo = PgRepository::new(pool.clone());
    let mut tx = pool.begin().await.unwrap();
    let nonexistent = Uuid::new_v4();

    let result = repo
        .walk_up_project_tree(&mut tx, &nonexistent)
        .await
        .unwrap();

    assert!(result.is_empty());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("project_tree_test_data"))
)]
async fn source_entities_returns_direct_shares_across_projects(pool: Pool<Postgres>) {
    let repo = PgRepository::new(pool.clone());
    let mut tx = pool.begin().await.unwrap();

    let result = repo
        .get_all_source_entities_for_projects(&mut tx, &[ROOT_PROJECT_ID, CHILD_PROJECT_ID])
        .await
        .unwrap();

    // 3 direct shares: user/edit on root, team/view on root, channel/comment on child
    assert_eq!(result.len(), 3);

    let user_entry = result
        .iter()
        .find(|e| e.source_id == "macro|testuser@test.com")
        .unwrap();
    assert!(matches!(
        user_entry.source_type,
        EntityAccessSourceType::User
    ));
    assert_eq!(user_entry.access_level, AccessLevel::Edit);

    let team_entry = result.iter().find(|e| e.source_id == "team-one").unwrap();
    assert!(matches!(
        team_entry.source_type,
        EntityAccessSourceType::Team
    ));
    assert_eq!(team_entry.access_level, AccessLevel::View);

    let channel_entry = result
        .iter()
        .find(|e| e.source_id == "channel-one")
        .unwrap();
    assert!(matches!(
        channel_entry.source_type,
        EntityAccessSourceType::Channel
    ));
    assert_eq!(channel_entry.access_level, AccessLevel::Comment);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("project_tree_test_data"))
)]
async fn source_entities_excludes_inherited_access(pool: Pool<Postgres>) {
    let repo = PgRepository::new(pool.clone());
    let mut tx = pool.begin().await.unwrap();

    // Child project has one direct share (channel/comment) and one inherited (user/view with granted_from_project_id)
    let result = repo
        .get_all_source_entities_for_projects(&mut tx, &[CHILD_PROJECT_ID])
        .await
        .unwrap();

    assert_eq!(result.len(), 1);
    assert_eq!(result[0].source_id, "channel-one");
    assert!(matches!(
        result[0].source_type,
        EntityAccessSourceType::Channel
    ));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("project_tree_test_data"))
)]
async fn source_entities_excludes_non_project_entity_type(pool: Pool<Postgres>) {
    let repo = PgRepository::new(pool.clone());
    let mut tx = pool.begin().await.unwrap();

    // Root project has 2 direct project shares + 1 document row (should be excluded)
    let result = repo
        .get_all_source_entities_for_projects(&mut tx, &[ROOT_PROJECT_ID])
        .await
        .unwrap();

    assert_eq!(result.len(), 2);
    assert!(
        result
            .iter()
            .all(|e| e.source_id != "macro|testuser@test.com"
                || matches!(e.source_type, EntityAccessSourceType::User))
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("project_tree_test_data"))
)]
async fn source_entities_empty_for_project_without_access(pool: Pool<Postgres>) {
    let repo = PgRepository::new(pool.clone());
    let mut tx = pool.begin().await.unwrap();

    let result = repo
        .get_all_source_entities_for_projects(&mut tx, &[GRANDCHILD_PROJECT_ID])
        .await
        .unwrap();

    assert!(result.is_empty());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("project_tree_test_data"))
)]
async fn source_entities_empty_for_nonexistent_project(pool: Pool<Postgres>) {
    let repo = PgRepository::new(pool.clone());
    let mut tx = pool.begin().await.unwrap();
    let nonexistent = Uuid::new_v4();

    let result = repo
        .get_all_source_entities_for_projects(&mut tx, &[nonexistent])
        .await
        .unwrap();

    assert!(result.is_empty());
}

/// Simulates adding an entity to PROJECT_C in a 3-level hierarchy with
/// different owners at each level.
///
/// Project tree:
///   PROJECT_A (owner: user_a)
///     PROJECT_B (owner: user_b)
///       PROJECT_C (owner: user_c)
///
/// The `entity_access` table contains 12 rows total:
///
/// | entity_id | source_id | source_type | access_level | granted_from_project_id |
/// |-----------|-----------|-------------|--------------|-------------------------|
/// | project_a | user_a    | user        | owner        | NULL                    |
/// | project_b | user_b    | user        | owner        | NULL                    |
/// | project_c | user_c    | user        | owner        | NULL                    |
/// | project_a | channel_1 | channel     | view         | NULL                    |
/// | project_b | team_1    | team        | edit         | NULL                    |
/// | project_c | channel_2 | channel     | comment      | NULL                    |
/// | project_b | user_a    | user        | owner        | project_a               |
/// | project_c | user_a    | user        | owner        | project_a               |
/// | project_c | user_b    | user        | owner        | project_b               |
/// | project_b | channel_1 | channel     | view         | project_a               |
/// | project_c | channel_1 | channel     | view         | project_a               |
/// | project_c | team_1    | team        | edit         | project_b               |
///
/// Walking up from PROJECT_C gives [A, B, C]. The query should return only the
/// 6 direct shares (where `granted_from_project_id IS NULL`), excluding the 6
/// inherited rows.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("complex_project_tree_test_data"))
)]
async fn source_entities_for_full_tree_walk_returns_only_direct_shares(pool: Pool<Postgres>) {
    let repo = PgRepository::new(pool.clone());
    let mut tx = pool.begin().await.unwrap();

    let project_a = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa").unwrap();
    let project_b = Uuid::parse_str("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb").unwrap();
    let project_c = Uuid::parse_str("cccccccc-cccc-cccc-cccc-cccccccccccc").unwrap();

    // Simulates walk_up_project_tree from PROJECT_C → [A, B, C]
    let result = repo
        .get_all_source_entities_for_projects(&mut tx, &[project_a, project_b, project_c])
        .await
        .unwrap();

    // 6 direct shares total: 3 users + 1 team + 2 channels
    // All 6 inherited rows (granted_from_project_id IS NOT NULL) should be excluded
    assert_eq!(result.len(), 6);

    // 3 user owner records
    let users: Vec<_> = result
        .iter()
        .filter(|e| matches!(e.source_type, EntityAccessSourceType::User))
        .collect();
    assert_eq!(users.len(), 3);
    assert!(users.iter().any(|e| e.source_id == "macro|user_a@test.com" && e.access_level == AccessLevel::Owner));
    assert!(users.iter().any(|e| e.source_id == "macro|user_b@test.com" && e.access_level == AccessLevel::Owner));
    assert!(users.iter().any(|e| e.source_id == "macro|user_c@test.com" && e.access_level == AccessLevel::Owner));

    // 2 channel shares
    let channels: Vec<_> = result
        .iter()
        .filter(|e| matches!(e.source_type, EntityAccessSourceType::Channel))
        .collect();
    assert_eq!(channels.len(), 2);
    assert!(
        channels
            .iter()
            .any(|e| e.source_id == "channel-1" && e.access_level == AccessLevel::View)
    );
    assert!(
        channels
            .iter()
            .any(|e| e.source_id == "channel-2" && e.access_level == AccessLevel::Comment)
    );

    // 1 team share
    let teams: Vec<_> = result
        .iter()
        .filter(|e| matches!(e.source_type, EntityAccessSourceType::Team))
        .collect();
    assert_eq!(teams.len(), 1);
    assert_eq!(teams[0].source_id, "team-1");
    assert_eq!(teams[0].access_level, AccessLevel::Edit);
}

/// Adds a document to PROJECT_C and verifies that `add_entity_to_project`
/// inserts 6 entity_access rows — one for each direct share found across
/// the full ancestor chain [A, B, C].
///
/// Expected inserted rows (all with granted_from_project_id set):
///
/// | source_id | source_type | access_level | granted_from_project_id |
/// |-----------|-------------|--------------|-------------------------|
/// | user_a    | user        | owner        | project_a               |
/// | user_b    | user        | owner        | project_b               |
/// | user_c    | user        | owner        | project_c               |
/// | channel_1 | channel     | view         | project_a               |
/// | team_1    | team        | edit         | project_b               |
/// | channel_2 | channel     | comment      | project_c               |
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("complex_project_tree_test_data"))
)]
async fn add_entity_to_project_inserts_access_for_all_ancestor_shares(pool: Pool<Postgres>) {
    let repo = PgRepository::new(pool.clone());

    let document_id = Uuid::new_v4();
    let project_c = Uuid::parse_str("cccccccc-cccc-cccc-cccc-cccccccccccc").unwrap();

    repo.add_entity_to_project(&document_id, EntityType::Document, &project_c)
        .await
        .unwrap();

    // Query the inserted rows for this document
    let rows = sqlx::query!(
        r#"
        SELECT
            source_id,
            source_type as "source_type:EntityAccessSourceType",
            access_level as "access_level:AccessLevel",
            granted_from_project_id,
            entity_type
        FROM entity_access
        WHERE entity_id = $1
        ORDER BY source_id
        "#,
        &document_id,
    )
    .fetch_all(&pool)
    .await
    .unwrap();

    assert_eq!(rows.len(), 6);

    // All rows should be entity_type = 'document'
    assert!(rows.iter().all(|r| r.entity_type == "document"));

    // All rows should have granted_from_project_id set (none are direct shares on the document)
    assert!(rows.iter().all(|r| r.granted_from_project_id.is_some()));

    // channel-1: view, granted from project_a
    let ch1 = rows.iter().find(|r| r.source_id == "channel-1").unwrap();
    assert_eq!(ch1.access_level, AccessLevel::View);
    assert_eq!(
        ch1.granted_from_project_id.as_deref(),
        Some("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
    );

    // channel-2: comment, granted from project_c
    let ch2 = rows.iter().find(|r| r.source_id == "channel-2").unwrap();
    assert_eq!(ch2.access_level, AccessLevel::Comment);
    assert_eq!(
        ch2.granted_from_project_id.as_deref(),
        Some("cccccccc-cccc-cccc-cccc-cccccccccccc")
    );

    // team-1: edit, granted from project_b
    let t1 = rows.iter().find(|r| r.source_id == "team-1").unwrap();
    assert_eq!(t1.access_level, AccessLevel::Edit);
    assert_eq!(
        t1.granted_from_project_id.as_deref(),
        Some("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
    );

    // user_a: owner, granted from project_a
    let ua = rows
        .iter()
        .find(|r| r.source_id == "macro|user_a@test.com")
        .unwrap();
    assert_eq!(ua.access_level, AccessLevel::Owner);
    assert_eq!(
        ua.granted_from_project_id.as_deref(),
        Some("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
    );

    // user_b: owner, granted from project_b
    let ub = rows
        .iter()
        .find(|r| r.source_id == "macro|user_b@test.com")
        .unwrap();
    assert_eq!(ub.access_level, AccessLevel::Owner);
    assert_eq!(
        ub.granted_from_project_id.as_deref(),
        Some("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
    );

    // user_c: owner, granted from project_c
    let uc = rows
        .iter()
        .find(|r| r.source_id == "macro|user_c@test.com")
        .unwrap();
    assert_eq!(uc.access_level, AccessLevel::Owner);
    assert_eq!(
        uc.granted_from_project_id.as_deref(),
        Some("cccccccc-cccc-cccc-cccc-cccccccccccc")
    );
}

/// Adds a document to PROJECT_C then removes it, verifying that all 6
/// inherited access rows are deleted while the pre-existing project
/// access rows remain untouched.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("complex_project_tree_test_data"))
)]
async fn remove_entity_from_project_deletes_inherited_access(pool: Pool<Postgres>) {
    let repo = PgRepository::new(pool.clone());

    let document_id = Uuid::new_v4();
    let project_c = Uuid::parse_str("cccccccc-cccc-cccc-cccc-cccccccccccc").unwrap();

    // Add entity to project — creates 6 inherited access rows
    repo.add_entity_to_project(&document_id, EntityType::Document, &project_c)
        .await
        .unwrap();

    // Verify 6 rows exist before removal
    let before_count = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM entity_access WHERE entity_id = $1",
        &document_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(before_count, Some(6));

    // Remove entity from project
    repo.remove_entity_from_project(&document_id, EntityType::Document, &project_c)
        .await
        .unwrap();

    // All 6 document rows should be gone
    let after_count = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM entity_access WHERE entity_id = $1",
        &document_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(after_count, Some(0));

    // Pre-existing project access rows should be untouched (12 rows from fixture)
    let project_rows =
        sqlx::query_scalar!("SELECT COUNT(*) FROM entity_access WHERE entity_type = 'project'",)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(project_rows, Some(12));
}

/// Calling from PROJECT_A (root) should return the full tree:
/// 3 projects (A, B, C) + 1 document in A + 1 chat in B + 1 document in C = 6 entities
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("complex_project_tree_test_data"))
)]
async fn nested_entities_from_root_returns_full_tree(pool: Pool<Postgres>) {
    let repo = PgRepository::new(pool.clone());
    let mut tx = pool.begin().await.unwrap();
    let project_a = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa").unwrap();

    let result = repo
        .get_nested_project_entities(&mut tx, &project_a)
        .await
        .unwrap();

    assert_eq!(result.len(), 6);

    let projects: Vec<_> = result
        .iter()
        .filter(|e| e.entity_type == "project")
        .collect();
    assert_eq!(projects.len(), 3);

    let documents: Vec<_> = result
        .iter()
        .filter(|e| e.entity_type == "document")
        .collect();
    assert_eq!(documents.len(), 2);
    assert!(documents.iter().any(|e| e.entity_id == "doc-in-a"));
    assert!(documents.iter().any(|e| e.entity_id == "doc-in-c"));

    let chats: Vec<_> = result.iter().filter(|e| e.entity_type == "chat").collect();
    assert_eq!(chats.len(), 1);
    assert_eq!(chats[0].entity_id, "chat-in-b");
}

/// Calling from PROJECT_B should return B's subtree:
/// 2 projects (B, C) + 1 chat in B + 1 document in C = 4 entities
/// Should NOT include project_a or doc-in-a.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("complex_project_tree_test_data"))
)]
async fn nested_entities_from_mid_returns_subtree_only(pool: Pool<Postgres>) {
    let repo = PgRepository::new(pool.clone());
    let mut tx = pool.begin().await.unwrap();
    let project_b = Uuid::parse_str("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb").unwrap();

    let result = repo
        .get_nested_project_entities(&mut tx, &project_b)
        .await
        .unwrap();

    assert_eq!(result.len(), 4);

    let projects: Vec<_> = result
        .iter()
        .filter(|e| e.entity_type == "project")
        .collect();
    assert_eq!(projects.len(), 2);
    assert!(
        !projects
            .iter()
            .any(|e| e.entity_id == "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
    );

    assert!(result.iter().any(|e| e.entity_id == "chat-in-b"));
    assert!(result.iter().any(|e| e.entity_id == "doc-in-c"));
    assert!(!result.iter().any(|e| e.entity_id == "doc-in-a"));
}

/// Calling from PROJECT_C (leaf) should return:
/// 1 project (C) + 1 document in C = 2 entities
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("complex_project_tree_test_data"))
)]
async fn nested_entities_from_leaf_returns_self_and_children(pool: Pool<Postgres>) {
    let repo = PgRepository::new(pool.clone());
    let mut tx = pool.begin().await.unwrap();
    let project_c = Uuid::parse_str("cccccccc-cccc-cccc-cccc-cccccccccccc").unwrap();

    let result = repo
        .get_nested_project_entities(&mut tx, &project_c)
        .await
        .unwrap();

    assert_eq!(result.len(), 2);
    assert!(result.iter().any(
        |e| e.entity_type == "project" && e.entity_id == "cccccccc-cccc-cccc-cccc-cccccccccccc"
    ));
    assert!(
        result
            .iter()
            .any(|e| e.entity_type == "document" && e.entity_id == "doc-in-c")
    );
}

/// Non-existent project returns empty.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("complex_project_tree_test_data"))
)]
async fn nested_entities_nonexistent_project_returns_empty(pool: Pool<Postgres>) {
    let repo = PgRepository::new(pool.clone());
    let mut tx = pool.begin().await.unwrap();
    let nonexistent = Uuid::new_v4();

    let result = repo
        .get_nested_project_entities(&mut tx, &nonexistent)
        .await
        .unwrap();

    assert!(result.is_empty());
}

/// Move PROJECT_B from under PROJECT_A to under PROJECT_D.
///
/// Project tree before:
///   PROJECT_A (user_a/owner, channel-1/view)
///     PROJECT_B (user_b/owner, team-1/edit)
///       PROJECT_C (user_c/owner)
///         doc_in_c
///       doc_in_b
///   PROJECT_D (user_d/owner, team-2/comment)
///
/// Project tree after:
///   PROJECT_A (unchanged)
///   PROJECT_D
///     PROJECT_B
///       PROJECT_C
///         doc_in_c
///       doc_in_b
///
/// The move should:
/// - Remove all inherited access from project_a for B's nested entities (8 rows)
/// - Add inherited access from project_d for B's nested entities (8 rows)
/// - Leave project_a's own access and project_d's own access untouched
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("move_project_test_data"))
)]
async fn move_project_from_a_to_d_updates_inherited_access(pool: Pool<Postgres>) {
    let repo = PgRepository::new(pool.clone());

    let project_a = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa").unwrap();
    let project_b = Uuid::parse_str("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb").unwrap();
    let project_c = Uuid::parse_str("cccccccc-cccc-cccc-cccc-cccccccccccc").unwrap();
    let project_d = Uuid::parse_str("dddddddd-dddd-dddd-dddd-dddddddddddd").unwrap();
    let doc_in_b = Uuid::parse_str("d1111111-1111-1111-1111-111111111111").unwrap();
    let doc_in_c = Uuid::parse_str("d2222222-2222-2222-2222-222222222222").unwrap();

    repo.move_project(&project_b, Some(&project_a), Some(&project_d))
        .await
        .unwrap();

    // Helper to count entity_access rows for a given entity
    let count_for = |pool: Pool<Postgres>, entity_id: Uuid| async move {
        sqlx::query_scalar!(
            "SELECT COUNT(*) FROM entity_access WHERE entity_id = $1",
            &entity_id,
        )
        .fetch_one(&pool)
        .await
        .unwrap()
        .unwrap_or(0)
    };

    // Helper to check grants from a specific project
    let grants_from = |pool: Pool<Postgres>, entity_id: Uuid, project: &'static str| async move {
        sqlx::query_scalar!(
                "SELECT COUNT(*) FROM entity_access WHERE entity_id = $1 AND granted_from_project_id = $2",
                &entity_id,
                project,
            )
            .fetch_one(&pool)
            .await
            .unwrap()
            .unwrap_or(0)
    };

    // -- project_a: unchanged (2 direct shares, no inherited)
    assert_eq!(count_for(pool.clone(), project_a).await, 2);

    // -- project_d: unchanged (2 direct shares, no inherited)
    assert_eq!(count_for(pool.clone(), project_d).await, 2);

    // -- project_b: 2 direct + 2 from D (lost 2 from A)
    assert_eq!(count_for(pool.clone(), project_b).await, 4);
    assert_eq!(
        grants_from(
            pool.clone(),
            project_b,
            "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        )
        .await,
        0
    );
    assert_eq!(
        grants_from(
            pool.clone(),
            project_b,
            "dddddddd-dddd-dddd-dddd-dddddddddddd"
        )
        .await,
        2
    );

    // -- project_c: 1 direct + 2 from B + 2 from D (lost 2 from A)
    assert_eq!(count_for(pool.clone(), project_c).await, 5);
    assert_eq!(
        grants_from(
            pool.clone(),
            project_c,
            "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        )
        .await,
        0
    );
    assert_eq!(
        grants_from(
            pool.clone(),
            project_c,
            "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
        )
        .await,
        2
    );
    assert_eq!(
        grants_from(
            pool.clone(),
            project_c,
            "dddddddd-dddd-dddd-dddd-dddddddddddd"
        )
        .await,
        2
    );

    // -- doc_in_b: 2 from B + 2 from D (lost 2 from A)
    assert_eq!(count_for(pool.clone(), doc_in_b).await, 4);
    assert_eq!(
        grants_from(
            pool.clone(),
            doc_in_b,
            "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        )
        .await,
        0
    );
    assert_eq!(
        grants_from(
            pool.clone(),
            doc_in_b,
            "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
        )
        .await,
        2
    );
    assert_eq!(
        grants_from(
            pool.clone(),
            doc_in_b,
            "dddddddd-dddd-dddd-dddd-dddddddddddd"
        )
        .await,
        2
    );

    // -- doc_in_c: 2 from B + 1 from C + 2 from D (lost 2 from A)
    assert_eq!(count_for(pool.clone(), doc_in_c).await, 5);
    assert_eq!(
        grants_from(
            pool.clone(),
            doc_in_c,
            "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        )
        .await,
        0
    );
    assert_eq!(
        grants_from(
            pool.clone(),
            doc_in_c,
            "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
        )
        .await,
        2
    );
    assert_eq!(
        grants_from(
            pool.clone(),
            doc_in_c,
            "cccccccc-cccc-cccc-cccc-cccccccccccc"
        )
        .await,
        1
    );
    assert_eq!(
        grants_from(
            pool.clone(),
            doc_in_c,
            "dddddddd-dddd-dddd-dddd-dddddddddddd"
        )
        .await,
        2
    );
}
