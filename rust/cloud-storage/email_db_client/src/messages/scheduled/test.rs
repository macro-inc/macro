use crate::messages::scheduled::get::{
    fetch_scheduled_messages_in_bulk, get_and_start_processing_scheduled_message,
};
use anyhow::Result;
use chrono::{TimeZone, Utc};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::types::Uuid;
use sqlx::{Pool, Postgres};

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("get_process_scheduled_messages"))
)]
async fn get_and_start_processing_returns_message_with_old_processing_value(
    pool: Pool<Postgres>,
) -> Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000e01")?;
    let message_id = Uuid::parse_str("00000000-0000-0000-0000-00000000e501")?;

    let result = get_and_start_processing_scheduled_message(&pool, link_id, message_id).await?;

    assert!(result.is_some());
    let scheduled_message = result.unwrap();

    // Should return the OLD processing value (false) before the update
    assert_eq!(scheduled_message.link_id, link_id);
    assert_eq!(scheduled_message.message_id, message_id);
    assert!(!scheduled_message.processing);
    assert!(!scheduled_message.sent);
    assert_eq!(
        scheduled_message.send_time,
        Utc.with_ymd_and_hms(2025, 1, 15, 10, 0, 0).unwrap()
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("get_process_scheduled_messages"))
)]
async fn get_and_start_processing_sets_processing_to_true_in_database(
    pool: Pool<Postgres>,
) -> Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000e01")?;
    let message_id = Uuid::parse_str("00000000-0000-0000-0000-00000000e501")?;

    // First call should return processing = false (old value)
    let result = get_and_start_processing_scheduled_message(&pool, link_id, message_id).await?;
    assert!(result.is_some());
    assert!(!result.unwrap().processing);

    // Second call should return processing = true (the new old value after first update)
    let result2 = get_and_start_processing_scheduled_message(&pool, link_id, message_id).await?;
    assert!(result2.is_some());
    assert!(result2.unwrap().processing);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("get_process_scheduled_messages"))
)]
async fn get_and_start_processing_returns_message_already_processing(
    pool: Pool<Postgres>,
) -> Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000e01")?;
    let message_id = Uuid::parse_str("00000000-0000-0000-0000-00000000e502")?;

    let result = get_and_start_processing_scheduled_message(&pool, link_id, message_id).await?;

    assert!(result.is_some());
    let scheduled_message = result.unwrap();

    // Should return the OLD processing value which is already true
    assert!(scheduled_message.processing);
    assert!(!scheduled_message.sent);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("get_process_scheduled_messages"))
)]
async fn get_and_start_processing_returns_already_sent_message(pool: Pool<Postgres>) -> Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000e01")?;
    let message_id = Uuid::parse_str("00000000-0000-0000-0000-00000000e503")?;

    let result = get_and_start_processing_scheduled_message(&pool, link_id, message_id).await?;

    assert!(result.is_some());
    let scheduled_message = result.unwrap();

    assert!(scheduled_message.sent);
    assert!(!scheduled_message.processing);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("get_process_scheduled_messages"))
)]
async fn get_and_start_processing_returns_none_for_wrong_link_id(
    pool: Pool<Postgres>,
) -> Result<()> {
    let wrong_link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000e02")?;
    let message_id = Uuid::parse_str("00000000-0000-0000-0000-00000000e501")?;

    let result =
        get_and_start_processing_scheduled_message(&pool, wrong_link_id, message_id).await?;

    assert!(result.is_none());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("get_process_scheduled_messages"))
)]
async fn get_and_start_processing_returns_none_for_nonexistent_message(
    pool: Pool<Postgres>,
) -> Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000e01")?;
    let nonexistent_message_id = Uuid::parse_str("00000000-0000-0000-0000-00000000ffff")?;

    let result =
        get_and_start_processing_scheduled_message(&pool, link_id, nonexistent_message_id).await?;

    assert!(result.is_none());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("get_process_scheduled_messages"))
)]
async fn get_and_start_processing_does_not_affect_other_messages(
    pool: Pool<Postgres>,
) -> Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000e01")?;
    let message_id_1 = Uuid::parse_str("00000000-0000-0000-0000-00000000e501")?;
    let message_id_2 = Uuid::parse_str("00000000-0000-0000-0000-00000000e502")?;

    // Process message 1
    let result1 = get_and_start_processing_scheduled_message(&pool, link_id, message_id_1).await?;
    assert!(result1.is_some());
    assert!(!result1.unwrap().processing);

    // Message 2 should still have its original processing state (true)
    let result2 = get_and_start_processing_scheduled_message(&pool, link_id, message_id_2).await?;
    assert!(result2.is_some());
    assert!(result2.unwrap().processing);

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
