//! Serialize provider identity reconciliation with inbox synchronization.

use sqlx::PgConnection;
use sqlx::types::Uuid;

/// Lock a provider conversation before taking its thread or message row locks.
///
/// The caller must keep its transaction open for the entire write. Both sync
/// and delivery completion use this order so reconciliation cannot deadlock
/// against a thread upsert followed by a message upsert.
#[tracing::instrument(skip(tx), err)]
pub async fn lock_provider_thread(
    tx: &mut PgConnection,
    link_id: Uuid,
    provider_thread_id: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        format!("email_provider_thread:{link_id}:{provider_thread_id}"),
    )
    .execute(tx)
    .await?;
    Ok(())
}

/// Execute the original_thread statement.
pub async fn original_thread(
    tx: &mut PgConnection,
    message_id: Uuid,
    link_id: Uuid,
) -> anyhow::Result<Uuid> {
    let row = sqlx::query_scalar!(
        "SELECT thread_id FROM email_messages WHERE id = $1 AND link_id = $2",
        message_id,
        link_id,
    )
    .fetch_one(&mut *tx)
    .await?;
    Ok(row)
}

/// Execute the canonical_thread statement.
pub async fn canonical_thread(
    tx: &mut PgConnection,
    link_id: Uuid,
    provider_thread_id: &str,
) -> anyhow::Result<Option<Uuid>> {
    let row = sqlx::query_scalar!(
        "SELECT id FROM email_threads WHERE link_id = $1 AND provider_id = $2 FOR UPDATE",
        link_id,
        provider_thread_id,
    )
    .fetch_optional(&mut *tx)
    .await?;
    Ok(row)
}

/// Execute the move_message_thread statement.
pub async fn move_message_thread(
    tx: &mut PgConnection,
    message_id: Uuid,
    link_id: Uuid,
    canonical: Uuid,
) -> anyhow::Result<()> {
    sqlx::query!(
        "UPDATE email_messages SET thread_id = $3, updated_at = NOW() WHERE id = $1 AND link_id = $2",
        message_id,
        link_id,
        canonical,
    )
    .execute(&mut *tx)
    .await?;
    Ok(())
}

/// Execute the move_attempt_thread statement.
pub async fn move_attempt_thread(
    tx: &mut PgConnection,
    message_id: Uuid,
    link_id: Uuid,
    canonical: Uuid,
) -> anyhow::Result<()> {
    sqlx::query!(
        "UPDATE email_send_attempts SET thread_id = $3 WHERE message_id = $1 AND link_id = $2",
        message_id,
        link_id,
        canonical,
    )
    .execute(&mut *tx)
    .await?;
    Ok(())
}

/// Execute the original_thread_empty statement.
pub async fn original_thread_empty(tx: &mut PgConnection, original: Uuid) -> anyhow::Result<bool> {
    let row = sqlx::query_scalar!(
        r#"SELECT NOT EXISTS(SELECT 1 FROM email_messages WHERE thread_id = $1) AS "empty!""#,
        original,
    )
    .fetch_one(&mut *tx)
    .await?;
    Ok(row)
}

/// Execute the redirect_thread_aliases statement.
pub async fn redirect_thread_aliases(
    tx: &mut PgConnection,
    link_id: Uuid,
    original: Uuid,
    canonical: Uuid,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"UPDATE email_thread_client_ids SET thread_id = $3, created_at = NOW()
               WHERE link_id = $1 AND thread_id = $2"#,
        link_id,
        original,
        canonical,
    )
    .execute(&mut *tx)
    .await?;
    Ok(())
}

/// Execute the redirect_original_thread statement.
pub async fn redirect_original_thread(
    tx: &mut PgConnection,
    original: Uuid,
    link_id: Uuid,
    canonical: Uuid,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"INSERT INTO email_thread_client_ids (client_id, link_id, thread_id)
               VALUES ($1, $2, $3) ON CONFLICT (link_id, client_id)
               DO UPDATE SET thread_id = EXCLUDED.thread_id, created_at = NOW()"#,
        original,
        link_id,
        canonical,
    )
    .execute(&mut *tx)
    .await?;
    Ok(())
}
