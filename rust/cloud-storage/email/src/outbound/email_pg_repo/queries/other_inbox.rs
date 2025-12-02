use super::super::db_types::*;
use models_pagination::{Query, SimpleSortMethod};
use sqlx::PgPool;
use uuid::Uuid;

/// Fetches a paginated list of thread previews for the "Other" inbox view.
/// This view includes threads that have a category label (Promotions, Social, etc.)
/// and are not explicitly spam, trash, or drafts.
#[tracing::instrument(skip(pool), err)]
pub(crate) async fn other_inbox_preview_cursor(
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
            -- A thread in "Other" can still be "Important", so we must perform the check.
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
            -- Step 1: Efficiently find, sort, and limit the top N+1 threads that qualify for the "Other" inbox.
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
              -- Inclusion Criteria: Must have a category label.
              AND EXISTS (
                  SELECT 1 FROM email_messages m JOIN email_message_labels ml ON m.id = ml.message_id JOIN email_labels l ON ml.label_id = l.id
                  WHERE m.thread_id = t.id AND l.link_id = t.link_id AND l.name IN ('CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS')
              )
              -- ****** CORRECTED EXCLUSION CRITERIA ******
              -- This now matches the logic of your original query, which did NOT filter out 'INBOX' or 'IMPORTANT'.
              AND NOT EXISTS (
                  SELECT 1 FROM email_messages m JOIN email_message_labels ml ON m.id = ml.message_id JOIN email_labels l ON ml.label_id = l.id
                  WHERE m.thread_id = t.id AND l.link_id = t.link_id AND l.name IN ('SPAM', 'TRASH', 'DRAFT')
              )
              
              AND (($3::timestamptz IS NULL) OR (
                  CASE $5 -- sort_method_str
                      WHEN 'viewed_at' THEN COALESCE(uh."updated_at", '1970-01-01 00:00:00+00')
                      WHEN 'viewed_updated' THEN COALESCE(uh.updated_at, t.latest_non_spam_message_ts)
                      ELSE t.latest_non_spam_message_ts
                  END, t.id
              ) < ($3::timestamptz, $4::uuid))
            ORDER BY effective_ts DESC, t.updated_at DESC
            LIMIT $2
        ) AS t
        -- Step 2: For EACH of the limited threads from above, find its latest non-spam/trash message for the preview.
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
                SELECT 1 FROM email_message_labels ml JOIN email_labels l ON ml.label_id = l.id
                WHERE ml.message_id = m.id AND l.link_id = t.link_id AND l.name IN ('SPAM', 'TRASH')
            )
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
        sort_method_str,          // $5
    )
        .fetch_all(pool)
        .await
}
