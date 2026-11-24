//! Which user labels a thread gains from a write.
//!
//! A write reads [`absent_from_thread`] before it changes labels and
//! [`carried_by_messages`] after, in one transaction that holds the thread's
//! label-write lock (Outlook writes hold the inbox row instead), so writes to a
//! thread's messages take turns and only the first one gains a label. Both read
//! the effective labels, which overlay Outlook category writes the provider has
//! not confirmed yet. Drafts are left out: a label waiting on a draft is not on
//! the thread.
//!
//! Each query reaches the effective labels by message id only: joined on
//! anything else, a planner with stale statistics reads the whole view.

use sqlx::PgConnection;
use sqlx::types::Uuid;

#[cfg(test)]
mod test;

/// The link's user labels among `provider_label_ids` that no message of the
/// thread carries. A thread that doesn't exist yet lacks them all.
pub async fn absent_from_thread(
    conn: &mut PgConnection,
    link_id: Uuid,
    thread_id: Uuid,
    provider_label_ids: &[String],
) -> Result<Vec<Uuid>, sqlx::Error> {
    if provider_label_ids.is_empty() {
        return Ok(Vec::new());
    }

    sqlx::query_scalar!(
        r#"
        WITH carried AS MATERIALIZED (
            SELECT ml.label_id
            FROM email_effective_message_labels ml
            WHERE ml.message_id = ANY(ARRAY(
                SELECT m.id FROM email_messages m WHERE m.thread_id = $3 AND NOT m.is_draft
            ))
        )
        SELECT l.id
        FROM email_labels l
        WHERE l.link_id = $1 AND l.provider_label_id = ANY($2) AND l.type = 'User'
            AND NOT EXISTS (SELECT 1 FROM carried c WHERE c.label_id = l.id)
        ORDER BY l.id
        "#,
        link_id,
        provider_label_ids,
        thread_id,
    )
    .fetch_all(conn)
    .await
}

/// A label one of the messages carries, and that message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CarriedLabel {
    pub label_id: Uuid,
    pub message_id: Uuid,
    pub thread_id: Uuid,
}

/// Which of `label_ids` the messages carry, one row per thread and label: the
/// first message carrying it.
pub async fn carried_by_messages(
    conn: &mut PgConnection,
    message_ids: &[Uuid],
    label_ids: &[Uuid],
) -> Result<Vec<CarriedLabel>, sqlx::Error> {
    if message_ids.is_empty() || label_ids.is_empty() {
        return Ok(Vec::new());
    }

    sqlx::query_as!(
        CarriedLabel,
        r#"
        SELECT DISTINCT ON (m.thread_id, ml.label_id)
            ml.label_id AS "label_id!", m.id AS "message_id!", m.thread_id AS "thread_id!"
        FROM unnest($1::uuid[]) AS ids(id)
        CROSS JOIN LATERAL (
            SELECT o.id, o.thread_id FROM email_messages o WHERE o.id = ids.id AND NOT o.is_draft
            OFFSET 0
        ) m
        CROSS JOIN LATERAL (
            SELECT e.label_id FROM email_effective_message_labels e WHERE e.message_id = m.id
            OFFSET 0
        ) ml
        WHERE ml.label_id = ANY($2)
        ORDER BY m.thread_id, ml.label_id, m.id
        "#,
        message_ids,
        label_ids,
    )
    .fetch_all(conn)
    .await
}

/// The user labels a message carries that no earlier message of its thread
/// does, for a thread imported whole: there is no state before the write to
/// compare with. A later message counts as having arrived with its own labels.
pub async fn new_to_thread(
    pool: &sqlx::PgPool,
    message_id: Uuid,
) -> Result<Vec<Uuid>, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
        WITH target AS MATERIALIZED (
            SELECT m.thread_id, COALESCE(m.internal_date_ts, m.created_at) AS at
            FROM email_messages m
            WHERE m.id = $1 AND NOT m.is_draft
        ),
        earlier AS MATERIALIZED (
            SELECT ml.label_id
            FROM email_effective_message_labels ml
            WHERE ml.message_id = ANY(ARRAY(
                SELECT o.id
                FROM target t
                JOIN email_messages o ON o.thread_id = t.thread_id
                WHERE o.id <> $1 AND NOT o.is_draft
                    AND COALESCE(o.internal_date_ts, o.created_at) < t.at
            ))
        )
        SELECT ml.label_id AS "label_id!"
        FROM email_effective_message_labels ml
        JOIN email_labels l ON l.id = ml.label_id AND l.type = 'User'
        WHERE ml.message_id = $1 AND EXISTS (SELECT 1 FROM target)
            AND NOT EXISTS (SELECT 1 FROM earlier e WHERE e.label_id = ml.label_id)
        ORDER BY ml.label_id
        "#,
        message_id,
    )
    .fetch_all(pool)
    .await
}
