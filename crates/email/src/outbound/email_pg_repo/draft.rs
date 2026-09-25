use super::{client_id_mapping, message, thread};
use crate::domain::models::{
    EmailErr, ResolvedDraftInput, SettledDraftIds, ThreadRow, UpsertedContacts,
};
use chrono::Utc;
use sqlx::PgPool;
use uuid::Uuid;

/// Insert a draft message within a transaction.
/// Includes: thread insert (if new), message upsert, scheduled message, recipients,
/// thread metadata update, and user history.
/// Returns the IDs the save settled on, or `None` (rolling everything back)
/// when the upsert's owner guard rejected the write — the message ID exists
/// under another inbox or is no longer an unsent draft.
#[tracing::instrument(skip(pool, input, contacts, new_thread), err)]
pub(crate) async fn insert_message(
    pool: &PgPool,
    input: &ResolvedDraftInput,
    contacts: &UpsertedContacts,
    link_id: Uuid,
    new_thread: Option<ThreadRow>,
    is_draft: bool,
) -> Result<Option<SettledDraftIds>, EmailErr> {
    let mut tx = pool.begin().await.map_err(anyhow::Error::from)?;

    let mut settled = SettledDraftIds {
        message_db_id: input.db_id,
        thread_db_id: input.thread_db_id,
    };
    let mut new_thread = new_thread;

    // The caller resolved this handle on its own connection, where a
    // concurrent first save's binding is invisible until it commits — so two
    // first saves of one draft would each mint a message and a thread, and the
    // losing binding upsert would orphan a full row set. Serialize on the
    // handle and re-read the binding under the lock: the loser adopts the row
    // the winner settled on and updates it instead.
    if let Some(client_id) = input.draft_client_id {
        client_id_mapping::lock_draft_client_id(&mut tx, client_id, link_id)
            .await
            .map_err(anyhow::Error::from)?;
        if let Some(bound) = client_id_mapping::bound_draft_row(&mut tx, client_id, link_id)
            .await
            .map_err(anyhow::Error::from)?
            && bound.message_db_id != settled.message_db_id
        {
            settled = bound;
            // Our thread would have no messages left to hold.
            new_thread = None;
        }
    }

    let SettledDraftIds {
        message_db_id,
        thread_db_id,
    } = settled;

    // Serialize with schedule/cancel/claim before checking editability. The
    // domain's earlier read cannot protect a save waiting on this transaction.
    let existing = sqlx::query!(
        "SELECT link_id, is_sent, is_draft FROM email_messages WHERE id = $1 FOR UPDATE",
        message_db_id,
    )
    .fetch_optional(&mut *tx)
    .await
    .map_err(anyhow::Error::from)?;
    let was_missing = existing.is_none();
    if let Some(existing) = existing {
        if existing.link_id != link_id || existing.is_sent || !existing.is_draft {
            return Ok(None);
        }
        let scheduled = sqlx::query_scalar!(
            "SELECT EXISTS(SELECT 1 FROM email_scheduled_messages WHERE message_id = $1 AND link_id = $2) AS \"exists!\"",
            message_db_id, link_id,
        ).fetch_one(&mut *tx).await.map_err(anyhow::Error::from)?;
        if scheduled {
            return Err(EmailErr::MessageDeliveryConflict(message_db_id));
        }
    }

    if let Some(thread) = new_thread {
        thread::insert_thread(&mut tx, &thread, link_id)
            .await
            .map_err(anyhow::Error::from)?;
    }

    let updated = upsert_draft(
        &mut tx,
        input,
        message_db_id,
        thread_db_id,
        contacts.from_contact_id,
        link_id,
        is_draft,
    )
    .await
    .map_err(anyhow::Error::from)?;
    if !updated {
        return Ok(None);
    }

    // A first save can miss an uncommitted insert in the initial SELECT, then
    // wait on its unique-key conflict. ON CONFLICT's subquery keeps that older
    // statement snapshot, so recheck after the upsert owns the message lock.
    // A concurrent insert+schedule must roll back this entire stale write.
    if was_missing {
        let scheduled = sqlx::query_scalar!(
            "SELECT EXISTS(SELECT 1 FROM email_scheduled_messages WHERE message_id = $1 AND link_id = $2) AS \"exists!\"",
            message_db_id, link_id,
        ).fetch_one(&mut *tx).await.map_err(anyhow::Error::from)?;
        if scheduled {
            return Err(EmailErr::MessageDeliveryConflict(message_db_id));
        }
    }

    // Only immediate Send persists its internal undo-window delivery here.
    // Ordinary draft writes never touch scheduling, even for legacy clients.
    if !is_draft && input.send_time.is_some() {
        message::process_scheduled_message(
            &mut tx,
            link_id,
            message_db_id,
            input.send_time,
            input.actor_id.as_deref(),
        )
        .await
        .map_err(anyhow::Error::from)?;
    }

    message::upsert_recipients(&mut tx, message_db_id, contacts)
        .await
        .map_err(anyhow::Error::from)?;

    thread::update_thread_metadata(&mut tx, thread_db_id, link_id)
        .await
        .map_err(anyhow::Error::from)?;

    thread::upsert_user_history(&mut tx, link_id, thread_db_id)
        .await
        .map_err(anyhow::Error::from)?;

    // Persist handles with the actual settled identity, including a concurrent
    // first-save winner and a draft recreated after sender migration.
    if let Some(client_id) = input.draft_client_id {
        client_id_mapping::bind_draft_client_id(&mut tx, client_id, link_id, message_db_id)
            .await
            .map_err(anyhow::Error::from)?;
    }
    if let Some(client_id) = input.thread_client_id {
        client_id_mapping::bind_thread_client_id(&mut tx, client_id, link_id, thread_db_id)
            .await
            .map_err(anyhow::Error::from)?;
    }

    tx.commit().await.map_err(anyhow::Error::from)?;
    Ok(Some(settled))
}

/// Upsert a draft message row.
///
/// The conflict clause is owner-guarded: an existing row is only updated when
/// it is an unsent draft in the sending inbox. The IDs reaching this upsert
/// come from validated reads, but reads race — the guard, not the read, is
/// what keeps a raced save from rewriting another inbox's row or a sent
/// message. Returns `false` when the guard rejected the write.
pub(crate) async fn upsert_draft(
    tx: &mut sqlx::PgConnection,
    input: &ResolvedDraftInput,
    message_db_id: Uuid,
    thread_db_id: Uuid,
    from_contact_id: Option<Uuid>,
    link_id: Uuid,
    is_draft: bool,
) -> Result<bool, sqlx::Error> {
    let now = Utc::now();

    let result = sqlx::query!(
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
            is_read = EXCLUDED.is_read,
            is_starred = EXCLUDED.is_starred,
            is_sent = EXCLUDED.is_sent,
            is_draft = EXCLUDED.is_draft,
            body_text = EXCLUDED.body_text,
            body_html_sanitized = EXCLUDED.body_html_sanitized,
            body_macro = EXCLUDED.body_macro,
            headers_jsonb = EXCLUDED.headers_jsonb,
            updated_at = NOW()
        WHERE email_messages.link_id = EXCLUDED.link_id
          AND email_messages.is_draft AND NOT email_messages.is_sent
          AND NOT EXISTS (SELECT 1 FROM email_scheduled_messages WHERE message_id = EXCLUDED.id AND link_id = EXCLUDED.link_id)
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

    Ok(result.rows_affected() == 1)
}
