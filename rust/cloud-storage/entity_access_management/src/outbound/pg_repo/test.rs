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
