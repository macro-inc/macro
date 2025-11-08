use anyhow::Context;
use models_email::service;
use sqlx::PgPool;

/// Inserts or updates the sync tokens for a given link id
pub async fn insert_sync_tokens(
    pool: &PgPool,
    sync_tokens: service::sync_token::SyncTokens,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO email_sync_tokens (link_id, contacts_sync_token, other_contacts_sync_token)
        VALUES ($1, $2, $3)
        ON CONFLICT (link_id)
        DO UPDATE SET
            contacts_sync_token = $2,
            other_contacts_sync_token = $3
        "#,
        sync_tokens.link_id,
        sync_tokens.contacts_sync_token,
        sync_tokens.other_contacts_sync_token
    )
    .execute(pool)
    .await
    .with_context(|| {
        format!(
            "Failed to insert sync tokens for link_id {}",
            sync_tokens.link_id
        )
    })?;

    Ok(())
}
