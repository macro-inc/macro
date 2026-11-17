//! Thread lookups that let search apply the Email list's thread-level filters.

use sqlx::PgPool;
use sqlx::types::Uuid;

#[cfg(test)]
mod test;

/// Thread-level conditions, each meaning what the Email list query's literal
/// of the same name means. `None` and empty fields impose nothing.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct ThreadStateFilter {
    /// `email_threads.is_read` must equal this.
    pub is_read: Option<bool>,
    /// `email_threads.inbox_visible` must equal this (false is "done").
    pub inbox_visible: Option<bool>,
    /// The thread must carry `has_calendar_attachment`.
    pub calendar_only: bool,
    /// The viewer must hold a live notification on the thread in one of
    /// these `notification_state` values.
    pub notification_states: Vec<String>,
}

/// The subset of `thread_ids` that meets every condition in `filter`, with
/// notification states read for `viewer` as the Email list reads them. Each
/// id is one primary-key lookup and, with notification states, a read of that
/// thread's notifications and their recipients. The `OFFSET 0` fences keep
/// the planner from walking a flag's partial index across every mailbox, or
/// every notification the viewer holds, when its statistics underrate them.
#[tracing::instrument(skip(pool, thread_ids, viewer), fields(thread_count = thread_ids.len()), err)]
pub async fn thread_ids_matching_states(
    pool: &PgPool,
    thread_ids: &[Uuid],
    viewer: &str,
    filter: &ThreadStateFilter,
) -> anyhow::Result<Vec<Uuid>> {
    if thread_ids.is_empty() {
        return Ok(Vec::new());
    }
    let ids = sqlx::query_scalar!(
        r#"
        SELECT ids.id AS "id!"
        FROM unnest($1::uuid[]) AS ids(id)
        CROSS JOIN LATERAL (
            SELECT t.is_read, t.inbox_visible, t.has_calendar_attachment
            FROM email_threads t
            WHERE t.id = ids.id
            OFFSET 0
        ) t
        WHERE ($2::bool IS NULL OR t.is_read = $2)
          AND ($3::bool IS NULL OR t.inbox_visible = $3)
          AND (NOT $4 OR t.has_calendar_attachment)
          AND (
              cardinality($5::text[]) = 0
              OR EXISTS (
                  SELECT 1
                  FROM notification n
                  CROSS JOIN LATERAL (
                      SELECT un.user_id, un.state, un.deleted_at
                      FROM user_notification un
                      WHERE un.notification_id = n.id
                      OFFSET 0
                  ) un
                  WHERE n.event_item_type = 'email_thread'
                    AND n.event_item_id = ids.id::text
                    AND un.user_id = $6
                    AND un.deleted_at IS NULL
                    AND un.state = ANY($5::text[]::notification_state[])
                  OFFSET 0
              )
          )
        "#,
        thread_ids,
        filter.is_read,
        filter.inbox_visible,
        filter.calendar_only,
        &filter.notification_states,
        viewer,
    )
    .fetch_all(pool)
    .await?;
    Ok(ids)
}

/// Threads with a calendar attachment in the given inboxes, newest first per
/// inbox, at most `limit` of them. Each inbox is read in the order of the
/// partial `idx_email_threads_calendar_view` index, as the Email list's
/// Calendar view reads it, so the read stops at the limit.
#[tracing::instrument(skip(pool, link_ids), fields(link_count = link_ids.len()), err)]
pub async fn calendar_thread_ids(
    pool: &PgPool,
    link_ids: &[Uuid],
    limit: i64,
) -> anyhow::Result<Vec<Uuid>> {
    if link_ids.is_empty() || limit <= 0 {
        return Ok(Vec::new());
    }
    let mut tx = Box::pin(pool.begin()).await?;
    sqlx::query!("SET LOCAL statement_timeout = '5s'")
        .execute(&mut *tx)
        .await?;
    let ids = sqlx::query_scalar!(
        r#"
        SELECT c.id AS "id!"
        FROM unnest($1::uuid[]) AS links(link_id)
        CROSS JOIN LATERAL (
            SELECT t.id
            FROM email_threads t
            WHERE t.link_id = links.link_id
              AND t.has_calendar_attachment
            ORDER BY COALESCE(t.latest_non_spam_message_ts, t.updated_at) DESC, t.id DESC
            LIMIT $2
        ) c
        LIMIT $2
        "#,
        link_ids,
        limit,
    )
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(ids)
}
