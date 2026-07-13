use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_uuid::Uuid;
use model_entity::EntityType;
use models_permissions::share_permission::access_level::AccessLevel;
use models_permissions::share_permission::channel_share_permission::{
    UpdateChannelSharePermission, UpdateOperation,
};
use sqlx::Row as _;
use sqlx::{Pool, Postgres, Transaction};

use super::*;

const ROOT_PROJECT_ID: Uuid = Uuid::from_u128(0x11111111_1111_1111_1111_111111111111);
const CHILD_PROJECT_ID: Uuid = Uuid::from_u128(0x22222222_2222_2222_2222_222222222222);
const EMPTY_PROJECT_ID: Uuid = Uuid::from_u128(0x33333333_3333_3333_3333_333333333333);
const DOC_ROOT_ID: Uuid = Uuid::from_u128(0x44444444_4444_4444_4444_444444444444);
const DOC_CHILD_ID: Uuid = Uuid::from_u128(0x55555555_5555_5555_5555_555555555555);
const CHAT_CHILD_ID: Uuid = Uuid::from_u128(0x66666666_6666_6666_6666_666666666666);
const CHAT_ROOT_ID: Uuid = Uuid::from_u128(0x77777777_7777_7777_7777_777777777777);

#[derive(Debug)]
struct Row {
    entity_id: Uuid,
    entity_type: String,
    source_id: String,
    access_level: AccessLevel,
    granted_from_project_id: Option<String>,
}

async fn fetch_channel_rows(pool: &Pool<Postgres>, channel_id: &str) -> Vec<Row> {
    // Runtime query (not the compile-time macro) so this test file does not
    // require a `.sqlx` cache entry to build.
    sqlx::query(
        r#"
        SELECT
            entity_id,
            entity_type,
            source_id,
            access_level,
            granted_from_project_id
        FROM entity_access
        WHERE source_id = $1 AND source_type = 'channel'
        ORDER BY entity_type, entity_id, granted_from_project_id NULLS FIRST
        "#,
    )
    .bind(channel_id)
    .map(|r: sqlx::postgres::PgRow| Row {
        entity_id: r.get("entity_id"),
        entity_type: r.get("entity_type"),
        source_id: r.get("source_id"),
        access_level: r.get("access_level"),
        granted_from_project_id: r.get("granted_from_project_id"),
    })
    .fetch_all(pool)
    .await
    .unwrap()
}

#[derive(Debug)]
struct EntityAccessRow {
    source_id: String,
    source_type: String,
    access_level: AccessLevel,
    granted_from_project_id: Option<String>,
}

async fn insert_entity_access_for_test(
    transaction: &mut Transaction<'_, Postgres>,
    entity_id: &Uuid,
    entity_type: EntityType,
    source_id: &str,
    source_type: EntityAccessSourceType,
    access_level: AccessLevel,
    granted_from_project_id: Option<&str>,
) {
    // Runtime query (not the compile-time macro) so this test helper does not
    // require a `.sqlx` cache entry to build.
    sqlx::query(
        r#"
        INSERT INTO entity_access (
            entity_id,
            entity_type,
            source_id,
            source_type,
            access_level,
            granted_from_project_id
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        "#,
    )
    .bind(entity_id)
    .bind(entity_type.as_ref())
    .bind(source_id)
    .bind(source_type)
    .bind(access_level)
    .bind(granted_from_project_id)
    .execute(transaction.as_mut())
    .await
    .unwrap();
}

async fn fetch_entity_access_rows(
    pool: &Pool<Postgres>,
    entity_id: &Uuid,
    entity_type: EntityType,
) -> Vec<EntityAccessRow> {
    // Runtime query (not the compile-time macro) so this test helper does not
    // require a `.sqlx` cache entry to build.
    sqlx::query(
        r#"
        SELECT
            source_id,
            source_type::text AS source_type,
            access_level,
            granted_from_project_id
        FROM entity_access
        WHERE entity_id = $1 AND entity_type = $2
        ORDER BY source_type, source_id, granted_from_project_id NULLS FIRST
        "#,
    )
    .bind(entity_id)
    .bind(entity_type.as_ref())
    .map(|r: sqlx::postgres::PgRow| EntityAccessRow {
        source_id: r.get("source_id"),
        source_type: r.get("source_type"),
        access_level: r.get("access_level"),
        granted_from_project_id: r.get("granted_from_project_id"),
    })
    .fetch_all(pool)
    .await
    .unwrap()
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("upsert_test_data"))
)]
async fn upsert_single_channel_to_chat(pool: Pool<Postgres>) {
    let mut tx = pool.begin().await.unwrap();

    let perms = vec![UpdateChannelSharePermission {
        operation: UpdateOperation::Add,
        channel_id: "channel-1".to_string(),
        access_level: Some(AccessLevel::Edit),
    }];

    update_entity_access_channel_share_permissions(
        &mut tx,
        &CHAT_ROOT_ID,
        EntityType::Chat,
        &perms,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();

    let rows = fetch_channel_rows(&pool, "channel-1").await;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].entity_id, CHAT_ROOT_ID);
    assert_eq!(rows[0].entity_type, "chat");
    assert_eq!(rows[0].source_id, "channel-1");
    assert_eq!(rows[0].access_level, AccessLevel::Edit);
    assert!(rows[0].granted_from_project_id.is_none());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("upsert_test_data"))
)]
async fn upsert_multiple_channels_to_document(pool: Pool<Postgres>) {
    let mut tx = pool.begin().await.unwrap();

    let perms = vec![
        UpdateChannelSharePermission {
            operation: UpdateOperation::Add,
            channel_id: "channel-a".to_string(),
            access_level: Some(AccessLevel::View),
        },
        UpdateChannelSharePermission {
            operation: UpdateOperation::Add,
            channel_id: "channel-b".to_string(),
            access_level: Some(AccessLevel::Comment),
        },
        UpdateChannelSharePermission {
            operation: UpdateOperation::Add,
            channel_id: "channel-c".to_string(),
            access_level: None, // defaults to View
        },
    ];

    update_entity_access_channel_share_permissions(
        &mut tx,
        &DOC_ROOT_ID,
        EntityType::Document,
        &perms,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();

    let mut all_rows = Vec::new();
    for ch in ["channel-a", "channel-b", "channel-c"] {
        all_rows.extend(fetch_channel_rows(&pool, ch).await);
    }

    assert_eq!(all_rows.len(), 3);
    let by_ch: std::collections::HashMap<_, _> =
        all_rows.iter().map(|r| (r.source_id.as_str(), r)).collect();

    assert_eq!(by_ch["channel-a"].access_level, AccessLevel::View);
    assert_eq!(by_ch["channel-b"].access_level, AccessLevel::Comment);
    assert_eq!(by_ch["channel-c"].access_level, AccessLevel::View);
    assert!(
        all_rows
            .iter()
            .all(|r| r.entity_id == DOC_ROOT_ID && r.entity_type == "document")
    );
    assert!(all_rows.iter().all(|r| r.granted_from_project_id.is_none()));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("upsert_test_data"))
)]
async fn upsert_to_project_inserts_direct_grant_and_inherited_rows(pool: Pool<Postgres>) {
    let mut tx = pool.begin().await.unwrap();

    let perms = vec![UpdateChannelSharePermission {
        operation: UpdateOperation::Add,
        channel_id: "channel-1".to_string(),
        access_level: Some(AccessLevel::Comment),
    }];

    update_entity_access_channel_share_permissions(
        &mut tx,
        &ROOT_PROJECT_ID,
        EntityType::Project,
        &perms,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();

    let rows = fetch_channel_rows(&pool, "channel-1").await;
    // root project (direct), child project (inherited), doc-root (inherited),
    // doc-child (inherited), chat-child (inherited), chat-root (inherited) = 6
    assert_eq!(rows.len(), 6);

    // All rows are for channel-1 with Comment access.
    assert!(rows.iter().all(|r| r.access_level == AccessLevel::Comment));

    // The project itself: direct grant (NULL granted_from)
    let project_row = rows
        .iter()
        .find(|r| r.entity_id == ROOT_PROJECT_ID && r.entity_type == "project")
        .unwrap();
    assert!(project_row.granted_from_project_id.is_none());

    // Every other row: inherited from ROOT_PROJECT_ID
    let inherited: Vec<_> = rows
        .iter()
        .filter(|r| !(r.entity_id == ROOT_PROJECT_ID && r.entity_type == "project"))
        .collect();
    assert_eq!(inherited.len(), 5);
    let root_str = ROOT_PROJECT_ID.to_string();
    assert!(
        inherited
            .iter()
            .all(|r| r.granted_from_project_id.as_deref() == Some(root_str.as_str()))
    );

    // Spot-check each expected nested entity is present.
    assert!(
        inherited
            .iter()
            .any(|r| r.entity_id == CHILD_PROJECT_ID && r.entity_type == "project")
    );
    assert!(
        inherited
            .iter()
            .any(|r| r.entity_id == DOC_ROOT_ID && r.entity_type == "document")
    );
    assert!(
        inherited
            .iter()
            .any(|r| r.entity_id == DOC_CHILD_ID && r.entity_type == "document")
    );
    assert!(
        inherited
            .iter()
            .any(|r| r.entity_id == CHAT_CHILD_ID && r.entity_type == "chat")
    );
    assert!(
        inherited
            .iter()
            .any(|r| r.entity_id == CHAT_ROOT_ID && r.entity_type == "chat")
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("upsert_test_data"))
)]
async fn replace_updates_access_level_on_existing_row(pool: Pool<Postgres>) {
    // First: insert a row with View
    let mut tx = pool.begin().await.unwrap();
    let perms = vec![UpdateChannelSharePermission {
        operation: UpdateOperation::Add,
        channel_id: "channel-1".to_string(),
        access_level: Some(AccessLevel::View),
    }];
    update_entity_access_channel_share_permissions(
        &mut tx,
        &DOC_ROOT_ID,
        EntityType::Document,
        &perms,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();

    let initial = fetch_channel_rows(&pool, "channel-1").await;
    assert_eq!(initial.len(), 1);
    assert_eq!(initial[0].access_level, AccessLevel::View);

    // Second: replace with Edit
    let mut tx = pool.begin().await.unwrap();
    let perms = vec![UpdateChannelSharePermission {
        operation: UpdateOperation::Replace,
        channel_id: "channel-1".to_string(),
        access_level: Some(AccessLevel::Edit),
    }];
    update_entity_access_channel_share_permissions(
        &mut tx,
        &DOC_ROOT_ID,
        EntityType::Document,
        &perms,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();

    let after = fetch_channel_rows(&pool, "channel-1").await;
    // Still exactly one row — the existing row was updated, not duplicated.
    assert_eq!(after.len(), 1);
    assert_eq!(after[0].entity_id, DOC_ROOT_ID);
    assert_eq!(after[0].access_level, AccessLevel::Edit);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("upsert_test_data"))
)]
async fn remove_then_upsert_in_same_call_yields_upserted_state(pool: Pool<Postgres>) {
    // Pre-populate: View access on chat-root for channel-1
    let mut tx = pool.begin().await.unwrap();
    update_entity_access_channel_share_permissions(
        &mut tx,
        &CHAT_ROOT_ID,
        EntityType::Chat,
        &[UpdateChannelSharePermission {
            operation: UpdateOperation::Add,
            channel_id: "channel-1".to_string(),
            access_level: Some(AccessLevel::View),
        }],
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();

    // Now: remove + upsert the same channel in a single call. Final state
    // should be the upsert (Edit), since remove runs first, then upsert.
    let mut tx = pool.begin().await.unwrap();
    let perms = vec![
        UpdateChannelSharePermission {
            operation: UpdateOperation::Remove,
            channel_id: "channel-1".to_string(),
            access_level: None,
        },
        UpdateChannelSharePermission {
            operation: UpdateOperation::Add,
            channel_id: "channel-1".to_string(),
            access_level: Some(AccessLevel::Edit),
        },
    ];
    update_entity_access_channel_share_permissions(
        &mut tx,
        &CHAT_ROOT_ID,
        EntityType::Chat,
        &perms,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();

    let rows = fetch_channel_rows(&pool, "channel-1").await;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].entity_id, CHAT_ROOT_ID);
    assert_eq!(rows[0].access_level, AccessLevel::Edit);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("upsert_test_data"))
)]
async fn upsert_to_project_with_no_children_inserts_only_project_row(pool: Pool<Postgres>) {
    let mut tx = pool.begin().await.unwrap();

    let perms = vec![UpdateChannelSharePermission {
        operation: UpdateOperation::Add,
        channel_id: "channel-1".to_string(),
        access_level: Some(AccessLevel::View),
    }];

    update_entity_access_channel_share_permissions(
        &mut tx,
        &EMPTY_PROJECT_ID,
        EntityType::Project,
        &perms,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();

    let rows = fetch_channel_rows(&pool, "channel-1").await;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].entity_id, EMPTY_PROJECT_ID);
    assert_eq!(rows[0].entity_type, "project");
    assert!(rows[0].granted_from_project_id.is_none());
    assert_eq!(rows[0].access_level, AccessLevel::View);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("upsert_test_data"))
)]
async fn remove_non_owner_user_entity_access_removes_direct_non_owner_users(pool: Pool<Postgres>) {
    let owner_id = "macro|owner@test.com";
    let mut tx = pool.begin().await.unwrap();

    insert_entity_access_for_test(
        &mut tx,
        &DOC_ROOT_ID,
        EntityType::Document,
        owner_id,
        EntityAccessSourceType::User,
        AccessLevel::Owner,
        None,
    )
    .await;
    insert_entity_access_for_test(
        &mut tx,
        &DOC_ROOT_ID,
        EntityType::Document,
        "macro|viewer@test.com",
        EntityAccessSourceType::User,
        AccessLevel::View,
        None,
    )
    .await;
    insert_entity_access_for_test(
        &mut tx,
        &DOC_ROOT_ID,
        EntityType::Document,
        "macro|editor@test.com",
        EntityAccessSourceType::User,
        AccessLevel::Edit,
        None,
    )
    .await;

    remove_non_owner_user_entity_access(&mut tx, &DOC_ROOT_ID, EntityType::Document, owner_id)
        .await
        .unwrap();
    tx.commit().await.unwrap();

    let rows = fetch_entity_access_rows(&pool, &DOC_ROOT_ID, EntityType::Document).await;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].source_type, "user");
    assert_eq!(rows[0].source_id, owner_id);
    assert_eq!(rows[0].access_level, AccessLevel::Owner);
    assert!(rows[0].granted_from_project_id.is_none());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("upsert_test_data"))
)]
async fn remove_non_owner_user_entity_access_preserves_non_user_inherited_and_other_entities(
    pool: Pool<Postgres>,
) {
    let owner_id = "macro|owner@test.com";
    let shared_user_id = "macro|shared@test.com";
    let root_project_id = ROOT_PROJECT_ID.to_string();
    let mut tx = pool.begin().await.unwrap();

    insert_entity_access_for_test(
        &mut tx,
        &DOC_ROOT_ID,
        EntityType::Document,
        owner_id,
        EntityAccessSourceType::User,
        AccessLevel::Owner,
        None,
    )
    .await;
    insert_entity_access_for_test(
        &mut tx,
        &DOC_ROOT_ID,
        EntityType::Document,
        shared_user_id,
        EntityAccessSourceType::User,
        AccessLevel::View,
        None,
    )
    .await;
    insert_entity_access_for_test(
        &mut tx,
        &DOC_ROOT_ID,
        EntityType::Document,
        shared_user_id,
        EntityAccessSourceType::User,
        AccessLevel::View,
        Some(root_project_id.as_str()),
    )
    .await;
    insert_entity_access_for_test(
        &mut tx,
        &DOC_ROOT_ID,
        EntityType::Document,
        "team-1",
        EntityAccessSourceType::Team,
        AccessLevel::Edit,
        None,
    )
    .await;
    insert_entity_access_for_test(
        &mut tx,
        &DOC_ROOT_ID,
        EntityType::Document,
        "channel-1",
        EntityAccessSourceType::Channel,
        AccessLevel::Comment,
        None,
    )
    .await;
    insert_entity_access_for_test(
        &mut tx,
        &DOC_CHILD_ID,
        EntityType::Document,
        "macro|other-document@test.com",
        EntityAccessSourceType::User,
        AccessLevel::View,
        None,
    )
    .await;
    insert_entity_access_for_test(
        &mut tx,
        &DOC_ROOT_ID,
        EntityType::Chat,
        "macro|other-type@test.com",
        EntityAccessSourceType::User,
        AccessLevel::View,
        None,
    )
    .await;

    remove_non_owner_user_entity_access(&mut tx, &DOC_ROOT_ID, EntityType::Document, owner_id)
        .await
        .unwrap();
    tx.commit().await.unwrap();

    let target_rows = fetch_entity_access_rows(&pool, &DOC_ROOT_ID, EntityType::Document).await;
    assert_eq!(target_rows.len(), 4);
    assert!(target_rows.iter().any(|r| {
        r.source_type == "user"
            && r.source_id == owner_id
            && r.access_level == AccessLevel::Owner
            && r.granted_from_project_id.is_none()
    }));
    assert!(target_rows.iter().any(|r| {
        r.source_type == "user"
            && r.source_id == shared_user_id
            && r.access_level == AccessLevel::View
            && r.granted_from_project_id.as_deref() == Some(root_project_id.as_str())
    }));
    assert!(target_rows.iter().any(|r| {
        r.source_type == "team"
            && r.source_id == "team-1"
            && r.access_level == AccessLevel::Edit
            && r.granted_from_project_id.is_none()
    }));
    assert!(target_rows.iter().any(|r| {
        r.source_type == "channel"
            && r.source_id == "channel-1"
            && r.access_level == AccessLevel::Comment
            && r.granted_from_project_id.is_none()
    }));
    assert!(!target_rows.iter().any(|r| {
        r.source_type == "user"
            && r.source_id == shared_user_id
            && r.granted_from_project_id.is_none()
    }));

    let other_entity_rows =
        fetch_entity_access_rows(&pool, &DOC_CHILD_ID, EntityType::Document).await;
    assert_eq!(other_entity_rows.len(), 1);
    assert_eq!(other_entity_rows[0].source_type, "user");
    assert_eq!(
        other_entity_rows[0].source_id,
        "macro|other-document@test.com"
    );
    assert_eq!(other_entity_rows[0].access_level, AccessLevel::View);
    assert!(other_entity_rows[0].granted_from_project_id.is_none());

    let other_type_rows = fetch_entity_access_rows(&pool, &DOC_ROOT_ID, EntityType::Chat).await;
    assert_eq!(other_type_rows.len(), 1);
    assert_eq!(other_type_rows[0].source_type, "user");
    assert_eq!(other_type_rows[0].source_id, "macro|other-type@test.com");
    assert_eq!(other_type_rows[0].access_level, AccessLevel::View);
    assert!(other_type_rows[0].granted_from_project_id.is_none());
}
