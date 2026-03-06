use std::collections::HashMap;

use crate::labels::get;
use crate::parse::db_to_service;
use crate::parse::db_to_service::map_attachmentless_db_message_to_service;
use crate::{attachments, contacts, labels, messages};
use anyhow::Context;
use futures::future::try_join_all;
use models_email::email::db;
use models_email::email::service::message::Message;
use models_email::service;
use models_email::service::address::ContactInfo;
use models_email::service::message::{MessageSenderInfo, MessageToSend};
use sqlx::PgPool;
use sqlx::types::Uuid;

/// Returns a map of message IDs to sender info for all found messages
#[tracing::instrument(skip(pool), err)]
pub async fn get_message_sender_and_pretty_sender(
    pool: &PgPool,
    link_id: Uuid,
    message_ids: &[Uuid],
) -> anyhow::Result<HashMap<Uuid, MessageSenderInfo>> {
    // TODO: use NonEmpty
    if message_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let rows = sqlx::query!(
        r#"
        SELECT
            m.id as message_id,
            c.email_address as "sender!",
            COALESCE(c.name, c.email_address) as "pretty_sender!"
        FROM email_messages m
        LEFT JOIN email_contacts c ON c.id = m.from_contact_id
        WHERE m.id = ANY($1)
        AND m.link_id = $2
        "#,
        message_ids,
        link_id
    )
    .fetch_all(pool)
    .await?;

    let mut result = HashMap::new();
    for row in rows {
        let message_id = row.message_id;
        let sender = row.sender;
        let pretty_sender = row.pretty_sender;
        result.insert(
            message_id,
            MessageSenderInfo {
                sender,
                pretty_sender,
            },
        );
    }

    Ok(result)
}

/// Returns the (message_id, thread_id) for a message with the given (link_id, provider_id).
/// Errors if no row is found.
#[tracing::instrument(skip(pool), err)]
pub async fn get_message_and_thread_id_by_provider_id(
    pool: &PgPool,
    link_id: Uuid,
    provider_id: &str,
) -> anyhow::Result<(Uuid, Uuid)> {
    let row = sqlx::query_as(
        r#"
        SELECT id, thread_id
        FROM email_messages
        WHERE link_id = $1 AND provider_id = $2
        LIMIT 1
        "#,
    )
    .bind(link_id)
    .bind(provider_id)
    .fetch_optional(pool)
    .await?;

    match row {
        Some((message_id, thread_id)) => Ok((message_id, thread_id)),
        None => anyhow::bail!(
            "Message not found for link_id={} provider_id={}",
            link_id,
            provider_id
        ),
    }
}

/// Returns `true` if a message already exists for this (provider_id, link_id), else `false`.
#[tracing::instrument(skip(pool), err)]
pub async fn message_exists_by_provider_id(
    pool: &PgPool,
    provider_id: &str,
    link_id: Uuid,
) -> anyhow::Result<bool> {
    let exists: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS(
            SELECT 1
            FROM email_messages
            WHERE provider_id = $1 AND link_id = $2
        )
        "#,
    )
    .bind(provider_id)
    .bind(link_id)
    .fetch_one(pool)
    .await?;

    Ok(exists)
}

/// Fetches the thread's messages without attachments and body attributes.
#[tracing::instrument(skip(conn), err)]
pub async fn fetch_messages_metadata(
    conn: &mut sqlx::PgConnection,
    thread_db_id: Uuid,
) -> anyhow::Result<Vec<Message>> {
    let db_messages = sqlx::query_as!(
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
            NULL as "body_text?",
            NULL as "body_html_sanitized?",
            NULL as "body_macro?"
        FROM email_messages
        WHERE thread_id = $1
        ORDER BY internal_date_ts DESC NULLS LAST
        "#,
        thread_db_id
    )
    .fetch_all(&mut *conn)
    .await?;

    if db_messages.is_empty() {
        return Ok(Vec::new());
    }

    let message_ids: Vec<Uuid> = db_messages.iter().map(|m| m.id).collect();

    let senders_map = contacts::get::get_senders_contacts_map(&mut *conn, &message_ids).await?;

    let recipients_map =
        contacts::get::fetch_db_recipients_in_bulk(&mut *conn, &message_ids).await?;

    let labels_map = get::fetch_message_labels_in_bulk(&mut *conn, &message_ids).await?;

    let mut processed_messages = Vec::with_capacity(db_messages.len());
    for message in db_messages {
        let sender = message
            .from_contact_id
            .and_then(|id| senders_map.get(&id).cloned());
        let recipients = recipients_map.get(&message.id).cloned().unwrap_or_default();
        let labels = labels_map.get(&message.id).cloned().unwrap_or_default();

        processed_messages.push(db_to_service::map_attachmentless_db_message_to_service(
            message, sender, recipients, None, labels,
        ));
    }

    Ok(processed_messages)
}

/// Fetches the thread's messages with labels.
#[tracing::instrument(skip(conn), err)]
pub async fn fetch_messages_with_labels(
    conn: &PgPool,
    thread_db_id: Uuid,
    link_id: Uuid,
) -> anyhow::Result<Vec<Message>> {
    let db_messages = sqlx::query_as!(
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
            NULL as "body_text?",
            NULL as "body_html_sanitized?",
            NULL as "body_macro?"
        FROM email_messages
        WHERE thread_id = $1 and link_id = $2
        ORDER BY internal_date_ts DESC NULLS LAST
        "#,
        thread_db_id,
        link_id
    )
    .fetch_all(conn)
    .await?;

    if db_messages.is_empty() {
        return Ok(Vec::new());
    }

    let message_ids: Vec<Uuid> = db_messages.iter().map(|m| m.id).collect();

    let labels_map = get::fetch_message_labels_in_bulk(conn, &message_ids).await?;

    let mut processed_messages = Vec::with_capacity(db_messages.len());
    for message in db_messages {
        let labels = labels_map.get(&message.id).cloned().unwrap_or_default();

        processed_messages.push(db_to_service::map_attachmentless_db_message_to_service(
            message,
            None,
            Vec::new(),
            None,
            labels,
        ));
    }

    Ok(processed_messages)
}

// gets the headers we need for threading messages correctly
#[tracing::instrument(skip(pool), err)]
pub async fn get_message_threading_headers(
    pool: &PgPool,
    message_id: Uuid,
    link_id: Uuid,
) -> anyhow::Result<(Option<String>, Option<String>)> {
    let row_option = sqlx::query!(
        r#"
        SELECT 
          -- Use trim() to remove the leading/trailing angle brackets
          trim(jsonb_path_query_first(headers_jsonb, '$[*] ? (@.name like_regex "message-id" flag "i").value') #>> '{}', '<>') as "message_id",
          -- The references header can have multiple IDs, so we just return it raw
          jsonb_path_query_first(headers_jsonb, '$[*] ? (@.name like_regex "references" flag "i").value') #>> '{}' as "references"
        FROM email_messages
        WHERE id = $1 AND link_id = $2
        "#,
        message_id,
        link_id
    )
        .fetch_optional(pool)
        .await?;

    match row_option {
        Some(row) => Ok((row.message_id, row.references)),
        None => Ok((None, None)),
    }
}

/// Retrieves the ID of a message based on link_id and global_id, if exists
#[tracing::instrument(skip(executor), err)]
pub async fn get_message_id_by_global_id<'e, E>(
    executor: E,
    link_id: Uuid,
    global_id: &str,
) -> anyhow::Result<Option<Uuid>>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    let message_id = sqlx::query_scalar!(
        r#"
        SELECT id
        FROM email_messages
        WHERE link_id = $1 AND global_id = $2
        "#,
        link_id,
        global_id
    )
    .fetch_optional(executor)
    .await?;

    Ok(message_id)
}

/// fetch draft message and sender contact info from database for sending
#[tracing::instrument(skip(pool), err)]
pub async fn get_message_to_send(
    pool: &PgPool,
    message_id: Uuid,
    link_id: Uuid,
) -> anyhow::Result<(MessageToSend, ContactInfo)> {
    let db_message = sqlx::query_as!(
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
            from_name,
            from_contact_id,
            sent_at,
            has_attachments,
            is_read,
            is_starred,
            is_sent,
            is_draft,
            body_text,
            body_html_sanitized,
            body_macro,
            headers_jsonb,
            created_at,
            updated_at
        FROM email_messages
        WHERE id = $1 and link_id = $2
        "#,
        message_id,
        link_id
    )
    .fetch_one(pool)
    .await?;

    // fetch data from each table concurrently
    let (sender_res, recipients_res) = tokio::try_join!(
        async { contacts::get::get_sender_by_message_id(pool, message_id).await },
        contacts::get::fetch_db_recipients(pool, db_message.id)
    )?;

    // db message will always have sender id
    let sender = sender_res.unwrap();

    // parse db-layer structs into service-layer message struct
    let message_to_send =
        db_to_service::map_db_message_to_message_to_send(db_message, recipients_res);

    Ok((
        message_to_send,
        ContactInfo {
            email: sender.email_address.unwrap(),
            name: sender.name,
            photo_url: sender.sfs_photo_url,
        },
    ))
}

/// Returns `true` if a message with `is_draft = true` exists for the given (link_id, id).
#[tracing::instrument(skip(pool), err)]
pub async fn draft_exists_with_id(
    pool: &PgPool,
    link_id: Uuid,
    db_id: Uuid,
) -> anyhow::Result<bool> {
    let exists: bool = sqlx::query_scalar!(
        r#"
            SELECT EXISTS(
                SELECT 1
                FROM email_messages
                WHERE id = $1 AND link_id = $2 AND is_draft = true
            ) as "exists!"
            "#,
        db_id,
        link_id
    )
    .fetch_one(pool)
    .await?;

    Ok(exists)
}

/// Converts a list of db messages to service messages by fetching ALL associated data
/// in bulk (one query per data type for all messages), then mapping results back.
pub async fn convert_db_messages_to_service_concurrent(
    pool: &PgPool,
    db_messages: Vec<db::message::Message>,
) -> anyhow::Result<Vec<service::message::Message>> {
    if db_messages.is_empty() {
        return Ok(Vec::new());
    }

    // Collect all message IDs
    let message_ids: Vec<Uuid> = db_messages.iter().map(|m| m.id).collect();

    // Collect message IDs that have attachments
    let message_ids_with_attachments: Vec<Uuid> = db_messages
        .iter()
        .filter(|m| m.has_attachments)
        .map(|m| m.id)
        .collect();

    // Query for drafts and sent messages we haven't gotten a provider id from gmail for. We return
    // draft attachments for non-drafts without provider ids so we can show the attachments on the
    // just-sent message, before the undo delay expires and before we get the provider id from gmail.
    let draft_message_ids: Vec<Uuid> = db_messages
        .iter()
        .filter(|m| m.provider_id.is_none())
        .map(|m| m.id)
        .collect();

    // Fetch all data concurrently using bulk functions
    let (
        senders_map,
        recipients_map,
        scheduled_map,
        labels_map,
        attachments_map,
        draft_attachments_map,
        forwarded_attachments_map,
    ) = tokio::try_join!(
        contacts::get::fetch_senders_by_message_ids(pool, &message_ids),
        contacts::get::fetch_db_recipients_in_bulk(pool, &message_ids),
        messages::scheduled::get::fetch_scheduled_messages_in_bulk(pool, &message_ids),
        labels::get::fetch_message_labels_in_bulk(pool, &message_ids),
        attachments::provider::fetch_db_attachments_in_bulk(pool, &message_ids_with_attachments),
        attachments::draft::fetch_db_draft_attachments_in_bulk(pool, &draft_message_ids),
        attachments::forwarded::fetch_forwarded_attachments_in_bulk(pool, &draft_message_ids),
    )?;

    // Build service messages concurrently by looking up data from the hashmaps
    let message_processing_futures = db_messages.into_iter().map(|db_message| {
        let message_id = db_message.id;

        // Look up data from maps (cloning to move into async block)
        let sender = senders_map.get(&message_id).cloned();
        let recipients = recipients_map.get(&message_id).cloned().unwrap_or_default();
        let scheduled = scheduled_map.get(&message_id).cloned();
        let labels = labels_map.get(&message_id).cloned().unwrap_or_default();
        let attachments = attachments_map
            .get(&message_id)
            .cloned()
            .unwrap_or_default();
        let draft_attachments = draft_attachments_map
            .get(&message_id)
            .cloned()
            .unwrap_or_default();
        let forwarded_attachments = forwarded_attachments_map
            .get(&message_id)
            .cloned()
            .unwrap_or_default();

        async move {
            // Build the service message without attachments first
            let service_message = map_attachmentless_db_message_to_service(
                db_message, sender, recipients, scheduled, labels,
            );

            // Add attachments
            db_to_service::map_db_message_attachments_to_service(
                service_message,
                attachments,
                draft_attachments,
                forwarded_attachments,
            )
        }
    });

    try_join_all(message_processing_futures)
        .await
        .context("Failed processing messages concurrently")
}
