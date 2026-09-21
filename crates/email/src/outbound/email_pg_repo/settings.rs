use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::ports::LinkEmailSettings;

/// Fetch one inbox's settings. An inbox without a settings row (links that
/// predate the table) reads as the schema defaults.
#[tracing::instrument(skip(pool), err)]
pub(super) async fn fetch_email_settings(
    pool: &PgPool,
    link_id: Uuid,
) -> Result<LinkEmailSettings, sqlx::Error> {
    let row = sqlx::query!(
        r#"
        SELECT signature_on_replies_forwards, signature, mcp_send_enabled
        FROM email_settings
        WHERE link_id = $1
        "#,
        link_id
    )
    .fetch_optional(pool)
    .await?;

    Ok(row
        .map(|row| LinkEmailSettings {
            signature: row.signature,
            signature_on_replies_forwards: row.signature_on_replies_forwards,
            mcp_send_enabled: row.mcp_send_enabled,
        })
        .unwrap_or_default())
}
