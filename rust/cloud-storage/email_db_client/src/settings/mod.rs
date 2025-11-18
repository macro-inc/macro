use models_email::{db, service};
use sqlx::PgPool;
use sqlx::types::Uuid;

/// Updates a user's settings.
#[tracing::instrument(skip(pool), level = "info", err)]
pub async fn patch_settings(
    pool: &PgPool,
    service_settings: service::settings::Settings,
) -> anyhow::Result<service::settings::Settings> {
    let db_settings = db::settings::Settings::from(service_settings);

    let result = sqlx::query_as!(
        db::settings::Settings,
        r#"
        INSERT INTO email_settings (link_id, signature_on_replies_forwards)
        VALUES ($1, $2)
        ON CONFLICT (link_id)
        DO UPDATE SET
            signature_on_replies_forwards = EXCLUDED.signature_on_replies_forwards,
            updated_at = NOW()
        RETURNING link_id, signature_on_replies_forwards
        "#,
        db_settings.link_id,
        db_settings.signature_on_replies_forwards,
    )
    .fetch_one(pool)
    .await?;

    Ok(service::settings::Settings::from(result))
}

/// Fetches a user's settings by link ID.
#[tracing::instrument(skip(pool), level = "info", err)]
pub async fn fetch_settings(
    pool: &PgPool,
    link_id: Uuid,
) -> anyhow::Result<service::settings::Settings> {
    let result = sqlx::query_as!(
        db::settings::Settings,
        r#"
        SELECT link_id, signature_on_replies_forwards
        FROM email_settings
        WHERE link_id = $1
        "#,
        link_id
    )
    .fetch_one(pool)
    .await?;

    Ok(service::settings::Settings::from(result))
}
