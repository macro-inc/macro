use crate::domain::models::{EmailThreadMetadata, MessageRow, ThreadRow};
use chrono::Utc;
use sqlx::PgPool;
use std::collections::HashMap;
use uuid::Uuid;

use super::db_types::{DbMessageRow, DbThreadRow};

#[tracing::instrument(err, skip(pool))]
pub(super) async fn thread_by_id(
    pool: &PgPool,
    thread_id: Uuid,
) -> Result<Option<ThreadRow>, sqlx::Error> {
    let row: Option<DbThreadRow> = sqlx::query_as!(
        DbThreadRow,
        r#"
        SELECT t.id, t.provider_id, t.link_id, t.inbox_visible, t.is_read,
               t.latest_inbound_message_ts, t.latest_outbound_message_ts,
               t.latest_non_spam_message_ts, t.created_at, t.updated_at,
               t.project_id
        FROM email_threads t
        WHERE t.id = $1
        "#,
        thread_id,
    )
    .fetch_optional(pool)
    .await?;

    Ok(row.map(ThreadRow::from))
}

#[tracing::instrument(err, skip(pool, thread_ids))]
pub(super) async fn thread_metadata_by_ids(
    pool: &PgPool,
    thread_ids: &[Uuid],
) -> Result<Vec<EmailThreadMetadata>, sqlx::Error> {
    if thread_ids.is_empty() {
        return Ok(Vec::new());
    }

    sqlx::query_as!(
        EmailThreadMetadata,
        r#"
        SELECT
            id AS "thread_id!",
            link_id,
            latest_inbound_message_ts
        FROM email_threads
        WHERE id = ANY($1)
        "#,
        thread_ids,
    )
    .fetch_all(pool)
    .await
}

#[tracing::instrument(err, skip(pool))]
pub(super) async fn messages_by_thread_id_paginated(
    pool: &PgPool,
    thread_id: Uuid,
    offset: i64,
    limit: i64,
) -> Result<Vec<MessageRow>, sqlx::Error> {
    let rows = sqlx::query_as!(
        DbMessageRow,
        r#"
        SELECT
            id, provider_id, thread_id, provider_thread_id, replying_to_id,
            global_id, link_id, provider_history_id, internal_date_ts, snippet,
            size_estimate, subject, sent_at, has_attachments, is_read, is_starred,
            is_sent, is_draft, body_text, body_html_sanitized, body_macro,
            headers_jsonb, created_at, updated_at
        FROM email_messages
        WHERE thread_id = $1
        ORDER BY COALESCE(internal_date_ts, sent_at, created_at) DESC, id DESC
        LIMIT $2 OFFSET $3
        "#,
        thread_id,
        limit,
        offset,
    )
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(MessageRow::from).collect())
}

/// Fetch the newest non-draft content message in each thread using an
/// effective timestamp and deterministic ID tiebreaker.
#[allow(
    clippy::disallowed_methods,
    reason = "runtime lateral query is covered by repository integration tests"
)]
pub(super) async fn latest_content_message_rows(
    pool: &PgPool,
    thread_ids: &[Uuid],
) -> Result<Vec<MessageRow>, sqlx::Error> {
    let rows = sqlx::query_as::<_, DbMessageRow>(
        r#"
        SELECT
            message.id, message.provider_id, message.thread_id,
            message.provider_thread_id, message.replying_to_id,
            message.global_id, message.link_id, message.provider_history_id,
            message.internal_date_ts, message.snippet, message.size_estimate,
            message.subject, message.sent_at, message.has_attachments,
            message.is_read, message.is_starred, message.is_sent,
            message.is_draft, message.body_text, message.body_html_sanitized,
            message.body_macro, message.headers_jsonb, message.created_at,
            message.updated_at
        FROM UNNEST($1::uuid[]) AS requested(thread_id)
        CROSS JOIN LATERAL (
            SELECT
                id, provider_id, thread_id, provider_thread_id, replying_to_id,
                global_id, link_id, provider_history_id, internal_date_ts,
                snippet, size_estimate, subject, sent_at, has_attachments,
                is_read, is_starred, is_sent, is_draft, body_text,
                body_html_sanitized, body_macro, headers_jsonb, created_at,
                updated_at
            FROM email_messages
            WHERE thread_id = requested.thread_id
              AND is_draft = false
            ORDER BY COALESCE(internal_date_ts, sent_at, created_at) DESC,
                     id DESC
            LIMIT 1
        ) AS message
        "#,
    )
    .bind(thread_ids)
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(MessageRow::from).collect())
}

/// Find macro drafts that reply to any of the given messages but live in a
/// different thread within one of the accessible inboxes. These are reply drafts
/// the user moved to another of their inboxes by switching the sender; surfacing
/// them lets the original conversation reopen the draft with its sender.
pub(super) async fn cross_inbox_reply_drafts(
    pool: &PgPool,
    replying_to_ids: &[Uuid],
    link_ids: &[Uuid],
    exclude_thread_id: Uuid,
) -> Result<Vec<MessageRow>, sqlx::Error> {
    let rows = sqlx::query_as!(
        DbMessageRow,
        r#"
        SELECT
            id, provider_id, thread_id, provider_thread_id, replying_to_id,
            global_id, link_id, provider_history_id, internal_date_ts, snippet,
            size_estimate, subject, sent_at, has_attachments, is_read, is_starred,
            is_sent, is_draft, body_text, body_html_sanitized, body_macro,
            headers_jsonb, created_at, updated_at
        FROM email_messages
        WHERE is_draft = true
          AND provider_id IS NULL
          AND replying_to_id = ANY($1)
          AND link_id = ANY($2)
          AND thread_id <> $3
        "#,
        replying_to_ids,
        link_ids,
        exclude_thread_id,
    )
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(MessageRow::from).collect())
}

/// Insert a new thread record within a transaction.
///
/// On conflict the update is skipped entirely when it would be a no-op
/// (incoming `latest_inbound_message_ts` is NULL or unchanged), so redundant
/// inserts neither rewrite the row nor wipe a populated timestamp with NULL.
pub(super) async fn insert_thread(
    tx: &mut sqlx::PgConnection,
    thread: &ThreadRow,
    link_id: Uuid,
) -> Result<Uuid, sqlx::Error> {
    let result = sqlx::query_scalar!(
        r#"
        INSERT INTO email_threads (id, provider_id, link_id, inbox_visible, is_read,
                             latest_inbound_message_ts, latest_outbound_message_ts,
                             latest_non_spam_message_ts)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (link_id, provider_id) WHERE provider_id IS NOT NULL DO UPDATE
        SET
            latest_inbound_message_ts = EXCLUDED.latest_inbound_message_ts,
            updated_at = NOW()
        WHERE
            EXCLUDED.latest_inbound_message_ts IS NOT NULL AND
            email_threads.latest_inbound_message_ts IS DISTINCT FROM EXCLUDED.latest_inbound_message_ts
        RETURNING id
        "#,
        thread.db_id,
        thread.provider_id,
        link_id,
        thread.inbox_visible,
        thread.is_read,
        thread.latest_inbound_message_ts,
        thread.latest_outbound_message_ts,
        thread.latest_non_spam_message_ts,
    )
    .fetch_optional(&mut *tx)
    .await?;

    if let Some(id) = result {
        return Ok(id);
    }

    // The conflicting row already holds this data; fetch its id.
    sqlx::query_scalar!(
        r#"
        SELECT id FROM email_threads
        WHERE link_id = $1 AND provider_id = $2
        "#,
        link_id,
        thread.provider_id,
    )
    .fetch_one(tx)
    .await
}

// --- Thread metadata update ---
// Ported from email_db_client::threads::update::update_thread_metadata.

mod system_labels {
    pub const INBOX: &str = "INBOX";
    pub const SENT: &str = "SENT";
    pub const SPAM: &str = "SPAM";
    pub const TRASH: &str = "TRASH";
}

/// Lightweight message metadata used only for computing thread metadata.
struct MessageMetadata {
    is_draft: bool,
    is_sent: bool,
    is_read: bool,
    provider_id: Option<String>,
    internal_date_ts: Option<chrono::DateTime<Utc>>,
    updated_at: chrono::DateTime<Utc>,
    labels: Vec<String>,
    /// Whether the sender (from_contact_id) is also a recipient of this message.
    sender_is_recipient: bool,
}

fn is_macro_draft(msg: &MessageMetadata) -> bool {
    msg.is_draft && msg.provider_id.is_none()
}

fn is_inbound(msg: &MessageMetadata) -> bool {
    if !msg.labels.iter().any(|l| l == system_labels::INBOX) {
        return false;
    }

    if !(msg.is_draft || msg.is_sent) {
        return true;
    }

    // edge case for messages a user sent to themselves
    msg.sender_is_recipient
}

fn is_outbound(msg: &MessageMetadata) -> bool {
    if msg.labels.iter().any(|l| l == system_labels::TRASH) {
        return false;
    }

    msg.is_sent
}

fn is_spam_or_trash(msg: &MessageMetadata) -> bool {
    msg.labels
        .iter()
        .any(|l| matches!(l.as_str(), system_labels::SPAM | system_labels::TRASH))
}

/// Fetch lightweight message metadata for all messages in a thread.
async fn fetch_messages_metadata(
    tx: &mut sqlx::PgConnection,
    thread_db_id: Uuid,
) -> Result<Vec<MessageMetadata>, sqlx::Error> {
    struct RawMsg {
        id: Uuid,
        is_draft: bool,
        is_sent: bool,
        is_read: bool,
        provider_id: Option<String>,
        internal_date_ts: Option<chrono::DateTime<Utc>>,
        updated_at: chrono::DateTime<Utc>,
    }

    let messages = sqlx::query_as!(
        RawMsg,
        r#"
        SELECT
            id, is_draft, is_sent, is_read, provider_id,
            internal_date_ts, updated_at
        FROM email_messages
        WHERE thread_id = $1
        ORDER BY internal_date_ts DESC NULLS LAST
        "#,
        thread_db_id,
    )
    .fetch_all(&mut *tx)
    .await?;

    if messages.is_empty() {
        return Ok(Vec::new());
    }

    let message_ids: Vec<Uuid> = messages.iter().map(|m| m.id).collect();

    // Fetch labels for all messages
    struct LabelRow {
        message_id: Uuid,
        provider_label_id: String,
    }

    let label_rows = sqlx::query_as!(
        LabelRow,
        r#"
        SELECT ml.message_id, el.provider_label_id
        FROM email_message_labels ml
        JOIN email_labels el ON el.id = ml.label_id
        WHERE ml.message_id = ANY($1)
        "#,
        &message_ids,
    )
    .fetch_all(&mut *tx)
    .await?;

    let mut labels_map: HashMap<Uuid, Vec<String>> = HashMap::new();
    for row in label_rows {
        labels_map
            .entry(row.message_id)
            .or_default()
            .push(row.provider_label_id);
    }

    // Check which messages have the sender as a recipient (for self-sent edge case)
    struct SelfSentRow {
        message_id: Uuid,
    }

    let self_sent_rows = sqlx::query_as!(
        SelfSentRow,
        r#"
        SELECT DISTINCT emr.message_id
        FROM email_message_recipients emr
        JOIN email_messages m ON m.id = emr.message_id
        WHERE emr.message_id = ANY($1)
          AND m.from_contact_id IS NOT NULL
          AND emr.contact_id = m.from_contact_id
        "#,
        &message_ids,
    )
    .fetch_all(&mut *tx)
    .await?;

    let self_sent_set: std::collections::HashSet<Uuid> =
        self_sent_rows.into_iter().map(|r| r.message_id).collect();

    Ok(messages
        .into_iter()
        .map(|m| MessageMetadata {
            labels: labels_map.remove(&m.id).unwrap_or_default(),
            sender_is_recipient: self_sent_set.contains(&m.id),
            is_draft: m.is_draft,
            is_sent: m.is_sent,
            is_read: m.is_read,
            provider_id: m.provider_id,
            internal_date_ts: m.internal_date_ts,
            updated_at: m.updated_at,
        })
        .collect())
}

/// Recalculate and update thread metadata from all messages in the thread.
/// This is the exact same logic as `email_db_client::threads::update::update_thread_metadata`.
pub(super) async fn update_thread_metadata(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    thread_db_id: Uuid,
    link_id: Uuid,
) -> Result<(), sqlx::Error> {
    let messages = fetch_messages_metadata(tx, thread_db_id).await?;

    // if any non-sent message in the thread has the INBOX label, the thread is visible in the inbox
    let inbox_visible = messages.iter().any(|message| {
        let has_inbox = message.labels.iter().any(|l| l == system_labels::INBOX);
        let has_sent = message.labels.iter().any(|l| l == system_labels::SENT);

        (has_inbox && !has_sent) || is_macro_draft(message)
    });

    // if any message in the thread is unread, the thread is considered unread in the FE
    let is_read = !messages.iter().any(|message| !message.is_read);

    let latest_draft_ts = messages
        .iter()
        .filter(|msg| is_macro_draft(msg))
        .map(|msg| msg.updated_at)
        .max();

    let latest_inbound_timestamp_ts = messages
        .iter()
        .find(|msg| is_inbound(msg))
        .map(|msg| msg.internal_date_ts)
        .unwrap_or(None);

    let latest_inbound_or_draft_ts = [latest_inbound_timestamp_ts, latest_draft_ts]
        .into_iter()
        .flatten()
        .max();

    let latest_outbound_message_ts = messages
        .iter()
        .find(|msg| is_outbound(msg))
        .map(|msg| msg.internal_date_ts)
        .unwrap_or(None);

    // latest non-spam message timestamp is the latest macro draft or provider message
    let latest_provider_message_ts = messages
        .iter()
        .find(|msg| !is_spam_or_trash(msg))
        .map(|msg| msg.internal_date_ts)
        .unwrap_or(None);

    let latest_non_spam_message_ts = [latest_provider_message_ts, latest_draft_ts]
        .into_iter()
        .flatten()
        .max();

    update_db_thread_metadata(
        tx,
        thread_db_id,
        link_id,
        inbox_visible,
        is_read,
        latest_inbound_or_draft_ts,
        latest_outbound_message_ts,
        latest_non_spam_message_ts,
    )
    .await?;

    sync_thread_signal_flag(tx, thread_db_id).await?;

    Ok(())
}

/// Recomputes the denormalized `email_threads.is_signal` flag: true iff the
/// thread has a non-TRASH message matching the importance heuristic. Exact
/// copy of `email_db_client::threads::update::sync_thread_signal_flag`,
/// mirroring the Importance(true) predicate in the dynamic query builder.
pub(super) async fn sync_thread_signal_flag(
    tx: &mut sqlx::PgConnection,
    thread_db_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        UPDATE email_threads t
        SET is_signal = calc.sig
        FROM (
            SELECT EXISTS (
                SELECT 1
                FROM email_messages m
                WHERE m.thread_id = $1
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
        ) calc
        WHERE t.id = $1
          AND t.is_signal IS DISTINCT FROM calc.sig
        "#,
        thread_db_id
    )
    .execute(tx)
    .await?;

    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn update_db_thread_metadata(
    tx: &mut sqlx::PgConnection,
    thread_id: Uuid,
    link_id: Uuid,
    inbox_visible: bool,
    is_read: bool,
    latest_inbound_message_ts: Option<chrono::DateTime<Utc>>,
    latest_outbound_message_ts: Option<chrono::DateTime<Utc>>,
    latest_non_spam_message_ts: Option<chrono::DateTime<Utc>>,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        UPDATE email_threads
        SET
            inbox_visible = $1,
            is_read = $2,
            latest_inbound_message_ts = $3,
            latest_outbound_message_ts = $4,
            latest_non_spam_message_ts = $5,
            updated_at = NOW()
        WHERE
            id = $6 AND
            link_id = $7 AND
            (inbox_visible, is_read, latest_inbound_message_ts, latest_outbound_message_ts, latest_non_spam_message_ts)
                IS DISTINCT FROM ($1, $2, $3, $4, $5)
        "#,
        inbox_visible,
        is_read,
        latest_inbound_message_ts,
        latest_outbound_message_ts,
        latest_non_spam_message_ts,
        thread_id,
        link_id,
    )
    .execute(tx)
    .await?;

    Ok(())
}

/// Update the denormalized thread-level read status, verified by link_id.
#[tracing::instrument(err, skip(pool))]
pub(super) async fn update_thread_read_status(
    pool: &PgPool,
    thread_id: Uuid,
    link_id: Uuid,
    is_read: bool,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        UPDATE email_threads
        SET
            is_read = $1,
            updated_at = NOW()
        WHERE
            id = $2 AND
            link_id = $3
        "#,
        is_read,
        thread_id,
        link_id,
    )
    .execute(pool)
    .await?;

    Ok(())
}

/// Update the project assignment for a thread. Returns `false` if the thread was not found.
#[tracing::instrument(err, skip(pool))]
pub(super) async fn update_thread_project(
    pool: &PgPool,
    thread_id: Uuid,
    project_id: Option<&str>,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query!(
        r#"
        UPDATE email_threads
        SET project_id = $2, updated_at = NOW()
        WHERE id = $1
        "#,
        thread_id,
        project_id,
    )
    .execute(pool)
    .await?;

    Ok(result.rows_affected() > 0)
}

/// Get the current project_id for a thread.
#[tracing::instrument(err, skip(pool))]
pub(super) async fn get_thread_project_id(
    pool: &PgPool,
    thread_id: Uuid,
) -> Result<Option<String>, sqlx::Error> {
    let row: Option<Option<String>> = sqlx::query_scalar!(
        r#"
        SELECT project_id
        FROM email_threads
        WHERE id = $1
        "#,
        thread_id,
    )
    .fetch_optional(pool)
    .await?;

    Ok(row.flatten())
}

/// Upsert user history for thread interaction tracking.
pub(super) async fn upsert_user_history(
    tx: &mut sqlx::PgConnection,
    link_id: Uuid,
    thread_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        INSERT INTO email_user_history (link_id, thread_id, created_at, updated_at)
        VALUES ($1, $2, NOW(), NOW())
        ON CONFLICT (link_id, thread_id)
        DO UPDATE SET
            updated_at = NOW()
        "#,
        link_id,
        thread_id,
    )
    .execute(tx)
    .await?;

    Ok(())
}
