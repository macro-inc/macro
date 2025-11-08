use crate::messages;
use crate::messages::get::fetch_messages_metadata;
use anyhow::Context;
use chrono::{DateTime, Utc};
use models_email::email::service::message::{is_inbound, is_outbound, is_spam_or_trash};
use models_email::gmail::labels::SystemLabelID;
use models_email::service;
use sqlx::PgPool;
use sqlx::types::Uuid;

/// Updates a thread's metadata
#[expect(clippy::too_many_arguments, reason = "too annoying to fix right now")]
#[tracing::instrument(skip(tx), level = "debug")]
async fn update_db_thread_metadata(
    tx: &mut sqlx::PgConnection,
    thread_id: Uuid,
    link_id: Uuid,
    inbox_visible: bool,
    is_read: bool,
    latest_inbound_message_ts: Option<DateTime<Utc>>,
    latest_outbound_message_ts: Option<DateTime<Utc>>,
    latest_non_spam_message_ts: Option<DateTime<Utc>>,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        UPDATE email_threads
        SET
            inbox_visible = $1,
            is_read = $2,
            latest_inbound_message_ts = $3,
            latest_outbound_message_ts = $4,
            latest_non_spam_message_ts = $5,
            updated_at = NOW()
        WHERE
            id = $6 AND
            link_id = $7
        "#,
        inbox_visible,
        is_read,
        latest_inbound_message_ts,
        latest_outbound_message_ts,
        latest_non_spam_message_ts,
        thread_id,
        link_id,
    )
    .execute(tx)
    .await
    .context(format!(
        "Failed to update timestamps for thread ID {} with link_id {}",
        thread_id, link_id
    ))?;

    Ok(())
}

// updates a thread's archived status to the passed boolean without performing checks
#[tracing::instrument(skip(conn))]
pub async fn update_inbox_visible_status(
    conn: &mut sqlx::PgConnection,
    thread_id: Uuid,
    link_id: Uuid,
    inbox_visible: bool,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        UPDATE email_threads
        SET
            inbox_visible = $1,
            updated_at = NOW()
        WHERE
            id = $2 AND
            link_id = $3
        "#,
        inbox_visible,
        thread_id,
        link_id,
    )
    .execute(conn)
    .await
    .context(format!(
        "Failed to update archived status to {} for thread ID {} with link_id {}",
        inbox_visible, thread_id, link_id
    ))?;

    Ok(())
}

/// Updates a thread's inbox_visible status, setting the value based on the inbox state
#[tracing::instrument(skip(tx), level = "debug")]
pub async fn validate_inbox_visible_status(
    tx: &mut sqlx::PgConnection,
    thread_db_id: Uuid,
    link_id: Uuid,
) -> anyhow::Result<()> {
    let inbox_count = messages::get::count_thread_messages_with_label(
        &mut *tx,
        thread_db_id,
        link_id,
        SystemLabelID::Inbox.as_ref(),
    )
    .await
    .context("Failed to count thread messages with label")?;

    // update the archived status of the thread
    update_inbox_visible_status(tx, thread_db_id, link_id, inbox_count != 0)
        .await
        .context("Failed to update thread inbox_visible status")?;

    Ok(())
}

/// Updates a thread's read status
#[tracing::instrument(skip(db))]
pub async fn update_thread_read_status(
    db: &PgPool,
    thread_id: Uuid,
    link_id: Uuid,
    is_read: bool,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        UPDATE email_threads
        SET
            is_read = $1,
            updated_at = NOW()
        WHERE
            id = $2 AND
            link_id = $3
        "#,
        is_read,
        thread_id,
        link_id,
    )
    .execute(db)
    .await
    .context(format!(
        "Failed to update read status to {} for thread ID {} with link_id {}",
        is_read, thread_id, link_id
    ))?;

    Ok(())
}

/// Updates a thread's provider_id
#[tracing::instrument(skip(conn))]
pub async fn update_thread_provider_id(
    conn: &mut sqlx::PgConnection,
    thread_id: Uuid,
    link_id: Uuid,
    provider_id: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        UPDATE email_threads
        SET
            provider_id = $1,
            updated_at = NOW()
        WHERE
            id = $2 AND
            link_id = $3
        "#,
        provider_id,
        thread_id,
        link_id,
    )
    .execute(conn)
    .await
    .context(format!(
        "Failed to update provider_id to '{}' for thread ID {} with link_id {}",
        provider_id, thread_id, link_id
    ))?;

    Ok(())
}

// Updates a thread's metadata (archived status, latest_timestamps)
#[tracing::instrument(skip(tx), level = "debug")]
pub async fn update_thread_metadata(
    tx: &mut sqlx::PgConnection,
    thread_db_id: Uuid,
    link_id: Uuid,
) -> anyhow::Result<()> {
    let messages = fetch_messages_metadata(&mut *tx, thread_db_id)
        .await
        .context("Failed to get messages for thread")?;

    // if any message in the thread has the INBOX label, the thread is visible in the inbox
    let inbox_visible = messages.iter().any(|message| {
        message
            .labels
            .iter()
            .any(|label| label.provider_label_id == service::label::system_labels::INBOX)
    });

    // if any message in the thread is unread, the thread is considered unread in the FE
    let is_read = !messages.iter().any(|message| !message.is_read);

    let latest_inbound_timestamp_ts = messages
        .iter()
        .find(|msg| is_inbound(msg))
        .map(|msg| msg.internal_date_ts)
        .unwrap_or_else(|| None);

    let latest_outbound_message_ts = messages
        .iter()
        .find(|msg| is_outbound(msg))
        .map(|msg| msg.internal_date_ts)
        .unwrap_or_else(|| None);

    let latest_non_spam_message_ts = messages
        .iter()
        .find(|msg| !is_spam_or_trash(msg))
        .map(|msg| msg.internal_date_ts)
        .unwrap_or_else(|| None);

    update_db_thread_metadata(
        &mut *tx,
        thread_db_id,
        link_id,
        inbox_visible,
        is_read,
        latest_inbound_timestamp_ts,
        latest_outbound_message_ts,
        latest_non_spam_message_ts,
    )
    .await
    .context("Failed to update thread timestamps")?;

    Ok(())
}
