use anyhow::Context;
use models_email::email::db;
use models_email::email::service::thread;
use models_email::email::service::thread::{
    PreviewCursorQuery, PreviewView, PreviewViewStandardLabel, ThreadPreviewCursor,
};
use sqlx::PgPool;

#[tracing::instrument(skip(pool), err)]
pub async fn fetch_previews_for_view_cursor(
    pool: &PgPool,
    query: PreviewCursorQuery,
    user_id: &str,
) -> anyhow::Result<Vec<ThreadPreviewCursor>> {
    match query.view {
        PreviewView::StandardLabel(ref label) => match label {
            PreviewViewStandardLabel::Inbox => {
                new_inbox_preview_cursor(pool, &query, user_id).await
            }
            PreviewViewStandardLabel::Sent => sent_preview_cursor(pool, &query, user_id).await,
            PreviewViewStandardLabel::Drafts => drafts_preview_cursor(pool, &query, user_id).await,
            PreviewViewStandardLabel::Starred => {
                starred_preview_cursor(pool, &query, user_id).await
            }
            PreviewViewStandardLabel::All => all_mail_preview_cursor(pool, &query, user_id).await,
            PreviewViewStandardLabel::Important => {
                important_preview_cursor(pool, &query, user_id).await
            }
            PreviewViewStandardLabel::Other => {
                other_inbox_preview_cursor(pool, &query, user_id).await
            }
        },
        PreviewView::UserLabel(ref label_name) => {
            user_label_preview_cursor(pool, &query, label_name, user_id).await
        }
    }
}

/// Fetches a paginated list of thread previews for a given link_id.
/// Each thread preview includes details from the latest message (inbound or outbound)
/// that is NOT in the 'TRASH' label.
/// The sorting and filtering behavior is determined by the `sort_method` parameter.
#[tracing::instrument(skip(pool), level = "info")]
pub async fn new_inbox_preview_cursor(
    pool: &PgPool,
    query: &PreviewCursorQuery,
    user_id: &str,
) -> anyhow::Result<Vec<thread::ThreadPreviewCursor>> {
    let query_limit = query.limit as i64;
    let sort_method_str = query.query.sort_method().to_string();
    let (cursor_id, cursor_timestamp) = query.query.vals();

    let db_previews = sqlx::query_as!(
        db::thread::ThreadPreviewCursor,
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
    ).fetch_all(pool).await.with_context(|| format!("Failed to fetch paginated thread previews for link_id {}", query.link_id))?;

    let items = db_previews
        .into_iter()
        .map(|db_preview| ThreadPreviewCursor::new_from(db_preview, user_id.to_string()))
        .collect();

    Ok(items)
}

/// Fetches a paginated list of thread previews for the "Sent" view.
/// This view includes all threads (archived or not) sorted by the timestamp
/// of the latest sent message. The preview details (subject, snippet) are
/// taken from the most recent sent message in the thread that is not in the trash.
#[tracing::instrument(skip(pool), level = "info")]
pub async fn sent_preview_cursor(
    pool: &PgPool,
    query: &PreviewCursorQuery,
    user_id: &str,
) -> anyhow::Result<Vec<ThreadPreviewCursor>> {
    let query_limit = query.limit as i64;
    let sort_method_str = query.query.sort_method().to_string();
    let (cursor_id, cursor_timestamp) = query.query.vals();

    let db_previews = sqlx::query_as!(
        db::thread::ThreadPreviewCursor,
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
            -- Step 1: Efficiently find and sort ONLY the top N+1 candidate threads.
            -- This subquery only touches `threads` and `user_history`.
            SELECT
                t.id,
                t.provider_id,
                t.link_id,
                t.inbox_visible,
                t.is_read,
                t.latest_outbound_message_ts AS created_at,
                t.latest_outbound_message_ts AS updated_at,
                uh.updated_at AS viewed_at,
                CASE $5 -- sort_method_str
                    WHEN 'viewed_at' THEN COALESCE(uh."updated_at", '1970-01-01 00:00:00+00')
                    WHEN 'viewed_updated' THEN COALESCE(uh.updated_at, t.latest_outbound_message_ts)
                    ELSE t.latest_outbound_message_ts
                END AS effective_ts
            FROM email_threads t
            LEFT JOIN email_user_history uh ON uh.thread_id = t.id AND uh.link_id = t.link_id
            WHERE
                t.link_id = $1
              AND t.latest_outbound_message_ts IS NOT NULL
              
              -- Cursor logic moved inside for maximum efficiency
              AND (($3::timestamptz IS NULL) OR (
                  -- This CASE must exactly match the one that defines `effective_ts`
                  CASE $5 -- sort_method_str
                      WHEN 'viewed_at' THEN COALESCE(uh."updated_at", '1970-01-01 00:00:00+00')
                      WHEN 'viewed_updated' THEN COALESCE(uh.updated_at, t.latest_outbound_message_ts)
                      ELSE t.latest_outbound_message_ts
                  END, t.id
              ) < ($3::timestamptz, $4::uuid))
            ORDER BY effective_ts DESC, t.updated_at DESC
            LIMIT $2
        ) AS t
        -- Step 2: For EACH of the limited threads from above, find its latest SENT, non-trashed message.
        CROSS JOIN LATERAL (
            SELECT
                   m.subject,
                   m.snippet,
                   m.from_contact_id,
                   m.is_draft
            FROM email_messages m
            WHERE m.thread_id = t.id
              AND m.is_sent = TRUE -- This condition is specific to the "Sent" view
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
        .with_context(|| {
            format!(
                "Failed to fetch paginated sent preview for link_id {}",
                query.link_id
            )
        })?;

    let items = db_previews
        .into_iter()
        .map(|db_preview| ThreadPreviewCursor::new_from(db_preview, user_id.to_string()))
        .collect();

    Ok(items)
}

/// Fetches a paginated list of thread previews for the "Drafts" view.
/// This view includes all threads that contain at least one draft message, sorted by the
/// timestamp of the most recent draft within each thread.
#[tracing::instrument(skip(pool), level = "info", err)]
pub async fn drafts_preview_cursor(
    pool: &PgPool,
    query: &PreviewCursorQuery,
    user_id: &str,
) -> anyhow::Result<Vec<thread::ThreadPreviewCursor>> {
    let query_limit = query.limit as i64;
    let sort_method_str = query.query.sort_method().to_string();
    let (cursor_id, cursor_timestamp) = query.query.vals();

    let db_previews = sqlx::query_as!(
        db::thread::ThreadPreviewCursor,
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
        .await?;

    let items = db_previews
        .into_iter()
        .map(|db_preview| ThreadPreviewCursor::new_from(db_preview, user_id.to_string()))
        .collect();

    Ok(items)
}

/// Fetches a paginated list of thread previews for the "Starred" view.
/// This view includes all threads that contain at least one starred message, sorted by the
/// timestamp of the most recent starred message within each thread. The preview content is
/// taken from the most-recent starred message.
#[tracing::instrument(skip(pool), level = "info")]
pub async fn starred_preview_cursor(
    pool: &PgPool,
    query: &PreviewCursorQuery,
    user_id: &str,
) -> anyhow::Result<Vec<thread::ThreadPreviewCursor>> {
    let query_limit = query.limit as i64;
    let sort_method_str = query.query.sort_method().to_string();
    let (cursor_id, cursor_timestamp) = query.query.vals();

    let db_previews = sqlx::query_as!(
        db::thread::ThreadPreviewCursor,
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
            -- Step 1: Find the latest starred timestamp for each thread, calculate the
            -- effective sort key, then sort and limit the results.
            SELECT
                t.id,
                t.provider_id,
                t.link_id,
                t.inbox_visible,
                t.is_read,
                lspt.latest_starred_ts AS created_at,
                lspt.latest_starred_ts AS updated_at,
                uh.updated_at AS viewed_at,
                CASE $5 -- sort_method_str
                    WHEN 'viewed_at' THEN COALESCE(uh."updated_at", '1970-01-01 00:00:00+00')
                    WHEN 'viewed_updated' THEN COALESCE(uh.updated_at, lspt.latest_starred_ts)
                    ELSE lspt.latest_starred_ts
                END AS effective_ts
            FROM (
                -- This sub-subquery efficiently finds the latest starred timestamp for every thread.
                SELECT thread_id, MAX(internal_date_ts) as latest_starred_ts
                FROM email_messages
                WHERE link_id = $1 AND is_starred = TRUE
                GROUP BY thread_id
            ) lspt
            JOIN email_threads t ON lspt.thread_id = t.id
            LEFT JOIN email_user_history uh ON uh.thread_id = t.id AND uh.link_id = t.link_id
            WHERE
                (($3::timestamptz IS NULL) OR (
                    CASE $5 -- sort_method_str
                        WHEN 'viewed_at' THEN COALESCE(uh."updated_at", '1970-01-01 00:00:00+00')
                        WHEN 'viewed_updated' THEN COALESCE(uh.updated_at, lspt.latest_starred_ts)
                        ELSE lspt.latest_starred_ts
                    END, t.id
                ) < ($3::timestamptz, $4::uuid))
            ORDER BY effective_ts DESC, t.updated_at DESC
            LIMIT $2
        ) AS t
        -- Step 2: For EACH of the limited threads from above, find the full details of its latest starred message.
        CROSS JOIN LATERAL (
            SELECT
                   m.subject,
                   m.snippet,
                   m.from_contact_id,
                   m.is_draft
            FROM email_messages m
            WHERE m.thread_id = t.id
              AND m.is_starred = TRUE
              AND m.is_draft = FALSE
            ORDER BY m.internal_date_ts DESC
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
        .with_context(|| {
            format!(
                "Failed to fetch paginated starred preview for link_id {}",
                query.link_id
            )
        })?;

    let items = db_previews
        .into_iter()
        .map(|db_preview| ThreadPreviewCursor::new_from(db_preview, user_id.to_string()))
        .collect();

    Ok(items)
}

/// Fetches a paginated list of thread previews for the "All Mail" view using a
/// denormalized timestamp.
/// This view includes all threads that have at least one non-spam message, sorted by the
/// `latest_non_spam_message_ts` column on the `threads` table. The preview shows
/// details from the latest non-spam message
#[tracing::instrument(skip(pool), level = "info")]
pub async fn all_mail_preview_cursor(
    pool: &PgPool,
    query: &PreviewCursorQuery,
    user_id: &str,
) -> anyhow::Result<Vec<thread::ThreadPreviewCursor>> {
    let query_limit = query.limit as i64;
    let sort_method_str = query.query.sort_method().to_string();
    let (cursor_id, cursor_timestamp) = query.query.vals();

    let db_previews = sqlx::query_as!(
        db::thread::ThreadPreviewCursor,
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
        query.link_id,            // $1
        query_limit,              // $2
        cursor_timestamp,   // $3
        cursor_id,          // $4
        sort_method_str,          // $5
    )
        .fetch_all(pool)
        .await
        .with_context(|| {
            format!(
                "Failed to fetch paginated all mail preview for link_id {}",
                query.link_id
            )
        })?;

    let items = db_previews
        .into_iter()
        .map(|db_preview| ThreadPreviewCursor::new_from(db_preview, user_id.to_string()))
        .collect();

    Ok(items)
}

/// Fetches a paginated list of thread previews for the "Important" view.
/// Includes threads that:
/// 1. Have messages with both 'IMPORTANT' and 'INBOX' labels, or
/// 2. Contain draft messages
/// The threads are sorted by timestamp, with preview details taken from the latest qualifying message.
#[tracing::instrument(skip(pool), level = "info")]
pub async fn important_preview_cursor(
    pool: &PgPool,
    query: &PreviewCursorQuery,
    user_id: &str,
) -> anyhow::Result<Vec<thread::ThreadPreviewCursor>> {
    let query_limit = query.limit as i64;
    let sort_method_str = query.query.sort_method().to_string();
    let (cursor_id, cursor_timestamp) = query.query.vals();

    let db_previews = sqlx::query_as!(
        db::thread::ThreadPreviewCursor,
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
        .with_context(|| {
            format!(
                "Failed to fetch paginated important preview for link_id {}",
                query.link_id
            )
        })?;

    let items = db_previews
        .into_iter()
        .map(|db_preview| ThreadPreviewCursor::new_from(db_preview, user_id.to_string()))
        .collect();

    Ok(items)
}

/// Fetches a paginated list of thread previews for the "Other" inbox view.
/// This view includes threads that have a category label (Promotions, Social, etc.)
/// and are not explicitly spam, trash, or drafts.
#[tracing::instrument(skip(pool), level = "info")]
pub async fn other_inbox_preview_cursor(
    pool: &PgPool,
    query: &PreviewCursorQuery,
    user_id: &str,
) -> anyhow::Result<Vec<thread::ThreadPreviewCursor>> {
    let query_limit = query.limit as i64;
    let sort_method_str = query.query.sort_method().to_string();
    let (cursor_id, cursor_timestamp) = query.query.vals();

    let db_previews = sqlx::query_as!(
        db::thread::ThreadPreviewCursor,
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
        query.link_id,            // $1
        query_limit,              // $2
        cursor_timestamp,   // $3
        cursor_id,          // $4
        sort_method_str,          // $5
    )
        .fetch_all(pool)
        .await
        .with_context(|| {
            format!(
                "Failed to fetch paginated other inbox preview for link_id {}",
                query.link_id
            )
        })?;

    let items = db_previews
        .into_iter()
        .map(|db_preview| ThreadPreviewCursor::new_from(db_preview, user_id.to_string()))
        .collect();

    Ok(items)
}

/// Fetches a paginated list of thread previews for a user label.
/// This view includes threads that have at least one message with the given label.
/// Threads are sorted by the timestamp of the most recent message that has the label.
/// The preview content is taken from that same most-recent labeled message.
#[tracing::instrument(skip(pool), level = "info")]
pub async fn user_label_preview_cursor(
    pool: &PgPool,
    query: &PreviewCursorQuery,
    label_name: &str,
    user_id: &str,
) -> anyhow::Result<Vec<thread::ThreadPreviewCursor>> {
    let query_limit = query.limit as i64;
    let sort_method_str = query.query.sort_method().to_string();
    let (cursor_id, cursor_timestamp) = query.query.vals();

    let db_previews = sqlx::query_as!(
        db::thread::ThreadPreviewCursor,
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
        query.link_id,            // $1
        query_limit,              // $2
        cursor_timestamp,   // $3
        cursor_id,          // $4
        label_name,               // $5
        sort_method_str,          // $6
    )
        .fetch_all(pool)
        .await
        .with_context(|| {
            format!(
                "Failed to fetch paginated user label preview for link_id {} and label '{}'",
                query.link_id, label_name
            )
        })?;

    let items = db_previews
        .into_iter()
        .map(|db_preview| ThreadPreviewCursor::new_from(db_preview, user_id.to_string()))
        .collect();

    Ok(items)
}
