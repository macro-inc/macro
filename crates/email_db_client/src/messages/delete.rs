use crate::threads;
use models_email::email::service::message;
use sqlx::types::Uuid;
use sqlx::{Executor, Postgres};

/// Committed effects a message-deletion caller must handle after its transaction.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeleteMessageOutcome {
    /// Thread deleted because the removed message was its final message.
    pub deleted_thread_id: Option<Uuid>,
    /// Documents whose `document_email` relation was cascade-removed.
    pub detached_document_ids: Vec<String>,
}

/// Deletes a message and returns post-commit relation effects for its caller.
#[tracing::instrument(skip(tx, message), fields(link_id = %message.link_id), err)]
pub async fn delete_message_with_tx(
    tx: &mut sqlx::PgConnection,
    message: &message::SimpleMessage,
) -> anyhow::Result<DeleteMessageOutcome> {
    // Snapshot projection-relevant relations in the same transaction before
    // the message -> attachment -> document_email cascade removes them.
    let mut detached_document_ids = sqlx::query_scalar!(
        r#"
        SELECT de.document_id
        FROM document_email de
        INNER JOIN email_attachments ea ON ea.id = de.email_attachment_id
        WHERE ea.message_id = $1
        "#,
        message.db_id
    )
    .fetch_all(&mut *tx)
    .await?;
    detached_document_ids.sort();
    detached_document_ids.dedup();

    // delete the message itself
    delete_db_message(&mut *tx, message.db_id).await?;

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

    Ok(DeleteMessageOutcome {
        deleted_thread_id: deleted_thread.then_some(message.thread_db_id),
        detached_document_ids,
    })
}

#[tracing::instrument(skip(executor), err)]
pub async fn delete_db_message<'e, E>(executor: E, message_id: Uuid) -> anyhow::Result<()>
where
    E: Executor<'e, Database = Postgres>,
{
    // Delete the message
    let result = sqlx::query!(r#"DELETE FROM email_messages WHERE id = $1"#, message_id)
        .execute(executor)
        .await?;

    // Check if any rows were affected
    if result.rows_affected() == 0 {
        anyhow::bail!("Message not found with id {}", message_id);
    }

    Ok(())
}
