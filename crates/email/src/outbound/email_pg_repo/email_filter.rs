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
#[tracing::instrument(skip(conn), err)]
pub async fn upsert_email_filter_by_address(
    conn: &mut sqlx::PgConnection,
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
    .fetch_one(conn)
    .await?;

    Ok(row.into())
}

/// Upsert an email filter by domain. If a filter for this link+domain already
/// exists, update its `is_important` value.
#[tracing::instrument(skip(conn), err)]
pub async fn upsert_email_filter_by_domain(
    conn: &mut sqlx::PgConnection,
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
    .fetch_one(conn)
    .await?;

    Ok(row.into())
}

/// Sender target (address or domain) of a deleted email filter, returned so
/// the caller can resync affected threads' signal flags.
pub struct DeletedEmailFilterTarget {
    pub email_address: Option<String>,
    pub email_domain: Option<String>,
}

/// Delete an email filter by its ID, scoped to a link. Returns the deleted
/// filter's sender target, or `None` if no row matched.
#[tracing::instrument(skip(conn), err)]
pub async fn delete_email_filter(
    conn: &mut sqlx::PgConnection,
    filter_id: Uuid,
    link_id: Uuid,
) -> Result<Option<DeletedEmailFilterTarget>, sqlx::Error> {
    let row = sqlx::query!(
        r#"DELETE FROM email_filters WHERE id = $1 AND link_id = $2
        RETURNING email_address, email_domain"#,
        filter_id,
        link_id,
    )
    .fetch_optional(conn)
    .await?;

    Ok(row.map(|r| DeletedEmailFilterTarget {
        email_address: r.email_address,
        email_domain: r.email_domain,
    }))
}

/// Recomputes `email_threads.is_signal` for every thread in the link with a
/// message from the given sender address or domain. Called after an
/// email_filters change, since the override feeds the signal heuristic.
/// The recompute mirrors sync_thread_signal_flag (thread.rs) / the
/// Importance(true) predicate in the dynamic query builder.
#[tracing::instrument(skip(conn), err)]
pub async fn resync_signal_flags_for_sender(
    conn: &mut sqlx::PgConnection,
    link_id: Uuid,
    email_address: Option<&str>,
    email_domain: Option<&str>,
) -> Result<u64, sqlx::Error> {
    // The scope filter below ANDs both targets, so passing both would only
    // match contacts satisfying address AND domain at once.
    debug_assert!(
        email_address.is_some() ^ email_domain.is_some(),
        "expected exactly one filter target"
    );

    let result = sqlx::query!(
        r#"
        WITH affected AS MATERIALIZED (
            -- Contact-first candidate scan, MATERIALIZED so the planner can't
            -- hoist the expensive per-thread sig predicate above this
            -- selective filter and evaluate it for the whole link.
            SELECT DISTINCT m.thread_id
            FROM email_contacts c
            JOIN email_messages m ON m.from_contact_id = c.id
            WHERE c.link_id = $1
              AND m.link_id = $1
              AND ($2::text IS NULL OR LOWER(c.email_address) = LOWER($2))
              AND ($3::text IS NULL OR LOWER(SPLIT_PART(c.email_address, '@', 2)) = LOWER($3))
        ),
        -- MATERIALIZED so sig is computed once per thread; inlined, both the
        -- SET and the IS DISTINCT FROM would re-evaluate the predicate.
        calc AS MATERIALIZED (
            SELECT a.thread_id,
                EXISTS (
                    SELECT 1
                    FROM email_messages m
                    WHERE m.thread_id = a.thread_id
                      AND NOT EXISTS (
                          SELECT 1 FROM email_message_labels ml
                          JOIN email_labels l ON ml.label_id = l.id
                          WHERE ml.message_id = m.id AND l.name = 'TRASH'
                      )
                      AND (
                          (
                              EXISTS (
                                  SELECT 1
                                  FROM email_contacts sender_c
                                  JOIN email_filters ef
                                    ON ef.link_id = m.link_id
                                   AND ef.email_address IS NOT NULL
                                   AND LOWER(ef.email_address) = LOWER(sender_c.email_address)
                                  WHERE sender_c.id = m.from_contact_id
                                    AND ef.is_important = TRUE
                              )
                              OR EXISTS (
                                  SELECT 1
                                  FROM email_contacts sender_c
                                  JOIN email_filters ef
                                    ON ef.link_id = m.link_id
                                   AND ef.email_domain IS NOT NULL
                                   AND LOWER(ef.email_domain) = LOWER(SPLIT_PART(sender_c.email_address, '@', 2))
                                  WHERE sender_c.id = m.from_contact_id
                                    AND ef.is_important = TRUE
                                    AND NOT EXISTS (
                                        SELECT 1 FROM email_filters ef_addr
                                        WHERE ef_addr.link_id = m.link_id
                                          AND ef_addr.email_address IS NOT NULL
                                          AND LOWER(ef_addr.email_address) = LOWER(sender_c.email_address)
                                          AND ef_addr.is_important = FALSE
                                    )
                              )
                          )
                          OR (
                              NOT (
                                  EXISTS (
                                      SELECT 1
                                      FROM email_contacts sender_c
                                      JOIN email_filters ef
                                        ON ef.link_id = m.link_id
                                       AND ef.email_address IS NOT NULL
                                       AND LOWER(ef.email_address) = LOWER(sender_c.email_address)
                                      WHERE sender_c.id = m.from_contact_id
                                        AND ef.is_important = FALSE
                                  )
                                  OR EXISTS (
                                      SELECT 1
                                      FROM email_contacts sender_c
                                      JOIN email_filters ef
                                        ON ef.link_id = m.link_id
                                       AND ef.email_domain IS NOT NULL
                                       AND LOWER(ef.email_domain) = LOWER(SPLIT_PART(sender_c.email_address, '@', 2))
                                      WHERE sender_c.id = m.from_contact_id
                                        AND ef.is_important = FALSE
                                        AND NOT EXISTS (
                                            SELECT 1 FROM email_filters ef_addr
                                            WHERE ef_addr.link_id = m.link_id
                                              AND ef_addr.email_address IS NOT NULL
                                              AND LOWER(ef_addr.email_address) = LOWER(sender_c.email_address)
                                              AND ef_addr.is_important = TRUE
                                        )
                                  )
                              )
                              AND (
                                  m.is_draft = TRUE
                                  OR EXISTS (
                                      SELECT 1 FROM email_message_labels ml
                                      JOIN email_labels l ON ml.label_id = l.id
                                      WHERE ml.message_id = m.id
                                        AND l.name IN ('CATEGORY_PERSONAL', 'SENT', 'DRAFT')
                                  )
                                  OR NOT EXISTS (
                                      SELECT 1 FROM email_message_labels ml
                                      JOIN email_labels l ON ml.label_id = l.id
                                      WHERE ml.message_id = m.id
                                        AND l.name IN ('CATEGORY_UPDATES', 'CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS')
                                  )
                              )
                          )
                      )
                ) AS sig
            FROM affected a
        )
        UPDATE email_threads t
        SET is_signal = calc.sig
        FROM calc
        WHERE t.id = calc.thread_id
          AND t.link_id = $1
          AND t.is_signal IS DISTINCT FROM calc.sig
        "#,
        link_id,
        email_address,
        email_domain,
    )
    .execute(conn)
    .await?;

    Ok(result.rows_affected())
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
