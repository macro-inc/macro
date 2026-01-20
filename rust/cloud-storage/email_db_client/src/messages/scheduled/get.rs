use crate::messages::get::convert_db_messages_to_service;
use models_email::{db, service};
use sqlx::PgPool;
use sqlx::types::Uuid;

/// Retrieves a scheduled message by link_id and message_id
/// Returns None if the message doesn't exist
#[tracing::instrument(skip(db), err)]
pub async fn get_scheduled_message<'e, E>(
    db: E,
    link_id: Uuid,
    message_id: Uuid,
) -> anyhow::Result<Option<service::message::ScheduledMessage>>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    let record = sqlx::query_as!(
        service::message::ScheduledMessage,
        r#"
        SELECT link_id, message_id, send_time, sent, processing
        FROM email_scheduled_messages
        WHERE link_id = $1 AND message_id = $2
        "#,
        link_id,
        message_id,
    )
    .fetch_optional(db)
    .await?;

    Ok(record)
}

/// Retrieves a scheduled message by link_id and message_id, and sets processing to true
/// Returns the message with the OLD processing value (before it was set to true)
/// Returns None if the message doesn't exist
#[tracing::instrument(skip(db), err)]
pub async fn get_and_start_processing_scheduled_message(
    db: &sqlx::PgPool,
    link_id: Uuid,
    message_id: Uuid,
) -> anyhow::Result<Option<service::message::ScheduledMessage>> {
    let record = sqlx::query_as!(
        service::message::ScheduledMessage,
        r#"
        WITH old AS (
            SELECT link_id, message_id, send_time, sent, processing
            FROM email_scheduled_messages
            WHERE link_id = $1 AND message_id = $2
        ), updated AS (
            UPDATE email_scheduled_messages
            SET processing = true, updated_at = NOW()
            WHERE link_id = $1 AND message_id = $2
        )
        SELECT link_id, message_id, send_time, sent, processing
        FROM old
        "#,
        link_id,
        message_id,
    )
    .fetch_optional(db)
    .await?;

    Ok(record)
}

/// Retrieves scheduled messages for drafts that have not been sent yet. used for populating
/// messages in get thread by id endpoint
#[tracing::instrument(skip(db), err)]
pub async fn get_scheduled_message_no_auth(
    db: &sqlx::PgPool,
    message_id: sqlx::types::Uuid,
) -> anyhow::Result<Option<db::message::ScheduledMessage>> {
    let record = sqlx::query_as!(
        db::message::ScheduledMessage,
        r#"
        SELECT link_id, message_id, send_time, sent, processing
        FROM email_scheduled_messages
        WHERE message_id = $1 and sent = false
        "#,
        message_id,
    )
    .fetch_optional(db)
    .await?;

    Ok(record)
}

/// Fetches unsent scheduled messages for a link with pagination
#[tracing::instrument(skip(pool), err)]
pub async fn get_scheduled_messages_by_link_id(
    pool: &PgPool,
    link_id: Uuid,
    offset: u32,
    limit: u32,
) -> anyhow::Result<Vec<service::message::Message>> {
    if limit == 0 {
        anyhow::bail!("limit must be positive");
    }

    let db_messages = get_scheduled_db_messages_by_link_id(pool, link_id, offset, limit).await?;
    convert_db_messages_to_service(pool, db_messages).await
}

/// Fetches unsent scheduled db messages for a link with pagination
#[tracing::instrument(skip(pool), err)]
pub async fn get_scheduled_db_messages_by_link_id(
    pool: &PgPool,
    link_id: Uuid,
    offset: u32,
    limit: u32,
) -> anyhow::Result<Vec<db::message::Message>> {
    let db_messages = sqlx::query_as!(
        db::message::Message,
        r#"
        SELECT
            m.id,
            m.provider_id,
            m.global_id,
            m.thread_id,
            m.provider_thread_id,
            m.replying_to_id,
            m.link_id,
            m.provider_history_id,
            m.internal_date_ts,
            m.snippet,
            m.size_estimate,
            m.subject,
            m.from_name,
            m.from_contact_id,
            m.sent_at,
            m.has_attachments,
            m.is_read,
            m.is_starred,
            m.is_sent,
            m.is_draft,
            m.body_text,
            m.body_html_sanitized,
            m.body_macro,
            m.headers_jsonb,
            m.created_at,
            m.updated_at
        FROM email_messages m
        JOIN email_scheduled_messages sm ON m.id = sm.message_id
        WHERE m.link_id = $1 AND sm.sent = false
        ORDER BY m.created_at DESC
        LIMIT $2 OFFSET $3
        "#,
        link_id,
        limit as i64,
        offset as i64
    )
    .fetch_all(pool)
    .await?;

    Ok(db_messages)
}
