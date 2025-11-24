use crate::threads;
use anyhow::Context;
use models_email::email::service::message;
use sqlx::types::Uuid;
use sqlx::{Executor, Postgres};

/// Deletes message from the database with transaction handling. Returns an optional db thread id
/// if the thread was deleted
#[tracing::instrument(skip(tx, message), fields(link_id = %message.link_id), level = "info")]
pub async fn delete_message_with_tx(
    tx: &mut sqlx::PgConnection,
    message: &message::SimpleMessage,
    // update thread-object vals (inbox_visible, latest timestamps)
    update_thread_metadata: bool,
) -> anyhow::Result<Option<Uuid>> {
    // delete the message itself
    delete_db_message(&mut *tx, message.db_id)
        .await
        .context("Failed to delete db message")?;

    // if it was the only message in the thread, delete the thread too
    let deleted_thread = threads::delete::delete_thread_if_empty(&mut *tx, message.thread_db_id)
        .await
        .context("Failed to attempt thread deletion")?;

    if !deleted_thread && update_thread_metadata {
        threads::update::update_thread_metadata(&mut *tx, message.thread_db_id, message.link_id)
            .await
            .context("Failed to update thread metadata")?;
    }

    if deleted_thread {
        Ok(Some(message.thread_db_id))
    } else {
        Ok(None)
    }
}

#[tracing::instrument(skip(executor), level = "info")]
pub async fn delete_db_message<'e, E>(executor: E, message_id: Uuid) -> anyhow::Result<()>
where
    E: Executor<'e, Database = Postgres>,
{
    // Delete the message
    let result = sqlx::query!(r#"DELETE FROM email_messages WHERE id = $1"#, message_id)
        .execute(executor)
        .await
        .with_context(|| format!("Failed to delete message with id {}", message_id))?;

    // Check if any rows were affected
    if result.rows_affected() == 0 {
        return Err(anyhow::anyhow!("Message not found with id {}", message_id));
    }

    Ok(())
}
