use super::{message, thread};
use crate::domain::models::{CreateDraftInput, ThreadRow, UpsertedContacts};
use chrono::Utc;
use sqlx::PgPool;
use uuid::Uuid;

/// Insert a draft message within a transaction.
/// Includes: thread insert (if new), message upsert, scheduled message, recipients,
/// thread metadata update, and user history.
/// Returns the thread DB ID.
#[tracing::instrument(skip(pool, input, contacts, new_thread), err)]
pub(crate) async fn insert_draft_message(
    pool: &PgPool,
    input: &CreateDraftInput,
    message_db_id: Uuid,
    thread_db_id: Uuid,
    contacts: &UpsertedContacts,
    link_id: Uuid,
    new_thread: Option<ThreadRow>,
) -> Result<Uuid, sqlx::Error> {
    let mut tx = pool.begin().await?;

    let thread_db_id = if let Some(thread) = new_thread {
        thread::insert_thread(&mut tx, &thread, link_id).await?
    } else {
        thread_db_id
    };

    upsert_draft(
        &mut tx,
        input,
        message_db_id,
        thread_db_id,
        contacts.from_contact_id,
        link_id,
    )
    .await?;

    message::process_scheduled_message(&mut tx, link_id, message_db_id, input.send_time).await?;

    message::upsert_recipients(&mut tx, message_db_id, contacts).await?;

    thread::update_thread_metadata(&mut tx, thread_db_id, link_id).await?;

    thread::upsert_user_history(&mut tx, link_id, thread_db_id).await?;

    tx.commit().await?;
    Ok(thread_db_id)
}

/// Upsert a draft message row.
pub(crate) async fn upsert_draft(
    tx: &mut sqlx::PgConnection,
    input: &CreateDraftInput,
    message_db_id: Uuid,
    thread_db_id: Uuid,
    from_contact_id: Option<Uuid>,
    link_id: Uuid,
) -> Result<(), sqlx::Error> {
    let now = Utc::now();

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
            provider_id = EXCLUDED.provider_id,
            thread_id = EXCLUDED.thread_id,
            provider_thread_id = EXCLUDED.provider_thread_id,
            replying_to_id = EXCLUDED.replying_to_id,
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
        input.provider_id,
        link_id,
        thread_db_id,
        input.provider_thread_id,
        input.replying_to_id,
        input.subject,
        from_contact_id,
        now,
        false, // has_attachments
        true,  // is_read
        false, // is_starred
        false, // is_sent
        true,  // is_draft (always true for drafts)
        input.body_text,
        input.body_html,
        input.body_macro,
        input.headers_json,
        now,
        now,
    )
    .execute(&mut *tx)
    .await?;

    Ok(())
}
