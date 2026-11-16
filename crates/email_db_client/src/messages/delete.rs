//! Statement-sized storage for retained message deletion.
use sqlx::types::Uuid;
use sqlx::{Executor, Postgres};

/// Message identity locked before resolving a retained deletion.
pub struct DeletionMessage {
    pub thread_id: Uuid,
    pub provider_id: Option<String>,
    pub draft_generation: i32,
    pub is_draft: bool,
}
/// Identity captured when deletion was deferred.
pub struct DeferredDeletion {
    pub provider_id: Option<String>,
    pub draft_generation: i32,
}

/// Execute the has_deferred_deletion statement.
pub async fn has_deferred_deletion(
    tx: &mut sqlx::PgConnection,
    message_id: Uuid,
) -> anyhow::Result<bool> {
    let row = sqlx::query_scalar!(
            "SELECT EXISTS(SELECT 1 FROM email_deferred_message_deletions WHERE message_id=$1) AS \"deferred!\"",
            message_id,
        ).fetch_one(&mut *tx).await?;
    Ok(row)
}

/// Execute the lock_thread statement.
pub async fn lock_thread(tx: &mut sqlx::PgConnection, thread_id: Uuid) -> anyhow::Result<()> {
    sqlx::query!(
        "SELECT id FROM email_threads WHERE id = $1 FOR UPDATE",
        thread_id
    )
    .fetch_optional(&mut *tx)
    .await?;
    Ok(())
}

/// Execute the deletion_message statement.
pub async fn deletion_message(
    tx: &mut sqlx::PgConnection,
    message_id: Uuid,
    link_id: Uuid,
) -> anyhow::Result<Option<DeletionMessage>> {
    let row = sqlx::query!(
        "SELECT thread_id, provider_id, draft_generation, is_draft FROM email_messages WHERE id=$1 AND link_id=$2 FOR UPDATE",
        message_id, link_id,
    ).fetch_optional(&mut *tx).await?;
    Ok(row.map(|row| DeletionMessage {
        thread_id: row.thread_id,
        provider_id: row.provider_id,
        draft_generation: row.draft_generation,
        is_draft: row.is_draft,
    }))
}

/// Execute the deferred_deletion statement.
pub async fn deferred_deletion(
    tx: &mut sqlx::PgConnection,
    message_id: Uuid,
) -> anyhow::Result<Option<DeferredDeletion>> {
    let row = sqlx::query!(
        "SELECT provider_id, draft_generation FROM email_deferred_message_deletions WHERE message_id=$1",
        message_id,
    ).fetch_optional(&mut *tx).await?;
    Ok(row.map(|row| DeferredDeletion {
        provider_id: row.provider_id,
        draft_generation: row.draft_generation,
    }))
}

/// Execute the remove_deferred_deletion statement.
pub async fn remove_deferred_deletion(
    tx: &mut sqlx::PgConnection,
    message_id: Uuid,
) -> anyhow::Result<()> {
    sqlx::query!(
        "DELETE FROM email_deferred_message_deletions WHERE message_id=$1",
        message_id
    )
    .execute(&mut *tx)
    .await?;
    Ok(())
}

/// Execute the has_active_attempt statement.
pub async fn has_active_attempt(
    tx: &mut sqlx::PgConnection,
    message_id: Uuid,
    link_id: Uuid,
) -> anyhow::Result<bool> {
    let row = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM email_send_attempts WHERE message_id=$1 AND link_id=$2 AND NOT cancelled AND NOT sent) AS \"active!\"",
        message_id, link_id,
    ).fetch_one(&mut *tx).await?;
    Ok(row)
}

/// Execute the deletion_recipients statement.
pub async fn deletion_recipients(
    tx: &mut sqlx::PgConnection,
    message_id: Uuid,
) -> anyhow::Result<Vec<String>> {
    let row = sqlx::query_scalar!(
        r#"SELECT DISTINCT lower(trim(c.email_address)) AS "email!"
           FROM email_message_recipients r JOIN email_contacts c ON c.id = r.contact_id
           WHERE r.message_id=$1 AND c.email_address IS NOT NULL AND trim(c.email_address) <> ''"#,
        message_id,
    )
    .fetch_all(&mut *tx)
    .await?;
    Ok(row)
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
