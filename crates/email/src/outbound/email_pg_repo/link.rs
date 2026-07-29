use crate::domain::models::{
    EmailBackfillStatus, EmailInboxDetails, Link, UserEmailLinkSettings, UserProvider,
};
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
               is_sync_active, is_primary, created_at, updated_at
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
               is_sync_active, is_primary, created_at, updated_at
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
pub(super) async fn owned_link_for_thread(
    pool: &PgPool,
    thread_id: Uuid,
    macro_id: MacroUserIdStr<'_>,
) -> Result<Option<Link>, sqlx::Error> {
    let db_link: Option<DbLink> = sqlx::query_as!(
        DbLink,
        r#"
        SELECT l.id, l.macro_id, l.fusionauth_user_id, l.email_address, l.provider as "provider: _",
               l.is_sync_active, l.is_primary, l.created_at, l.updated_at
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
        macro_id.as_ref()
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
               is_sync_active, is_primary, created_at, updated_at
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
               is_primary as "is_primary!",
               created_at as "created_at!",
               updated_at as "updated_at!"
        FROM (
            SELECT el.id, el.macro_id, el.fusionauth_user_id, el.email_address,
                   el.provider, el.is_sync_active, el.is_primary, el.created_at, el.updated_at
            FROM email_links el
            WHERE el.macro_id = $1
            UNION
            SELECT el.id, el.macro_id, el.fusionauth_user_id, el.email_address,
                   el.provider, el.is_sync_active, el.is_primary, el.created_at, el.updated_at
            FROM email_links el
            JOIN macro_user_links mul ON el.id = mul.link_id
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

/// Fetch and map the enriched, user-scoped inbox details used by inbound
/// email catalog adapters.
#[tracing::instrument(err, skip(pool))]
pub(super) async fn inbox_details_for_macro_id(
    pool: &PgPool,
    macro_id: &MacroUserIdStr<'_>,
) -> anyhow::Result<Vec<EmailInboxDetails>> {
    email_db_client::links::get::fetch_inbox_details_for_macro_id(pool, macro_id)
        .await?
        .into_iter()
        .map(|inbox| {
            let provider = match inbox.link.provider {
                models_email::email::service::link::UserProvider::Gmail => UserProvider::Gmail,
            };
            let latest_backfill_status = inbox.latest_backfill_status.map(|status| match status {
                models_email::email::service::backfill::BackfillJobStatus::Init => {
                    EmailBackfillStatus::Init
                }
                models_email::email::service::backfill::BackfillJobStatus::InProgress => {
                    EmailBackfillStatus::InProgress
                }
                models_email::email::service::backfill::BackfillJobStatus::Complete => {
                    EmailBackfillStatus::Complete
                }
                models_email::email::service::backfill::BackfillJobStatus::Cancelled => {
                    EmailBackfillStatus::Cancelled
                }
                models_email::email::service::backfill::BackfillJobStatus::Failed => {
                    EmailBackfillStatus::Failed
                }
            });

            Ok(EmailInboxDetails {
                id: inbox.link.id,
                macro_id: inbox.link.macro_id,
                email_address: inbox.link.email_address,
                photo_url: inbox.photo_url,
                provider,
                is_sync_active: inbox.link.is_sync_active,
                needs_reauth: inbox.link.needs_reauth,
                settings: UserEmailLinkSettings {
                    signature_on_replies_forwards: inbox.settings.signature_on_replies_forwards,
                    signature: inbox.settings.signature,
                },
                is_primary: inbox.link.is_primary,
                latest_backfill_status,
                created_at: inbox.link.created_at,
                updated_at: inbox.link.updated_at,
            })
        })
        .collect()
}
