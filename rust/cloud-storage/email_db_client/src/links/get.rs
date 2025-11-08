use anyhow::{Context, anyhow};
use models_email::email::db;
use models_email::email::service::link;
use sqlx::PgPool;
use sqlx::types::Uuid;

/// fetches a link given a fusionauth_user_id macro_id and provider.
pub async fn fetch_link_by_fusionauth_and_macro_id(
    pool: &PgPool,
    fusionauth_user_id: &str,
    macro_id: &str,
    provider: db::link::UserProvider,
) -> anyhow::Result<Option<link::Link>> {
    if fusionauth_user_id.is_empty() {
        return Err(anyhow!("Fusion Auth user ID cannot be empty"));
    }

    if macro_id.is_empty() {
        return Err(anyhow!("Macro ID cannot be empty"));
    }

    let provider_display = provider.as_str();

    let db_link = sqlx::query_as!(
        db::link::Link,
        r#"
        SELECT id, macro_id, fusionauth_user_id, email_address, provider as "provider: _",
               is_sync_active, created_at, updated_at
        FROM email_links
        WHERE fusionauth_user_id = $1 AND macro_id = $2 AND provider = $3
        LIMIT 1
        "#,
        fusionauth_user_id,
        macro_id,
        provider as _
    )
    .fetch_optional(pool)
    .await
    .with_context(|| {
        format!(
            "Failed to fetch link for fusionauth_user_id {}, macro_id {} and provider {}",
            fusionauth_user_id, macro_id, provider_display
        )
    })?;

    Ok(db_link.map(Into::into))
}

/// fetches a link given an email address and provider.
pub async fn fetch_link_by_email(
    pool: &PgPool,
    email_address: &str,
    provider: db::link::UserProvider,
) -> anyhow::Result<Option<link::Link>> {
    if email_address.is_empty() {
        return Err(anyhow!("Email address cannot be empty"));
    }

    let provider_display = provider.as_str();

    let db_link = sqlx::query_as!(
        db::link::Link,
        r#"
        SELECT id, macro_id, fusionauth_user_id, email_address, provider as "provider: _",
               is_sync_active, created_at, updated_at
        FROM email_links
        WHERE email_address = $1 AND provider = $2
        LIMIT 1
        "#,
        email_address,
        provider as _
    )
    .fetch_optional(pool)
    .await
    .with_context(|| {
        format!(
            "Failed to fetch link for email_address {} and provider {}",
            email_address, provider_display
        )
    })?;

    Ok(db_link.map(Into::into))
}

/// fetches email_links given a macro_id.
#[tracing::instrument(skip(pool), level = "info")]
pub async fn fetch_link_by_macro_id(
    pool: &PgPool,
    macro_id: &str,
) -> anyhow::Result<Option<link::Link>> {
    if macro_id.is_empty() {
        return Err(anyhow!("Macro ID cannot be empty"));
    }

    let db_link = sqlx::query_as!(
        db::link::Link,
        r#"
        SELECT id, macro_id, fusionauth_user_id, email_address, provider as "provider: _",
               is_sync_active, created_at, updated_at 
        FROM email_links
        WHERE macro_id = $1
        ORDER BY created_at DESC
        LIMIT 1
        "#,
        macro_id
    )
    .fetch_optional(pool)
    .await
    .with_context(|| format!("Failed to fetch link for macro_id {}", macro_id))?;

    // Convert DB link to service link if it exists
    Ok(db_link.map(Into::into))
}

/// fetches email_links given a fusionauth_user_id. a fusionauth_user_id can have multiple email_links, each with a unique macro_id
#[tracing::instrument(skip(pool), level = "info")]
pub async fn fetch_links_by_fusionauth_user_id(
    pool: &PgPool,
    fusionauth_user_id: &str,
) -> anyhow::Result<Vec<link::Link>> {
    if fusionauth_user_id.is_empty() {
        return Err(anyhow!("fusionauth_user_id cannot be empty"));
    }

    let db_links = sqlx::query_as!(
        db::link::Link,
        r#"
        SELECT id, fusionauth_user_id, macro_id, email_address, provider as "provider: _",
               is_sync_active, created_at, updated_at
        FROM email_links
        WHERE fusionauth_user_id = $1
        ORDER BY created_at DESC
        "#,
        fusionauth_user_id
    )
    .fetch_all(pool)
    .await
    .with_context(|| {
        format!(
            "Failed to fetch email_links for fusionauth_user_id {}",
            fusionauth_user_id
        )
    })?;

    // Convert DB email_links to service email_links
    let service_links = db_links.into_iter().map(Into::into).collect();

    Ok(service_links)
}

/// Fetches a link by its ID.
/// Returns None if no link with the given ID exists.
#[tracing::instrument(skip(pool), level = "info")]
pub async fn fetch_link_by_id(pool: &PgPool, link_id: Uuid) -> anyhow::Result<Option<link::Link>> {
    let db_link = sqlx::query_as!(
        db::link::Link,
        r#"
        SELECT id, macro_id, fusionauth_user_id, email_address, provider as "provider: _",
               is_sync_active, created_at, updated_at
        FROM email_links
        WHERE id = $1
        "#,
        link_id
    )
    .fetch_optional(pool)
    .await
    .with_context(|| format!("Failed to fetch link with ID {}", link_id))?;

    Ok(db_link.map(Into::into))
}
