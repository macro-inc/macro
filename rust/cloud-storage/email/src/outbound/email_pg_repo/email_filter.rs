use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::models::EmailFilter;

#[derive(sqlx::FromRow)]
struct EmailFilterRow {
    id: Uuid,
    link_id: Uuid,
    email_address: Option<String>,
    email_domain: Option<String>,
    is_important: bool,
    created_at: DateTime<Utc>,
}

impl From<EmailFilterRow> for EmailFilter {
    fn from(row: EmailFilterRow) -> Self {
        EmailFilter {
            id: row.id,
            link_id: row.link_id,
            email_address: row.email_address,
            email_domain: row.email_domain,
            is_important: row.is_important,
            created_at: row.created_at,
        }
    }
}

/// Upsert an email filter by address. If a filter for this link+address already
/// exists, update its `is_important` value.
#[tracing::instrument(skip(pool), err)]
pub async fn upsert_email_filter_by_address(
    pool: &PgPool,
    link_id: Uuid,
    email_address: &str,
    is_important: bool,
) -> Result<EmailFilter, sqlx::Error> {
    let row = sqlx::query_as!(
        EmailFilterRow,
        r#"INSERT INTO email_filters (link_id, email_address, is_important)
        VALUES ($1, $2, $3)
        ON CONFLICT (link_id, lower(email_address)) WHERE email_address IS NOT NULL
        DO UPDATE SET is_important = EXCLUDED.is_important
        RETURNING id, link_id, email_address, email_domain, is_important, created_at"#,
        link_id,
        email_address,
        is_important,
    )
    .fetch_one(pool)
    .await?;

    Ok(row.into())
}

/// Upsert an email filter by domain. If a filter for this link+domain already
/// exists, update its `is_important` value.
#[tracing::instrument(skip(pool), err)]
pub async fn upsert_email_filter_by_domain(
    pool: &PgPool,
    link_id: Uuid,
    email_domain: &str,
    is_important: bool,
) -> Result<EmailFilter, sqlx::Error> {
    let row = sqlx::query_as!(
        EmailFilterRow,
        r#"INSERT INTO email_filters (link_id, email_domain, is_important)
        VALUES ($1, $2, $3)
        ON CONFLICT (link_id, lower(email_domain)) WHERE email_domain IS NOT NULL
        DO UPDATE SET is_important = EXCLUDED.is_important
        RETURNING id, link_id, email_address, email_domain, is_important, created_at"#,
        link_id,
        email_domain,
        is_important,
    )
    .fetch_one(pool)
    .await?;

    Ok(row.into())
}

/// Delete an email filter by its ID, scoped to a link.
#[tracing::instrument(skip(pool), err)]
pub async fn delete_email_filter(
    pool: &PgPool,
    filter_id: Uuid,
    link_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query!(
        r#"DELETE FROM email_filters WHERE id = $1 AND link_id = $2"#,
        filter_id,
        link_id,
    )
    .execute(pool)
    .await?;

    Ok(result.rows_affected() > 0)
}

/// List all email filters for a link.
#[tracing::instrument(skip(pool), err)]
pub async fn list_email_filters(
    pool: &PgPool,
    link_id: Uuid,
) -> Result<Vec<EmailFilter>, sqlx::Error> {
    let rows = sqlx::query_as!(
        EmailFilterRow,
        r#"SELECT id, link_id, email_address, email_domain, is_important, created_at
        FROM email_filters
        WHERE link_id = $1
        ORDER BY created_at DESC"#,
        link_id,
    )
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(Into::into).collect())
}
