use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};
use std::collections::HashMap;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("sync_thread_signal_flag"))
)]
async fn stale_label_cleanup_runs_only_for_conflict_updates(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000d01")?;
    let message_id = Uuid::parse_str("00000000-0000-0000-0000-00000000d502")?;
    let empty_labels = Vec::new();
    let mut tx = pool.begin().await?;

    insert_message_labels(
        &mut tx,
        link_id,
        message_id,
        &empty_labels,
        None,
        true,
        true,
    )
    .await?;
    let count_after_fresh_insert = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM email_message_labels WHERE message_id = $1",
        message_id
    )
    .fetch_one(&mut *tx)
    .await?;
    assert_eq!(count_after_fresh_insert, Some(1));

    insert_message_labels(
        &mut tx,
        link_id,
        message_id,
        &empty_labels,
        None,
        true,
        false,
    )
    .await?;
    let count_after_conflict = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM email_message_labels WHERE message_id = $1",
        message_id
    )
    .fetch_one(&mut *tx)
    .await?;
    assert_eq!(count_after_conflict, Some(0));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("sync_thread_signal_flag"))
)]
async fn resolved_label_ids_are_used_with_database_fallback_for_cache_misses(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000d01")?;
    let message_id = Uuid::parse_str("00000000-0000-0000-0000-00000000d501")?;
    let trash_label_id = Uuid::parse_str("00000000-0000-0000-0000-0000000bd001")?;
    let provider_label_ids = vec!["TRASH".to_string(), "CATEGORY_PROMOTIONS".to_string()];
    let resolved_label_ids = HashMap::from([("TRASH".to_string(), trash_label_id)]);
    let mut tx = pool.begin().await?;

    insert_message_labels(
        &mut tx,
        link_id,
        message_id,
        &provider_label_ids,
        Some(&resolved_label_ids),
        false,
        false,
    )
    .await?;

    let inserted_label_ids = sqlx::query_scalar!(
        "SELECT label_id FROM email_message_labels WHERE message_id = $1 ORDER BY label_id",
        message_id
    )
    .fetch_all(&mut *tx)
    .await?;
    assert_eq!(inserted_label_ids.len(), 2);
    assert!(inserted_label_ids.contains(&trash_label_id));

    Ok(())
}
