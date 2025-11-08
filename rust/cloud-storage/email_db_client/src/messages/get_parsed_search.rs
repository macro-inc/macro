use crate::parse::db_to_service;
use crate::{contacts, labels};
use anyhow::Context;
use futures::future::join_all;
use models_email::db;
use models_email::service::message;
use models_email::service::message::{MessageWithBodyReplyless, ParsedSearchMessage};
use sqlx::PgPool;
use sqlx::types::Uuid;

/// retreive a parsed search message by its id.
/// returns None if no message was found.
#[tracing::instrument(skip(pool))]
pub async fn get_parsed_search_message_by_id(
    pool: &PgPool,
    message_id: &Uuid,
) -> anyhow::Result<Option<message::ParsedSearchMessage>> {
    let mut conn = pool.acquire().await?;

    // Only fetch parsed body
    let db_message = sqlx::query_as!(
        db::message::Message,
        r#"
        SELECT
            m.id, m.provider_id, m.global_id, m.link_id, m.thread_id, m.provider_thread_id, m.provider_history_id,
            m.replying_to_id, m.internal_date_ts, m.snippet, m.size_estimate, m.subject,
            m.from_contact_id, m.sent_at, m.has_attachments, m.is_read, m.is_starred, m.is_sent, m.is_draft,
            m.body_text as body_text,
            m.body_html_sanitized as body_html_sanitized,
            NULL::TEXT as body_macro,
            m.headers_jsonb, m.created_at, m.updated_at
        FROM email_messages m
        JOIN email_links l ON m.link_id = l.id
        WHERE m.id = $1
        "#,
        message_id,
    )
        .fetch_optional(&mut *conn)
        .await
        .with_context(|| {
            format!(
                "Failed to fetch message {}",
                message_id
            )
        })?;

    let db_message: db::message::Message = if let Some(db_message) = db_message {
        db_message
    } else {
        return Ok(None);
    };

    let message_ids: Vec<Uuid> = vec![db_message.id];
    let sender_ids: Vec<Uuid> = vec![db_message.from_contact_id.unwrap_or_default()];

    let senders_map = contacts::get::get_contacts_map(&mut *conn, &sender_ids)
        .await
        .context("Failed to fetch senders in bulk")?;

    let recipients_map = contacts::get::fetch_db_recipients_in_bulk(&mut *conn, &message_ids)
        .await
        .context("Failed to fetch recipients in bulk")?;

    let labels_map = labels::get::fetch_message_labels_in_bulk(&mut *conn, &message_ids)
        .await
        .context("Failed to fetch message labels in bulk")?;

    let sender = db_message
        .from_contact_id
        .and_then(|id| senders_map.get(&id).cloned());
    let recipients = recipients_map
        .get(&db_message.id)
        .cloned()
        .unwrap_or_default();
    let labels = labels_map.get(&db_message.id).cloned().unwrap_or_default();

    let service_message = db_to_service::map_attachmentless_db_message_to_service(
        db_message, sender, recipients, None, labels,
    );

    Ok(Some(ParsedSearchMessage::from(
        MessageWithBodyReplyless::from(service_message),
    )))
}

/// get a paginated number of messages for a given thread.
#[tracing::instrument(skip(pool))]
pub async fn get_paginated_parsed_search_messages_by_thread_id(
    pool: &PgPool,
    thread_id: Uuid,
    offset: i64,
    limit: i64,
) -> anyhow::Result<Vec<message::ParsedSearchMessage>> {
    let mut conn = pool
        .acquire()
        .await
        .context("failed to acquire connection")?;

    // Get messages for thread
    let db_messages: Vec<db::message::Message> = sqlx::query_as!(
        db::message::Message,
        r#"
        SELECT
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
    let sender_ids: Vec<Uuid> = db_messages
        .iter()
        .filter_map(|m| m.from_contact_id)
        .collect();

    let senders_map = contacts::get::get_contacts_map(&mut *conn, &sender_ids)
        .await
        .context("Failed to fetch senders in bulk")?;

    let recipients_map = contacts::get::fetch_db_recipients_in_bulk(&mut *conn, &message_ids)
        .await
        .context("Failed to fetch recipients in bulk")?;

    let labels_map = labels::get::fetch_message_labels_in_bulk(&mut *conn, &message_ids)
        .await
        .context("Failed to fetch message labels in bulk")?;

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

                let service_message = db_to_service::map_attachmentless_db_message_to_service(
                    message, sender, recipients, None, labels,
                );

                ParsedSearchMessage::from(MessageWithBodyReplyless::from(service_message))
            }
        })
        .collect();

    let result = join_all(tasks).await;

    Ok(result)
}
