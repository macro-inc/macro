-- Viewed sorts, threads the caller has opened, a page per link. The history
-- index orders by view time alone, so a page also holds the threads tied with
-- its last row and the sort below breaks ties by id. Keep thread_id out of
-- that index: with it the planner answers every per-thread history lookup by
-- scanning the link's history.
--
-- A link is read one of two ways. Normally its newest views (four pages'
-- worth, at least 200) are checked against the inbox, newest first, until the
-- page is full. A link that opens mail and archives it can have far more
-- views than inbox threads, and that walk would cross its whole history; when
-- those views neither fill the page nor end the history, the link's inbox
-- threads are read instead and sorted by their view time, which costs one
-- inbox.
WITH viewed AS MATERIALIZED (
    SELECT per_link.*
    FROM unnest($1::uuid[]) AS links(link_id)
    CROSS JOIN LATERAL (
        WITH recent_views AS MATERIALIZED (
            SELECT uh.thread_id, uh.updated_at
            FROM email_user_history uh
            WHERE
                uh.link_id = links.link_id
              AND uh.updated_at <= COALESCE($3::timestamptz, 'infinity')
              AND (uh.updated_at, uh.thread_id) < (
                  COALESCE($3::timestamptz, 'infinity'),
                  COALESCE($4::uuid, 'ffffffff-ffff-ffff-ffff-ffffffffffff')
              )
            ORDER BY uh.updated_at DESC
            FETCH FIRST (GREATEST(4 * $2::bigint, 200)) ROWS WITH TIES
        ),
        -- OFFSET 0 keeps the inbox check one index probe per view.
        from_recent_views AS MATERIALIZED (
            SELECT t.*, recent_views.updated_at AS effective_ts
            FROM recent_views
            CROSS JOIN LATERAL (
                SELECT
                    t.id,
                    t.provider_id,
                    t.link_id,
                    t.is_read,
                    t.is_signal,
                    t.project_id,
                    COALESCE(t.latest_inbound_message_ts, t.latest_outbound_message_ts, t.created_at) AS created_at,
                    GREATEST(t.latest_inbound_message_ts, t.reminder_returned_at) AS updated_at
                FROM email_threads t
                WHERE
                    t.id = recent_views.thread_id
                  AND t.link_id = links.link_id
                  AND t.inbox_visible = TRUE
                  AND GREATEST(t.latest_inbound_message_ts, t.reminder_returned_at) IS NOT NULL
                OFFSET 0
            ) AS t
            ORDER BY recent_views.updated_at DESC
            FETCH FIRST ($2) ROWS WITH TIES
        ),
        recent_views_suffice AS (
            SELECT
                (SELECT count(*) FROM from_recent_views) >= $2
                OR (SELECT count(*) FROM recent_views) < GREATEST(4 * $2::bigint, 200) AS suffice
        )
        SELECT from_recent_views.*
        FROM from_recent_views
        WHERE (SELECT suffice FROM recent_views_suffice)

        UNION ALL

        -- Both OFFSET 0 fences keep this driven by the inbox: left to itself the
        -- planner walks the history in view order again.
        SELECT from_inbox.*
        FROM (
            SELECT t.*, uh.updated_at AS effective_ts
            FROM (
                SELECT
                    t.id,
                    t.provider_id,
                    t.link_id,
                    t.is_read,
                    t.is_signal,
                    t.project_id,
                    COALESCE(t.latest_inbound_message_ts, t.latest_outbound_message_ts, t.created_at) AS created_at,
                    GREATEST(t.latest_inbound_message_ts, t.reminder_returned_at) AS updated_at
                FROM email_threads t
                WHERE
                    t.link_id = links.link_id
                  AND t.inbox_visible = TRUE
                  AND GREATEST(t.latest_inbound_message_ts, t.reminder_returned_at) IS NOT NULL
                OFFSET 0
            ) AS t
            CROSS JOIN LATERAL (
                SELECT uh.updated_at
                FROM email_user_history uh
                WHERE uh.link_id = t.link_id AND uh.thread_id = t.id
                OFFSET 0
            ) AS uh
            WHERE (uh.updated_at, t.id) < (
                COALESCE($3::timestamptz, 'infinity'),
                COALESCE($4::uuid, 'ffffffff-ffff-ffff-ffff-ffffffffffff')
            )
            ORDER BY uh.updated_at DESC
            FETCH FIRST ($2) ROWS WITH TIES
        ) AS from_inbox
        WHERE NOT (SELECT suffice FROM recent_views_suffice)
    ) AS per_link
    WHERE $5 IN ('viewed_at', 'viewed_updated')
),
-- The view time of the page's last row when opened threads alone fill the
-- page, and no row otherwise. A never-opened thread that sorts below it
-- cannot be on the page.
viewed_page_end AS (
    SELECT effective_ts
    FROM viewed
    ORDER BY effective_ts DESC, id DESC
    OFFSET GREATEST($2 - 1, 0)
    LIMIT 1
)
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
    -- Step 1: Find the top N+1 candidate threads. $5 picks the branches that run.
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

        SELECT * FROM viewed

        UNION ALL

        -- viewed_updated, threads never opened: they sort by inbox recency, so
        -- each link walks the same index as the recency sorts and skips the
        -- opened threads. OFFSET 0 keeps the history check a per-thread probe;
        -- as a join the planner reads the link's whole inbox and sorts it.
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
              AND NOT EXISTS (
                  SELECT 1
                  FROM email_user_history uh
                  WHERE uh.link_id = t.link_id AND uh.thread_id = t.id
                  OFFSET 0
              )
              AND (GREATEST(t.latest_inbound_message_ts, t.reminder_returned_at), t.id) < (
                  COALESCE($3::timestamptz, 'infinity'),
                  COALESCE($4::uuid, 'ffffffff-ffff-ffff-ffff-ffffffffffff')
              )
              AND GREATEST(t.latest_inbound_message_ts, t.reminder_returned_at) >= COALESCE(
                  (SELECT effective_ts FROM viewed_page_end),
                  '-infinity'
              )
            ORDER BY GREATEST(t.latest_inbound_message_ts, t.reminder_returned_at) DESC, t.id DESC
            LIMIT $2
        ) AS per_link
        WHERE $5 = 'viewed_updated'

        UNION ALL

        -- viewed_at, threads never opened: they all sort at the epoch, so they
        -- are read only when opened threads do not fill the page, and each link
        -- walks idx_email_threads_inbox_id in id order. The cursor is among
        -- them only when its timestamp is the epoch.
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
                '1970-01-01 00:00:00+00'::timestamptz AS effective_ts
            FROM email_threads t
            WHERE
                t.link_id = links.link_id
              AND t.inbox_visible = TRUE
              AND GREATEST(t.latest_inbound_message_ts, t.reminder_returned_at) IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1
                  FROM email_user_history uh
                  WHERE uh.link_id = t.link_id AND uh.thread_id = t.id
                  OFFSET 0
              )
              AND t.id < CASE
                  WHEN $3::timestamptz = '1970-01-01 00:00:00+00' THEN $4::uuid
                  ELSE 'ffffffff-ffff-ffff-ffff-ffffffffffff'
              END
            ORDER BY t.id DESC
            LIMIT $2
        ) AS per_link
        WHERE $5 = 'viewed_at'
          AND COALESCE($3::timestamptz, 'infinity') >= '1970-01-01 00:00:00+00'
          AND '1970-01-01 00:00:00+00' >= COALESCE(
              (SELECT effective_ts FROM viewed_page_end),
              '-infinity'
          )
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
