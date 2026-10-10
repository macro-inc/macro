//! Move an authorized editable draft without deleting its attachment rows.

use super::super::{client_id_mapping, thread};
use crate::domain::{
    models::{EmailErr, ResolvedDraftInput, ThreadRow},
    send_attempt::SendSourceInbox,
};
use uuid::Uuid;

/// Match admission's handle/message lock order and revalidate the source facts.
/// Every change rolls back if subsequent attachment validation rejects the send.
pub(super) async fn move_for_admission(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    message: &ResolvedDraftInput,
    destination: Uuid,
    source: SendSourceInbox,
    new_thread: &mut Option<ThreadRow>,
) -> Result<(), EmailErr> {
    if let Some(handle) = message.draft_client_id {
        client_id_mapping::lock_draft_client_id(&mut *tx, handle, destination)
            .await
            .map_err(anyhow::Error::from)?;
        if let Some(bound) = client_id_mapping::bound_draft_row(&mut *tx, handle, destination)
            .await
            .map_err(anyhow::Error::from)?
            && bound.message_db_id != message.db_id
        {
            return Err(EmailErr::MessageDeliveryConflict(message.db_id));
        }
    }
    let current = sqlx::query!(
        "SELECT link_id, thread_id, is_draft, is_sent FROM email_messages WHERE id = $1 FOR UPDATE",
        message.db_id,
    )
    .fetch_optional(&mut **tx)
    .await
    .map_err(anyhow::Error::from)?
    .ok_or(EmailErr::MessageNotFound(message.db_id))?;
    if current.link_id != source.link_id
        || current.thread_id != source.thread_id
        || !current.is_draft
        || current.is_sent
    {
        return Err(EmailErr::MessageDeliveryConflict(message.db_id));
    }
    let scheduled = sqlx::query_scalar!(
        r#"SELECT EXISTS(SELECT 1 FROM email_scheduled_messages WHERE message_id = $1) AS "exists!""#,
        message.db_id,
    )
    .fetch_one(&mut **tx)
    .await
    .map_err(anyhow::Error::from)?;
    if scheduled {
        return Err(EmailErr::MessageDeliveryConflict(message.db_id));
    }
    if let Some(created) = new_thread.take() {
        thread::insert_thread(&mut *tx, &created, destination)
            .await
            .map_err(anyhow::Error::from)?;
    }
    sqlx::query!(
        r#"UPDATE email_messages SET link_id = $1, thread_id = $2,
           provider_id = NULL, provider_thread_id = NULL, provider_history_id = NULL,
           global_id = NULL, updated_at = NOW() WHERE id = $3"#,
        destination,
        message.thread_db_id,
        message.db_id,
    )
    .execute(&mut **tx)
    .await
    .map_err(anyhow::Error::from)?;
    // Provider labels belong to the source account. Attachments belong to the
    // message and remain intact; admission checks their approved identities.
    sqlx::query!(
        "DELETE FROM email_message_labels WHERE message_id = $1",
        message.db_id,
    )
    .execute(&mut **tx)
    .await
    .map_err(anyhow::Error::from)?;
    let remaining = sqlx::query_scalar!(
        r#"SELECT EXISTS(SELECT 1 FROM email_messages WHERE thread_id = $1) AS "exists!""#,
        source.thread_id,
    )
    .fetch_one(&mut **tx)
    .await
    .map_err(anyhow::Error::from)?;
    if remaining {
        thread::update_thread_metadata(&mut *tx, source.thread_id, source.link_id)
            .await
            .map_err(anyhow::Error::from)?;
    } else {
        sqlx::query!("DELETE FROM email_threads WHERE id = $1", source.thread_id)
            .execute(&mut **tx)
            .await
            .map_err(anyhow::Error::from)?;
    }
    Ok(())
}
