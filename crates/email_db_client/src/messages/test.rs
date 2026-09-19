use crate::messages::get::{draft_exists_with_id, filter_existing_provider_message_ids};
use crate::messages::scheduled::get::get_scheduled_db_messages_by_link_id;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::types::Uuid;
use sqlx::{Pool, Postgres};

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("draft_exists_with_id"))
)]
async fn draft_exists_with_id_returns_true_for_existing_draft(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000e01")?;
    let draft_id = Uuid::parse_str("00000000-0000-0000-0000-00000000e501")?;

    let exists = draft_exists_with_id(&pool, link_id, draft_id).await?;

    assert!(exists);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("draft_exists_with_id"))
)]
async fn draft_exists_with_id_returns_false_for_non_draft_message(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000e01")?;
    let non_draft_id = Uuid::parse_str("00000000-0000-0000-0000-00000000e502")?;

    let exists = draft_exists_with_id(&pool, link_id, non_draft_id).await?;

    assert!(!exists);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("draft_exists_with_id"))
)]
async fn draft_exists_with_id_returns_false_for_wrong_link_id(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let wrong_link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000e02")?;
    let draft_id = Uuid::parse_str("00000000-0000-0000-0000-00000000e501")?;

    let exists = draft_exists_with_id(&pool, wrong_link_id, draft_id).await?;

    assert!(!exists);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("draft_exists_with_id"))
)]
async fn draft_exists_with_id_returns_false_for_nonexistent_message(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000e01")?;
    let nonexistent_id = Uuid::parse_str("00000000-0000-0000-0000-00000000efff")?;

    let exists = draft_exists_with_id(&pool, link_id, nonexistent_id).await?;

    assert!(!exists);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("get_scheduled_db_messages"))
)]
async fn get_scheduled_db_messages_returns_unsent_only(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001")?;
    let result = get_scheduled_db_messages_by_link_id(&pool, link_id, 0, 100).await?;

    // Should return 3 unsent scheduled messages
    assert_eq!(result.len(), 3);

    // Verify all returned messages are unsent scheduled messages
    let returned_ids: Vec<Uuid> = result.iter().map(|m| m.id).collect();

    let unsent_1 = Uuid::parse_str("00000000-0000-0000-0000-0000000d0001")?;
    let unsent_2 = Uuid::parse_str("00000000-0000-0000-0000-0000000d0002")?;
    let unsent_3 = Uuid::parse_str("00000000-0000-0000-0000-0000000d0003")?;

    assert!(
        returned_ids.contains(&unsent_1),
        "Should include unsent message 1"
    );
    assert!(
        returned_ids.contains(&unsent_2),
        "Should include unsent message 2"
    );
    assert!(
        returned_ids.contains(&unsent_3),
        "Should include unsent message 3"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("get_scheduled_db_messages"))
)]
async fn get_scheduled_db_messages_excludes_sent_messages(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001")?;
    let result = get_scheduled_db_messages_by_link_id(&pool, link_id, 0, 100).await?;

    let returned_ids: Vec<Uuid> = result.iter().map(|m| m.id).collect();

    // Already sent scheduled message should NOT be included
    let sent_msg = Uuid::parse_str("00000000-0000-0000-0000-0000000d0004")?;
    assert!(
        !returned_ids.contains(&sent_msg),
        "Should not include already sent message"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("get_scheduled_db_messages"))
)]
async fn get_scheduled_db_messages_excludes_non_scheduled_messages(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001")?;
    let result = get_scheduled_db_messages_by_link_id(&pool, link_id, 0, 100).await?;

    let returned_ids: Vec<Uuid> = result.iter().map(|m| m.id).collect();

    // Regular non-scheduled message should NOT be included
    let regular_msg = Uuid::parse_str("00000000-0000-0000-0000-0000000d0005")?;
    assert!(
        !returned_ids.contains(&regular_msg),
        "Should not include non-scheduled message"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("get_scheduled_db_messages"))
)]
async fn get_scheduled_db_messages_isolates_by_link_id(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001")?;
    let result = get_scheduled_db_messages_by_link_id(&pool, link_id, 0, 100).await?;

    let returned_ids: Vec<Uuid> = result.iter().map(|m| m.id).collect();

    // Message from other link should NOT be included
    let other_link_msg = Uuid::parse_str("00000000-0000-0000-0000-0000000d0006")?;
    assert!(
        !returned_ids.contains(&other_link_msg),
        "Should not include messages from other links"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("get_scheduled_db_messages"))
)]
async fn get_scheduled_db_messages_orders_by_created_at_desc(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001")?;
    let result = get_scheduled_db_messages_by_link_id(&pool, link_id, 0, 100).await?;

    // Should be ordered by created_at DESC (newest first)
    assert_eq!(
        result[0].subject,
        Some("Newest scheduled message".to_string())
    );
    assert_eq!(
        result[1].subject,
        Some("Middle scheduled message".to_string())
    );
    assert_eq!(
        result[2].subject,
        Some("Oldest scheduled message".to_string())
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("get_scheduled_db_messages"))
)]
async fn get_scheduled_db_messages_respects_limit(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001")?;

    // Request only 2 messages
    let result = get_scheduled_db_messages_by_link_id(&pool, link_id, 0, 2).await?;

    assert_eq!(result.len(), 2);

    // Should return the 2 newest (ordered by created_at DESC)
    assert_eq!(
        result[0].subject,
        Some("Newest scheduled message".to_string())
    );
    assert_eq!(
        result[1].subject,
        Some("Middle scheduled message".to_string())
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("get_scheduled_db_messages"))
)]
async fn get_scheduled_db_messages_respects_offset(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001")?;

    // Skip first 2 messages
    let result = get_scheduled_db_messages_by_link_id(&pool, link_id, 2, 100).await?;

    assert_eq!(result.len(), 1);

    // Should return only the oldest message
    assert_eq!(
        result[0].subject,
        Some("Oldest scheduled message".to_string())
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("get_scheduled_db_messages"))
)]
async fn get_scheduled_db_messages_pagination_works(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001")?;

    // Page 1: limit 1, offset 0
    let page1 = get_scheduled_db_messages_by_link_id(&pool, link_id, 0, 1).await?;
    assert_eq!(page1.len(), 1);
    assert_eq!(
        page1[0].subject,
        Some("Newest scheduled message".to_string())
    );

    // Page 2: limit 1, offset 1
    let page2 = get_scheduled_db_messages_by_link_id(&pool, link_id, 1, 1).await?;
    assert_eq!(page2.len(), 1);
    assert_eq!(
        page2[0].subject,
        Some("Middle scheduled message".to_string())
    );

    // Page 3: limit 1, offset 2
    let page3 = get_scheduled_db_messages_by_link_id(&pool, link_id, 2, 1).await?;
    assert_eq!(page3.len(), 1);
    assert_eq!(
        page3[0].subject,
        Some("Oldest scheduled message".to_string())
    );

    // Page 4: limit 1, offset 3 (no more results)
    let page4 = get_scheduled_db_messages_by_link_id(&pool, link_id, 3, 1).await?;
    assert!(page4.is_empty());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("get_scheduled_db_messages"))
)]
async fn get_scheduled_db_messages_returns_empty_for_nonexistent_link(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let nonexistent_link_id = Uuid::parse_str("00000000-0000-0000-0000-999999999999")?;
    let result = get_scheduled_db_messages_by_link_id(&pool, nonexistent_link_id, 0, 100).await?;

    assert!(result.is_empty());

    Ok(())
}

async fn fetch_calendar_flag(pool: &Pool<Postgres>, thread_id: Uuid) -> anyhow::Result<bool> {
    Ok(sqlx::query_scalar!(
        "SELECT has_calendar_attachment FROM email_threads WHERE id = $1",
        thread_id
    )
    .fetch_one(pool)
    .await?)
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("sync_thread_calendar_flag"))
)]
async fn delete_message_clears_calendar_flag_when_last_ics_message_removed(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let thread_id = Uuid::parse_str("00000000-0000-0000-0000-00000000b201")?;
    let ics_message_id = Uuid::parse_str("00000000-0000-0000-0000-00000000b501")?;
    let fusionauth_user_id = "00000000-0000-0000-0000-000000000b01";

    // Establish the flag from the fixture's .ics attachment.
    let mut conn = pool.acquire().await?;
    crate::threads::update::sync_thread_calendar_flag(&mut conn, thread_id).await?;
    drop(conn);
    assert!(fetch_calendar_flag(&pool, thread_id).await?);

    let message = crate::messages::get_simple_messages::get_simple_message(
        &pool,
        &ics_message_id,
        fusionauth_user_id,
    )
    .await?
    .expect("fixture message present");

    let mut tx = pool.begin().await?;
    let deleted_thread = crate::messages::delete::delete_message_with_tx(&mut tx, &message).await?;
    tx.commit().await?;

    // The thread survives (a second message remains) and the flag flips off
    // because its attachments cascaded away with the message.
    assert!(deleted_thread.is_none());
    assert!(!fetch_calendar_flag(&pool, thread_id).await?);
    Ok(())
}

const READ_STATUS_LINK: &str = "00000000-0000-0000-0000-000000000e11";
const READ_STATUS_OTHER_LINK: &str = "00000000-0000-0000-0000-000000000e12";
const READ_STATUS_MSG_A: &str = "00000000-0000-0000-0000-00000000e611";
const READ_STATUS_MSG_B: &str = "00000000-0000-0000-0000-00000000e612";
const READ_STATUS_OTHER_MSG: &str = "00000000-0000-0000-0000-00000000e613";

async fn fetch_is_read(pool: &Pool<Postgres>, message_id: Uuid) -> anyhow::Result<bool> {
    Ok(sqlx::query_scalar!(
        "SELECT is_read FROM email_messages WHERE id = $1",
        message_id
    )
    .fetch_one(pool)
    .await?)
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("message_read_status"))
)]
async fn update_message_read_status_batch_marks_messages_read(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str(READ_STATUS_LINK)?;
    let message_ids = vec![
        Uuid::parse_str(READ_STATUS_MSG_A)?,
        Uuid::parse_str(READ_STATUS_MSG_B)?,
    ];

    let updated = crate::messages::update::update_message_read_status_batch(
        &pool,
        message_ids.clone(),
        link_id,
        true,
    )
    .await?;

    assert_eq!(updated, 2);
    for id in message_ids {
        assert!(fetch_is_read(&pool, id).await?);
    }

    Ok(())
}

/// The inbox that owns a thread is not always owned by the macro user acting on it:
/// shared and delegated inboxes are owned by a separate fusion user. Scoping this
/// update by anything other than the link silently matched zero rows, leaving
/// `is_read` diverged from the labels and the denormalized thread flag.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("message_read_status"))
)]
async fn update_message_read_status_batch_scopes_to_owning_link(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let other_link_id = Uuid::parse_str(READ_STATUS_OTHER_LINK)?;
    let message_id = Uuid::parse_str(READ_STATUS_MSG_A)?;

    // Ids that belong to a different link than the one supplied must not be updated,
    // and the mismatch is loud rather than silently absorbed.
    let result = crate::messages::update::update_message_read_status_batch(
        &pool,
        vec![message_id],
        other_link_id,
        true,
    )
    .await;

    assert!(result.is_err());
    assert!(!fetch_is_read(&pool, message_id).await?);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("message_read_status"))
)]
async fn update_message_read_status_batch_leaves_other_inboxes_untouched(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str(READ_STATUS_LINK)?;
    let other_message_id = Uuid::parse_str(READ_STATUS_OTHER_MSG)?;

    let updated = crate::messages::update::update_message_read_status_batch(
        &pool,
        vec![Uuid::parse_str(READ_STATUS_MSG_A)?],
        link_id,
        true,
    )
    .await?;

    assert_eq!(updated, 1);
    assert!(!fetch_is_read(&pool, other_message_id).await?);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("message_read_status"))
)]
async fn update_message_read_status_ignores_wrong_link(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let other_link_id = Uuid::parse_str(READ_STATUS_OTHER_LINK)?;
    let message_id = Uuid::parse_str(READ_STATUS_MSG_A)?;

    let mut conn = pool.acquire().await?;
    let updated = crate::messages::update::update_message_read_status(
        &mut conn,
        message_id,
        other_link_id,
        true,
    )
    .await?;

    assert!(updated.is_none());
    assert!(!fetch_is_read(&pool, message_id).await?);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("draft_exists_with_id"))
)]
async fn filter_existing_provider_message_ids_partitions_known_and_missing(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000e01")?;
    let other_link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000e02")?;

    let requested = vec![
        "provider-msg-e501".to_string(),
        "provider-msg-e502".to_string(),
        "provider-msg-missing".to_string(),
    ];

    let existing = filter_existing_provider_message_ids(&pool, link_id, &requested).await?;
    assert!(existing.contains("provider-msg-e501"));
    assert!(existing.contains("provider-msg-e502"));
    assert!(!existing.contains("provider-msg-missing"));
    assert_eq!(existing.len(), 2);

    // Messages belong to the first link only.
    let cross_link = filter_existing_provider_message_ids(&pool, other_link_id, &requested).await?;
    assert!(cross_link.is_empty());

    Ok(())
}
