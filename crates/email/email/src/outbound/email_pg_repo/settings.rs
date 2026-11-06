use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::ports::LinkEmailSettings;

/// Fetch one inbox's signature settings.
#[tracing::instrument(skip(pool), err)]
pub(super) async fn fetch_email_settings(
    pool: &PgPool,
    link_id: Uuid,
) -> Result<LinkEmailSettings, sqlx::Error> {
    let row = sqlx::query!(
        r#"
        SELECT signature_on_replies_forwards, signature
        FROM email_settings
        WHERE link_id = $1
        "#,
        link_id
    )
    .fetch_one(pool)
    .await?;

    Ok(LinkEmailSettings {
        signature: row.signature,
        signature_on_replies_forwards: row.signature_on_replies_forwards,
    })
}
