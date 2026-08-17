use super::*;
use crate::threads::get::get_thread_by_id_and_link_id;
use chrono::Utc;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};
use std::time::Duration;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("links", "threads"))
)]
async fn provider_thread_upsert_advances_existing_thread_timestamp(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001")?;
    let existing_thread_id = Uuid::parse_str("10000000-0000-0000-0000-000000000001")?;
    let mut conflicting_thread = get_thread_by_id_and_link_id(&pool, existing_thread_id, link_id)
        .await?
        .expect("provider thread should exist");
    let updated_at_before = conflicting_thread.updated_at;

    tokio::time::sleep(Duration::from_millis(10)).await;

    conflicting_thread.db_id = Uuid::parse_str("20000000-0000-0000-0000-000000000001")?;
    conflicting_thread.latest_inbound_message_ts = Some(Utc::now());

    let upserted_thread_id =
        insert_thread(&mut *pool.acquire().await?, &conflicting_thread, link_id).await?;

    assert_eq!(upserted_thread_id, existing_thread_id);
    let thread_after = get_thread_by_id_and_link_id(&pool, existing_thread_id, link_id)
        .await?
        .expect("provider thread should still exist");
    assert!(
        thread_after.updated_at > updated_at_before,
        "provider thread upsert should advance the existing thread timestamp"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("links", "threads"))
)]
async fn unchanged_timestamp_upsert_is_noop(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001")?;
    let existing_thread_id = Uuid::parse_str("10000000-0000-0000-0000-000000000001")?;

    // Seed a populated latest_inbound_message_ts via a real upsert.
    let mut thread = get_thread_by_id_and_link_id(&pool, existing_thread_id, link_id)
        .await?
        .expect("provider thread should exist");
    thread.db_id = Uuid::parse_str("20000000-0000-0000-0000-000000000002")?;
    thread.latest_inbound_message_ts = Some(Utc::now());
    insert_thread(&mut *pool.acquire().await?, &thread, link_id).await?;

    let after_first = get_thread_by_id_and_link_id(&pool, existing_thread_id, link_id)
        .await?
        .expect("provider thread should exist");
    assert!(after_first.latest_inbound_message_ts.is_some());

    tokio::time::sleep(Duration::from_millis(10)).await;

    // Re-upsert with the identical timestamp: must not rewrite the row.
    let mut duplicate = get_thread_by_id_and_link_id(&pool, existing_thread_id, link_id)
        .await?
        .expect("provider thread should exist");
    duplicate.db_id = Uuid::parse_str("20000000-0000-0000-0000-000000000003")?;

    let upserted_thread_id =
        insert_thread(&mut *pool.acquire().await?, &duplicate, link_id).await?;

    assert_eq!(upserted_thread_id, existing_thread_id);
    let after_second = get_thread_by_id_and_link_id(&pool, existing_thread_id, link_id)
        .await?
        .expect("provider thread should still exist");
    assert_eq!(
        after_second.updated_at, after_first.updated_at,
        "no-op upsert must not rewrite the row"
    );
    assert_eq!(
        after_second.latest_inbound_message_ts,
        after_first.latest_inbound_message_ts
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("links", "threads"))
)]
async fn blank_upsert_preserves_populated_timestamp(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001")?;
    let existing_thread_id = Uuid::parse_str("10000000-0000-0000-0000-000000000001")?;

    // Seed a populated latest_inbound_message_ts via a real upsert.
    let mut thread = get_thread_by_id_and_link_id(&pool, existing_thread_id, link_id)
        .await?
        .expect("provider thread should exist");
    thread.db_id = Uuid::parse_str("20000000-0000-0000-0000-000000000004")?;
    thread.latest_inbound_message_ts = Some(Utc::now());
    insert_thread(&mut *pool.acquire().await?, &thread, link_id).await?;

    let before = get_thread_by_id_and_link_id(&pool, existing_thread_id, link_id)
        .await?
        .expect("provider thread should exist");
    assert!(before.latest_inbound_message_ts.is_some());

    tokio::time::sleep(Duration::from_millis(10)).await;

    // A redelivered backfill blank insert must not wipe the timestamp or
    // rewrite the row.
    let upserted_thread_id = insert_blank_thread(&pool, "prov1", link_id).await?;

    assert_eq!(upserted_thread_id, existing_thread_id);
    let after = get_thread_by_id_and_link_id(&pool, existing_thread_id, link_id)
        .await?
        .expect("provider thread should still exist");
    assert_eq!(
        after.latest_inbound_message_ts, before.latest_inbound_message_ts,
        "blank upsert must not wipe a populated timestamp"
    );
    assert_eq!(
        after.updated_at, before.updated_at,
        "blank upsert against an existing thread must not rewrite the row"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("links", "threads"))
)]
async fn blank_insert_creates_new_thread(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001")?;

    let thread_id = insert_blank_thread(&pool, "prov-brand-new", link_id).await?;

    let thread = get_thread_by_id_and_link_id(&pool, thread_id, link_id)
        .await?
        .expect("blank thread should be created");
    assert_eq!(thread.provider_id.as_deref(), Some("prov-brand-new"));
    assert_eq!(thread.latest_inbound_message_ts, None);

    Ok(())
}
