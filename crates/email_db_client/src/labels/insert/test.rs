use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};

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

    insert_message_labels(&mut tx, link_id, message_id, &empty_labels, true, true).await?;
    let count_after_fresh_insert = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM email_message_labels WHERE message_id = $1",
        message_id
    )
    .fetch_one(&mut *tx)
    .await?;
    assert_eq!(count_after_fresh_insert, Some(1));

    insert_message_labels(&mut tx, link_id, message_id, &empty_labels, true, false).await?;
    let count_after_conflict = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM email_message_labels WHERE message_id = $1",
        message_id
    )
    .fetch_one(&mut *tx)
    .await?;
    assert_eq!(count_after_conflict, Some(0));

    Ok(())
}
