use super::mark_message_as_sent;
use crate::messages::get::fetch_messages_metadata;
use crate::threads::get::get_thread_by_id_and_link_id;
use crate::threads::update::update_thread_metadata;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_email::service::message::Message;
use sqlx::{PgConnection, PgPool, types::Uuid};

const LINK: Uuid = Uuid::from_u128(0x019a0000_0000_7000_8000_000000000001);
const OTHER_LINK: Uuid = Uuid::from_u128(0x019a0000_0000_7000_8000_000000000002);
const THREAD: Uuid = Uuid::from_u128(0x019a0000_0000_7000_8000_000000000101);
const PROVIDER_THREAD: Uuid = Uuid::from_u128(0x019a0000_0000_7000_8000_000000000102);
const MESSAGE: Uuid = Uuid::from_u128(0x019a0000_0000_7000_8000_000000000201);
const PROVIDER_MESSAGE: Uuid = Uuid::from_u128(0x019a0000_0000_7000_8000_000000000202);

async fn message(conn: &mut PgConnection, thread: Uuid) -> anyhow::Result<Message> {
    let messages = fetch_messages_metadata(conn, thread).await?;
    assert_eq!(messages.len(), 1);
    Ok(messages.into_iter().next().unwrap())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("mark_message_as_sent"))
)]
async fn sent_message_has_recency_before_provider_sync(pool: PgPool) -> anyhow::Result<()> {
    let mut tx = pool.begin().await?;
    let pending = message(tx.as_mut(), THREAD).await?;
    assert!(!pending.is_sent);
    assert!(pending.internal_date_ts.is_none());

    // These are the same two steps used by scheduled-delivery finalization,
    // before its transaction commits and the message_sent event is published.
    mark_message_as_sent(tx.as_mut(), "sent-message", "sent-thread", LINK, MESSAGE).await?;
    update_thread_metadata(tx.as_mut(), THREAD, LINK).await?;
    let sent = message(tx.as_mut(), THREAD).await?;
    assert!(sent.is_sent);
    assert!(!sent.is_draft);
    assert_eq!(sent.provider_id.as_deref(), Some("sent-message"));
    assert_eq!(sent.provider_thread_id.as_deref(), Some("sent-thread"));
    assert_eq!(sent.internal_date_ts, Some(sent.updated_at));
    assert!(sent.internal_date_ts > pending.sent_at);
    tx.commit().await?;

    // The Mail cache capsule and server Sent membership both use this field.
    // It must already exist without a subsequent Gmail inbox-sync pass.
    let thread = get_thread_by_id_and_link_id(&pool, THREAD, LINK)
        .await?
        .unwrap();
    assert_eq!(thread.latest_outbound_message_ts, sent.internal_date_ts);
    assert_eq!(thread.latest_non_spam_message_ts, sent.internal_date_ts);
    assert!(thread.latest_inbound_message_ts.is_none());
    assert!(!thread.inbox_visible);

    let mut retry = pool.begin().await?;
    mark_message_as_sent(retry.as_mut(), "sent-message", "sent-thread", LINK, MESSAGE).await?;
    assert_eq!(
        message(retry.as_mut(), THREAD).await?.internal_date_ts,
        sent.internal_date_ts,
        "replaying finalization must not move the message in Sent"
    );
    retry.commit().await?;
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("mark_message_as_sent"))
)]
async fn sent_message_preserves_provider_timestamp(pool: PgPool) -> anyhow::Result<()> {
    let mut tx = pool.begin().await?;
    let before = message(tx.as_mut(), PROVIDER_THREAD).await?;
    assert!(before.internal_date_ts.is_some());
    mark_message_as_sent(
        tx.as_mut(),
        "provider-message",
        "provider-thread",
        LINK,
        PROVIDER_MESSAGE,
    )
    .await?;
    update_thread_metadata(tx.as_mut(), PROVIDER_THREAD, LINK).await?;
    let sent = message(tx.as_mut(), PROVIDER_THREAD).await?;
    assert!(sent.is_sent);
    assert_eq!(sent.internal_date_ts, before.internal_date_ts);
    tx.commit().await?;

    let thread = get_thread_by_id_and_link_id(&pool, PROVIDER_THREAD, LINK)
        .await?
        .unwrap();
    assert_eq!(thread.latest_outbound_message_ts, before.internal_date_ts);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("mark_message_as_sent"))
)]
async fn sent_message_update_is_scoped_to_its_inbox(pool: PgPool) -> anyhow::Result<()> {
    let mut tx = pool.begin().await?;
    mark_message_as_sent(
        tx.as_mut(),
        "wrong-message",
        "wrong-thread",
        OTHER_LINK,
        MESSAGE,
    )
    .await?;
    let unchanged = message(tx.as_mut(), THREAD).await?;
    assert!(!unchanged.is_sent);
    assert!(unchanged.internal_date_ts.is_none());
    assert!(unchanged.provider_id.is_none());
    tx.commit().await?;
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("mark_message_as_sent"))
)]
async fn failed_finalization_rolls_back_sent_recency(pool: PgPool) -> anyhow::Result<()> {
    let mut tx = pool.begin().await?;
    mark_message_as_sent(tx.as_mut(), "sent-message", "sent-thread", LINK, MESSAGE).await?;
    update_thread_metadata(tx.as_mut(), THREAD, LINK).await?;
    tx.rollback().await?;

    let mut conn = pool.acquire().await?;
    let unchanged = message(&mut conn, THREAD).await?;
    assert!(!unchanged.is_sent);
    assert!(unchanged.internal_date_ts.is_none());
    let thread = get_thread_by_id_and_link_id(&pool, THREAD, LINK)
        .await?
        .unwrap();
    assert!(thread.latest_outbound_message_ts.is_none());
    Ok(())
}
