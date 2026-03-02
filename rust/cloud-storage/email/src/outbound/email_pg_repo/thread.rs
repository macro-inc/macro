use crate::domain::models::{MessageRow, ThreadRow};
use sqlx::PgPool;
use uuid::Uuid;

use super::db_types::{DbMessageRow, DbThreadRow};

#[tracing::instrument(err, skip(pool))]
pub(super) async fn thread_by_id(
    pool: &PgPool,
    thread_id: Uuid,
) -> Result<Option<ThreadRow>, sqlx::Error> {
    let row = sqlx::query_as!(
        DbThreadRow,
        r#"
        SELECT t.id, t.provider_id, t.link_id, t.inbox_visible, t.is_read,
               t.latest_inbound_message_ts, t.latest_outbound_message_ts,
               t.latest_non_spam_message_ts, t.created_at, t.updated_at
        FROM email_threads t
        WHERE t.id = $1
        "#,
        thread_id,
    )
    .fetch_optional(pool)
    .await?;

    Ok(row.map(ThreadRow::from))
}

#[tracing::instrument(err, skip(pool))]
pub(super) async fn messages_by_thread_id_paginated(
    pool: &PgPool,
    thread_id: Uuid,
    offset: i64,
    limit: i64,
) -> Result<Vec<MessageRow>, sqlx::Error> {
    let rows = sqlx::query_as!(
        DbMessageRow,
        r#"
        SELECT
            id, provider_id, thread_id, provider_thread_id, replying_to_id,
            global_id, link_id, provider_history_id, internal_date_ts, snippet,
            size_estimate, subject, sent_at, has_attachments, is_read, is_starred,
            is_sent, is_draft, body_text, body_html_sanitized, body_macro,
            headers_jsonb, created_at, updated_at
        FROM email_messages
        WHERE thread_id = $1
        ORDER BY internal_date_ts DESC
        LIMIT $2 OFFSET $3
        "#,
        thread_id,
        limit,
        offset,
    )
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(MessageRow::from).collect())
}
