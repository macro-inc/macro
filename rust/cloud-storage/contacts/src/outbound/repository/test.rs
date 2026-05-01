use crate::domain::ports::{ContactsBackfillOutboxRepo, ContactsRepository};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use sqlx::types::Uuid;

use super::DbContactsRepository;

fn mid(s: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(s.to_owned()).unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_create_connections_basic(pool: PgPool) -> sqlx::Result<()> {
    let user1 = "macro|a@test.com";
    let user2 = "macro|b@test.com";
    let repo = DbContactsRepository::new(pool.clone());
    repo.create_connections(vec![(mid(user1), mid(user2))])
        .await
        .unwrap();
    let pair = sqlx::query!("SELECT user1, user2 FROM contacts_connections LIMIT 1")
        .fetch_one(&pool)
        .await?;
    assert_eq!(pair.user1, user1);
    assert_eq!(pair.user2, user2);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_create_connections_ordering(pool: PgPool) -> sqlx::Result<()> {
    let user1 = "macro|a@test.com";
    let user2 = "macro|b@test.com";
    let repo = DbContactsRepository::new(pool.clone());
    repo.create_connections(vec![(mid(user2), mid(user1))])
        .await
        .unwrap();
    let pair = sqlx::query!("SELECT user1, user2 FROM contacts_connections LIMIT 1")
        .fetch_one(&pool)
        .await?;
    assert_eq!(pair.user1, user1);
    assert_eq!(pair.user2, user2);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("user_list"))
)]
async fn test_get_contacts(pool: PgPool) -> sqlx::Result<()> {
    let repo = DbContactsRepository::new(pool);
    let contacts = repo.get_contacts(mid("macro|a@test.com")).await.unwrap();
    assert_eq!(contacts.len(), 3);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_create_connections_batch(pool: PgPool) -> sqlx::Result<()> {
    let connections: Vec<(MacroUserIdStr<'static>, MacroUserIdStr<'static>)> = (0..8)
        .map(|i| {
            (
                mid("macro|user0@test.com"),
                mid(&format!("macro|user{i}@test.com")),
            )
        })
        .filter(|(a, b)| a.as_ref() != b.as_ref())
        .collect();

    let expected_count = connections.len() as i64;

    let repo = DbContactsRepository::new(pool.clone());
    repo.create_connections(connections).await.unwrap();

    let count = sqlx::query_scalar!("SELECT count(*) FROM contacts_connections")
        .fetch_one(&pool)
        .await?
        .unwrap();
    assert_eq!(count, expected_count);

    let contacts = repo
        .get_contacts(mid("macro|user0@test.com"))
        .await
        .unwrap();
    assert_eq!(contacts.len(), expected_count as usize);
    Ok(())
}

async fn insert_channel(pool: &PgPool, id: Uuid) {
    sqlx::query!(
        "INSERT INTO comms_channels (id, channel_type, owner_id) \
         VALUES ($1, 'direct_message', 'macro|owner@test.com')",
        id
    )
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_get_unapplied_messages_returns_inserted_rows(pool: PgPool) -> sqlx::Result<()> {
    let channel_id = Uuid::new_v4();
    insert_channel(&pool, channel_id).await;

    // Simulate what the migration backfill inserts
    sqlx::query!(
        "INSERT INTO contacts_backfill_outbox (comms_channel_id, user_ids) \
         VALUES ($1, '[\"macro|a@test.com\", \"macro|b@test.com\"]'::jsonb)",
        channel_id,
    )
    .execute(&pool)
    .await?;

    let repo = DbContactsRepository::new(pool);
    let messages = repo.get_unapplied_messages().await.unwrap();

    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].channel_id, channel_id);
    assert_eq!(
        messages[0].channel_participants,
        [mid("macro|a@test.com"), mid("macro|b@test.com")]
            .into_iter()
            .collect()
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_get_unapplied_messages_excludes_applied(pool: PgPool) -> sqlx::Result<()> {
    let unapplied_id = Uuid::new_v4();
    let applied_id = Uuid::new_v4();
    insert_channel(&pool, unapplied_id).await;
    insert_channel(&pool, applied_id).await;

    sqlx::query!(
        "INSERT INTO contacts_backfill_outbox (comms_channel_id, user_ids) \
         VALUES ($1, '[\"macro|a@test.com\"]'::jsonb)",
        unapplied_id,
    )
    .execute(&pool)
    .await?;

    sqlx::query!(
        "INSERT INTO contacts_backfill_outbox (comms_channel_id, user_ids, applied_at) \
         VALUES ($1, '[\"macro|b@test.com\"]'::jsonb, now())",
        applied_id,
    )
    .execute(&pool)
    .await?;

    let repo = DbContactsRepository::new(pool);
    let messages = repo.get_unapplied_messages().await.unwrap();

    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].channel_id, unapplied_id);
    Ok(())
}
