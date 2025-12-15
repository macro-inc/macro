#[cfg(test)]
mod test;

use anyhow::anyhow;
use models_email::service::message::ThreadHistoryInfo;
use sqlx::PgPool;
use sqlx::types::Uuid;
use std::collections::HashMap;

// upsert user_history row for user and thread
#[tracing::instrument(skip(pool), level = "info")]
pub async fn upsert_user_history(
    pool: &PgPool,
    link_id: Uuid,
    thread_id: Uuid,
) -> anyhow::Result<()> {
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
    .execute(pool)
    .await
    .map_err(|_| anyhow!("Failed to upsert user history"))?;

    Ok(())
}

/// Get summary information for multiple email threads.
///
/// Returns a HashMap of thread history info including:
/// - `created_at`: timestamp of the first message in the thread (prefers sent_at from non-drafts, falls back to updated_at)
/// - `updated_at`: timestamp of the last message in the thread (prefers sent_at from non-drafts, falls back to updated_at)
/// - `viewed_at`: last time the user opened/viewed the thread (only included if >= updated_at)
/// - `snippet`, `subject`, `sender`, `pretty_sender`: from the latest message in the thread
///
/// The "latest message" is determined by:
/// 1. Message with the most recent sent_at (if available) or updated_at
#[tracing::instrument(skip(pool), err)]
pub async fn get_thread_summary_info(
    pool: &PgPool,
    link_id: Uuid,
    thread_ids: &[Uuid],
) -> anyhow::Result<HashMap<Uuid, ThreadHistoryInfo>> {
    if thread_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let rows = sqlx::query!(
        r#"
        SELECT
            t.id as thread_id,
            COALESCE(
                MIN(m.sent_at) FILTER (WHERE m.is_draft = false),
                MIN(m.updated_at)
            ) as "first_message_ts!",
            COALESCE(
                MAX(m.sent_at) FILTER (WHERE m.is_draft = false),
                MAX(m.updated_at)
            ) as "last_message_ts!",
            -- Last time user viewed this thread
            uh.updated_at as "viewed_at?",
            latest_msg.snippet,
            latest_msg.subject as "subject?",
            l.macro_id,
            latest_msg.sender as sender,
            latest_msg.pretty_sender as "pretty_sender!"
        FROM email_threads t
        INNER JOIN email_messages m ON m.thread_id = t.id AND m.link_id = $1
        LEFT JOIN email_user_history uh ON uh.thread_id = t.id AND uh.link_id = $1
        LEFT JOIN email_links l ON l.id = t.link_id
        -- LATERAL join to get snippet/subject/sender from the single latest message.
        -- This subquery runs once per thread and returns exactly one message's data.
        LEFT JOIN LATERAL (
            SELECT
                m2.snippet,
                m2.subject,
                c.email_address as sender,
                COALESCE(c.name, c.email_address) as pretty_sender
            FROM email_messages m2
            LEFT JOIN email_contacts c ON c.id = m2.from_contact_id
            WHERE m2.thread_id = t.id
              AND m2.link_id = $1
            ORDER BY
                -- Primary sort: most recent timestamp (use sent_at if available, otherwise updated_at)
                COALESCE(m2.sent_at, m2.updated_at) DESC NULLS LAST,
                -- Secondary sort: prefer non-drafts over drafts when timestamps are equal
                -- (0 for non-drafts comes before 1 for drafts in ASC order)
                (CASE WHEN m2.is_draft THEN 1 ELSE 0 END) ASC
            LIMIT 1
        ) latest_msg ON true
        WHERE t.id = ANY($2)
          AND t.link_id = $1
        GROUP BY
            t.id,
            uh.updated_at,
            latest_msg.snippet,
            latest_msg.subject,
            l.macro_id,
            latest_msg.sender,
            latest_msg.pretty_sender
        "#,
        link_id,
        thread_ids
    )
    .fetch_all(pool)
    .await
    .map_err(|e| anyhow!("Failed to fetch thread summary info: {}", e))?;

    let mut result = HashMap::new();

    for row in rows {
        let summary_info = ThreadHistoryInfo {
            item_id: row.thread_id,
            user_id: row.macro_id,
            subject: row.subject,
            snippet: row.snippet,
            created_at: row.first_message_ts,
            updated_at: row.last_message_ts,
            // if the last time the user viewed the thread was before the most recent message came in,
            // the user hasn't viewed the most recent message.
            viewed_at: row.viewed_at.and_then(|viewed| {
                if viewed >= row.last_message_ts {
                    Some(viewed)
                } else {
                    None
                }
            }),
            sender: row.sender,
            pretty_sender: row.pretty_sender,
        };
        result.insert(row.thread_id, summary_info);
    }

    Ok(result)
}
