//! Thread lookups that let search apply the Email list's thread-level filters.

use sqlx::PgPool;
use sqlx::types::Uuid;

use super::update::{
    DOCUMENT_MIME_PREFIXES, IMAGE_MIME_PREFIXES, PDF_MIME_PREFIXES, like_prefixes,
};

#[cfg(test)]
mod test;

/// A kind of attachment, by the MIME prefixes the thread attachment flags and
/// the Email view's attachment filters use.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThreadAttachmentKind {
    /// PDF files.
    Pdf,
    /// Images.
    Image,
    /// Office documents, plain text and CSV.
    Document,
    /// Any attachment with a MIME type.
    Any,
}

impl ThreadAttachmentKind {
    fn mime_prefixes(self) -> &'static [&'static str] {
        match self {
            Self::Pdf => PDF_MIME_PREFIXES,
            Self::Image => IMAGE_MIME_PREFIXES,
            Self::Document => DOCUMENT_MIME_PREFIXES,
            Self::Any => &[""],
        }
    }
}

fn attachment_like_patterns(kinds: &[ThreadAttachmentKind]) -> Vec<String> {
    let mut patterns = Vec::new();
    for kind in kinds {
        for pattern in like_prefixes(kind.mime_prefixes()) {
            if !patterns.contains(&pattern) {
                patterns.push(pattern);
            }
        }
    }
    patterns
}

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
    /// The thread must hold a sent message that is present and out of the
    /// trash, which is what `latest_outbound_message_ts` records and what the
    /// Sent view lists.
    pub sent: bool,
    /// The thread must hold a draft that is present and out of the trash, as
    /// the Drafts view lists.
    pub has_draft: bool,
    /// Some message of the thread must carry an attachment of one of these
    /// kinds. The Email view's attachment filters read every attachment of
    /// the thread, so neither presence nor trash is checked.
    pub attachment_kinds: Vec<ThreadAttachmentKind>,
}

/// The subset of `thread_ids` that meets every condition in `filter`, with
/// notification states read for `viewer` as the Email list reads them. Each
/// id is one primary-key lookup and, per condition asked for, a read of that
/// thread's notifications, drafts or messages and their attachments. The
/// `OFFSET 0` fences keep the planner from walking a flag's partial index
/// across every mailbox, or every notification the viewer holds, when its
/// statistics underrate them.
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
    let mut tx = Box::pin(pool.begin()).await?;
    sqlx::query!("SET LOCAL statement_timeout = '5s'")
        .execute(&mut *tx)
        .await?;
    let ids = sqlx::query_scalar!(
        r#"
        SELECT ids.id AS "id!"
        FROM unnest($1::uuid[]) AS ids(id)
        CROSS JOIN LATERAL (
            SELECT t.link_id, t.is_read, t.inbox_visible, t.has_calendar_attachment,
                   t.latest_outbound_message_ts IS NOT NULL AS sent
            FROM email_threads t
            WHERE t.id = ids.id
            OFFSET 0
        ) t
        WHERE ($2::bool IS NULL OR t.is_read = $2)
          AND ($3::bool IS NULL OR t.inbox_visible = $3)
          AND (NOT $4 OR t.has_calendar_attachment)
          AND (NOT $7 OR t.sent)
          AND (
              NOT $8
              OR EXISTS (
                  SELECT 1
                  FROM email_messages d
                  WHERE d.link_id = t.link_id
                    AND d.thread_id = ids.id
                    AND d.is_draft
                    AND EXISTS (
                        SELECT 1
                        FROM email_message_mailbox_facts mf
                        WHERE mf.id = d.id AND mf.is_present AND NOT mf.in_trash
                    )
                  OFFSET 0
              )
          )
          AND (
              cardinality($9::text[]) = 0
              OR EXISTS (
                  SELECT 1
                  FROM email_messages m
                  CROSS JOIN LATERAL (
                      SELECT 1
                      FROM email_attachments a
                      WHERE a.message_id = m.id
                        AND a.mime_type LIKE ANY($9::text[])
                      LIMIT 1
                  ) a
                  WHERE m.thread_id = ids.id
                  OFFSET 0
              )
          )
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
        filter.sent,
        filter.has_draft,
        &attachment_like_patterns(&filter.attachment_kinds),
    )
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
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

/// Threads with a sent message in the given inboxes, newest first per inbox,
/// at most `limit` of them. Each inbox is read in the order of the partial
/// `idx_email_threads_sent_view_link_ts_id` index, as the Email list's Sent
/// view reads it, so the read stops at the limit.
#[tracing::instrument(skip(pool, link_ids), fields(link_count = link_ids.len()), err)]
pub async fn sent_thread_ids(
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
        SELECT s.id AS "id!"
        FROM unnest($1::uuid[]) AS links(link_id)
        CROSS JOIN LATERAL (
            SELECT t.id
            FROM email_threads t
            WHERE t.link_id = links.link_id
              AND t.latest_outbound_message_ts IS NOT NULL
            ORDER BY t.latest_outbound_message_ts DESC
            LIMIT $2
        ) s
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

/// Threads holding a draft that is present and out of the trash in the given
/// inboxes, at most `limit` of them. Each inbox's drafts are read through the
/// partial `idx_email_messages_drafts_view` index, as the Email list's Drafts
/// view reads them; an inbox holds few drafts, so all of them are read.
#[tracing::instrument(skip(pool, link_ids), fields(link_count = link_ids.len()), err)]
pub async fn draft_thread_ids(
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
        SELECT d.thread_id AS "id!"
        FROM unnest($1::uuid[]) AS links(link_id)
        CROSS JOIN LATERAL (
            SELECT DISTINCT m.thread_id
            FROM email_messages m
            WHERE m.link_id = links.link_id
              AND m.is_draft
              AND EXISTS (
                  SELECT 1
                  FROM email_message_mailbox_facts mf
                  WHERE mf.id = m.id AND mf.is_present AND NOT mf.in_trash
              )
            LIMIT $2
        ) d
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
