use crate::domain::models::{Link, UserProvider};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

use super::db_types::{DbLink, DbUserProvider};

#[tracing::instrument(err, skip(pool))]
pub(super) async fn link_by_fusionauth_and_macro_id(
    pool: &PgPool,
    fusionauth_user_id: &str,
    macro_id: MacroUserIdStr<'_>,
    provider: UserProvider,
) -> Result<Option<Link>, sqlx::Error> {
    let provider: DbUserProvider = match provider {
        UserProvider::Gmail => DbUserProvider::Gmail,
    };

    let db_link = sqlx::query_as!(
        DbLink,
        r#"
        SELECT id, macro_id, fusionauth_user_id, email_address, provider as "provider: _",
               is_sync_active, created_at, updated_at
        FROM email_links
        WHERE fusionauth_user_id = $1 AND macro_id = $2 AND provider = $3
        LIMIT 1
        "#,
        fusionauth_user_id,
        macro_id.as_ref(),
        provider as _
    )
    .fetch_optional(pool)
    .await?;

    db_link
        .map(|v| v.try_into_model())
        .transpose()
        .map_err(|e| sqlx::Error::Decode(Box::new(e)))
}

#[tracing::instrument(err, skip(pool))]
pub(super) async fn link_by_fusionauth_email_provider(
    pool: &PgPool,
    fusionauth_user_id: &str,
    email_address: &str,
    provider: UserProvider,
) -> Result<Option<Link>, sqlx::Error> {
    let provider: DbUserProvider = match provider {
        UserProvider::Gmail => DbUserProvider::Gmail,
    };

    let db_link = sqlx::query_as!(
        DbLink,
        r#"
        SELECT id, macro_id, fusionauth_user_id, email_address, provider as "provider: _",
               is_sync_active, created_at, updated_at
        FROM email_links
        WHERE fusionauth_user_id = $1 AND email_address = $2 AND provider = $3
        LIMIT 1
        "#,
        fusionauth_user_id,
        email_address,
        provider as _
    )
    .fetch_optional(pool)
    .await?;

    db_link
        .map(|v| v.try_into_model())
        .transpose()
        .map_err(|e| sqlx::Error::Decode(Box::new(e)))
}

#[tracing::instrument(err, skip(pool))]
pub(super) async fn links_by_fusionauth_user_id(
    pool: &PgPool,
    fusionauth_user_id: &str,
) -> Result<Vec<Link>, sqlx::Error> {
    let db_links: Vec<DbLink> = sqlx::query_as!(
        DbLink,
        r#"
        SELECT id, macro_id, fusionauth_user_id, email_address, provider as "provider: _",
               is_sync_active, created_at, updated_at
        FROM email_links
        WHERE fusionauth_user_id = $1
        ORDER BY created_at DESC
        "#,
        fusionauth_user_id
    )
    .fetch_all(pool)
    .await?;

    db_links
        .into_iter()
        .map(|v| {
            v.try_into_model()
                .map_err(|e| sqlx::Error::Decode(Box::new(e)))
        })
        .collect()
}

#[tracing::instrument(err, skip(pool))]
pub(super) async fn owned_link_for_thread(
    pool: &PgPool,
    thread_id: Uuid,
    fusionauth_user_id: &str,
) -> Result<Option<Link>, sqlx::Error> {
    let db_link: Option<DbLink> = sqlx::query_as!(
        DbLink,
        r#"
        SELECT l.id, l.macro_id, l.fusionauth_user_id, l.email_address, l.provider as "provider: _",
               l.is_sync_active, l.created_at, l.updated_at
        FROM email_threads t
        JOIN email_links l ON l.id = t.link_id
        WHERE t.id = $1 AND l.fusionauth_user_id = $2
        "#,
        thread_id,
        fusionauth_user_id
    )
    .fetch_optional(pool)
    .await?;

    db_link
        .map(|v| v.try_into_model())
        .transpose()
        .map_err(|e| sqlx::Error::Decode(Box::new(e)))
}

#[tracing::instrument(err, skip(pool))]
pub(super) async fn link_by_macro_id(
    pool: &PgPool,
    macro_id: MacroUserIdStr<'_>,
) -> Result<Option<Link>, sqlx::Error> {
    let db_link: Option<DbLink> = sqlx::query_as!(
        DbLink,
        r#"
        SELECT id, macro_id, fusionauth_user_id, email_address, provider as "provider: _",
               is_sync_active, created_at, updated_at
        FROM email_links
        WHERE macro_id = $1
        LIMIT 1
        "#,
        macro_id.as_ref()
    )
    .fetch_optional(pool)
    .await?;

    db_link
        .map(|v: DbLink| v.try_into_model())
        .transpose()
        .map_err(|e| sqlx::Error::Decode(Box::new(e)))
}

#[tracing::instrument(err, skip(pool))]
pub(super) async fn inboxes_for_macro_id(
    pool: &PgPool,
    macro_id: MacroUserIdStr<'_>,
) -> Result<Vec<Link>, sqlx::Error> {
    let db_links: Vec<DbLink> = sqlx::query_as!(
        DbLink,
        r#"
        SELECT id as "id!", macro_id as "macro_id!",
               fusionauth_user_id as "fusionauth_user_id!",
               email_address as "email_address!",
               provider as "provider!: _",
               is_sync_active as "is_sync_active!",
               created_at as "created_at!",
               updated_at as "updated_at!"
        FROM (
            SELECT el.id, el.macro_id, el.fusionauth_user_id, el.email_address,
                   el.provider, el.is_sync_active, el.created_at, el.updated_at
            FROM email_links el
            WHERE el.macro_id = $1
            UNION
            SELECT el.id, el.macro_id, el.fusionauth_user_id, el.email_address,
                   el.provider, el.is_sync_active, el.created_at, el.updated_at
            FROM email_links el
            JOIN macro_user_links mul ON el.macro_id = mul.child_macro_id
            WHERE mul.primary_macro_id = $1
        ) AS combined
        ORDER BY created_at DESC
        "#,
        macro_id.as_ref()
    )
    .fetch_all(pool)
    .await?;

    db_links
        .into_iter()
        .map(|v| {
            v.try_into_model()
                .map_err(|e| sqlx::Error::Decode(Box::new(e)))
        })
        .collect()
}
