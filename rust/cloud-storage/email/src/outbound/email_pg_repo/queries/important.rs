use super::super::db_types::*;
use crate::domain::models::PreviewCursorQuery;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;

/// Fetches a paginated list of thread previews for the "Important" view.
/// Includes threads that:
/// 1. Have messages with both 'IMPORTANT' and 'INBOX' labels, or
/// 2. Contain draft messages
/// The threads are sorted by timestamp, with preview details taken from the latest qualifying message.
#[tracing::instrument(skip(pool), err)]
pub(crate) async fn important_preview_cursor(
    pool: &PgPool,
    query: &PreviewCursorQuery,
    user_id: MacroUserIdStr<'_>,
) -> Result<Vec<ThreadPreviewCursorDbRow>, sqlx::Error> {
    let query_limit = query.limit as i64;
    let sort_method_str = query.query.sort_method().to_string();
    let (cursor_id, cursor_timestamp) = query.query.vals();

    sqlx::query_as!(
        ThreadPreviewCursorDbRow,
        r#"
        WITH ApplicableLabelIDs AS (
            SELECT id
            FROM email_labels
            WHERE link_id = $1
              AND (name = 'INBOX')
        ),
        QualifyingMessages AS (
            SELECT m.thread_id,
                   m.internal_date_ts,
                   m.is_draft,
                   m.subject,
                   m.snippet,
                   m.from_contact_id
            FROM email_messages m
            WHERE m.link_id = $1
              AND EXISTS (
                  SELECT 1
                  FROM email_message_labels ml
                  JOIN email_labels l ON ml.label_id = l.id
                  WHERE ml.message_id = m.id
                    AND l.name = 'IMPORTANT'
              )
              AND EXISTS (
                  SELECT 1
                  FROM email_message_labels ml
                  JOIN ApplicableLabelIDs ali ON ml.label_id = ali.id
                  WHERE ml.message_id = m.id
              )

            UNION ALL

            SELECT m.thread_id,
                   m.internal_date_ts,
                   m.is_draft,
                   m.subject,
                   m.snippet,
                   m.from_contact_id
            FROM email_messages m
            WHERE m.link_id = $1
              AND m.is_draft = TRUE
        ),
        AllImportantThreads AS (
            -- From all qualifying messages, get the single most recent one per thread.
            SELECT DISTINCT ON (thread_id)
                   thread_id,
                   internal_date_ts,
                   is_draft,
                   subject,
                   snippet,
                   from_contact_id
            FROM QualifyingMessages
            ORDER BY thread_id, internal_date_ts DESC
        ),
        ImportantWithSortKey AS (
            -- Join with user_history to calculate the final effective sort key.
            SELECT
                ait.thread_id,
                ait.internal_date_ts,
                ait.is_draft,
                ait.subject,
                ait.snippet,
                ait.from_contact_id,
                ait.internal_date_ts as created_at,
                ait.internal_date_ts as updated_at,
                uh.updated_at as viewed_at,
                -- This CASE statement dynamically selects the correct timestamp for sorting.
                -- For 'updated_at' and 'created_at', we use the important message timestamp
                -- For 'viewed_at', we use the history timestamp.
                -- For 'viewed_updated', we use the history timestamp if it exists, otherwise the important message timestamp.
                CASE $5 -- sort_method_str
                    WHEN 'viewed_at' THEN COALESCE(uh."updated_at", '1970-01-01 00:00:00+00')
                    WHEN 'viewed_updated' THEN COALESCE(uh.updated_at, ait.internal_date_ts)
                    ELSE ait.internal_date_ts
                END AS effective_ts
            FROM AllImportantThreads ait
            -- This has to be a left join to support all sort methods.
            LEFT JOIN email_user_history uh ON uh.thread_id = ait.thread_id AND uh.link_id = $1
            -- user_history updated_at (aka last time opened) has to exist when viewed_at sort method is selected.
            WHERE ait.is_draft = FALSE 
        )
        SELECT
               isk.thread_id as "id!",
               t.provider_id,
               t.inbox_visible,
               t.is_read,
               isk.effective_ts as "sort_ts!",
               isk.created_at as "created_at!",
               isk.updated_at as "updated_at!",
               isk.viewed_at as "viewed_at?",
               isk.is_draft as "is_draft!",
               -- It's the important view - all threads here are important
               true as "is_important!",
               isk.subject as "name?",
               isk.snippet as "snippet?",
               c.email_address AS "sender_email?",
               c.name AS "sender_name?",
               c.sfs_photo_url as "sender_photo_url?"
        FROM ImportantWithSortKey isk
        JOIN email_threads t ON isk.thread_id = t.id
        LEFT JOIN email_contacts c ON isk.from_contact_id = c.id
        WHERE
            ($3::timestamptz IS NULL) OR (isk.effective_ts, isk.thread_id) < ($3::timestamptz, $4::uuid)
        ORDER BY isk.effective_ts DESC, isk.thread_id DESC
        LIMIT $2
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
