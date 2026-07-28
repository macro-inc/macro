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

    let upserted_thread_id = insert_thread(&pool, &conflicting_thread, link_id).await?;

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
