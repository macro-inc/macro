-- One page of the viewer's teammates' activity on entities shared with the
-- viewer. See `team_feed.rs` for the paging contract.
--
-- $1 viewer id, $2/$3 cursor position (NULL for the first page),
-- $4 rows to return, $5 fewest raw rows one teammate's scan reads,
-- $6 raw rows one page reads across all teammates.
WITH viewer_source AS (
    -- The principals an `entity_access` grant can name to reach the viewer:
    -- the viewer, their teams, and the channels they are active in.
    SELECT 'user'::entity_access_source_type AS source_type, $1::text AS source_id
    UNION ALL
    SELECT 'team', tu.team_id::text FROM team_user tu WHERE tu.user_id = $1
    UNION ALL
    SELECT 'channel', cp.channel_id::text
    FROM comms_channel_participants cp
    WHERE cp.user_id = $1 AND cp.left_at IS NULL
),
viewer_inbox AS (
    -- Inboxes whose threads the viewer owns: their own links and those
    -- delegated to them as primary.
    SELECT l.id AS link_id FROM email_links l WHERE l.macro_id = $1
    UNION
    SELECT mul.link_id FROM macro_user_links mul WHERE mul.primary_macro_id = $1
),
teammate AS (
    SELECT DISTINCT member.user_id
    FROM team_user viewer
    JOIN team_user member ON member.team_id = viewer.team_id
    WHERE viewer.user_id = $1 AND member.user_id <> $1
),
scan AS (
    SELECT GREATEST($5, $6 / GREATEST(count(*), 1))::bigint AS rows FROM teammate
),
scanned AS (
    -- Per teammate, one seek of the subject index that stops at $4 visible
    -- rows or after `scan.rows` raw rows. A scan that stops at that cap
    -- also emits its last raw row (`scan_rank = scan.rows`) as a frontier.
    SELECT s.*
    FROM teammate t
    CROSS JOIN LATERAL (
        SELECT w.*
        FROM (
            SELECT e.*,
                   row_number() OVER (ORDER BY e.occurred_at DESC, e.id DESC) AS scan_rank,
                   -- Mirrors `EntityAccessService::get_users_by_entity` for
                   -- every entity type activity records; anything else is
                   -- hidden. Forms are hidden too: their rows name
                   -- respondents, so they reach only their subject.
                   CASE
                       WHEN e.entity_type = 'channel' THEN e.entity_id IN (
                           SELECT vs.source_id FROM viewer_source vs
                           WHERE vs.source_type = 'channel'
                       )
                       -- A call's audience is its channel's, or its direct
                       -- user grants when it has none.
                       WHEN e.entity_type = 'call' THEN EXISTS (
                           SELECT 1 FROM call_entities ce
                           WHERE ce.id = e.entity_uuid
                             AND CASE
                                 WHEN ce.channel_id IS NULL THEN EXISTS (
                                     SELECT 1 FROM entity_access ea
                                     WHERE ea.entity_id = ce.id AND ea.entity_type = 'call'
                                       AND ea.source_type = 'user' AND ea.source_id = $1
                                       AND ea.granted_from_project_id IS NULL
                                 )
                                 ELSE ce.channel_id::text IN (
                                     SELECT vs.source_id FROM viewer_source vs
                                     WHERE vs.source_type = 'channel'
                                 )
                             END
                       )
                       WHEN e.entity_type IN (
                           'document', 'project', 'chat', 'initiative', 'database',
                           'crm_company', 'email_thread'
                       ) THEN EXISTS (
                           SELECT 1 FROM entity_access ea
                           WHERE ea.entity_id::text = e.entity_id
                             AND ea.entity_type = e.entity_type
                             AND (ea.source_type, ea.source_id) IN (
                                 SELECT vs.source_type, vs.source_id FROM viewer_source vs
                             )
                       ) OR (e.entity_type = 'email_thread' AND EXISTS (
                           SELECT 1 FROM email_threads et
                           WHERE et.id = e.entity_uuid
                             AND et.link_id IN (SELECT vi.link_id FROM viewer_inbox vi)
                       ))
                       ELSE false
                   END AS visible
            FROM (
                SELECT e.id, e.actor_id, e.action, e.action_payload, e.subject_id,
                       e.entity_type, e.entity_id, e.occurred_at,
                       -- Only these id columns are uuids; a malformed id
                       -- must hide its row, not fail the page.
                       CASE WHEN e.entity_type IN ('call', 'email_thread') THEN
                           CASE WHEN e.entity_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                                THEN e.entity_id::uuid
                           END
                       END AS entity_uuid
                FROM activity_events e
                WHERE e.subject_id = t.user_id
                  -- No cursor reads from the top. COALESCE, unlike an
                  -- `IS NULL OR` branch, keeps this an index condition in
                  -- generic plans.
                  AND (e.occurred_at, e.id) < (
                      COALESCE($2::timestamptz, 'infinity'),
                      COALESCE($3::uuid, 'ffffffff-ffff-ffff-ffff-ffffffffffff')
                  )
                ORDER BY e.occurred_at DESC, e.id DESC
                LIMIT (SELECT rows FROM scan)
            ) e
        ) w
        WHERE w.visible OR w.scan_rank = (SELECT rows FROM scan)
        LIMIT $4
    ) s
),
boundary AS (
    -- The newest frontier: below it some teammate's rows were not read.
    SELECT * FROM scanned
    WHERE scan_rank = (SELECT rows FROM scan)
    ORDER BY occurred_at DESC, id DESC
    LIMIT 1
)
(
    SELECT s.id AS "id!", s.actor_id AS "actor_id!", s.action AS "action!",
           s.action_payload, s.subject_id AS "subject_id!",
           s.entity_type AS "entity_type!", s.entity_id AS "entity_id!",
           s.occurred_at AS "occurred_at!", false AS "is_boundary!"
    FROM scanned s
    WHERE s.visible
      AND NOT EXISTS (
          SELECT 1 FROM boundary b WHERE (s.occurred_at, s.id) < (b.occurred_at, b.id)
      )
    ORDER BY s.occurred_at DESC, s.id DESC
    LIMIT $4
)
UNION ALL
SELECT b.id, b.actor_id, b.action, b.action_payload, b.subject_id, b.entity_type,
       b.entity_id, b.occurred_at, true
FROM boundary b
