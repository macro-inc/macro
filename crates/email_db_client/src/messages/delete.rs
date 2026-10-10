use crate::threads;
use models_email::email::service::message;
use sqlx::types::Uuid;
use sqlx::{Executor, Postgres};

/// Outcome of [`delete_message_with_tx`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessageDeletion {
    /// The message row was already gone, e.g. removed by a concurrent sync.
    AlreadyDeleted,
    /// The message was deleted. `deleted_thread` holds the thread id when the
    /// message was the thread's last one and the thread was deleted with it.
    Deleted { deleted_thread: Option<Uuid> },
}

/// Deletes message from the database with transaction handling.
#[tracing::instrument(skip(tx, message), fields(link_id = %message.link_id), err)]
pub async fn delete_message_with_tx(
    tx: &mut sqlx::PgConnection,
    message: &message::SimpleMessage,
) -> anyhow::Result<MessageDeletion> {
    if !delete_db_message(&mut *tx, message.db_id).await? {
        return Ok(MessageDeletion::AlreadyDeleted);
    }

    // if it was the only message in the thread, delete the thread too
    let deleted_thread =
        threads::delete::delete_thread_if_empty(&mut *tx, message.thread_db_id).await?;

    // Drafts count toward inbox_visible, latest_inbound_message_ts, and
    // is_signal, so every surviving thread needs the full recompute (which
    // piggybacks the is_signal sync) — a discarded draft would otherwise
    // leave the thread stranded in inbox views.
    if !deleted_thread {
        threads::update::update_thread_metadata(&mut *tx, message.thread_db_id, message.link_id)
            .await?;
    }

    // The message's attachments cascade with the delete, which may have
    // removed the thread's last calendar attachment. Drafts never have
    // email_attachments rows, so they can't move the flag.
    if !deleted_thread && !message.is_draft {
        threads::update::sync_thread_calendar_flag(&mut *tx, message.thread_db_id).await?;
    }

    Ok(MessageDeletion::Deleted {
        deleted_thread: deleted_thread.then_some(message.thread_db_id),
    })
}

/// Deletes a message row, returning `false` when no message has this id.
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
