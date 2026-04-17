use doppleganger::Mirror;
use sqlx::PgPool;
use sqlx::types::Uuid;

use crate::links::types::DbUserProvider;

#[tracing::instrument(skip(pool), err)]
pub async fn insert_email_link_history(
    pool: &PgPool,
    link_id: Uuid,
    fusionauth_user_id: &str,
    email_address: &str,
    provider: models_email::service::link::UserProvider,
) -> anyhow::Result<()> {
    let id = macro_uuid::generate_uuid_v7();
    let db_provider = DbUserProvider::mirror(provider);

    sqlx::query!(
        r#"
        INSERT INTO email_links_history (id, link_id, fusionauth_user_id, email_address, provider, created_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        "#,
        id,
        link_id,
        fusionauth_user_id,
        email_address,
        db_provider as _,
    )
    .execute(pool)
    .await?;

    Ok(())
}
