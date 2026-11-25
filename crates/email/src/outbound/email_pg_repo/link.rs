use crate::domain::models::{
    EmailBackfillStatus, EmailInboxDetails, Link, UserEmailLinkSettings, UserProvider,
};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

use super::db_types::{DbLink, DbUserProvider};

#[tracing::instrument(err, skip(pool, macro_id))]
pub(super) async fn link_by_fusionauth_and_macro_id(
    pool: &PgPool,
    fusionauth_user_id: &str,
    macro_id: MacroUserIdStr<'_>,
    provider: UserProvider,
) -> Result<Option<Link>, sqlx::Error> {
    let provider: DbUserProvider = match provider {
        UserProvider::Gmail => DbUserProvider::Gmail,
        UserProvider::Outlook => DbUserProvider::Outlook,
        UserProvider::Imap => DbUserProvider::Imap,
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

#[tracing::instrument(err, skip(pool, email_address))]
pub(super) async fn link_by_fusionauth_email_provider(
    pool: &PgPool,
    fusionauth_user_id: &str,
    email_address: &str,
    provider: UserProvider,
) -> Result<Option<Link>, sqlx::Error> {
    let provider: DbUserProvider = match provider {
        UserProvider::Gmail => DbUserProvider::Gmail,
        UserProvider::Outlook => DbUserProvider::Outlook,
        UserProvider::Imap => DbUserProvider::Imap,
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

#[tracing::instrument(err, skip(pool, macro_id))]
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

#[tracing::instrument(err, skip(pool, macro_id))]
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

/// Which of `ids` `macro_id` owns or has delegated to it, reading one row per
/// asked id and never the account's links or a link's other delegates, either
/// of which can be many. The fence keeps the owned check on the primary key;
/// the lateral probe keeps the delegated check on
/// `macro_user_links_link_primary_idx`, where a planner that guesses an account
/// has about one delegation would otherwise scan them all by primary key.
#[tracing::instrument(err, skip(pool, macro_id, ids), fields(ids = ids.len()))]
pub(super) async fn inbox_ids_among(
    pool: &PgPool,
    macro_id: MacroUserIdStr<'_>,
    ids: &[Uuid],
) -> Result<Vec<Uuid>, sqlx::Error> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let mut tx = pool.begin().await?;
    // A check that saves a routine must not hold a connection long if a plan
    // ever goes wrong.
    sqlx::query!("SET LOCAL statement_timeout = '5s'")
        .execute(&mut *tx)
        .await?;
    let theirs = sqlx::query_scalar!(
        r#"
        SELECT picked.id AS "id!"
        FROM (
            SELECT el.id, el.macro_id
            FROM email_links el
            WHERE el.id = ANY($2::uuid[])
            OFFSET 0
        ) picked
        WHERE picked.macro_id = $1
        UNION
        SELECT asked.id
        FROM unnest($2::uuid[]) AS asked(id)
        CROSS JOIN LATERAL (
            SELECT 1
            FROM macro_user_links mul
            WHERE mul.link_id = asked.id AND mul.primary_macro_id = $1
            LIMIT 1
        ) delegated
        "#,
        macro_id.as_ref(),
        ids
    )
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(theirs)
}

/// The links list uses the same grant facts and calendar policy as the catalog.
#[tracing::instrument(err, skip(pool, macro_id))]
pub(super) async fn inbox_details_for_macro_id(
    pool: &PgPool,
    macro_id: &MacroUserIdStr<'_>,
) -> anyhow::Result<Vec<EmailInboxDetails>> {
    use models_email::service::backfill::BackfillJobStatus;
    let details =
        email_db_client::links::get::fetch_inbox_details_for_macro_id(pool, macro_id).await?;
    Ok(details
        .into_iter()
        .map(|inbox| {
            let link = inbox.link;
            let provider = match link.provider {
                models_email::service::link::UserProvider::Gmail => UserProvider::Gmail,
                models_email::service::link::UserProvider::Outlook => UserProvider::Outlook,
                models_email::service::link::UserProvider::Imap => UserProvider::Imap,
            };
            EmailInboxDetails {
                id: link.id,
                macro_id: link.macro_id,
                email_address: link.email_address,
                provider,
                photo_url: inbox.photo_url,
                is_sync_active: link.is_sync_active,
                needs_reauth: link.needs_reauth,
                mailbox_unavailable: inbox.mailbox_unavailable,
                settings: UserEmailLinkSettings {
                    signature_on_replies_forwards: inbox.settings.signature_on_replies_forwards,
                    signature: inbox.settings.signature,
                },
                is_primary: link.is_primary,
                latest_backfill_status: inbox.latest_backfill_status.map(|status| match status {
                    BackfillJobStatus::Init => EmailBackfillStatus::Init,
                    BackfillJobStatus::InProgress => EmailBackfillStatus::InProgress,
                    BackfillJobStatus::Complete => EmailBackfillStatus::Complete,
                    BackfillJobStatus::Cancelled => EmailBackfillStatus::Cancelled,
                    BackfillJobStatus::Failed => EmailBackfillStatus::Failed,
                }),
                needs_calendar_permission:
                    crate::domain::mailbox::catalog::calendar_permission_required(
                        link.provider,
                        &inbox.provider_granted_scopes,
                        inbox.calendar_disabled,
                    ),
                calendar_disabled: inbox.calendar_disabled,
                has_calendar_data: inbox.has_calendar_data,
                created_at: link.created_at,
                updated_at: link.updated_at,
            }
        })
        .collect())
}
