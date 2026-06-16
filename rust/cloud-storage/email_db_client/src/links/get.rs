use doppleganger::Mirror;
use models_email::email::service::link;
use models_email::service;
use sqlx::PgPool;
use sqlx::types::Uuid;

use crate::links::types::{DbLink, DbUserProvider};

#[cfg(test)]
mod test;

/// fetches a link given an email address and provider.
#[tracing::instrument(skip(pool), err)]
pub async fn fetch_link_by_email(
    pool: &PgPool,
    email_address: &str,
    provider: service::link::UserProvider,
) -> anyhow::Result<Option<link::Link>> {
    if email_address.is_empty() {
        anyhow::bail!("Email address cannot be empty");
    }

    let db_link = sqlx::query_as!(
        DbLink,
        r#"
        SELECT id, macro_id, fusionauth_user_id, email_address, provider as "provider: _",
               is_sync_active, is_primary, needs_reauth, last_sync_error_at, created_at, updated_at
        FROM email_links
        WHERE email_address = $1 AND provider = $2
        LIMIT 1
        "#,
        email_address,
        DbUserProvider::mirror(provider) as _
    )
    .fetch_optional(pool)
    .await?;

    Ok(db_link.map(service::link::Link::try_from).transpose()?)
}

/// fetches email_links given a macro_id.
#[tracing::instrument(skip(pool), err)]
pub async fn fetch_link_by_macro_id(
    pool: &PgPool,
    macro_id: &str,
) -> anyhow::Result<Option<link::Link>> {
    if macro_id.is_empty() {
        anyhow::bail!("Macro ID cannot be empty");
    }

    let db_link = sqlx::query_as!(
        DbLink,
        r#"
        SELECT id, macro_id, fusionauth_user_id, email_address, provider as "provider: _",
               is_sync_active, is_primary, needs_reauth, last_sync_error_at, created_at, updated_at
        FROM email_links
        WHERE macro_id = $1
        ORDER BY created_at DESC
        LIMIT 1
        "#,
        macro_id
    )
    .fetch_optional(pool)
    .await?;

    // Convert DB link to service link if it exists
    Ok(db_link.map(service::link::Link::try_from).transpose()?)
}

/// Fetches all email_links the user can access via their macro_id, including any
/// inboxes delegated via macro_user_links. The union is the read-side half of the
/// multi-inbox narrow-graph design — it surfaces both the user's own inboxes
/// (same macro_id) and inboxes belonging to other macro users they've been delegated.
#[tracing::instrument(skip(pool), err)]
pub async fn fetch_inboxes_for_macro_id(
    pool: &PgPool,
    macro_id: &str,
) -> anyhow::Result<Vec<link::Link>> {
    if macro_id.is_empty() {
        anyhow::bail!("macro_id cannot be empty");
    }

    let db_links = sqlx::query_as!(
        DbLink,
        r#"
        SELECT id as "id!", macro_id as "macro_id!",
               fusionauth_user_id as "fusionauth_user_id!",
               email_address as "email_address!",
               provider as "provider!: _",
               is_sync_active as "is_sync_active!",
               is_primary as "is_primary!",
               needs_reauth as "needs_reauth!",
               last_sync_error_at,
               created_at as "created_at!",
               updated_at as "updated_at!"
        FROM (
            SELECT el.id, el.macro_id, el.fusionauth_user_id, el.email_address,
                   el.provider, el.is_sync_active, el.is_primary, el.needs_reauth,
                   el.last_sync_error_at, el.created_at, el.updated_at
            FROM email_links el
            WHERE el.macro_id = $1
            UNION
            SELECT el.id, el.macro_id, el.fusionauth_user_id, el.email_address,
                   el.provider, el.is_sync_active, el.is_primary, el.needs_reauth,
                   el.last_sync_error_at, el.created_at, el.updated_at
            FROM email_links el
            JOIN macro_user_links mul ON el.id = mul.link_id
            WHERE mul.primary_macro_id = $1
        ) AS combined
        ORDER BY created_at DESC
        "#,
        macro_id
    )
    .fetch_all(pool)
    .await?;

    let service_links: Result<Vec<_>, _> = db_links
        .into_iter()
        .map(service::link::Link::try_from)
        .collect();

    Ok(service_links?)
}

/// fetches email_links given a fusionauth_user_id. a fusionauth_user_id can have multiple email_links, each with a unique macro_id
#[tracing::instrument(skip(pool), err)]
pub async fn fetch_links_by_fusionauth_user_id(
    pool: &PgPool,
    fusionauth_user_id: &str,
) -> anyhow::Result<Vec<link::Link>> {
    if fusionauth_user_id.is_empty() {
        anyhow::bail!("fusionauth_user_id cannot be empty");
    }

    let db_links = sqlx::query_as!(
        DbLink,
        r#"
        SELECT id, fusionauth_user_id, macro_id, email_address, provider as "provider: _",
               is_sync_active, is_primary, needs_reauth, last_sync_error_at, created_at, updated_at
        FROM email_links
        WHERE fusionauth_user_id = $1
        ORDER BY created_at DESC
        "#,
        fusionauth_user_id
    )
    .fetch_all(pool)
    .await?;

    // Convert DB email_links to service email_links
    let service_links: Result<Vec<_>, _> = db_links
        .into_iter()
        .map(service::link::Link::try_from)
        .collect();

    Ok(service_links?)
}

/// Resolves the inbox (email_link) that owns a thread, but only when that inbox
/// belongs to the given macro user or is delegated to them via macro_user_links.
/// Returns `None` when the thread doesn't exist or its inbox isn't one the caller
/// owns or has delegated access to — callers map that to a not-found/unauthorized
/// response. Lets mutating thread routes derive the inbox from the thread instead
/// of an `X-Email-Link-Id` header.
#[tracing::instrument(skip(pool), err)]
pub async fn fetch_owned_link_for_thread(
    pool: &PgPool,
    macro_id: &str,
    thread_id: Uuid,
) -> anyhow::Result<Option<link::Link>> {
    let db_link = sqlx::query_as!(
        DbLink,
        r#"
        SELECT l.id, l.macro_id, l.fusionauth_user_id, l.email_address, l.provider as "provider: _",
               l.is_sync_active, l.is_primary, l.needs_reauth, l.last_sync_error_at,
               l.created_at, l.updated_at
        FROM email_threads t
        JOIN email_links l ON l.id = t.link_id
        WHERE t.id = $1
          AND (
              l.macro_id = $2
              OR EXISTS (
                  SELECT 1 FROM macro_user_links mul
                  WHERE mul.link_id = l.id AND mul.primary_macro_id = $2
              )
          )
        "#,
        thread_id,
        macro_id
    )
    .fetch_optional(pool)
    .await?;

    Ok(db_link.map(service::link::Link::try_from).transpose()?)
}

/// Resolves the inbox (email_link) that owns a message, scoped to the caller's
/// own and delegated inboxes. See [`fetch_owned_link_for_thread`].
#[tracing::instrument(skip(pool), err)]
pub async fn fetch_owned_link_for_message(
    pool: &PgPool,
    macro_id: &str,
    message_id: Uuid,
) -> anyhow::Result<Option<link::Link>> {
    let db_link = sqlx::query_as!(
        DbLink,
        r#"
        SELECT l.id, l.macro_id, l.fusionauth_user_id, l.email_address, l.provider as "provider: _",
               l.is_sync_active, l.is_primary, l.needs_reauth, l.last_sync_error_at,
               l.created_at, l.updated_at
        FROM email_messages m
        JOIN email_links l ON l.id = m.link_id
        WHERE m.id = $1
          AND (
              l.macro_id = $2
              OR EXISTS (
                  SELECT 1 FROM macro_user_links mul
                  WHERE mul.link_id = l.id AND mul.primary_macro_id = $2
              )
          )
        "#,
        message_id,
        macro_id
    )
    .fetch_optional(pool)
    .await?;

    Ok(db_link.map(service::link::Link::try_from).transpose()?)
}

/// Fetches a link by its ID.
/// Returns None if no link with the given ID exists.
#[tracing::instrument(skip(pool), err)]
pub async fn fetch_link_by_id(pool: &PgPool, link_id: Uuid) -> anyhow::Result<Option<link::Link>> {
    let db_link = sqlx::query_as!(
        DbLink,
        r#"
        SELECT id, macro_id, fusionauth_user_id, email_address, provider as "provider: _",
               is_sync_active, is_primary, needs_reauth, last_sync_error_at, created_at, updated_at
        FROM email_links
        WHERE id = $1
        "#,
        link_id
    )
    .fetch_optional(pool)
    .await?;

    Ok(db_link.map(link::Link::try_from).transpose()?)
}
