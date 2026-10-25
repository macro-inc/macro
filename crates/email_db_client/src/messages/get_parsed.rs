use crate::parse::db_to_service::{self};
use crate::{contacts, labels};

use chrono::{DateTime, Utc};
use futures::future::join_all;
use models_email::email::service::message;
use models_email::email::{db, service};
use models_email::service::message::{MessageWithBodyReplyless, ParsedMessage};
use serde_json::Value as JsonValue;
use sqlx::PgPool;
use sqlx::types::Uuid;

// Keep the edit generation in the same SQL snapshot as the parsed message.
struct ParsedMessageRow {
    draft_generation: i32,
    id: Uuid,
    provider_id: Option<String>,
    thread_id: Uuid,
    provider_thread_id: Option<String>,
    replying_to_id: Option<Uuid>,
    global_id: Option<String>,
    link_id: Uuid,
    provider_history_id: Option<String>,
    internal_date_ts: Option<DateTime<Utc>>,
    snippet: Option<String>,
    size_estimate: Option<i64>,
    subject: Option<String>,
    from_name: Option<String>,
    from_contact_id: Option<Uuid>,
    sent_at: Option<DateTime<Utc>>,
    has_attachments: bool,
    is_read: bool,
    is_starred: bool,
    is_sent: bool,
    is_draft: bool,
    body_text: Option<String>,
    body_html_sanitized: Option<String>,
    body_macro: Option<String>,
    headers_jsonb: Option<JsonValue>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl From<ParsedMessageRow> for db::message::Message {
    fn from(row: ParsedMessageRow) -> Self {
        Self {
            id: row.id,
            provider_id: row.provider_id,
            thread_id: row.thread_id,
            provider_thread_id: row.provider_thread_id,
            replying_to_id: row.replying_to_id,
            global_id: row.global_id,
            link_id: row.link_id,
            provider_history_id: row.provider_history_id,
            internal_date_ts: row.internal_date_ts,
            snippet: row.snippet,
            size_estimate: row.size_estimate,
            subject: row.subject,
            from_name: row.from_name,
            from_contact_id: row.from_contact_id,
            sent_at: row.sent_at,
            has_attachments: row.has_attachments,
            is_read: row.is_read,
            is_starred: row.is_starred,
            is_sent: row.is_sent,
            is_draft: row.is_draft,
            body_text: row.body_text,
            body_html_sanitized: row.body_html_sanitized,
            body_macro: row.body_macro,
            headers_jsonb: row.headers_jsonb,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

/// retreive a parsed message by its id.
/// returns None if no message was found.
#[tracing::instrument(skip(pool), err)]
pub async fn get_parsed_message_by_id(
    pool: &PgPool,
    message_id: &Uuid,
) -> anyhow::Result<Option<message::ParsedMessage>> {
    let mut conn = pool.acquire().await?;

    // Only fetch parsed body
    let db_message = sqlx::query_as!(
        ParsedMessageRow,
        r#"
        SELECT
            m.draft_generation, m.id, m.provider_id, m.global_id, m.link_id, m.thread_id, m.provider_thread_id, m.provider_history_id,
            m.replying_to_id, m.internal_date_ts, m.snippet, m.size_estimate, m.subject, m.from_name,
            m.from_contact_id, m.sent_at, m.has_attachments, m.is_read, m.is_starred, m.is_sent, m.is_draft,
            NULL::TEXT as body_text,
            NULL::TEXT as body_html_sanitized,
            NULL::TEXT as body_macro,
            m.headers_jsonb, m.created_at, m.updated_at
        FROM email_messages m
        JOIN email_links l ON m.link_id = l.id
        WHERE m.id = $1
        "#,
        message_id,
    )
        .fetch_optional(&mut *conn)
        .await?;

    let db_message = if let Some(db_message) = db_message {
        db_message
    } else {
        return Ok(None);
    };

    let message_ids: Vec<Uuid> = vec![db_message.id];

    let senders_map = contacts::get::get_senders_contacts_map(&mut *conn, &message_ids).await?;

    let recipients_map =
        contacts::get::fetch_db_recipients_in_bulk(&mut *conn, &message_ids).await?;

    let labels_map = labels::get::fetch_message_labels_in_bulk(&mut *conn, &message_ids).await?;

    let sender = db_message
        .from_contact_id
        .and_then(|id| senders_map.get(&id).cloned());
    let recipients = recipients_map
        .get(&db_message.id)
        .cloned()
        .unwrap_or_default();
    let labels = labels_map.get(&db_message.id).cloned().unwrap_or_default();

    let draft_generation = db_message.draft_generation;
    let service_message = db_to_service::map_attachmentless_db_message_to_service(
        db_message.into(),
        sender,
        recipients,
        None,
        labels,
    );

    Ok(Some(ParsedMessage::with_generation(
        MessageWithBodyReplyless::from(service_message),
        draft_generation,
    )))
}

/// retreive a list of parsed message by their ids
#[tracing::instrument(skip(pool), err)]
pub async fn get_parsed_messages_by_id_batch(
    pool: &PgPool,
    message_ids: &[Uuid],
) -> anyhow::Result<Vec<service::message::ParsedMessage>> {
    let mut conn = pool.acquire().await?;

    let db_messages: Vec<ParsedMessageRow> = sqlx::query_as!(
        ParsedMessageRow,
        r#"
        SELECT
            m.draft_generation, m.id, m.provider_id, m.global_id, m.link_id, m.thread_id, m.provider_thread_id, m.provider_history_id,
            m.replying_to_id, m.internal_date_ts, m.snippet, m.size_estimate, m.subject, m.from_name,
            m.from_contact_id, m.sent_at, m.has_attachments, m.is_read, m.is_starred, m.is_sent, m.is_draft,
            m.body_text as body_text,
            m.body_html_sanitized as body_html_sanitized,
            NULL::TEXT as body_macro,
            m.headers_jsonb, m.created_at, m.updated_at
        FROM email_messages m
        JOIN email_links l ON m.link_id = l.id
        WHERE m.id = ANY($1)
        "#,
        &message_ids,
    )
    .fetch_all(&mut *conn)
    .await?;

    if db_messages.is_empty() {
        tracing::trace!("no messages found");
        return Ok(Vec::new());
    }

    let message_ids: Vec<Uuid> = db_messages.iter().map(|m| m.id).collect();

    let senders_map = contacts::get::get_senders_contacts_map(&mut *conn, &message_ids).await?;

    let recipients_map =
        contacts::get::fetch_db_recipients_in_bulk(&mut *conn, &message_ids).await?;

    let labels_map = labels::get::fetch_message_labels_in_bulk(&mut *conn, &message_ids).await?;

    let tasks: Vec<_> = db_messages
        .into_iter()
        .map(|message| {
            let senders_map = &senders_map;
            let recipients_map = &recipients_map;
            let labels_map = &labels_map;

            async move {
                let sender = message
                    .from_contact_id
                    .and_then(|id| senders_map.get(&id).cloned());
                let recipients = recipients_map.get(&message.id).cloned().unwrap_or_default();
                let labels = labels_map.get(&message.id).cloned().unwrap_or_default();

                let draft_generation = message.draft_generation;
                let service_message = db_to_service::map_attachmentless_db_message_to_service(
                    message.into(),
                    sender,
                    recipients,
                    None,
                    labels,
                );

                ParsedMessage::with_generation(
                    MessageWithBodyReplyless::from(service_message),
                    draft_generation,
                )
            }
        })
        .collect();

    let result = join_all(tasks).await;

    Ok(result)
}

/// get a paginated number of messages for a given thread.
#[tracing::instrument(skip(pool), err)]
pub async fn get_paginated_parsed_messages_by_thread_id(
    pool: &PgPool,
    thread_id: Uuid,
    offset: i64,
    limit: i64,
) -> anyhow::Result<Vec<message::ParsedMessage>> {
    let mut conn = pool.acquire().await?;

    // Get messages for thread
    let db_messages: Vec<ParsedMessageRow> = sqlx::query_as!(
        ParsedMessageRow,
        r#"
        SELECT
            draft_generation,
            id,
            provider_id,
            global_id,
            thread_id,
            provider_thread_id,
            replying_to_id,
            link_id,
            provider_history_id,
            internal_date_ts,
            snippet,
            size_estimate,
            subject,
            from_name,
            from_contact_id,
            sent_at,
            has_attachments,
            is_read,
            is_starred,
            is_sent,
            is_draft,
            headers_jsonb,
            created_at,
            updated_at,
            -- No body attributes
            body_text as body_text,
            body_html_sanitized as body_html_sanitized,
            NULL::TEXT as body_macro
        FROM email_messages
        WHERE thread_id = $1
        ORDER BY internal_date_ts DESC NULLS LAST
        LIMIT $2 OFFSET $3
        "#,
        thread_id,
        limit,
        offset
    )
    .fetch_all(&mut *conn)
    .await?;

    if db_messages.is_empty() {
        tracing::trace!("no messages found");
        return Ok(Vec::new());
    }

    let message_ids: Vec<Uuid> = db_messages.iter().map(|m| m.id).collect();

    let senders_map = contacts::get::get_senders_contacts_map(&mut *conn, &message_ids).await?;

    let recipients_map =
        contacts::get::fetch_db_recipients_in_bulk(&mut *conn, &message_ids).await?;

    let labels_map = labels::get::fetch_message_labels_in_bulk(&mut *conn, &message_ids).await?;

    let tasks: Vec<_> = db_messages
        .into_iter()
        .map(|message| {
            let senders_map = &senders_map;
            let recipients_map = &recipients_map;
            let labels_map = &labels_map;

            async move {
                let sender = message
                    .from_contact_id
                    .and_then(|id| senders_map.get(&id).cloned());
                let recipients = recipients_map.get(&message.id).cloned().unwrap_or_default();
                let labels = labels_map.get(&message.id).cloned().unwrap_or_default();

                let draft_generation = message.draft_generation;
                let service_message = db_to_service::map_attachmentless_db_message_to_service(
                    message.into(),
                    sender,
                    recipients,
                    None,
                    labels,
                );

                ParsedMessage::with_generation(
                    MessageWithBodyReplyless::from(service_message),
                    draft_generation,
                )
            }
        })
        .collect();

    let result = join_all(tasks).await;

    Ok(result)
}
