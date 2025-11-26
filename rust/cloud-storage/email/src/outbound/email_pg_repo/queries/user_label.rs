use super::super::db_types::*;
use crate::domain::models::PreviewCursorQuery;
use models_pagination::{Query, SimpleSortMethod};
use sqlx::PgPool;
use uuid::Uuid;

/// Fetches a paginated list of thread previews for a user label.
/// This view includes threads that have at least one message with the given label.
/// Threads are sorted by the timestamp of the most recent message that has the label.
/// The preview content is taken from that same most-recent labeled message.
#[tracing::instrument(skip(pool), err)]
pub(crate) async fn user_label_preview_cursor(
    pool: &PgPool,
    link_id: &Uuid,
    limit: u32,
    query: &Query<Uuid, SimpleSortMethod, ()>,
    label_name: &str,
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
            t.effective_ts AS "sort_ts!",
            t.created_at AS "created_at!",
            t.updated_at AS "updated_at!",
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
                      AND l.link_id = t.link_id
                      AND l.name = 'IMPORTANT'
                )
            ) AS "is_important!",
            c.email_address AS "sender_email?",
            c.name AS "sender_name?",
            c.sfs_photo_url as "sender_photo_url?"
        FROM (
            -- Step 1: Find the latest labeled message timestamp for each thread,
            -- calculate the effective sort key, then sort and limit the results.
            SELECT
                t.id,
                t.provider_id,
                t.link_id,
                t.inbox_visible,
                t.is_read,
                llpt.latest_labeled_ts AS created_at,
                llpt.latest_labeled_ts AS updated_at,
                uh.updated_at AS viewed_at,
                CASE $6 -- sort_method_str
                    WHEN 'viewed_at' THEN COALESCE(uh."updated_at", '1970-01-01 00:00:00+00')
                    WHEN 'viewed_updated' THEN COALESCE(uh.updated_at, llpt.latest_labeled_ts)
                    ELSE llpt.latest_labeled_ts
                END AS effective_ts
            FROM (
                -- This sub-subquery efficiently finds the latest timestamp for every thread
                -- that has at least one message with the specified label.
                SELECT
                    m.thread_id,
                    MAX(m.internal_date_ts) as latest_labeled_ts
                FROM email_messages m
                JOIN email_message_labels ml ON m.id = ml.message_id
                JOIN email_labels l ON ml.label_id = l.id
                WHERE m.link_id = $1 AND l.name = $5
                GROUP BY m.thread_id
            ) llpt
            JOIN email_threads t ON llpt.thread_id = t.id
            LEFT JOIN email_user_history uh ON uh.thread_id = t.id AND uh.link_id = $1
            WHERE
                (($3::timestamptz IS NULL) OR (
                    CASE $6 -- sort_method_str
                        WHEN 'viewed_at' THEN COALESCE(uh."updated_at", '1970-01-01 00:00:00+00')
                        WHEN 'viewed_updated' THEN COALESCE(uh.updated_at, llpt.latest_labeled_ts)
                        ELSE llpt.latest_labeled_ts
                    END, t.id
                ) < ($3::timestamptz, $4::uuid))
            ORDER BY effective_ts DESC, t.updated_at DESC
            LIMIT $2
        ) AS t
        -- Step 2: For EACH of the limited threads from above, find the full details of its latest message with that specific label.
        CROSS JOIN LATERAL (
            SELECT
                   m.subject,
                   m.snippet,
                   m.from_contact_id,
                   m.is_draft
            FROM email_messages m
            JOIN email_message_labels ml ON m.id = ml.message_id
            JOIN email_labels l ON ml.label_id = l.id
            WHERE m.thread_id = t.id AND m.is_draft = FALSE AND l.link_id = t.link_id AND l.name = $5
            ORDER BY m.internal_date_ts DESC
            LIMIT 1
        ) AS lmp
        -- Step 3: Join to get the sender's details.
        LEFT JOIN email_contacts c ON lmp.from_contact_id = c.id
        ORDER BY t.effective_ts DESC, t.updated_at DESC
        "#,
        link_id,            // $1
        query_limit,              // $2
        cursor_timestamp,   // $3
        cursor_id,          // $4
        label_name,               // $5
        sort_method_str,          // $6
    )
        .fetch_all(pool)
        .await
}
