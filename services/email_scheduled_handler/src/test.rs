use crate::handler::fetch_pending_scheduled_messages;
use anyhow::Result;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::types::Uuid;
use sqlx::{Pool, Postgres};

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "test/fixtures", scripts("fetch_pending_scheduled_messages"))
)]
async fn fetch_pending_returns_only_eligible_messages(pool: Pool<Postgres>) -> Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

    let results = fetch_pending_scheduled_messages(&pool).await?;

    // Should return exactly 3 messages:
    // - Message 1: Draft with past send_time, not sent
    // - Message 5: Draft with past send_time, not sent (different link)
    // - Message 6: Non-draft undo-window send stranded well past its send_time
    assert_eq!(results.len(), 3);

    let message_ids: Vec<Uuid> = results.iter().map(|r| r.message_id).collect();

    assert!(message_ids.contains(&Uuid::parse_str("00000000-0000-0000-0000-00000000f501")?));
    assert!(message_ids.contains(&Uuid::parse_str("00000000-0000-0000-0000-00000000f505")?));
    assert!(message_ids.contains(&Uuid::parse_str("00000000-0000-0000-0000-00000000f506")?));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "test/fixtures", scripts("fetch_pending_scheduled_messages"))
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
    fixtures(path = "test/fixtures", scripts("fetch_pending_scheduled_messages"))
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
    fixtures(path = "test/fixtures", scripts("fetch_pending_scheduled_messages"))
)]
async fn fetch_pending_excludes_delivered_messages(pool: Pool<Postgres>) -> Result<()> {
    let results = fetch_pending_scheduled_messages(&pool).await?;

    let message_ids: Vec<Uuid> = results.iter().map(|r| r.message_id).collect();

    // Messages 4 and 9 both have is_sent = true, so the send already happened
    // and the unsent scheduled row is stale. Re-enqueueing either would send
    // the same mail twice.
    assert!(!message_ids.contains(&Uuid::parse_str("00000000-0000-0000-0000-00000000f504")?));
    assert!(!message_ids.contains(&Uuid::parse_str("00000000-0000-0000-0000-00000000f509")?));

    Ok(())
}

/// The bug this sweep now covers: `send_message_impl` commits the message as a
/// non-draft with a scheduled row and only then enqueues the delivery, so a
/// failed enqueue leaves a message that is not a draft, was never sent, and has
/// no worker coming for it. The old `em.is_draft = TRUE` predicate could not
/// see those rows at all.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "test/fixtures", scripts("fetch_pending_scheduled_messages"))
)]
async fn fetch_pending_includes_stranded_non_draft_sends(pool: Pool<Postgres>) -> Result<()> {
    let results = fetch_pending_scheduled_messages(&pool).await?;

    let rescued = results
        .iter()
        .find(|r| r.message_id == Uuid::parse_str("00000000-0000-0000-0000-00000000f506").unwrap());

    let rescued = rescued.expect("the stranded send should be picked up");
    assert!(
        rescued.stranded,
        "a rescue must be flagged so the underlying send failure is visible in the logs"
    );

    // Ordinary send-later drafts are this sweep's normal work, not rescues.
    let draft = results
        .iter()
        .find(|r| r.message_id == Uuid::parse_str("00000000-0000-0000-0000-00000000f501").unwrap())
        .expect("the send-later draft should be picked up");
    assert!(!draft.stranded);

    Ok(())
}

/// A non-draft send that is only seconds overdue still has its own queue
/// message in flight (or in SQS redelivery), so rescuing it would double-send.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "test/fixtures", scripts("fetch_pending_scheduled_messages"))
)]
async fn fetch_pending_excludes_non_draft_sends_inside_grace_period(
    pool: Pool<Postgres>,
) -> Result<()> {
    let results = fetch_pending_scheduled_messages(&pool).await?;

    let message_ids: Vec<Uuid> = results.iter().map(|r| r.message_id).collect();

    // Message 7 is 30 seconds overdue, well inside the grace period
    assert!(!message_ids.contains(&Uuid::parse_str("00000000-0000-0000-0000-00000000f507")?));

    Ok(())
}

/// A worker already claimed the row, so it is being delivered rather than
/// stranded.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "test/fixtures", scripts("fetch_pending_scheduled_messages"))
)]
async fn fetch_pending_excludes_non_draft_sends_being_processed(
    pool: Pool<Postgres>,
) -> Result<()> {
    let results = fetch_pending_scheduled_messages(&pool).await?;

    let message_ids: Vec<Uuid> = results.iter().map(|r| r.message_id).collect();

    // Message 8 is well overdue but has processing = true
    assert!(!message_ids.contains(&Uuid::parse_str("00000000-0000-0000-0000-00000000f508")?));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "test/fixtures", scripts("fetch_pending_scheduled_messages"))
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
