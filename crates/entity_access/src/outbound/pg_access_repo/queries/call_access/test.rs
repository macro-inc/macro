#[allow(unused_imports)]
use super::*;
use crate::domain::models::AccessLevel;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

async fn insert_channel(pool: &PgPool, channel_id: Uuid) {
    sqlx::query!(
        r#"
        INSERT INTO comms_channels (id, name, channel_type, org_id, owner_id)
        VALUES ($1, 'test', 'public', NULL, 'owner')
        "#,
        channel_id
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_share_permission(
    pool: &PgPool,
    id: &str,
    is_public: bool,
    access_level: Option<&str>,
) {
    sqlx::query!(
        r#"
        INSERT INTO "SharePermission" (id, "isPublic", "publicAccessLevel")
        VALUES ($1, $2, $3)
        "#,
        id,
        is_public,
        access_level,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_call(pool: &PgPool, call_id: Uuid, channel_id: Uuid, share_permission_id: &str) {
    sqlx::query!(
        r#"
        INSERT INTO calls (id, channel_id, room_name, created_by, share_permission_id)
        VALUES ($1, $2, 'room', 'creator', $3)
        "#,
        call_id,
        channel_id,
        share_permission_id,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_call_record(
    pool: &PgPool,
    call_id: Uuid,
    channel_id: Uuid,
    share_permission_id: &str,
) {
    sqlx::query!(
        r#"
        INSERT INTO call_records (id, channel_id, room_name, created_by, started_at, ended_at, duration_ms, share_permission_id)
        VALUES ($1, $2, 'room', 'creator', NOW() - INTERVAL '1 hour', NOW(), 3600000, $3)
        "#,
        call_id,
        channel_id,
        share_permission_id,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_entity_access(
    pool: &PgPool,
    entity_id: Uuid,
    source_id: &str,
    access_level: AccessLevel,
) {
    let level_str = access_level.to_string();
    sqlx::query!(
        r#"
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ($1, 'call', $2, 'user', $3::text::"AccessLevel")
        "#,
        entity_id,
        source_id,
        level_str,
    )
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn returns_none_when_call_does_not_exist(pool: PgPool) -> anyhow::Result<()> {
    let call_id = Uuid::new_v4();
    let source_ids = SourceIds(vec!["macro|user@test.com".to_string()]);

    let result = get_call_access(&pool, &call_id, &source_ids).await?;

    assert_eq!(result, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn returns_none_when_no_source_ids_and_not_public(pool: PgPool) -> anyhow::Result<()> {
    let call_id = Uuid::new_v4();
    let channel_id = Uuid::new_v4();
    let sp_id = Uuid::new_v4().to_string();

    insert_channel(&pool, channel_id).await;
    insert_share_permission(&pool, &sp_id, false, None).await;
    insert_call(&pool, call_id, channel_id, &sp_id).await;

    let source_ids = SourceIds(vec![]);

    let result = get_call_access(&pool, &call_id, &source_ids).await?;

    assert_eq!(result, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn returns_public_access_when_no_source_ids_and_public(pool: PgPool) -> anyhow::Result<()> {
    let call_id = Uuid::new_v4();
    let channel_id = Uuid::new_v4();
    let sp_id = Uuid::new_v4().to_string();

    insert_channel(&pool, channel_id).await;
    insert_share_permission(&pool, &sp_id, true, Some("view")).await;
    insert_call(&pool, call_id, channel_id, &sp_id).await;

    let source_ids = SourceIds(vec![]);

    let result = get_call_access(&pool, &call_id, &source_ids).await?;

    assert_eq!(result, Some(AccessLevel::View));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn returns_direct_user_access_from_entity_access(pool: PgPool) -> anyhow::Result<()> {
    let call_id = Uuid::new_v4();
    let channel_id = Uuid::new_v4();
    let sp_id = Uuid::new_v4().to_string();
    let user_id = "macro|user@test.com";

    insert_channel(&pool, channel_id).await;
    insert_share_permission(&pool, &sp_id, false, None).await;
    insert_call(&pool, call_id, channel_id, &sp_id).await;
    insert_entity_access(&pool, call_id, user_id, AccessLevel::Edit).await;

    let source_ids = SourceIds(vec![user_id.to_string()]);

    let result = get_call_access(&pool, &call_id, &source_ids).await?;

    assert_eq!(result, Some(AccessLevel::Edit));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn returns_highest_of_direct_and_public_access(pool: PgPool) -> anyhow::Result<()> {
    let call_id = Uuid::new_v4();
    let channel_id = Uuid::new_v4();
    let sp_id = Uuid::new_v4().to_string();
    let user_id = "macro|user@test.com";

    insert_channel(&pool, channel_id).await;
    insert_share_permission(&pool, &sp_id, true, Some("view")).await;
    insert_call(&pool, call_id, channel_id, &sp_id).await;
    insert_entity_access(&pool, call_id, user_id, AccessLevel::Edit).await;

    let source_ids = SourceIds(vec![user_id.to_string()]);

    let result = get_call_access(&pool, &call_id, &source_ids).await?;

    assert_eq!(result, Some(AccessLevel::Edit));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn public_access_wins_when_higher_than_direct(pool: PgPool) -> anyhow::Result<()> {
    let call_id = Uuid::new_v4();
    let channel_id = Uuid::new_v4();
    let sp_id = Uuid::new_v4().to_string();
    let user_id = "macro|user@test.com";

    insert_channel(&pool, channel_id).await;
    insert_share_permission(&pool, &sp_id, true, Some("edit")).await;
    insert_call(&pool, call_id, channel_id, &sp_id).await;
    insert_entity_access(&pool, call_id, user_id, AccessLevel::View).await;

    let source_ids = SourceIds(vec![user_id.to_string()]);

    let result = get_call_access(&pool, &call_id, &source_ids).await?;

    assert_eq!(result, Some(AccessLevel::Edit));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn returns_none_when_user_has_no_access(pool: PgPool) -> anyhow::Result<()> {
    let call_id = Uuid::new_v4();
    let channel_id = Uuid::new_v4();
    let sp_id = Uuid::new_v4().to_string();

    insert_channel(&pool, channel_id).await;
    insert_share_permission(&pool, &sp_id, false, None).await;
    insert_call(&pool, call_id, channel_id, &sp_id).await;

    let source_ids = SourceIds(vec!["macro|stranger@test.com".to_string()]);

    let result = get_call_access(&pool, &call_id, &source_ids).await?;

    assert_eq!(result, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn resolves_access_from_call_records(pool: PgPool) -> anyhow::Result<()> {
    let call_id = Uuid::new_v4();
    let channel_id = Uuid::new_v4();
    let sp_id = Uuid::new_v4().to_string();

    insert_channel(&pool, channel_id).await;
    insert_share_permission(&pool, &sp_id, true, Some("view")).await;
    insert_call_record(&pool, call_id, channel_id, &sp_id).await;

    let source_ids = SourceIds(vec![]);

    let result = get_call_access(&pool, &call_id, &source_ids).await?;

    assert_eq!(result, Some(AccessLevel::View));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn returns_owner_access_from_entity_access(pool: PgPool) -> anyhow::Result<()> {
    let call_id = Uuid::new_v4();
    let channel_id = Uuid::new_v4();
    let sp_id = Uuid::new_v4().to_string();
    let user_id = "macro|owner@test.com";

    insert_channel(&pool, channel_id).await;
    insert_share_permission(&pool, &sp_id, false, None).await;
    insert_call(&pool, call_id, channel_id, &sp_id).await;
    insert_entity_access(&pool, call_id, user_id, AccessLevel::Owner).await;

    let source_ids = SourceIds(vec![user_id.to_string()]);

    let result = get_call_access(&pool, &call_id, &source_ids).await?;

    assert_eq!(result, Some(AccessLevel::Owner));
    Ok(())
}
