use super::super::db_types::*;
use models_pagination::{Query, SimpleSortMethod};
use sqlx::PgPool;
use uuid::Uuid;

/// Fetches a paginated list of thread previews for the "All Mail" view using a
/// denormalized timestamp.
/// This view includes all threads that have at least one non-spam message, sorted by the
/// `latest_non_spam_message_ts` column on the `threads` table. The preview shows
/// details from the latest non-spam message
#[tracing::instrument(skip(pool), err)]
pub(crate) async fn all_mail_preview_cursor(
    pool: &PgPool,
    link_id: &Uuid,
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
            -- Step 1: Efficiently find, sort, and limit the top N+1 threads.
            -- This subquery only touches `threads` and `user_history`, making it very fast.
            SELECT
                t.id,
                t.provider_id,
                t.link_id,
                t.inbox_visible,
                t.is_read,
                t.latest_non_spam_message_ts AS created_at,
                t.latest_non_spam_message_ts AS updated_at,
                uh.updated_at AS viewed_at,
                CASE $5 -- sort_method_str
                    WHEN 'viewed_at' THEN COALESCE(uh."updated_at", '1970-01-01 00:00:00+00')
                    WHEN 'viewed_updated' THEN COALESCE(uh.updated_at, t.latest_non_spam_message_ts)
                    ELSE t.latest_non_spam_message_ts
                END AS effective_ts
            FROM email_threads t
            LEFT JOIN email_user_history uh ON uh.thread_id = t.id AND uh.link_id = t.link_id
            WHERE
                t.link_id = $1
              AND t.latest_non_spam_message_ts IS NOT NULL
              
              -- Cursor logic is moved inside for maximum efficiency
              AND (($3::timestamptz IS NULL) OR (
                  -- This CASE must exactly match the one that defines `effective_ts`
                  CASE $5 -- sort_method_str
                      WHEN 'viewed_at' THEN COALESCE(uh."updated_at", '1970-01-01 00:00:00+00')
                      WHEN 'viewed_updated' THEN COALESCE(uh.updated_at, t.latest_non_spam_message_ts)
                      ELSE t.latest_non_spam_message_ts
                  END, t.id
              ) < ($3::timestamptz, $4::uuid))
            ORDER BY effective_ts DESC, t.updated_at DESC
            LIMIT $2
        ) AS t
        -- Step 2: For EACH of the limited threads from above, find its latest non-SPAM/TRASH message.
        CROSS JOIN LATERAL (
            SELECT
                m.subject,
                m.snippet,
                m.is_draft,
                m.from_contact_id
            FROM email_messages m
            WHERE m.thread_id = t.id
              AND m.is_draft = FALSE
            AND NOT EXISTS (
                SELECT 1
                FROM email_message_labels ml
                JOIN email_labels l ON ml.label_id = l.id
                WHERE ml.message_id = m.id
                  AND l.link_id = t.link_id
                  AND l.name IN ('SPAM', 'TRASH')
            )
            ORDER BY m.internal_date_ts DESC
            LIMIT 1
        ) AS lmp
        -- Step 3: Join to get the sender's details for the final result set.
        LEFT JOIN email_contacts c ON lmp.from_contact_id = c.id
        ORDER BY t.effective_ts DESC, t.updated_at DESC
        "#,
        link_id,            // $1
        query_limit,              // $2
        cursor_timestamp,   // $3
        cursor_id,          // $4
        sort_method_str,          // $5
    )
        .fetch_all(pool)
        .await
}
