#[cfg(test)]
mod test;

use sqlx::types::Uuid;
use sqlx::{Executor, Postgres};

/// Records that the Gmail operations sharing `write_id` will change
/// `provider_label_id` on `message_ids`, so inbox sync keeps the local label
/// state until Gmail confirms it. A newer change to the same label on the same
/// message takes over the row. Rows stop applying after 12 hours, longer than
/// an operation is redelivered through the gmail_ops queues, so only operations
/// that are dead-lettered or lost fall back to Gmail's labels.
#[tracing::instrument(skip(executor, message_ids), err)]
pub async fn mark_pending_label_writes<'e, E>(
    executor: E,
    link_id: Uuid,
    message_ids: &[Uuid],
    provider_label_id: &str,
    write_id: Uuid,
) -> Result<(), sqlx::Error>
where
    E: Executor<'e, Database = Postgres>,
{
    if message_ids.is_empty() {
        return Ok(());
    }

    sqlx::query!(
        r#"
        INSERT INTO email_gmail_pending_label_writes (message_id, provider_label_id, write_id, expires_at)
        SELECT m.id, $3, $4, now() + interval '12 hours'
        FROM email_messages m
        WHERE m.id = ANY($1) AND m.link_id = $2
        ON CONFLICT (message_id, provider_label_id) DO UPDATE
        SET write_id = EXCLUDED.write_id, expires_at = EXCLUDED.expires_at
        "#,
        message_ids,
        link_id,
        provider_label_id,
        write_id,
    )
    .execute(executor)
    .await?;

    Ok(())
}

/// Removes `write_id`'s pending label changes on `message_ids`, once Gmail has
/// accepted or rejected them. Rows a newer change took over stay.
#[tracing::instrument(skip(executor, message_ids), err)]
pub async fn clear_pending_label_writes<'e, E>(
    executor: E,
    message_ids: &[Uuid],
    write_id: Uuid,
) -> Result<(), sqlx::Error>
where
    E: Executor<'e, Database = Postgres>,
{
    if message_ids.is_empty() {
        return Ok(());
    }

    sqlx::query!(
        r#"
        DELETE FROM email_gmail_pending_label_writes
        WHERE message_id = ANY($1) AND write_id = $2
        "#,
        message_ids,
        write_id,
    )
    .execute(executor)
    .await?;

    Ok(())
}

/// Provider label ids on the message with a local change Gmail has not
/// confirmed yet.
#[tracing::instrument(skip(executor), err)]
pub async fn pending_provider_label_ids<'e, E>(
    executor: E,
    message_id: Uuid,
) -> Result<Vec<String>, sqlx::Error>
where
    E: Executor<'e, Database = Postgres>,
{
    sqlx::query_scalar!(
        r#"
        SELECT provider_label_id
        FROM email_gmail_pending_label_writes
        WHERE message_id = $1 AND expires_at > now()
        "#,
        message_id,
    )
    .fetch_all(executor)
    .await
}
