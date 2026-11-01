use super::super::db_types::*;
use models_pagination::{Query, SimpleSortMethod};
use sqlx::PgPool;
use uuid::Uuid;

/// Fetches a paginated list of thread previews for a given link_id.
/// Each thread preview includes details from the latest message (inbound or outbound)
/// that is NOT in the 'TRASH' label.
/// The sorting and filtering behavior is determined by the `sort_method` parameter.
#[tracing::instrument(skip(pool), err)]
pub(crate) async fn new_inbox_preview_cursor(
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
            t.id AS "id!",
            t.provider_id,
            TRUE AS "inbox_visible!",
            t.is_read AS "is_read!",
            t.is_signal AS "is_signal!",
            t.effective_ts AS "sort_ts!",
            t.created_at AS "created_at!",
            t.updated_at AS "updated_at!",
            t.project_id,
            uh.updated_at AS "viewed_at?",
            lmp.subject AS "name?",
            lmp.snippet AS "snippet?",
            lmp.is_draft,
            EXISTS (
                SELECT 1
                FROM email_messages m_imp
                    JOIN email_message_mailbox_facts mf ON mf.id = m_imp.id
                    WHERE m_imp.thread_id = t.id AND mf.is_present AND NOT mf.in_trash AND mf.provider_is_important
            ) AS "is_important!",
            c.email_address AS "sender_email?",
            COALESCE(lmp.from_name, c.name) AS "sender_name?",
            c.sfs_photo_url as "sender_photo_url?",
            el.macro_id AS "owner_id!",
            el.id AS "link_id!"
        FROM (
            -- Step 1: Find the top N+1 candidate threads. $5 picks exactly one
            -- of the two branches below.
            SELECT *
            FROM (
                -- Recency sorts: each link walks idx_email_threads_inbox_reminder_sort
                -- in order and stops at LIMIT. Before Postgres 17, `link_id = ANY(...)`
                -- cannot return index order, so it would read and sort every inbox
                -- thread of every link.
                SELECT per_link.*
                FROM unnest($1::uuid[]) AS links(link_id)
                CROSS JOIN LATERAL (
                    SELECT
                        t.id,
                        t.provider_id,
                        t.link_id,
                        t.is_read,
                        t.is_signal,
                        t.project_id,
                        COALESCE(t.latest_inbound_message_ts, t.latest_outbound_message_ts, t.created_at) AS created_at,
                        GREATEST(t.latest_inbound_message_ts, t.reminder_returned_at) AS updated_at,
                        GREATEST(t.latest_inbound_message_ts, t.reminder_returned_at) AS effective_ts
                    FROM email_threads t
                    WHERE
                        t.link_id = links.link_id
                      AND t.inbox_visible = TRUE
                      AND GREATEST(t.latest_inbound_message_ts, t.reminder_returned_at) IS NOT NULL
                      AND (($3::timestamptz IS NULL) OR (
                          GREATEST(t.latest_inbound_message_ts, t.reminder_returned_at), t.id
                      ) < ($3::timestamptz, $4::uuid))
                    ORDER BY GREATEST(t.latest_inbound_message_ts, t.reminder_returned_at) DESC, t.id DESC
                    LIMIT $2
                ) AS per_link
                WHERE $5 NOT IN ('viewed_at', 'viewed_updated')

                UNION ALL

                -- Viewed sorts order by the caller's history, so every inbox thread
                -- is a candidate.
                SELECT
                    t.id,
                    t.provider_id,
                    t.link_id,
                    t.is_read,
                    t.is_signal,
                    t.project_id,
                    COALESCE(t.latest_inbound_message_ts, t.latest_outbound_message_ts, t.created_at) AS created_at,
                    GREATEST(t.latest_inbound_message_ts, t.reminder_returned_at) AS updated_at,
                    CASE $5 -- sort_method_str
                        WHEN 'viewed_at' THEN COALESCE(uh.updated_at, '1970-01-01 00:00:00+00')
                        ELSE COALESCE(uh.updated_at, GREATEST(t.latest_inbound_message_ts, t.reminder_returned_at))
                    END AS effective_ts
                FROM email_threads t
                LEFT JOIN email_user_history uh ON uh.thread_id = t.id AND uh.link_id = t.link_id
                WHERE
                    t.link_id = ANY($1)
                  AND t.inbox_visible = TRUE
                  AND GREATEST(t.latest_inbound_message_ts, t.reminder_returned_at) IS NOT NULL
                  AND $5 IN ('viewed_at', 'viewed_updated')
                  AND (($3::timestamptz IS NULL) OR (
                      -- This CASE must exactly match the one that defines `effective_ts`
                      CASE $5 -- sort_method_str
                          WHEN 'viewed_at' THEN COALESCE(uh.updated_at, '1970-01-01 00:00:00+00')
                          ELSE COALESCE(uh.updated_at, GREATEST(t.latest_inbound_message_ts, t.reminder_returned_at))
                      END, t.id
                  ) < ($3::timestamptz, $4::uuid))
            ) AS candidates
            ORDER BY effective_ts DESC, id DESC
            LIMIT $2
        ) AS t
        -- Step 2: For EACH of the limited threads from above, find its latest non-trashed message.
        CROSS JOIN LATERAL (
            SELECT
                   m.subject,
                   m.snippet,
                   m.from_contact_id,
                   m.from_name,
                   m.is_draft
            FROM email_messages m
            WHERE m.thread_id = t.id
              AND EXISTS (SELECT 1 FROM email_message_mailbox_facts mf WHERE mf.id = m.id AND mf.is_present AND NOT mf.in_trash)
            ORDER BY m.internal_date_ts DESC
            LIMIT 1
        ) AS lmp
        -- Step 3: Join to get the sender's details for the final result set.
        LEFT JOIN email_contacts c ON lmp.from_contact_id = c.id
        LEFT JOIN email_user_history uh ON uh.thread_id = t.id AND uh.link_id = t.link_id
        JOIN email_links el ON t.link_id = el.id
        -- Final ordering is preserved because the input `t` is already sorted.
        ORDER BY t.effective_ts DESC, t.id DESC
        "#,
        link_ids,           // $1
        query_limit,        // $2
        cursor_timestamp,   // $3
        cursor_id,          // $4
        sort_method_str,    // $5
    ).fetch_all(pool).await
}
