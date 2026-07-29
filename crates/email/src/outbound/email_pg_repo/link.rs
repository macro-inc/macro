use crate::domain::models::{
    EmailBackfillStatus, EmailInboxDetails, Link, UserEmailLinkSettings, UserProvider,
};
use chrono::{DateTime, Utc};
use macro_user_id::{email::EmailStr, user_id::MacroUserIdStr};
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

/// Database representation of an initial mailbox backfill status.
#[derive(Debug, Clone, Copy, sqlx::Type)]
#[sqlx(type_name = "email_backfill_job_status", rename_all = "PascalCase")]
enum DbEmailBackfillStatus {
    /// The backfill is queued but has not started.
    Init,
    /// The backfill is running.
    InProgress,
    /// The backfill completed.
    Complete,
    /// The backfill was cancelled.
    Cancelled,
    /// The backfill failed.
    Failed,
}

/// Database row for the enriched accessible-inbox projection.
struct DbInboxDetailsRow {
    /// Stable email link identifier.
    id: Uuid,
    /// Macro user that owns the link.
    macro_id: String,
    /// Provider email address.
    email_address: String,
    /// Email provider.
    provider: DbUserProvider,
    /// Whether synchronization is active.
    is_sync_active: bool,
    /// Whether the provider grant needs reauthorization.
    needs_reauth: bool,
    /// Whether this is the owner's primary inbox.
    is_primary: bool,
    /// Link creation timestamp.
    created_at: DateTime<Utc>,
    /// Link last-updated timestamp.
    updated_at: DateTime<Utc>,
    /// Whether signatures are included on replies and forwards.
    signature_on_replies_forwards: Option<bool>,
    /// Saved signature HTML.
    signature: Option<String>,
    /// Latest initial backfill status.
    latest_backfill_status: Option<DbEmailBackfillStatus>,
    /// SFS URL of the inbox's self-contact photo.
    photo_url: Option<String>,
}

impl DbInboxDetailsRow {
    /// Convert the database projection into domain-owned persisted facts.
    fn try_into_model(self) -> Result<EmailInboxDetails, macro_user_id::error::ParseErr> {
        Ok(EmailInboxDetails {
            id: self.id,
            macro_id: MacroUserIdStr::try_from(self.macro_id)?,
            email_address: EmailStr::try_from(self.email_address)?,
            photo_url: self.photo_url,
            provider: match self.provider {
                DbUserProvider::Gmail => UserProvider::Gmail,
            },
            is_sync_active: self.is_sync_active,
            needs_reauth: self.needs_reauth,
            settings: UserEmailLinkSettings {
                signature_on_replies_forwards: self.signature_on_replies_forwards.unwrap_or(false),
                signature: self.signature,
            },
            is_primary: self.is_primary,
            latest_backfill_status: self.latest_backfill_status.map(|status| match status {
                DbEmailBackfillStatus::Init => EmailBackfillStatus::Init,
                DbEmailBackfillStatus::InProgress => EmailBackfillStatus::InProgress,
                DbEmailBackfillStatus::Complete => EmailBackfillStatus::Complete,
                DbEmailBackfillStatus::Cancelled => EmailBackfillStatus::Cancelled,
                DbEmailBackfillStatus::Failed => EmailBackfillStatus::Failed,
            }),
            created_at: self.created_at,
            updated_at: self.updated_at,
        })
    }
}

/// Fetch and map the enriched, user-scoped inbox details used by inbound
/// email catalog adapters.
#[tracing::instrument(err, skip(pool))]
pub(super) async fn inbox_details_for_macro_id(
    pool: &PgPool,
    macro_id: &MacroUserIdStr<'_>,
) -> Result<Vec<EmailInboxDetails>, sqlx::Error> {
    let rows = sqlx::query_as!(
        DbInboxDetailsRow,
        r#"
        SELECT l.id as "id!", l.macro_id as "macro_id!",
               l.email_address as "email_address!",
               l.provider as "provider!: _",
               l.is_sync_active as "is_sync_active!",
               l.needs_reauth as "needs_reauth!",
               l.is_primary as "is_primary!",
               l.created_at as "created_at!",
               l.updated_at as "updated_at!",
               s.signature_on_replies_forwards as "signature_on_replies_forwards?",
               s.signature,
               bj.status as "latest_backfill_status?: _",
               c.sfs_photo_url as "photo_url?"
        FROM (
            SELECT el.id, el.macro_id, el.email_address, el.provider,
                   el.is_sync_active, el.needs_reauth, el.is_primary,
                   el.created_at, el.updated_at
            FROM email_links el
            WHERE el.macro_id = $1
            UNION
            SELECT el.id, el.macro_id, el.email_address, el.provider,
                   el.is_sync_active, el.needs_reauth, el.is_primary,
                   el.created_at, el.updated_at
            FROM email_links el
            JOIN macro_user_links mul ON el.id = mul.link_id
            WHERE mul.primary_macro_id = $1
        ) l
        LEFT JOIN email_settings s ON s.link_id = l.id
        LEFT JOIN LATERAL (
            SELECT status FROM email_backfill_jobs
            WHERE link_id = l.id
            ORDER BY created_at DESC
            LIMIT 1
        ) bj ON true
        LEFT JOIN email_contacts c
            ON c.link_id = l.id AND LOWER(c.email_address) = LOWER(l.email_address)
        ORDER BY l.created_at DESC
        "#,
        macro_id.as_ref()
    )
    .fetch_all(pool)
    .await?;

    rows.into_iter()
        .map(|row| {
            row.try_into_model()
                .map_err(|error| sqlx::Error::Decode(Box::new(error)))
        })
        .collect()
}
