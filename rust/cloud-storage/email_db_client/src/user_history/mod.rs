#[cfg(test)]
mod test;

use anyhow::anyhow;
use models_email::service::message::ThreadHistoryInfo;
use sqlx::types::Uuid;
use sqlx::{Executor, PgPool, Postgres};
use std::collections::HashMap;

// upsert user_history row for user and thread
#[tracing::instrument(skip(executor), err)]
pub async fn upsert_user_history<'e, E>(
    executor: E,
    link_id: Uuid,
    thread_id: Uuid,
) -> anyhow::Result<()>
where
    E: Executor<'e, Database = Postgres>,
{
    sqlx::query!(
        r#"
        INSERT INTO email_user_history (link_id, thread_id, created_at, updated_at)
        VALUES ($1, $2, NOW(), NOW())
        ON CONFLICT (link_id, thread_id)
        DO UPDATE SET
            updated_at = NOW()
        "#,
        link_id,
        thread_id
    )
    .execute(executor)
    .await
    .map_err(|_| anyhow!("Failed to upsert user history"))?;

    Ok(())
}

/// Get summary information for multiple email threads.
///
/// Returns a HashMap of thread history info including:
/// - `created_at`: timestamp of the first message in the thread
/// - `updated_at`: timestamp of the last message in the thread
/// - `viewed_at`: last time the user opened/viewed the thread (only included if >= updated_at)
/// - `snippet`, `sender`, `pretty_sender`: from the *latest* message in the thread
/// - `subject`: from the *earliest* message in the thread (so it doesn't include "Re:"s
///
/// The "earliest" and "latest" messages are determined by:
/// 1. Priority: Non-drafts with a valid `sent_at` take precedence over drafts (or messages without `sent_at`).
/// 2. Sort: Chronological order of `sent_at` (or `updated_at` fallback).
///
/// Note: This will exclude any threads where the latest message is marked as TRASH
#[tracing::instrument(skip(pool), err)]
pub async fn get_thread_summary_info(
    pool: &PgPool,
    link_ids: &[Uuid],
    thread_ids: &[Uuid],
) -> anyhow::Result<HashMap<Uuid, ThreadHistoryInfo>> {
    if thread_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let rows = sqlx::query!(
            r#"
            SELECT
                t.id as thread_id,
                -- Return timestamps from the chosen messages directly
                COALESCE(earliest_msg.sent_at, earliest_msg.updated_at) as "first_message_ts!",
                COALESCE(latest_msg.sent_at, latest_msg.updated_at) as "last_message_ts!",
                -- Last time user viewed this thread
                uh.updated_at as "viewed_at?",
                latest_msg.snippet,
                earliest_msg.subject as "subject?",
                l.macro_id,
                t.link_id,
                latest_msg.sender as sender,
                latest_msg.pretty_sender as "pretty_sender!",
                latest_msg.trash_label as trash_label,
                (
                    SELECT m_latest.is_draft
                    FROM email_messages m_latest
                    WHERE m_latest.thread_id = t.id
                      AND m_latest.link_id = t.link_id
                    ORDER BY m_latest.internal_date_ts DESC NULLS LAST
                    LIMIT 1
                ) AS "is_draft!",
                t.is_read,
                t.inbox_visible,
                (
                    SELECT EXISTS (
                        SELECT 1
                        FROM email_messages m_imp
                        JOIN email_message_labels ml ON m_imp.id = ml.message_id
                        JOIN email_labels l ON ml.label_id = l.id
                        WHERE m_imp.thread_id = t.id
                          AND l.link_id = t.link_id
                          AND l.name = 'IMPORTANT'
                    )
                ) AS "is_important!"
            FROM email_threads t
            LEFT JOIN email_user_history uh ON uh.thread_id = t.id AND uh.link_id = t.link_id
            LEFT JOIN email_links l ON l.id = t.link_id
            -- LATERAL join for LATEST message
            -- JOIN (Inner) acts as a filter to ensure we only return threads that actually have messages
            JOIN LATERAL (
                SELECT
                    m2.snippet,
                    m2.sent_at,
                    m2.updated_at,
                    c.email_address as sender,
                    COALESCE(c.name, c.email_address) as pretty_sender,
                    EXISTS(
                        SELECT 1 
                        FROM email_message_labels eml 
                        JOIN email_labels el ON el.id = eml.label_id 
                        WHERE eml.message_id = m2.id 
                          AND el.provider_label_id = 'TRASH'
                    ) as trash_label
                FROM email_messages m2
                LEFT JOIN email_contacts c ON c.id = m2.from_contact_id
                WHERE m2.thread_id = t.id
                  AND m2.link_id = t.link_id
                ORDER BY
                    (CASE WHEN m2.is_draft = false AND m2.sent_at IS NOT NULL THEN 0 ELSE 1 END) ASC,
                    COALESCE(m2.sent_at, m2.updated_at) DESC NULLS LAST
                LIMIT 1
            ) latest_msg ON true
            -- LATERAL join for EARLIEST message
            LEFT JOIN LATERAL (
                SELECT
                    m3.subject,
                    m3.sent_at,
                    m3.updated_at
                FROM email_messages m3
                WHERE m3.thread_id = t.id
                  AND m3.link_id = t.link_id
                ORDER BY
                    -- 1. Priority: Non-drafts with valid sent_at come first (0), everything else is fallback (1)
                    (CASE WHEN m3.is_draft = false AND m3.sent_at IS NOT NULL THEN 0 ELSE 1 END) ASC,
                    -- 2. Sort by time (Oldest first)
                    COALESCE(m3.sent_at, m3.updated_at) ASC NULLS LAST
                LIMIT 1
            ) earliest_msg ON true
            WHERE t.id = ANY($2)
              AND t.link_id = ANY($1)
            "#,
            link_ids,
            thread_ids
        )
        .fetch_all(pool)
        .await
        .map_err(|e| anyhow!("Failed to fetch thread summary info: {}", e))?;

    let mut result = HashMap::new();

    for row in rows {
        // If the latest message of the thread is in the trash, do not insert ThreadHistoryInfo.
        // We don't want to include threads that are most likely in trash in the search results.
        if row.trash_label.unwrap_or_default() {
            continue;
        }
        let summary_info = ThreadHistoryInfo {
            item_id: row.thread_id,
            user_id: row.macro_id,
            link_id: row.link_id,
            subject: row.subject,
            snippet: row.snippet,
            created_at: row.first_message_ts,
            updated_at: row.last_message_ts,
            // if the last time the user viewed the thread was before the most recent message came in,
            // the user hasn't viewed the most recent message.
            viewed_at: row
                .viewed_at
                .filter(|&viewed| viewed >= row.last_message_ts),
            sender: row.sender,
            pretty_sender: row.pretty_sender,
            is_read: row.is_read,
            inbox_visible: row.inbox_visible,
            is_draft: row.is_draft,
            is_important: row.is_important,
        };
        result.insert(row.thread_id, summary_info);
    }

    Ok(result)
}
