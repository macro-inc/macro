use crate::messages::scheduled::get::{
    fetch_scheduled_messages_in_bulk, get_and_start_processing_scheduled_message,
};
use anyhow::Result;
use chrono::{TimeZone, Utc};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::types::Uuid;
use sqlx::{Pool, Postgres};

fn claim_identity() -> (Uuid, Uuid) {
    (
        Uuid::parse_str("00000000-0000-0000-0000-000000000e01").unwrap(),
        Uuid::parse_str("00000000-0000-0000-0000-00000000e501").unwrap(),
    )
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("get_process_scheduled_messages"))
)]
async fn claim_returns_owned_processing_row_and_duplicate_skips(
    pool: Pool<Postgres>,
) -> Result<()> {
    let (link, message) = claim_identity();
    let claimed = get_and_start_processing_scheduled_message(&pool, link, message)
        .await?
        .unwrap();
    assert!(claimed.processing && !claimed.sent);
    assert_eq!(claimed.link_id, link);
    assert_eq!(claimed.message_id, message);
    assert!(
        get_and_start_processing_scheduled_message(&pool, link, message)
            .await?
            .is_none()
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("get_process_scheduled_messages"))
)]
async fn processing_and_sent_rows_are_not_claimed_or_changed(pool: Pool<Postgres>) -> Result<()> {
    let (link, _) = claim_identity();
    for (id, sent, processing) in [
        ("00000000-0000-0000-0000-00000000e502", false, true),
        ("00000000-0000-0000-0000-00000000e503", true, false),
    ] {
        let message = Uuid::parse_str(id)?;
        assert!(
            get_and_start_processing_scheduled_message(&pool, link, message)
                .await?
                .is_none()
        );
        let row = sqlx::query!(
            "SELECT sent, processing FROM email_scheduled_messages WHERE message_id = $1",
            message
        )
        .fetch_one(&pool)
        .await?;
        assert_eq!((row.sent, row.processing), (sent, processing));
    }
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("get_process_scheduled_messages"))
)]
async fn wrong_inbox_and_missing_rows_are_not_claimed(pool: Pool<Postgres>) -> Result<()> {
    let (link, message) = claim_identity();
    assert!(
        get_and_start_processing_scheduled_message(&pool, Uuid::nil(), message)
            .await?
            .is_none()
    );
    assert!(
        get_and_start_processing_scheduled_message(&pool, link, Uuid::nil())
            .await?
            .is_none()
    );
    assert!(
        get_and_start_processing_scheduled_message(&pool, link, message)
            .await?
            .is_some()
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("get_process_scheduled_messages"))
)]
async fn future_rows_are_not_marked_processing(pool: Pool<Postgres>) -> Result<()> {
    let (link, message) = claim_identity();
    sqlx::query!("UPDATE email_scheduled_messages SET send_time = NOW() + INTERVAL '1 hour' WHERE message_id = $1", message)
        .execute(&pool).await?;
    assert!(
        get_and_start_processing_scheduled_message(&pool, link, message)
            .await?
            .is_none()
    );
    let processing = sqlx::query_scalar!(
        "SELECT processing FROM email_scheduled_messages WHERE message_id = $1",
        message
    )
    .fetch_one(&pool)
    .await?;
    assert!(!processing);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("get_process_scheduled_messages"))
)]
async fn immediate_send_undo_rows_remain_claimable(pool: Pool<Postgres>) -> Result<()> {
    let (link, message) = claim_identity();
    sqlx::query!(
        "UPDATE email_messages SET is_draft = false WHERE id = $1",
        message
    )
    .execute(&pool)
    .await?;
    assert!(
        get_and_start_processing_scheduled_message(&pool, link, message)
            .await?
            .is_some()
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("get_process_scheduled_messages"))
)]
async fn concurrent_workers_have_exactly_one_winner(pool: Pool<Postgres>) -> Result<()> {
    let (link, message) = claim_identity();
    let (a, b) = tokio::join!(
        get_and_start_processing_scheduled_message(&pool, link, message),
        get_and_start_processing_scheduled_message(&pool, link, message),
    );
    assert_eq!(usize::from(a?.is_some()) + usize::from(b?.is_some()), 1);
    let processing = sqlx::query_scalar!(
        "SELECT processing FROM email_scheduled_messages WHERE message_id = $1",
        message
    )
    .fetch_one(&pool)
    .await?;
    assert!(processing);
    Ok(())
}

// ============================================================================
// Tests for fetch_scheduled_messages_in_bulk
// ============================================================================

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("fetch_scheduled_messages_in_bulk")
    )
)]
async fn fetch_scheduled_messages_in_bulk_returns_unsent_messages_grouped_by_message_id(
    pool: Pool<Postgres>,
) -> Result<()> {
    let message_id_1 = Uuid::parse_str("00000000-0000-0000-0000-000000007501")?;
    let message_id_2 = Uuid::parse_str("00000000-0000-0000-0000-000000007502")?;

    let result = fetch_scheduled_messages_in_bulk(&pool, &[message_id_1, message_id_2]).await?;

    assert_eq!(result.len(), 2);
    assert!(result.contains_key(&message_id_1));
    assert!(result.contains_key(&message_id_2));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("fetch_scheduled_messages_in_bulk")
    )
)]
async fn fetch_scheduled_messages_in_bulk_returns_correct_fields(
    pool: Pool<Postgres>,
) -> Result<()> {
    let message_id_1 = Uuid::parse_str("00000000-0000-0000-0000-000000007501")?;
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000701")?;

    let result = fetch_scheduled_messages_in_bulk(&pool, &[message_id_1]).await?;

    let scheduled_msg = result.get(&message_id_1).unwrap();
    assert_eq!(scheduled_msg.link_id, link_id);
    assert_eq!(scheduled_msg.message_id, message_id_1);
    assert_eq!(
        scheduled_msg.send_time,
        Utc.with_ymd_and_hms(2025, 1, 15, 10, 0, 0).unwrap()
    );
    assert!(!scheduled_msg.sent);
    assert!(!scheduled_msg.processing);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("fetch_scheduled_messages_in_bulk")
    )
)]
async fn fetch_scheduled_messages_in_bulk_includes_processing_messages(
    pool: Pool<Postgres>,
) -> Result<()> {
    let message_id_2 = Uuid::parse_str("00000000-0000-0000-0000-000000007502")?;

    let result = fetch_scheduled_messages_in_bulk(&pool, &[message_id_2]).await?;

    let scheduled_msg = result.get(&message_id_2).unwrap();
    assert!(scheduled_msg.processing);
    assert!(!scheduled_msg.sent);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("fetch_scheduled_messages_in_bulk")
    )
)]
async fn fetch_scheduled_messages_in_bulk_excludes_sent_messages(
    pool: Pool<Postgres>,
) -> Result<()> {
    let unsent_message = Uuid::parse_str("00000000-0000-0000-0000-000000007501")?;
    let sent_message = Uuid::parse_str("00000000-0000-0000-0000-000000007503")?;

    let result = fetch_scheduled_messages_in_bulk(&pool, &[unsent_message, sent_message]).await?;

    // Only unsent message should be in the result
    assert_eq!(result.len(), 1);
    assert!(result.contains_key(&unsent_message));
    assert!(!result.contains_key(&sent_message));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("fetch_scheduled_messages_in_bulk")
    )
)]
async fn fetch_scheduled_messages_in_bulk_excludes_unscheduled_messages(
    pool: Pool<Postgres>,
) -> Result<()> {
    let scheduled_message = Uuid::parse_str("00000000-0000-0000-0000-000000007501")?;
    let unscheduled_message = Uuid::parse_str("00000000-0000-0000-0000-000000007504")?;

    let result =
        fetch_scheduled_messages_in_bulk(&pool, &[scheduled_message, unscheduled_message]).await?;

    // Only scheduled message should be in the result
    assert_eq!(result.len(), 1);
    assert!(result.contains_key(&scheduled_message));
    assert!(!result.contains_key(&unscheduled_message));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("fetch_scheduled_messages_in_bulk")
    )
)]
async fn fetch_scheduled_messages_in_bulk_returns_empty_for_empty_input(
    pool: Pool<Postgres>,
) -> Result<()> {
    let result = fetch_scheduled_messages_in_bulk(&pool, &[]).await?;

    assert!(result.is_empty());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("fetch_scheduled_messages_in_bulk")
    )
)]
async fn fetch_scheduled_messages_in_bulk_returns_empty_for_nonexistent_messages(
    pool: Pool<Postgres>,
) -> Result<()> {
    let nonexistent_message_id = Uuid::parse_str("00000000-0000-0000-0000-00000000ffff")?;

    let result = fetch_scheduled_messages_in_bulk(&pool, &[nonexistent_message_id]).await?;

    assert!(result.is_empty());

    Ok(())
}
