use chrono::{DateTime, Utc};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use model_owner::{Owner, OwnerType};
use shared_entity_registry::{InsertOutcome, NewEntityRecord, RegisteredEntityType, WriteOutcome};
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use super::{clear_deleted, delete_entity, insert_entity, mark_deleted, touch_updated};

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

async fn insert(tx: &mut Transaction<'_, Postgres>, record: NewEntityRecord) -> InsertOutcome {
    insert_entity(tx, record).await.unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn insert_registers_a_row_for_each_registered_kind(pool: PgPool) {
    let owner = user_owner();
    let mut tx = pool.begin().await.unwrap();
    for (index, kind) in RegisteredEntityType::ALL.into_iter().enumerate() {
        let id = Uuid::from_u128(index as u128 + 1);
        assert_eq!(
            insert(&mut tx, NewEntityRecord::new(id, kind, owner.clone())).await,
            InsertOutcome::Inserted
        );
        let row = sqlx::query!(
            r#"
            SELECT entity_type
            FROM entity
            WHERE id = $1
            "#,
            id,
        )
        .fetch_one(tx.as_mut())
        .await
        .unwrap();
        assert_eq!(row.entity_type, kind.as_str());
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn insert_twice_is_a_no_op(pool: PgPool) {
    let id = Uuid::from_u128(1);
    let first = user_owner();
    let second = bot_owner();
    let mut tx = pool.begin().await.unwrap();

    assert_eq!(
        insert(
            &mut tx,
            NewEntityRecord::new(id, RegisteredEntityType::Chat, first.clone())
        )
        .await,
        InsertOutcome::Inserted
    );
    assert_eq!(
        insert(
            &mut tx,
            NewEntityRecord::new(id, RegisteredEntityType::Document, second)
        )
        .await,
        InsertOutcome::AlreadyRegistered
    );

    let rows = sqlx::query!(
        r#"
        SELECT owner_type AS "owner_type: OwnerType", owner_id, entity_type
        FROM entity
        WHERE id = $1
        "#,
        id,
    )
    .fetch_all(tx.as_mut())
    .await
    .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].owner_type, OwnerType::User);
    assert_eq!(rows[0].owner_id, first.principal_id());
    assert_eq!(rows[0].entity_type, "chat");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn insert_encodes_user_bot_and_team_owners(pool: PgPool) {
    let cases = [
        (
            Uuid::from_u128(1),
            user_owner(),
            OwnerType::User,
            "macro|hutch@macro.com",
        ),
        (
            Uuid::from_u128(2),
            bot_owner(),
            OwnerType::Bot,
            "bot|00000000-0000-0000-0000-00000000a1a1",
        ),
        (
            Uuid::from_u128(3),
            team_owner(),
            OwnerType::Team,
            "01234567-89ab-cdef-0123-456789abcdef",
        ),
    ];
    let mut tx = pool.begin().await.unwrap();
    for (id, owner, owner_type, owner_id) in cases {
        assert_eq!(
            insert(
                &mut tx,
                NewEntityRecord::new(id, RegisteredEntityType::Project, owner)
            )
            .await,
            InsertOutcome::Inserted
        );
        let row = sqlx::query!(
            r#"
            SELECT owner_type AS "owner_type: OwnerType", owner_id
            FROM entity
            WHERE id = $1
            "#,
            id,
        )
        .fetch_one(tx.as_mut())
        .await
        .unwrap();
        assert_eq!(row.owner_type, owner_type);
        assert_eq!(row.owner_id, owner_id);
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn insert_without_timestamps_matches_transaction_now(pool: PgPool) {
    let id = Uuid::from_u128(1);
    let mut tx = pool.begin().await.unwrap();
    let now = sqlx::query_scalar!(r#"SELECT now() AS "now!""#)
        .fetch_one(tx.as_mut())
        .await
        .unwrap();

    insert(
        &mut tx,
        NewEntityRecord::new(id, RegisteredEntityType::Chat, user_owner()),
    )
    .await;

    let row = sqlx::query!(
        r#"
        SELECT created_at, updated_at
        FROM entity
        WHERE id = $1
        "#,
        id,
    )
    .fetch_one(tx.as_mut())
    .await
    .unwrap();
    assert_eq!(row.created_at, now);
    assert_eq!(row.updated_at, now);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn insert_with_timestamps_stores_them(pool: PgPool) {
    let id = Uuid::from_u128(1);
    let created_at = ts("2024-03-15T12:00:00Z");
    let updated_at = ts("2024-03-16T08:30:00Z");
    let mut tx = pool.begin().await.unwrap();

    insert(
        &mut tx,
        NewEntityRecord::new(id, RegisteredEntityType::Document, user_owner())
            .with_timestamps(created_at, updated_at),
    )
    .await;

    let row = sqlx::query!(
        r#"
        SELECT created_at, updated_at, deleted_at
        FROM entity
        WHERE id = $1
        "#,
        id,
    )
    .fetch_one(tx.as_mut())
    .await
    .unwrap();
    assert_eq!(row.created_at, created_at);
    assert_eq!(row.updated_at, updated_at);
    assert_eq!(row.deleted_at, None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn mark_deleted_sets_the_instant_and_last_write_wins(pool: PgPool) {
    let id = Uuid::from_u128(1);
    let first = ts("2024-01-01T00:00:00Z");
    let second = ts("2024-01-02T00:00:00Z");
    let mut tx = pool.begin().await.unwrap();
    insert(
        &mut tx,
        NewEntityRecord::new(id, RegisteredEntityType::Chat, user_owner()),
    )
    .await;

    assert_eq!(
        mark_deleted(&mut tx, id, first).await.unwrap(),
        WriteOutcome::Applied
    );
    let after_first = sqlx::query!(
        r#"
        SELECT deleted_at
        FROM entity
        WHERE id = $1
        "#,
        id,
    )
    .fetch_one(tx.as_mut())
    .await
    .unwrap();
    assert_eq!(after_first.deleted_at, Some(first));

    assert_eq!(
        mark_deleted(&mut tx, id, second).await.unwrap(),
        WriteOutcome::Applied
    );
    let after_second = sqlx::query!(
        r#"
        SELECT deleted_at
        FROM entity
        WHERE id = $1
        "#,
        id,
    )
    .fetch_one(tx.as_mut())
    .await
    .unwrap();
    assert_eq!(after_second.deleted_at, Some(second));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn mark_deleted_on_missing_row_is_not_found_not_error(pool: PgPool) {
    let mut tx = pool.begin().await.unwrap();
    assert_eq!(
        mark_deleted(&mut tx, Uuid::from_u128(99), ts("2024-01-01T00:00:00Z"))
            .await
            .unwrap(),
        WriteOutcome::NotFound
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn clear_deleted_nulls_deleted_at(pool: PgPool) {
    let id = Uuid::from_u128(1);
    let mut tx = pool.begin().await.unwrap();
    insert(
        &mut tx,
        NewEntityRecord::new(id, RegisteredEntityType::Chat, user_owner()),
    )
    .await;
    mark_deleted(&mut tx, id, ts("2024-01-01T00:00:00Z"))
        .await
        .unwrap();

    assert_eq!(
        clear_deleted(&mut tx, id).await.unwrap(),
        WriteOutcome::Applied
    );
    let row = sqlx::query!(
        r#"
        SELECT deleted_at
        FROM entity
        WHERE id = $1
        "#,
        id,
    )
    .fetch_one(tx.as_mut())
    .await
    .unwrap();
    assert_eq!(row.deleted_at, None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn touch_updated_sets_updated_at_only(pool: PgPool) {
    let id = Uuid::from_u128(1);
    let created_at = ts("2024-03-15T12:00:00Z");
    let original_updated = ts("2024-03-16T08:30:00Z");
    let touched = ts("2024-04-01T00:00:00Z");
    let mut tx = pool.begin().await.unwrap();
    insert(
        &mut tx,
        NewEntityRecord::new(id, RegisteredEntityType::Chat, user_owner())
            .with_timestamps(created_at, original_updated),
    )
    .await;

    assert_eq!(
        touch_updated(&mut tx, id, touched).await.unwrap(),
        WriteOutcome::Applied
    );
    let row = sqlx::query!(
        r#"
        SELECT created_at, updated_at, deleted_at
        FROM entity
        WHERE id = $1
        "#,
        id,
    )
    .fetch_one(tx.as_mut())
    .await
    .unwrap();
    assert_eq!(row.created_at, created_at);
    assert_eq!(row.updated_at, touched);
    assert_eq!(row.deleted_at, None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delete_entity_removes_the_row_and_reports_not_found_second_time(pool: PgPool) {
    let id = Uuid::from_u128(1);
    let mut tx = pool.begin().await.unwrap();
    insert(
        &mut tx,
        NewEntityRecord::new(id, RegisteredEntityType::Chat, user_owner()),
    )
    .await;

    assert_eq!(
        delete_entity(&mut tx, id).await.unwrap(),
        WriteOutcome::Applied
    );
    let missing = sqlx::query_scalar!(
        r#"
        SELECT count(*) AS "count!"
        FROM entity
        WHERE id = $1
        "#,
        id,
    )
    .fetch_one(tx.as_mut())
    .await
    .unwrap();
    assert_eq!(missing, 0);
    assert_eq!(
        delete_entity(&mut tx, id).await.unwrap(),
        WriteOutcome::NotFound
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn helpers_never_commit(pool: PgPool) {
    let id = Uuid::from_u128(1);
    let mut tx = pool.begin().await.unwrap();
    insert(
        &mut tx,
        NewEntityRecord::new(id, RegisteredEntityType::Chat, user_owner()),
    )
    .await;
    tx.rollback().await.unwrap();

    let count = sqlx::query_scalar!(
        r#"
        SELECT count(*) AS "count!"
        FROM entity
        WHERE id = $1
        "#,
        id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(count, 0);
}
