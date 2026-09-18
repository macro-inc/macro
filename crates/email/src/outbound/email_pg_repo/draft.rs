use super::{message, thread};
use crate::domain::models::{ResolvedDraftInput, ThreadRow, UpsertedContacts};
use chrono::Utc;
use sqlx::PgPool;
use uuid::Uuid;

/// Insert a draft message within a transaction.
/// Includes: thread insert (if new), message upsert, scheduled message, recipients,
/// thread metadata update, and user history.
/// Returns the thread DB ID.
#[tracing::instrument(skip(pool, input, contacts, new_thread), err)]
pub(crate) async fn insert_message(
    pool: &PgPool,
    input: &ResolvedDraftInput,
    contacts: &UpsertedContacts,
    link_id: Uuid,
    new_thread: Option<ThreadRow>,
    is_draft: bool,
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;

    let message_db_id = input.db_id;
    let thread_db_id = input.thread_db_id;

    if let Some(thread) = new_thread {
        thread::insert_thread(&mut tx, &thread, link_id).await?;
    }

    upsert_draft(
        &mut tx,
        input,
        message_db_id,
        thread_db_id,
        contacts.from_contact_id,
        link_id,
        is_draft,
    )
    .await?;

    // Only touch scheduling if send_time is explicitly provided.
    // Scheduling is managed via the dedicated /drafts/scheduled endpoints.
    if input.send_time.is_some() {
        message::process_scheduled_message(
            &mut tx,
            link_id,
            message_db_id,
            input.send_time,
            input.actor_id.as_deref(),
        )
        .await?;
    }

    message::upsert_recipients(&mut tx, message_db_id, contacts).await?;

    thread::update_thread_metadata(&mut tx, thread_db_id, link_id).await?;

    thread::upsert_user_history(&mut tx, link_id, thread_db_id).await?;

    tx.commit().await?;
    Ok(())
}

/// Revert a message that `insert_message(.., is_draft = false)` optimistically
/// marked as outgoing back to an unsent draft, and drop its pending scheduled
/// row.
///
/// The whole revert hinges on the send not having happened: a message the
/// scheduled worker already delivered (`is_sent`), or is delivering right now
/// (`processing` on its scheduled row), is left exactly as it is, message row
/// and scheduled row both. `get_message_to_send` does not re-check `is_draft`,
/// so a worker that has claimed the row sends the mail whatever this does —
/// reverting underneath it would deliver the email *and* leave a live draft to
/// send again.
#[tracing::instrument(skip(pool), err)]
pub(crate) async fn revert_sent_message_to_draft(
    pool: &PgPool,
    message_id: Uuid,
    link_id: Uuid,
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;

    // Lock the scheduled row up front rather than testing `processing` inside
    // the UPDATE below. A worker's claim is a single committed statement, so an
    // unlocked read only proves nothing had claimed the row at that instant: a
    // claim landing before the DELETE would have its row deleted out from under
    // it and still send. Holding the lock makes a concurrent claim wait — it
    // then finds no row and skips — and makes a claim that got here first
    // visible to the check.
    let claimed = sqlx::query_scalar!(
        r#"
        SELECT processing FROM email_scheduled_messages
        WHERE link_id = $1 AND message_id = $2
        FOR UPDATE
        "#,
        link_id,
        message_id,
    )
    .fetch_optional(&mut *tx)
    .await?;

    if claimed == Some(true) {
        tx.commit().await?;
        return Ok(());
    }

    let thread_db_id = sqlx::query_scalar!(
        r#"
        UPDATE email_messages
        SET is_draft = true, is_sent = false, updated_at = NOW()
        WHERE id = $1 AND link_id = $2 AND is_sent = false
        RETURNING thread_id
        "#,
        message_id,
        link_id,
    )
    .fetch_optional(&mut *tx)
    .await?;

    let Some(thread_db_id) = thread_db_id else {
        tx.commit().await?;
        return Ok(());
    };

    sqlx::query!(
        r#"
        DELETE FROM email_scheduled_messages
        WHERE link_id = $1 AND message_id = $2 AND sent = false
        "#,
        link_id,
        message_id,
    )
    .execute(&mut *tx)
    .await?;

    // Drafts count toward inbox_visible and the latest-message timestamps, so
    // the metadata the insert computed for an outgoing message no longer
    // describes the thread. Same recompute delete_draft_message does.
    thread::update_thread_metadata(&mut tx, thread_db_id, link_id).await?;

    tx.commit().await?;
    Ok(())
}

/// Upsert a draft message row.
pub(crate) async fn upsert_draft(
    tx: &mut sqlx::PgConnection,
    input: &ResolvedDraftInput,
    message_db_id: Uuid,
    thread_db_id: Uuid,
    from_contact_id: Option<Uuid>,
    link_id: Uuid,
    is_draft: bool,
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
        is_draft,
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
