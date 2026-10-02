use super::super::db_types::*;
use models_pagination::{Query, SimpleSortMethod};
use sqlx::PgPool;
use uuid::Uuid;

/// Fetches a paginated list of thread previews for the "Spam" view.
/// This view includes threads that have at least one message with the SPAM label,
/// sorted by the timestamp of the most recent spam message.
#[tracing::instrument(skip(pool), err)]
pub(crate) async fn spam_preview_cursor(
    pool: &PgPool,
    link_ids: &[Uuid],
    limit: u32,
    query: &Query<Uuid, SimpleSortMethod, ()>,
) -> Result<Vec<ThreadPreviewCursorDbRow>, sqlx::Error> {
    let query_limit = limit as i64;
    let sort_method_str = query.sort_method().to_string();
    let (cursor_id, cursor_timestamp) = query.vals();

    sqlx::query_as!(
        ThreadPreviewCursorDbRow,
        r#"
        SELECT
            t.id,
            t.provider_id,
            t.inbox_visible,
            t.is_read,
            t.is_signal,
            t.effective_ts AS "sort_ts!",
            t.created_at AS "created_at!",
            t.updated_at AS "updated_at!",
            t.project_id,
            t.viewed_at AS "viewed_at?",
            lmp.subject AS "name?",
            lmp.snippet AS "snippet?",
            lmp.is_draft,
            (
                SELECT EXISTS (
                    SELECT 1
                    FROM email_messages m_imp
                    JOIN email_message_labels ml ON m_imp.id = ml.message_id
                    JOIN email_labels l ON ml.label_id = l.id
                    WHERE m_imp.thread_id = t.id
                      AND l.name = 'IMPORTANT'
                      AND l.link_id = t.link_id
                )
            ) AS "is_important!",
            c.email_address AS "sender_email?",
            COALESCE(lmp.from_name, c.name) AS "sender_name?",
            c.sfs_photo_url as "sender_photo_url?",
            el.macro_id AS "owner_id!",
            el.id AS "link_id!"
        FROM (
            -- Step 1: Find threads with spam messages and the latest spam message timestamp,
            -- then sort and limit the results.
            SELECT
                t.id,
                t.provider_id,
                t.link_id,
                t.inbox_visible,
                t.is_read,
                t.is_signal,
                t.project_id,
                lspt.latest_spam_ts AS created_at,
                lspt.latest_spam_ts AS updated_at,
                uh.updated_at AS viewed_at,
                CASE $5 -- sort_method_str
                    WHEN 'viewed_at' THEN COALESCE(uh."updated_at", '1970-01-01 00:00:00+00')
                    WHEN 'viewed_updated' THEN COALESCE(uh.updated_at, lspt.latest_spam_ts)
                    ELSE lspt.latest_spam_ts
                END AS effective_ts
            FROM (
                -- This sub-subquery finds the latest spam timestamp for every thread.
                SELECT m.thread_id, MAX(m.internal_date_ts) as latest_spam_ts
                FROM email_messages m
                JOIN email_message_labels ml ON m.id = ml.message_id
                JOIN email_labels l ON ml.label_id = l.id
                WHERE m.link_id = ANY($1)
                  AND l.name = 'SPAM'
                  AND l.link_id = m.link_id
                GROUP BY m.thread_id
            ) lspt
            JOIN email_threads t ON lspt.thread_id = t.id
            LEFT JOIN email_user_history uh ON uh.thread_id = t.id AND uh.link_id = t.link_id
            WHERE
                (($3::timestamptz IS NULL) OR (
                    CASE $5 -- sort_method_str
                        WHEN 'viewed_at' THEN COALESCE(uh."updated_at", '1970-01-01 00:00:00+00')
                        WHEN 'viewed_updated' THEN COALESCE(uh.updated_at, lspt.latest_spam_ts)
                        ELSE lspt.latest_spam_ts
                    END, t.id
                ) < ($3::timestamptz, $4::uuid))
            ORDER BY effective_ts DESC, t.updated_at DESC
            LIMIT $2
        ) AS t
        -- Step 2: For EACH of the limited threads, find the full details of its latest spam message.
        CROSS JOIN LATERAL (
            SELECT
                   m.subject,
                   m.snippet,
                   m.from_contact_id,
                   m.from_name,
                   m.is_draft
            FROM email_messages m
            JOIN email_message_labels ml ON m.id = ml.message_id
            JOIN email_labels l ON ml.label_id = l.id
            WHERE m.thread_id = t.id
              AND l.name = 'SPAM'
              AND l.link_id = t.link_id
            ORDER BY m.internal_date_ts DESC
            LIMIT 1
        ) AS lmp
        -- Step 3: Join to get the sender's details.
        LEFT JOIN email_contacts c ON lmp.from_contact_id = c.id
        JOIN email_links el ON t.link_id = el.id
        ORDER BY t.effective_ts DESC, t.updated_at DESC
        "#,
        link_ids,           // $1
        query_limit,              // $2
        cursor_timestamp,   // $3
        cursor_id,          // $4
        sort_method_str,          // $5
    )
        .fetch_all(pool)
        .await
}
