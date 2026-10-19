#[cfg(test)]
pub(crate) mod test;

use crate::attachments::provider;
use crate::messages::replying_to_id;
use crate::parse::service_to_db::addresses_from_message;
use crate::{contacts, labels, parse, threads};

use models_email::email::db::address::UpsertedRecipients;
use models_email::email::service::message;
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
    .await?;

    contacts::upsert_message::upsert_message_recipients(tx, message_db_id, &recipents).await?;

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
        .await?;
    }

    provider::insert_attachments(tx, message_db_id, &mut message.attachments).await?;

    if update_thread_metadata {
        threads::update::update_thread_metadata(tx, thread_db_id, link_id).await?;

        replying_to_id::update_message_replying_to_from_headers(
            tx,
            message,
            message_db_id,
            link_id,
        )
        .await?;
    }

    Ok(())
}

/// inserts message object into the database
///
/// On conflict the update is skipped entirely when the stored row already
/// holds the incoming values, so a re-sync writes no new row version. When
/// only small columns change, the large body/header columns keep their
/// existing values, which lets Postgres reuse their TOAST chunks instead of
/// rewriting them. Provider messages arrive without `replying_to_id` (it is
/// resolved from headers afterwards), so a NULL keeps the stored value.
#[tracing::instrument(skip(tx, message), err)]
async fn insert_db_message(
    tx: &mut sqlx::PgConnection,
    message: &mut message::Message,
    thread_id: Uuid,
    from_contact_id: Option<Uuid>,
    update_thread_metadata: bool,
) -> anyhow::Result<Uuid> {
    let db_message =
        parse::service_to_db::map_service_message_to_db(message, thread_id, from_contact_id);

    let result = sqlx::query_scalar!(
        r#"
        INSERT INTO email_messages (
        id, provider_id, link_id, global_id, thread_id, provider_thread_id, replying_to_id, provider_history_id, internal_date_ts,
            snippet, size_estimate, subject, from_name, from_contact_id, sent_at, has_attachments, is_read,
            is_starred, is_sent, is_draft, body_text, body_html_sanitized, headers_jsonb
        )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
        ON CONFLICT (link_id, provider_id) WHERE provider_id IS NOT NULL DO UPDATE SET
            global_id = EXCLUDED.global_id,
            provider_history_id = EXCLUDED.provider_history_id,
            provider_thread_id = EXCLUDED.provider_thread_id,
            replying_to_id = COALESCE(EXCLUDED.replying_to_id, email_messages.replying_to_id),
            from_name = EXCLUDED.from_name,
            from_contact_id = EXCLUDED.from_contact_id,
            internal_date_ts = EXCLUDED.internal_date_ts,
            snippet = EXCLUDED.snippet,
            size_estimate = EXCLUDED.size_estimate,
            subject = EXCLUDED.subject,
            sent_at = EXCLUDED.sent_at,
            has_attachments = EXCLUDED.has_attachments,
            is_read = EXCLUDED.is_read,
            is_starred = EXCLUDED.is_starred,
            is_sent = EXCLUDED.is_sent,
            is_draft = EXCLUDED.is_draft,
            headers_jsonb = CASE
                WHEN email_messages.headers_jsonb IS DISTINCT FROM EXCLUDED.headers_jsonb
                THEN EXCLUDED.headers_jsonb ELSE email_messages.headers_jsonb END,
            body_text = CASE
                WHEN email_messages.body_text IS DISTINCT FROM EXCLUDED.body_text
                THEN EXCLUDED.body_text ELSE email_messages.body_text END,
            body_html_sanitized = CASE
                WHEN email_messages.body_html_sanitized IS DISTINCT FROM EXCLUDED.body_html_sanitized
                THEN EXCLUDED.body_html_sanitized ELSE email_messages.body_html_sanitized END,
            updated_at = NOW()
        -- Large columns last: the row comparison stops at the first difference.
        WHERE (
            email_messages.global_id, email_messages.provider_history_id,
            email_messages.provider_thread_id, email_messages.replying_to_id,
            email_messages.from_name, email_messages.from_contact_id,
            email_messages.internal_date_ts, email_messages.snippet,
            email_messages.size_estimate, email_messages.subject, email_messages.sent_at,
            email_messages.has_attachments, email_messages.is_read, email_messages.is_starred,
            email_messages.is_sent, email_messages.is_draft, email_messages.headers_jsonb,
            email_messages.body_text, email_messages.body_html_sanitized
        ) IS DISTINCT FROM (
            EXCLUDED.global_id, EXCLUDED.provider_history_id,
            EXCLUDED.provider_thread_id, COALESCE(EXCLUDED.replying_to_id, email_messages.replying_to_id),
            EXCLUDED.from_name, EXCLUDED.from_contact_id,
            EXCLUDED.internal_date_ts, EXCLUDED.snippet,
            EXCLUDED.size_estimate, EXCLUDED.subject, EXCLUDED.sent_at,
            EXCLUDED.has_attachments, EXCLUDED.is_read, EXCLUDED.is_starred,
            EXCLUDED.is_sent, EXCLUDED.is_draft, EXCLUDED.headers_jsonb,
            EXCLUDED.body_text, EXCLUDED.body_html_sanitized
        )
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
        db_message.from_name,
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
        .fetch_optional(&mut *tx)
        .await?;

    if let Some(id) = result {
        return Ok(id);
    }

    // The conflicting row already holds this data; fetch its id.
    let existing_id = sqlx::query_scalar!(
        r#"
        SELECT id FROM email_messages
        WHERE link_id = $1 AND provider_id = $2
        "#,
        db_message.link_id,
        db_message.provider_id,
    )
    .fetch_one(&mut *tx)
    .await?;

    Ok(existing_id)
}

/// Inserts a single message into the database with transaction handling
#[tracing::instrument(skip(pool, message), fields(link_id = %message.link_id), err)]
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
            .await?;

    let mut tx = pool.begin().await?;

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
            tx.commit().await?;
            Ok(())
        }
        Err(e) => {
            if let Err(rollback_err) = tx.rollback().await {
                return Err(e.context(format!("Rollback also failed: {:?}", rollback_err)));
            }

            Err(e)
        }
    }
}
