use anyhow::Context;
use models_email::{db, service};
use sqlx::PgPool;
use sqlx::types::Uuid;

/// fetches the contacts sync tokens for a given link id
pub async fn get_sync_tokens_by_link_id(
    pool: &PgPool,
    link_id: Uuid,
) -> anyhow::Result<Option<service::sync_token::SyncTokens>> {
    let db_sync_tokens: Option<db::sync_token::SyncTokens> = sqlx::query_as!(
        db::sync_token::SyncTokens,
        r#"
        SELECT link_id, contacts_sync_token, other_contacts_sync_token
        FROM email_sync_tokens
        WHERE link_id = $1
        "#,
        link_id
    )
    .fetch_optional(pool)
    .await
    .with_context(|| format!("Failed to fetch sync token for link_id {}", link_id))?;

    Ok(db_sync_tokens.map(Into::into))
}
