use crate::handler::fetch_pending_scheduled_messages;
use anyhow::Result;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::types::Uuid;
use sqlx::{Pool, Postgres};

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("fetch_pending_scheduled_messages"))
)]
async fn fetch_pending_returns_only_eligible_messages(pool: Pool<Postgres>) -> Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

    let results = fetch_pending_scheduled_messages(&pool).await?;

    // Should return exactly 2 messages:
    // - Message 1: Draft with past send_time, not sent
    // - Message 5: Draft with past send_time, not sent (different link)
    assert_eq!(results.len(), 2);

    let message_ids: Vec<Uuid> = results.iter().map(|r| r.message_id).collect();

    assert!(message_ids.contains(&Uuid::parse_str("00000000-0000-0000-0000-00000000f501")?));
    assert!(message_ids.contains(&Uuid::parse_str("00000000-0000-0000-0000-00000000f505")?));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("fetch_pending_scheduled_messages"))
)]
async fn fetch_pending_excludes_future_send_time(pool: Pool<Postgres>) -> Result<()> {
    let results = fetch_pending_scheduled_messages(&pool).await?;

    let message_ids: Vec<Uuid> = results.iter().map(|r| r.message_id).collect();

    // Message 2 has future send_time, should not be included
    assert!(!message_ids.contains(&Uuid::parse_str("00000000-0000-0000-0000-00000000f502")?));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("fetch_pending_scheduled_messages"))
)]
async fn fetch_pending_excludes_already_sent(pool: Pool<Postgres>) -> Result<()> {
    let results = fetch_pending_scheduled_messages(&pool).await?;

    let message_ids: Vec<Uuid> = results.iter().map(|r| r.message_id).collect();

    // Message 3 has sent = true, should not be included
    assert!(!message_ids.contains(&Uuid::parse_str("00000000-0000-0000-0000-00000000f503")?));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("fetch_pending_scheduled_messages"))
)]
async fn fetch_pending_excludes_non_drafts(pool: Pool<Postgres>) -> Result<()> {
    let results = fetch_pending_scheduled_messages(&pool).await?;

    let message_ids: Vec<Uuid> = results.iter().map(|r| r.message_id).collect();

    // Message 4 has is_draft = false, should not be included
    assert!(!message_ids.contains(&Uuid::parse_str("00000000-0000-0000-0000-00000000f504")?));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("fetch_pending_scheduled_messages"))
)]
async fn fetch_pending_returns_correct_link_ids(pool: Pool<Postgres>) -> Result<()> {
    let results = fetch_pending_scheduled_messages(&pool).await?;

    let link_id_1 = Uuid::parse_str("00000000-0000-0000-0000-000000000f01")?;
    let link_id_2 = Uuid::parse_str("00000000-0000-0000-0000-000000000f02")?;

    // Find message from link 1
    let msg_from_link_1 = results
        .iter()
        .find(|r| r.message_id == Uuid::parse_str("00000000-0000-0000-0000-00000000f501").unwrap());
    assert!(msg_from_link_1.is_some());
    assert_eq!(msg_from_link_1.unwrap().link_id, link_id_1);

    // Find message from link 2
    let msg_from_link_2 = results
        .iter()
        .find(|r| r.message_id == Uuid::parse_str("00000000-0000-0000-0000-00000000f505").unwrap());
    assert!(msg_from_link_2.is_some());
    assert_eq!(msg_from_link_2.unwrap().link_id, link_id_2);

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn fetch_pending_returns_empty_when_no_scheduled_messages(
    pool: Pool<Postgres>,
) -> Result<()> {
    // No fixtures loaded, database is empty
    let results = fetch_pending_scheduled_messages(&pool).await?;

    assert!(results.is_empty());

    Ok(())
}
