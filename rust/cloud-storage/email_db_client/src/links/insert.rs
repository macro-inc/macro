use doppleganger::Mirror;
use models_email::email::service;
use sqlx::types::Uuid;

use crate::links::types::DbUserProvider;

#[cfg(test)]
mod test;

struct LinkId {
    id: Uuid,
    is_primary: bool,
}

/// Upserts a link record with the provided Link struct.
/// If a record with matching fusionauth_user_id, email_address, and provider already exists,
/// updates the existing record with values from the provided Link.
/// Returns the ID of the inserted or updated link and a boolean indicating if a new record was created.
#[tracing::instrument(skip(conn), err)]
pub async fn upsert_link(
    conn: &mut sqlx::PgConnection,
    service_link: service::link::Link,
) -> anyhow::Result<service::link::Link> {
    if service_link.fusionauth_user_id.is_empty() {
        anyhow::bail!("FusionAuth User ID cannot be empty");
    }

    let service::link::Link {
        id,
        macro_id,
        fusionauth_user_id,
        email_address,
        provider,
        is_sync_active,
        is_primary: _,
        needs_reauth: _,
        last_sync_error_at: _,
        created_at,
        updated_at,
    } = service_link;

    let db_provider = DbUserProvider::mirror(provider);

    let result = sqlx::query_as!(
        LinkId,
        r#"
        INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (fusionauth_user_id, email_address, provider)
        DO UPDATE SET
            is_sync_active = EXCLUDED.is_sync_active,
            needs_reauth = false,
            last_sync_error_at = NULL,
            updated_at = NOW()
        RETURNING id, is_primary
        "#,
        id,
        macro_id.as_ref(),
        fusionauth_user_id,
        email_address.0.as_ref(),
        db_provider as _,
        is_sync_active
    )
        .fetch_one(&mut *conn)
        .await?;

    let service_link = service::link::Link {
        id: result.id,
        macro_id,
        fusionauth_user_id,
        email_address,
        provider,
        is_sync_active,
        is_primary: result.is_primary,
        needs_reauth: false,
        last_sync_error_at: None,
        created_at,
        updated_at,
    };

    let _ = sqlx::query!(
        r#"
        INSERT INTO email_settings (link_id) -- default settings for new links
        VALUES ($1)
        ON CONFLICT (link_id)
        DO NOTHING
        "#,
        service_link.id,
    )
    .execute(&mut *conn)
    .await?;

    Ok(service_link)
}
