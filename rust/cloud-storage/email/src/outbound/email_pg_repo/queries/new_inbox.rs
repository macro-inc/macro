use super::super::db_types::*;
use crate::domain::models::PreviewCursorQuery;
use sqlx::PgPool;

/// Fetches a paginated list of thread previews for a given link_id.
/// Each thread preview includes details from the latest message (inbound or outbound)
/// that is NOT in the 'TRASH' label.
/// The sorting and filtering behavior is determined by the `sort_method` parameter.
#[tracing::instrument(skip(pool), err)]
pub(crate) async fn new_inbox_preview_cursor(
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
            TRUE AS "inbox_visible!",
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
            -- Step 1: Efficiently find and sort ONLY the top N+1 candidate threads.
            -- This subquery is fast as it only touches `threads` and `user_history`.
            SELECT
                t.id,
                t.provider_id,
                t.link_id,
                t.is_read,
                t.latest_inbound_message_ts AS created_at,
                t.latest_inbound_message_ts AS updated_at,
                uh.updated_at AS viewed_at,
                CASE $5 -- sort_method_str
                    WHEN 'viewed_at' THEN COALESCE(uh."updated_at", '1970-01-01 00:00:00+00')
                    WHEN 'viewed_updated' THEN COALESCE(uh.updated_at, t.latest_inbound_message_ts)
                    ELSE t.latest_inbound_message_ts
                END AS effective_ts
            FROM email_threads t
            LEFT JOIN email_user_history uh ON uh.thread_id = t.id AND uh.link_id = t.link_id
            WHERE
                t.link_id = $1
              AND t.inbox_visible = TRUE
              AND t.latest_inbound_message_ts IS NOT NULL
              
              -- The cursor logic is moved inside this subquery for maximum efficiency.
              AND (($3::timestamptz IS NULL) OR (
                  -- This CASE must exactly match the one that defines `effective_ts`
                  CASE $5 -- sort_method_str
                      WHEN 'viewed_at' THEN COALESCE(uh."updated_at", '1970-01-01 00:00:00+00')
                      WHEN 'viewed_updated' THEN COALESCE(uh.updated_at, t.latest_inbound_message_ts)
                      ELSE t.latest_inbound_message_ts
                  END, t.id
              ) < ($3::timestamptz, $4::uuid))
            ORDER BY effective_ts DESC, t.updated_at DESC -- fall back to updated_at if effective_ts is the same
            LIMIT $2
        ) AS t
        -- Step 2: For EACH of the limited threads from above, find its latest non-trashed message.
        CROSS JOIN LATERAL (
            SELECT
                   m.subject,
                   m.snippet,
                   m.from_contact_id,
                   m.is_draft
            FROM email_messages m
            WHERE m.thread_id = t.id
              AND m.is_draft = FALSE
              AND NOT EXISTS (
                SELECT 1 FROM email_message_labels ml JOIN email_labels l ON ml.label_id = l.id
                WHERE ml.message_id = m.id AND l.name = 'TRASH' AND l.link_id = t.link_id
            )
            ORDER BY m.internal_date_ts DESC
            LIMIT 1
        ) AS lmp
        -- Step 3: Join to get the sender's details for the final result set.
        LEFT JOIN email_contacts c ON lmp.from_contact_id = c.id
        -- Final ordering is preserved because the input `t` is already sorted.
        ORDER BY t.effective_ts DESC, t.updated_at DESC -- fall back to updated_at if effective_ts is the same
        "#,
        query.link_id,            // $1
        query_limit,              // $2
        cursor_timestamp,   // $3
        cursor_id,          // $4
        sort_method_str,          // $5
    ).fetch_all(pool).await
}
