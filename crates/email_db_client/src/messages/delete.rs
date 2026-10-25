use crate::threads;
use models_email::email::service::message;
use sqlx::types::Uuid;
use sqlx::{Executor, Postgres};

/// Outcome of [`delete_message_with_tx`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessageDeletion {
    /// The message row was already gone, e.g. removed by a concurrent sync.
    AlreadyDeleted,
    /// An accepted send still needs the message; deletion is recorded for recovery.
    Deferred,
    /// The message was deleted. `deleted_thread` holds the thread id when the
    /// message was the thread's last one and the thread was deleted with it.
    Deleted { deleted_thread: Option<Uuid> },
}

/// Deletes a message snapshot locked in this transaction. Provider sync must use
/// `get_simple_message_by_provider_and_link_for_update` before collecting its
/// cleanup data, so completion/Undo cannot replace the snapshot before DELETE.
#[tracing::instrument(skip(tx, message), fields(link_id = %message.link_id), err)]
pub async fn delete_message_with_tx(
    tx: &mut sqlx::PgConnection,
    message: &message::SimpleMessage,
) -> anyhow::Result<MessageDeletion> {
    delete_message_in_thread(
        tx,
        message.db_id,
        message.thread_db_id,
        message.link_id,
        message.is_draft,
    )
    .await
}

async fn delete_message_in_thread(
    tx: &mut sqlx::PgConnection,
    message_id: Uuid,
    thread_id: Uuid,
    link_id: Uuid,
    is_draft: bool,
) -> anyhow::Result<MessageDeletion> {
    if !delete_db_message(&mut *tx, message_id).await? {
        let deferred = sqlx::query_scalar!(
            "SELECT EXISTS(SELECT 1 FROM email_deferred_message_deletions WHERE message_id=$1) AS \"deferred!\"",
            message_id,
        ).fetch_one(&mut *tx).await?;
        return Ok(if deferred {
            MessageDeletion::Deferred
        } else {
            MessageDeletion::AlreadyDeleted
        });
    }

    // if it was the only message in the thread, delete the thread too
    let deleted_thread = threads::delete::delete_thread_if_empty(&mut *tx, thread_id).await?;

    // Drafts count toward inbox_visible, latest_inbound_message_ts, and
    // is_signal, so every surviving thread needs the full recompute (which
    // piggybacks the is_signal sync) — a discarded draft would otherwise
    // leave the thread stranded in inbox views.
    if !deleted_thread {
        threads::update::update_thread_metadata(&mut *tx, thread_id, link_id).await?;
    }

    // The message's attachments cascade with the delete, which may have
    // removed the thread's last calendar attachment. Drafts never have
    // email_attachments rows, so they can't move the flag.
    if !deleted_thread && !is_draft {
        threads::update::sync_thread_calendar_flag(&mut *tx, thread_id).await?;
    }

    Ok(MessageDeletion::Deleted {
        deleted_thread: deleted_thread.then_some(thread_id),
    })
}

/// Identity needed to publish the deletion after the database commit.
pub struct DeferredMessageDeleted {
    /// Thread containing the deleted message.
    pub thread_id: Uuid,
    /// Provider identity the deferred deletion targeted.
    pub provider_id: String,
}

/// Reconcile one retained deletion under the same message lock as Send and Undo.
/// Changed identities/generations retire stale deletions; unresolved sends retain
/// both the deletion and all delivery/recovery data.
#[tracing::instrument(skip(pool), err)]
pub async fn reconcile_deferred_deletion(
    pool: &sqlx::PgPool,
    link_id: Uuid,
    message_id: Uuid,
) -> anyhow::Result<Option<DeferredMessageDeleted>> {
    let mut tx = pool.begin().await?;
    let message = sqlx::query!(
        "SELECT thread_id, provider_id, draft_generation, is_draft FROM email_messages WHERE id=$1 AND link_id=$2 FOR UPDATE",
        message_id, link_id,
    ).fetch_optional(&mut *tx).await?;
    let Some(message) = message else {
        return Ok(None);
    };
    let deferred = sqlx::query!(
        "SELECT provider_id, draft_generation FROM email_deferred_message_deletions WHERE message_id=$1",
        message_id,
    ).fetch_optional(&mut *tx).await?;
    let Some(deferred) = deferred else {
        return Ok(None);
    };
    if message.draft_generation != deferred.draft_generation
        || message.provider_id != deferred.provider_id
    {
        sqlx::query!(
            "DELETE FROM email_deferred_message_deletions WHERE message_id=$1",
            message_id
        )
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        return Ok(None);
    }
    let active = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM email_send_attempts WHERE message_id=$1 AND link_id=$2 AND NOT cancelled AND NOT sent) AS \"active!\"",
        message_id, link_id,
    ).fetch_one(&mut *tx).await?;
    if active {
        return Ok(None);
    }

    // Capture recipients before the cascade. Extra candidates are harmless:
    // the CRM cleanup worker checks remaining email sources before removal.
    sqlx::query!(
        r#"INSERT INTO crm_cleanup_candidates (link_id, contact_email)
           SELECT DISTINCT $2::uuid, lower(trim(c.email_address))
           FROM email_message_recipients r JOIN email_contacts c ON c.id = r.contact_id
           WHERE r.message_id=$1 AND c.email_address IS NOT NULL AND trim(c.email_address) <> ''
           ON CONFLICT (link_id, contact_email) DO UPDATE SET created_at=NOW()"#,
        message_id,
        link_id,
    )
    .execute(&mut *tx)
    .await?;
    let result = delete_message_in_thread(
        &mut tx,
        message_id,
        message.thread_id,
        link_id,
        message.is_draft,
    )
    .await?;
    tx.commit().await?;
    tracing::info!(event = "email_send.deferred_deletion_resolved", %message_id, %link_id);
    Ok(match result {
        MessageDeletion::Deleted { .. } => Some(DeferredMessageDeleted {
            thread_id: message.thread_id,
            provider_id: deferred.provider_id.unwrap_or_default(),
        }),
        MessageDeletion::AlreadyDeleted | MessageDeletion::Deferred => None,
    })
}

/// Deletes a message row, returning `false` when missing or retained for an active send.
#[tracing::instrument(skip(executor), err)]
pub async fn delete_db_message<'e, E>(executor: E, message_id: Uuid) -> anyhow::Result<bool>
where
    E: Executor<'e, Database = Postgres>,
{
    let result = sqlx::query!(r#"DELETE FROM email_messages WHERE id = $1"#, message_id)
        .execute(executor)
        .await?;

    Ok(result.rows_affected() > 0)
}
