use super::super::db_types::*;
use crate::domain::models::PreviewCursorQuery;
use sqlx::PgPool;

/// Fetches a paginated list of thread previews for the "Drafts" view.
/// This view includes all threads that contain at least one draft message, sorted by the
/// timestamp of the most recent draft within each thread.
#[tracing::instrument(skip(pool), err)]
pub(crate) async fn drafts_preview_cursor(
    pool: &PgPool,
    query: &PreviewCursorQuery,
) -> Result<Vec<ThreadPreviewCursorDbRow>, sqlx::Error> {
    let query_limit = query.limit as i64;
    let sort_method_str = query.query.sort_method().to_string();
    let (cursor_id, cursor_timestamp) = query.query.vals();

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
                      AND l.name = 'IMPORTANT'
                      AND l.link_id = t.link_id
                )
            ) AS "is_important!",
            c.email_address AS "sender_email?",
            c.name AS "sender_name?",
            c.sfs_photo_url as "sender_photo_url?"
        FROM (
            -- Step 1: Find the latest draft timestamp for each thread, calculate the
            -- effective sort key, then sort and limit the results. This is the core optimization.
            SELECT
                t.id,
                t.provider_id,
                t.link_id,
                t.inbox_visible,
                t.is_read,
                ldpt.latest_draft_ts AS created_at,
                ldpt.latest_draft_ts AS updated_at,
                uh.updated_at AS viewed_at,
                CASE $5 -- sort_method_str
                    WHEN 'viewed_at' THEN COALESCE(uh."updated_at", '1970-01-01 00:00:00+00')
                    WHEN 'viewed_updated' THEN COALESCE(uh.updated_at, ldpt.latest_draft_ts)
                    ELSE ldpt.latest_draft_ts
                END AS effective_ts
            FROM (
                -- This sub-subquery efficiently finds the latest draft timestamp for every thread.
                SELECT thread_id, MAX(updated_at) as latest_draft_ts
                FROM email_messages
                -- we only display macro drafts, not drafts created in gmail
                WHERE link_id = $1 AND is_draft = TRUE AND internal_date_ts IS NULL
                GROUP BY thread_id
            ) ldpt
            JOIN email_threads t ON ldpt.thread_id = t.id
            LEFT JOIN email_user_history uh ON uh.thread_id = t.id AND uh.link_id = t.link_id
            WHERE
                (($3::timestamptz IS NULL) OR (
                    CASE $5 -- sort_method_str
                        WHEN 'viewed_at' THEN COALESCE(uh."updated_at", '1970-01-01 00:00:00+00')
                        WHEN 'viewed_updated' THEN COALESCE(uh.updated_at, ldpt.latest_draft_ts)
                        ELSE ldpt.latest_draft_ts
                    END, t.id
                ) < ($3::timestamptz, $4::uuid))
            ORDER BY effective_ts DESC, t.updated_at DESC
            LIMIT $2
        ) AS t
        -- Step 2: For EACH of the limited threads from above, find the full details of its latest draft.
        CROSS JOIN LATERAL (
            SELECT
                   m.subject,
                   m.snippet,
                   m.from_contact_id,
                   m.is_draft
            FROM email_messages m
            WHERE m.thread_id = t.id
              AND m.is_draft = TRUE
              -- we only display macro drafts, not drafts created in gmail
              AND m.internal_date_ts IS NULL
            ORDER BY m.updated_at DESC
            LIMIT 1
        ) AS lmp
        -- Step 3: Join to get the sender's details.
        LEFT JOIN email_contacts c ON lmp.from_contact_id = c.id
        ORDER BY t.effective_ts DESC, t.updated_at DESC
        "#,
        query.link_id,            // $1
        query_limit,              // $2
        cursor_timestamp,   // $3
        cursor_id,          // $4
        sort_method_str,          // $5
    )
        .fetch_all(pool)
        .await
}
