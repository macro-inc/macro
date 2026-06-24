use models_email::{db, service};
use sqlx::PgPool;
use sqlx::types::Uuid;

/// Applies a partial update to a user's settings. Fields left `None` in the
/// patch keep their existing value (COALESCE); on a fresh insert, an omitted
/// `signature_on_replies_forwards` is written as FALSE and `signature` as NULL.
#[tracing::instrument(skip(pool), err)]
pub async fn patch_settings(
    pool: &PgPool,
    patch: service::settings::SettingsPatch,
) -> anyhow::Result<service::settings::Settings> {
    let result = sqlx::query_as!(
        db::settings::Settings,
        r#"
        INSERT INTO email_settings (link_id, signature_on_replies_forwards, signature)
        VALUES ($1, COALESCE($2, FALSE), $3)
        ON CONFLICT (link_id)
        DO UPDATE SET
            signature_on_replies_forwards = COALESCE($2, email_settings.signature_on_replies_forwards),
            signature = COALESCE($3, email_settings.signature),
            updated_at = NOW()
        RETURNING link_id, signature_on_replies_forwards, signature
        "#,
        patch.link_id,
        patch.signature_on_replies_forwards,
        patch.signature,
    )
    .fetch_one(pool)
    .await?;

    Ok(service::settings::Settings::from(result))
}

/// Fetches a user's settings by link ID.
#[tracing::instrument(skip(pool), err)]
pub async fn fetch_settings(
    pool: &PgPool,
    link_id: Uuid,
) -> anyhow::Result<service::settings::Settings> {
    let result = sqlx::query_as!(
        db::settings::Settings,
        r#"
        SELECT link_id, signature_on_replies_forwards, signature
        FROM email_settings
        WHERE link_id = $1
        "#,
        link_id
    )
    .fetch_one(pool)
    .await?;

    Ok(service::settings::Settings::from(result))
}
