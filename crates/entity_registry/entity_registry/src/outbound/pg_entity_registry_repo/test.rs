use chrono::{DateTime, Utc};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use model_owner::{Owner, OwnerType};
use shared_entity_registry::{EntityRegistryError, NewEntityRecord, RegisteredEntityType};
use sqlx::PgPool;
use uuid::Uuid;

use super::{EntityRow, PgEntityRegistryRepository};
use crate::domain::ports::EntityRegistryRepository;

fn user_owner() -> Owner {
    Owner::parse(OwnerType::User, "macro|hutch@macro.com").unwrap()
}

fn bot_owner() -> Owner {
    Owner::parse(OwnerType::Bot, "bot|00000000-0000-0000-0000-00000000a1a1").unwrap()
}

fn team_owner() -> Owner {
    Owner::parse(OwnerType::Team, "01234567-89ab-cdef-0123-456789abcdef").unwrap()
}

fn ts(rfc3339: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(rfc3339)
        .unwrap()
        .with_timezone(&Utc)
}

async fn insert_committed(pool: &PgPool, record: NewEntityRecord) {
    let owner_type = record.owner.owner_type();
    let owner_id = record.owner.principal_id();
    sqlx::query!(
        r#"
        INSERT INTO entity (id, entity_type, owner_type, owner_id, created_at, updated_at)
        VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, now()), COALESCE($6::timestamptz, now()))
        "#,
        record.id,
        record.entity_type.as_str(),
        owner_type as _,
        owner_id,
        record.created_at,
        record.updated_at,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn mark_deleted_committed(pool: &PgPool, id: Uuid, at: DateTime<Utc>) {
    sqlx::query!(
        r#"
        UPDATE entity SET deleted_at = $2 WHERE id = $1
        "#,
        id,
        at,
    )
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_returns_live_and_soft_deleted_rows_and_none_for_unknown(pool: PgPool) {
    let live_id = Uuid::from_u128(1);
    let deleted_id = Uuid::from_u128(2);
    let owner = user_owner();
    insert_committed(
        &pool,
        NewEntityRecord::new(live_id, RegisteredEntityType::Chat, owner.clone()),
    )
    .await;
    insert_committed(
        &pool,
        NewEntityRecord::new(deleted_id, RegisteredEntityType::Document, owner.clone()),
    )
    .await;
    mark_deleted_committed(&pool, deleted_id, ts("2024-01-01T00:00:00Z")).await;

    let repo = PgEntityRegistryRepository::new(pool);
    let live = repo.get(live_id).await.unwrap().unwrap();
    assert_eq!(live.id, live_id);
    assert_eq!(live.entity_type, RegisteredEntityType::Chat);
    assert_eq!(live.owner, owner);
    assert!(live.is_live());

    let deleted = repo.get(deleted_id).await.unwrap().unwrap();
    assert_eq!(deleted.id, deleted_id);
    assert_eq!(deleted.deleted_at, Some(ts("2024-01-01T00:00:00Z")));
    assert!(!deleted.is_live());

    assert_eq!(repo.get(Uuid::from_u128(99)).await.unwrap(), None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_many_returns_present_ids_only_and_collapses_duplicates(pool: PgPool) {
    let present = Uuid::from_u128(1);
    let missing = Uuid::from_u128(2);
    insert_committed(
        &pool,
        NewEntityRecord::new(present, RegisteredEntityType::Chat, user_owner()),
    )
    .await;
    let repo = PgEntityRegistryRepository::new(pool.clone());

    assert_eq!(repo.get_many(&[]).await.unwrap(), Vec::new());

    let rows = repo.get_many(&[present, missing, present]).await.unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].id, present);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_owned_by_user_bot_and_team_each_see_only_their_rows(pool: PgPool) {
    let user = user_owner();
    let bot = bot_owner();
    let team = team_owner();
    let user_id = Uuid::from_u128(1);
    let bot_id = Uuid::from_u128(2);
    let team_id = Uuid::from_u128(3);
    insert_committed(
        &pool,
        NewEntityRecord::new(user_id, RegisteredEntityType::Chat, user.clone()),
    )
    .await;
    insert_committed(
        &pool,
        NewEntityRecord::new(bot_id, RegisteredEntityType::Document, bot.clone()),
    )
    .await;
    insert_committed(
        &pool,
        NewEntityRecord::new(team_id, RegisteredEntityType::Project, team.clone()),
    )
    .await;

    let repo = PgEntityRegistryRepository::new(pool);
    let user_rows = repo.list_owned_by(&user, None).await.unwrap();
    assert_eq!(user_rows.len(), 1);
    assert_eq!(user_rows[0].id, user_id);
    assert_eq!(user_rows[0].owner, user);

    let bot_rows = repo.list_owned_by(&bot, None).await.unwrap();
    assert_eq!(bot_rows.len(), 1);
    assert_eq!(bot_rows[0].id, bot_id);
    assert_eq!(bot_rows[0].owner, bot);

    let team_rows = repo.list_owned_by(&team, None).await.unwrap();
    assert_eq!(team_rows.len(), 1);
    assert_eq!(team_rows[0].id, team_id);
    assert_eq!(team_rows[0].owner, team);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_owned_by_filters_by_kind_and_skips_soft_deleted(pool: PgPool) {
    let owner = user_owner();
    let live_chat = Uuid::from_u128(1);
    let live_document = Uuid::from_u128(2);
    let deleted_chat = Uuid::from_u128(3);
    insert_committed(
        &pool,
        NewEntityRecord::new(live_chat, RegisteredEntityType::Chat, owner.clone()),
    )
    .await;
    insert_committed(
        &pool,
        NewEntityRecord::new(live_document, RegisteredEntityType::Document, owner.clone()),
    )
    .await;
    insert_committed(
        &pool,
        NewEntityRecord::new(deleted_chat, RegisteredEntityType::Chat, owner.clone()),
    )
    .await;
    mark_deleted_committed(&pool, deleted_chat, ts("2024-01-01T00:00:00Z")).await;

    let repo = PgEntityRegistryRepository::new(pool);
    let chats = repo
        .list_owned_by(&owner, Some(RegisteredEntityType::Chat))
        .await
        .unwrap();
    assert_eq!(chats.len(), 1);
    assert_eq!(chats[0].id, live_chat);

    let documents = repo
        .list_owned_by(&owner, Some(RegisteredEntityType::Document))
        .await
        .unwrap();
    assert_eq!(documents.len(), 1);
    assert_eq!(documents[0].id, live_document);

    let all = repo.list_owned_by(&owner, None).await.unwrap();
    let mut ids: Vec<_> = all.iter().map(|row| row.id).collect();
    ids.sort();
    assert_eq!(ids, vec![live_chat, live_document]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_owned_by_orders_newest_created_first(pool: PgPool) {
    let owner = user_owner();
    let older = Uuid::from_u128(1);
    let newer_low = Uuid::from_u128(2);
    let newer_high = Uuid::from_u128(3);
    let old_ts = ts("2024-01-01T00:00:00Z");
    let new_ts = ts("2024-06-01T00:00:00Z");
    insert_committed(
        &pool,
        NewEntityRecord::new(older, RegisteredEntityType::Chat, owner.clone())
            .with_timestamps(old_ts, old_ts),
    )
    .await;
    insert_committed(
        &pool,
        NewEntityRecord::new(newer_low, RegisteredEntityType::Chat, owner.clone())
            .with_timestamps(new_ts, new_ts),
    )
    .await;
    insert_committed(
        &pool,
        NewEntityRecord::new(newer_high, RegisteredEntityType::Chat, owner.clone())
            .with_timestamps(new_ts, new_ts),
    )
    .await;

    let repo = PgEntityRegistryRepository::new(pool);
    let rows = repo.list_owned_by(&owner, None).await.unwrap();
    assert_eq!(
        rows.iter().map(|row| row.id).collect::<Vec<_>>(),
        vec![newer_high, newer_low, older]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn count_by_type_splits_live_and_deleted(pool: PgPool) {
    let owner = user_owner();
    insert_committed(
        &pool,
        NewEntityRecord::new(
            Uuid::from_u128(1),
            RegisteredEntityType::Chat,
            owner.clone(),
        ),
    )
    .await;
    insert_committed(
        &pool,
        NewEntityRecord::new(
            Uuid::from_u128(2),
            RegisteredEntityType::Chat,
            owner.clone(),
        ),
    )
    .await;
    insert_committed(
        &pool,
        NewEntityRecord::new(
            Uuid::from_u128(3),
            RegisteredEntityType::Chat,
            owner.clone(),
        ),
    )
    .await;
    insert_committed(
        &pool,
        NewEntityRecord::new(Uuid::from_u128(4), RegisteredEntityType::Document, owner),
    )
    .await;
    mark_deleted_committed(&pool, Uuid::from_u128(3), ts("2024-01-01T00:00:00Z")).await;

    let repo = PgEntityRegistryRepository::new(pool);
    let chats = repo
        .count_by_type(RegisteredEntityType::Chat)
        .await
        .unwrap();
    assert_eq!(chats.live, 2);
    assert_eq!(chats.deleted, 1);
    assert_eq!(chats.total(), 3);

    let documents = repo
        .count_by_type(RegisteredEntityType::Document)
        .await
        .unwrap();
    assert_eq!(documents.live, 1);
    assert_eq!(documents.deleted, 0);
    assert_eq!(documents.total(), 1);

    let projects = repo
        .count_by_type(RegisteredEntityType::Project)
        .await
        .unwrap();
    assert_eq!(projects.live, 0);
    assert_eq!(projects.deleted, 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn decode_of_a_row_outside_the_checks_is_corrupt_row(_pool: PgPool) {
    let id = Uuid::from_u128(1);
    let now = ts("2024-01-01T00:00:00Z");
    let row = EntityRow {
        id,
        entity_type: "initiative".to_string(),
        owner_type: OwnerType::User,
        owner_id: "macro|hutch@macro.com".to_string(),
        created_at: now,
        updated_at: now,
        deleted_at: None,
    };
    let err = row.into_record().unwrap_err();
    assert_eq!(*err.current_context(), EntityRegistryError::CorruptRow);
}
