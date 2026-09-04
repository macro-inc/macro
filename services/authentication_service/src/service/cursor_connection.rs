//! Cursor connection lifecycle use cases.

#[cfg(test)]
mod test;

use bots::domain::provisioning::CURSOR_PERSONA;
use cursor_api_key::{cipher::EncryptedCursorApiKey, store::StoredCursorConfig};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;

/// Atomically store a Cursor key and ensure its owner's private persona.
///
/// # Errors
/// Returns an error if either write or the transaction commit fails.
pub async fn connect_cursor(
    pool: &PgPool,
    user_id: &MacroUserIdStr<'static>,
    encrypted: &EncryptedCursorApiKey,
) -> anyhow::Result<StoredCursorConfig> {
    if !user_id.as_ref().ends_with("@macro.com") {
        anyhow::bail!("Cursor agents are not enabled for this account");
    }
    let mut tx = pool.begin().await?;
    sqlx::query!(
        r#"SELECT id FROM "User" WHERE id = $1 FOR UPDATE"#,
        user_id.as_ref()
    )
    .fetch_one(&mut *tx)
    .await?;
    let stored =
        cursor_api_key::store::upsert_cursor_api_key(&mut *tx, user_id.as_ref(), encrypted).await?;
    bots::outbound::pg_provisioned_agents::ensure_private_provisioned_agent(
        &mut tx,
        user_id,
        &CURSOR_PERSONA,
    )
    .await?;
    tx.commit().await?;
    Ok(stored)
}

/// Atomically forget a Cursor key and deactivate its owner's private persona.
///
/// The persona row and agent configuration are retained so reconnecting
/// restores the same identity and user edits.
///
/// # Errors
/// Returns an error if either write or the transaction commit fails.
pub async fn disconnect_cursor(
    pool: &PgPool,
    user_id: &MacroUserIdStr<'static>,
) -> anyhow::Result<()> {
    let mut tx = pool.begin().await?;
    sqlx::query!(
        r#"SELECT id FROM "User" WHERE id = $1 FOR UPDATE"#,
        user_id.as_ref()
    )
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query("SELECT set_config('macro.cursor_persona_lifecycle', 'enabled', true)")
        .execute(&mut *tx)
        .await?;
    cursor_api_key::store::delete_cursor_api_key(&mut *tx, user_id.as_ref()).await?;
    bots::outbound::pg_provisioned_agents::deactivate_private_provisioned_agent(
        &mut tx,
        user_id,
        CURSOR_PERSONA.key,
    )
    .await?;
    tx.commit().await?;
    Ok(())
}
