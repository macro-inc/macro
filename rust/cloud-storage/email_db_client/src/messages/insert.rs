use crate::attachments::{marco, provider};
use crate::messages::replying_to_id;
use crate::messages::scheduled::{delete_scheduled_message, upsert_scheduled_message};
use crate::parse::service_to_db::{addresses_from_message, map_message_to_send_to_db};
use crate::{contacts, labels, parse, threads};
use anyhow::Context;
use chrono::Utc;
use models_email::email::db::address::UpsertedRecipients;
use models_email::email::service::message;
use models_email::service::message::ScheduledMessage;
use sqlx::PgPool;
use sqlx::types::Uuid;

/// inserts a message (and all its related parts) into the database using the passed transaction.
pub async fn insert_message_with_tx(
    tx: &mut sqlx::PgConnection,
    thread_db_id: Uuid,
    message: &mut message::Message,
    link_id: Uuid,
    // addresses (and labels) need to be inserted ahead of time outside the tx, as they are shared
    // across messages and can cause deadlocks if inserted within.
    recipents: UpsertedRecipients,
    // determines whether to update thread metadata (inbox_visible, timestamps). set to false when:
    // 1. inserting thread simultaneously (thread already has latest values)
    // 2. backfilling messages (metadata gets updated once after all messages complete)
    update_thread_metadata: bool,
) -> anyhow::Result<()> {
    let message_db_id = insert_db_message(
        tx,
        message,
        thread_db_id,
        recipents.from_contact_id,
        update_thread_metadata,
    )
    .await
    .context("Failed to insert message")?;

    contacts::upsert_message::upsert_message_recipients(tx, message_db_id, &recipents)
        .await
        .context("Failed to insert recipients")?;

    if !message.labels.is_empty() {
        let provider_label_ids: Vec<String> = message
            .labels
            .iter()
            .map(|label| label.provider_label_id.clone())
            .collect();
        labels::insert::insert_message_labels(
            tx,
            link_id,
            message_db_id,
            &provider_label_ids,
            true,
        )
        .await
        .context("failed to upsert labels")?;
    }

    if !message.attachments.is_empty() {
        provider::insert_attachments(tx, message_db_id, &mut message.attachments)
            .await
            .context("Failed to insert attachments")?;
    }

    if update_thread_metadata {
        threads::update::update_thread_metadata(tx, thread_db_id, link_id)
            .await
            .context("Failed to update thread metadata")?;

        replying_to_id::update_message_replying_to_from_headers(
            tx,
            message,
            message_db_id,
            link_id,
        )
        .await
        .context("Failed to update message replying_to_id from headers")?;
    }

    Ok(())
}

/// inserts message object into the database
#[tracing::instrument(skip(tx, message))]
async fn insert_db_message(
    tx: &mut sqlx::PgConnection,
    message: &mut message::Message,
    thread_id: Uuid,
    from_contact_id: Option<Uuid>,
    update_thread_metadata: bool,
) -> anyhow::Result<Uuid> {
    let message_db_id = macro_uuid::generate_uuid_v7();

    let db_message = parse::service_to_db::map_service_message_to_db(
        message,
        message_db_id,
        thread_id,
        from_contact_id,
    );

    let result = sqlx::query!(
        r#"
        INSERT INTO email_messages (
        id, provider_id, link_id, global_id, thread_id, provider_thread_id, replying_to_id, provider_history_id, internal_date_ts,
            snippet, size_estimate, subject, from_contact_id, sent_at, has_attachments, is_read,
            is_starred, is_sent, is_draft, body_text, body_html_sanitized, headers_jsonb
        )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
        ON CONFLICT (link_id, provider_id) WHERE provider_id IS NOT NULL DO UPDATE SET
            global_id = EXCLUDED.global_id,
            provider_history_id = EXCLUDED.provider_history_id,
            provider_thread_id = EXCLUDED.provider_thread_id,
            replying_to_id = EXCLUDED.replying_to_id,
            internal_date_ts = EXCLUDED.internal_date_ts,
            snippet = EXCLUDED.snippet,
            size_estimate = EXCLUDED.size_estimate,
            subject = EXCLUDED.subject,
            sent_at = EXCLUDED.sent_at,
            is_read = EXCLUDED.is_read,
            is_starred = EXCLUDED.is_starred,
            is_sent = EXCLUDED.is_sent,
            is_draft = EXCLUDED.is_draft,
            headers_jsonb = EXCLUDED.headers_jsonb,
            body_text = EXCLUDED.body_text,
            body_html_sanitized = EXCLUDED.body_html_sanitized,
            updated_at = NOW()
        RETURNING id
        "#,
        db_message.id,
        db_message.provider_id,
        db_message.link_id,
        db_message.global_id,
        thread_id,
        db_message.provider_thread_id,
        db_message.replying_to_id,
        db_message.provider_history_id,
        db_message.internal_date_ts,
        db_message.snippet,
        db_message.size_estimate,
        db_message.subject,
        db_message.from_contact_id,
        db_message.sent_at,
        db_message.has_attachments,
        db_message.is_read,
        db_message.is_starred,
        db_message.is_sent,
        db_message.is_draft,
        db_message.body_text,
        db_message.body_html_sanitized,
        db_message.headers_jsonb
    )
        .fetch_one(&mut *tx)
        .await
        .with_context(|| {
            format!(
                "Failed to insert/update message with thread_id {} and provider_id {}",
                thread_id, db_message.provider_id.unwrap_or_default()
            )
        })?;

    Ok(result.id)
}

/// Inserts a single message into the database with transaction handling
#[tracing::instrument(skip(pool, message), fields(link_id = %message.link_id), level = "info")]
pub async fn insert_message(
    pool: &PgPool,
    thread_id: Uuid,
    message: &mut message::Message,
    link_id: Uuid,
    update_thread_metadata: bool,
) -> anyhow::Result<()> {
    // we have to insert addresses before inserting the message. these values are shared
    // across messages, so inserting them in the txn can cause deadlocks.
    let addresses = addresses_from_message(message);

    let recipients =
        contacts::upsert_message::parse_and_upsert_message_contacts(pool, link_id, addresses)
            .await
            .context("Failed to insert address ids")?;

    let mut tx = pool
        .begin()
        .await
        .context("Failed to begin transaction for message")?;

    match insert_message_with_tx(
        &mut tx,
        thread_id,
        message,
        link_id,
        recipients,
        update_thread_metadata,
    )
    .await
    {
        Ok(_) => {
            tx.commit()
                .await
                .context("Failed to commit transaction for message")?;
            Ok(())
        }
        Err(e) => {
            if let Err(rollback_err) = tx.rollback().await {
                return Err(e)
                    .context("Failed to insert message")
                    .context(format!("Rollback also failed: {:?}", rollback_err));
            }

            Err(e).context("Failed to insert message")
        }
    }
}

/// insert message that user created via macro frontend
#[tracing::instrument(skip(tx, service_message))]
pub async fn insert_message_to_send(
    tx: &mut sqlx::PgConnection,
    service_message: &mut message::MessageToSend,
    thread_id: Uuid,
    from_contact_id: Option<Uuid>,
    is_draft: bool,
) -> anyhow::Result<()> {
    let message_db_id = service_message
        .db_id
        .unwrap_or_else(macro_uuid::generate_uuid_v7);

    // Generate and insert recipients for message before sending.
    // This ensures recipients are accessible to the frontend before Gmail sync message arrives with
    // complete message details.
    let addresses = addresses_from_message(service_message);

    let db_message_to_send = map_message_to_send_to_db(service_message, message_db_id, thread_id);

    let recipients = contacts::upsert_message::parse_and_upsert_message_contacts(
        &mut *tx,
        db_message_to_send.link_id,
        addresses,
    )
    .await
    .context("Failed to insert address ids")?;

    // Insert the message into the database
    sqlx::query!(
        r#"
        INSERT INTO email_messages (
            id, provider_id, link_id, thread_id, provider_thread_id,
            replying_to_id, subject, from_contact_id, sent_at,
            has_attachments, is_read, is_starred, is_sent, is_draft,
            body_text, body_html_sanitized, body_macro, headers_jsonb,
            created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
        ON CONFLICT (id) DO UPDATE SET
            id = EXCLUDED.id,
            provider_id = EXCLUDED.provider_id,
            thread_id = EXCLUDED.thread_id,
            provider_thread_id = EXCLUDED.provider_thread_id,
            replying_to_id = EXCLUDED.replying_to_id,
            provider_history_id = EXCLUDED.provider_history_id,
            subject = EXCLUDED.subject,
            from_contact_id = EXCLUDED.from_contact_id,
            sent_at = EXCLUDED.sent_at,
            has_attachments = EXCLUDED.has_attachments,
            is_read = EXCLUDED.is_read,
            is_starred = EXCLUDED.is_starred,
            is_sent = EXCLUDED.is_sent,
            is_draft = EXCLUDED.is_draft,
            body_text = EXCLUDED.body_text,
            body_html_sanitized = EXCLUDED.body_html_sanitized,
            body_macro = EXCLUDED.body_macro,
            headers_jsonb = EXCLUDED.headers_jsonb,
            updated_at = NOW()
        "#,
        message_db_id,
        db_message_to_send.provider_id,
        db_message_to_send.link_id,
        thread_id,
        db_message_to_send.provider_thread_id,
        db_message_to_send.replying_to_id,
        db_message_to_send.subject,
        from_contact_id,
        Utc::now(),
        service_message
            .attachments_macro.clone()
            .is_some_and(|x| !x.is_empty()),
        true,
        false,
        !is_draft,
        is_draft,
        db_message_to_send.body_text,
        db_message_to_send.body_html,
        db_message_to_send.body_macro,
        db_message_to_send.headers_json,
        Utc::now(),
        Utc::now()
    )
    .execute(&mut *tx)
    .await
    .with_context(|| format!("Failed to insert message with thread_id {}", thread_id))?;

    service_message.db_id = Some(message_db_id);

    process_scheduled_message(tx, service_message, message_db_id, is_draft)
        .await
        .context("Failed to process scheduled message")?;

    if let Some(mut attachments) = service_message.attachments_macro.clone() {
        marco::insert_macro_attachments(tx, message_db_id, &mut attachments)
            .await
            .context("Failed to insert macro attachments")?;
    }

    contacts::upsert_message::upsert_message_recipients(tx, message_db_id, &recipients)
        .await
        .context("Failed to insert recipients")?;

    Ok(())
}

// Handle scheduled message logic
async fn process_scheduled_message(
    tx: &mut sqlx::PgConnection,
    service_message: &message::MessageToSend,
    message_db_id: Uuid,
    is_draft: bool,
) -> anyhow::Result<()> {
    // if a draft is created with a specified send_time, upsert scheduled message row in database
    let upsert_scheduled_time = is_draft && service_message.send_time.is_some();
    // if a draft is created without a specified end_time, delete any existing scheduled entry.
    // this handles the case where a user removes a previously set send_time from a draft
    // if a user sends a message via the API, delete any existing scheduled entry for the message.
    // this covers the case where a user scheduled a message to be sent, then ended up just
    // sending it themselves.
    let delete_scheduled = !(is_draft && service_message.send_time.is_some());

    if upsert_scheduled_time {
        upsert_scheduled_message(
            tx,
            ScheduledMessage {
                link_id: service_message.link_id,
                message_id: message_db_id,
                send_time: service_message.send_time.unwrap(),
                sent: false,
            },
        )
        .await
        .context("Failed to insert scheduled message")?;
    }

    if delete_scheduled {
        delete_scheduled_message(tx, service_message.link_id, message_db_id)
            .await
            .context("Failed to delete scheduled message")?;
    }

    Ok(())
}
