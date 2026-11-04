use super::super::db_types::*;
use models_pagination::{Query, SimpleSortMethod};
use sqlx::PgPool;
use uuid::Uuid;

/// Fetches a paginated list of thread previews for the "Important" view.
/// Includes threads that:
/// 1. Have messages the provider marks important that are in the inbox, or
/// 2. Contain draft messages
/// Trashed and provider-missing messages never qualify.
/// The threads are sorted by timestamp, with preview details taken from the latest qualifying message.
#[tracing::instrument(skip(pool), err)]
pub(crate) async fn important_preview_cursor(
    pool: &PgPool,
    link_ids: &[Uuid],
    limit: u32,
    query: &Query<Uuid, SimpleSortMethod, ()>,
) -> Result<Vec<ThreadPreviewCursorDbRow>, sqlx::Error> {
    let query_limit = limit as i64;
    let sort_method_str = query.sort_method().to_string();
    let (cursor_id, cursor_timestamp) = query.vals();

    // The is_present, in_trash, in_inbox and provider_is_important predicates
    // restate email_message_mailbox_facts with link-wide hash lookups: the view
    // aggregates every message's labels and pending state separately, which
    // dominates a scan of a whole mailbox. test_static_important_matches_mailbox_facts
    // keeps the two in step.
    sqlx::query_as!(
        ThreadPreviewCursorDbRow,
        r#"
        WITH LinkLabels AS (
            SELECT l.id, l.provider_label_id
            FROM email_labels l
            WHERE l.link_id = ANY($1) AND l.provider_label_id IN ('INBOX', 'TRASH', 'IMPORTANT')
        ),
        QualifyingMessages AS (
            SELECT m.thread_id,
                   m.internal_date_ts,
                   m.created_at AS fallback_ts,
                   m.is_draft,
                   m.subject,
                   m.snippet,
                   m.from_contact_id,
                   m.from_name
            FROM email_messages m
            LEFT JOIN email_pending_mailbox_state pending_trash
                ON pending_trash.message_id = m.id AND pending_trash.attribute = 'in_trash'
            LEFT JOIN email_pending_mailbox_state pending_inbox
                ON pending_inbox.message_id = m.id AND pending_inbox.attribute = 'in_inbox'
            WHERE m.link_id = ANY($1)
              AND NOT COALESCE((m.mailbox_state->>'provider_missing')::boolean, false)
              AND NOT COALESCE(
                  (pending_trash.desired #>> '{}')::boolean,
                  (m.mailbox_state->>'in_trash')::boolean,
                  m.id IN (
                      SELECT ml.message_id FROM LinkLabels l JOIN email_message_labels ml ON ml.label_id = l.id
                      WHERE l.provider_label_id = 'TRASH'
                  )
              )
              AND (
                  m.is_draft
                  OR (
                      CASE WHEN m.mailbox_state IS NOT NULL THEN m.mailbox_state->>'attention' = 'primary'
                      ELSE m.id IN (
                          SELECT ml.message_id FROM LinkLabels l JOIN email_message_labels ml ON ml.label_id = l.id
                          WHERE l.provider_label_id = 'IMPORTANT'
                      )
                      END
                      AND COALESCE(
                          (pending_inbox.desired #>> '{}')::boolean,
                          (m.mailbox_state->>'in_inbox')::boolean,
                          m.id IN (
                              SELECT ml.message_id FROM LinkLabels l JOIN email_message_labels ml ON ml.label_id = l.id
                              WHERE l.provider_label_id = 'INBOX'
                          )
                      )
                  )
              )
        ),
        AllImportantThreads AS (
            -- From all qualifying messages, get the single most recent one per thread.
            SELECT DISTINCT ON (thread_id)
                   thread_id,
                   internal_date_ts,
                   fallback_ts,
                   is_draft,
                   subject,
                   snippet,
                   from_contact_id,
                   from_name
            FROM QualifyingMessages
            ORDER BY thread_id, COALESCE(internal_date_ts, fallback_ts) DESC
        ),
        ImportantWithSortKey AS (
            -- Join with user_history to calculate the final effective sort key.
            SELECT
                ait.thread_id,
                ait.is_draft,
                ait.subject,
                ait.snippet,
                ait.from_contact_id,
                ait.from_name,
                tt.provider_id,
                tt.inbox_visible,
                tt.is_read,
                tt.is_signal,
                tt.project_id,
                tt.link_id,
                COALESCE(ait.internal_date_ts, ait.fallback_ts) as created_at,
                COALESCE(ait.internal_date_ts, ait.fallback_ts) as updated_at,
                uh.updated_at as viewed_at,
                -- This CASE statement dynamically selects the correct timestamp for sorting.
                -- For 'updated_at' and 'created_at', we use the important message timestamp
                -- For 'viewed_at', we use the history timestamp.
                -- For 'viewed_updated', we use the history timestamp if it exists, otherwise the important message timestamp.
                CASE $5 -- sort_method_str
                    WHEN 'viewed_at' THEN COALESCE(uh."updated_at", '1970-01-01 00:00:00+00')
                    WHEN 'viewed_updated' THEN COALESCE(uh.updated_at, COALESCE(ait.internal_date_ts, ait.fallback_ts))
                    ELSE COALESCE(ait.internal_date_ts, ait.fallback_ts)
                END AS effective_ts
            FROM AllImportantThreads ait
            JOIN email_threads tt ON tt.id = ait.thread_id
            -- This has to be a left join to support all sort methods.
            LEFT JOIN email_user_history uh ON uh.thread_id = ait.thread_id AND uh.link_id = tt.link_id
        ),
        Page AS (
            -- Cut the page before joining senders and links, which every thread has at most one of.
            SELECT *
            FROM ImportantWithSortKey isk
            WHERE ($3::timestamptz IS NULL) OR (isk.effective_ts, isk.thread_id) < ($3::timestamptz, $4::uuid)
            ORDER BY isk.effective_ts DESC, isk.thread_id DESC
            LIMIT $2
        )
        SELECT
               isk.thread_id as "id!",
               isk.provider_id,
               isk.inbox_visible as "inbox_visible!",
               isk.is_read as "is_read!",
               isk.is_signal as "is_signal!",
               isk.effective_ts as "sort_ts!",
               isk.created_at as "created_at!",
               isk.updated_at as "updated_at!",
               isk.project_id,
               isk.viewed_at as "viewed_at?",
               isk.is_draft as "is_draft!",
               -- It's the important view - all threads here are important
               true as "is_important!",
               isk.subject as "name?",
               isk.snippet as "snippet?",
               c.email_address AS "sender_email?",
               COALESCE(isk.from_name, c.name) AS "sender_name?",
               c.sfs_photo_url as "sender_photo_url?",
               el.macro_id AS "owner_id!",
            el.id AS "link_id!"
        FROM Page isk
        LEFT JOIN email_contacts c ON isk.from_contact_id = c.id
        JOIN email_links el ON isk.link_id = el.id
        ORDER BY isk.effective_ts DESC, isk.thread_id DESC
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
