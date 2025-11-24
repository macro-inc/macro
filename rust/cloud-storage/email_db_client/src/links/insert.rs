use anyhow::anyhow;
use models_email::email::{db, service};
use sqlx::PgPool;
use sqlx::types::Uuid;

struct LinkId {
    id: Uuid,
}

/// Upserts a link record with the provided Link struct.
/// If a record with matching fusionauth_user_id, email_address, and provider already exists,
/// updates the existing record with values from the provided Link.
/// Returns the ID of the inserted or updated link and a boolean indicating if a new record was created.
#[tracing::instrument(skip(pool), level = "info", err)]
pub async fn upsert_link(
    pool: &PgPool,
    service_link: service::link::Link,
) -> anyhow::Result<service::link::Link> {
    if service_link.fusionauth_user_id.is_empty() {
        return Err(anyhow!("FusionAuth User ID cannot be empty"));
    }
    if service_link.email_address.is_empty() {
        return Err(anyhow!("Email address cannot be empty"));
    }

    let db_link: db::link::Link = service_link.into();

    let result = sqlx::query_as!(
        LinkId,
        r#"
        INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (fusionauth_user_id, email_address, provider) 
        DO UPDATE SET 
            is_sync_active = EXCLUDED.is_sync_active,
            updated_at = NOW()
        RETURNING id
        "#,
        db_link.id,
        db_link.macro_id,
        db_link.fusionauth_user_id,
        db_link.email_address,
        db_link.provider as _,
        db_link.is_sync_active
    )
        .fetch_one(pool)
        .await?;

    let mut service_link: service::link::Link = db_link.into();
    service_link.id = result.id;

    let _ = sqlx::query!(
        r#"
        INSERT INTO email_settings (link_id) -- default settings for new links
        VALUES ($1)
        ON CONFLICT (link_id)
        DO NOTHING
        "#,
        service_link.id,
    )
    .execute(pool)
    .await?;

    Ok(service_link)
}
