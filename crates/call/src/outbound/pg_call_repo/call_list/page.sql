-- One page of the calls a viewer can see: live calls, archived calls, and
-- imported calls, newest first.
--
-- $1 viewer, $2 page size, $3/$4 channel filter, $5/$6 call id filter,
-- $7/$8 status filter, $9-$13 property clauses (see property_clauses.rs),
-- $14 sort by start (else by last activity), $15/$16 keyset cursor.
--
-- The page starts from the viewer's grants on calls, so its cost follows the
-- calls the viewer can see, not every call on the platform. Each flag
-- parameter stands alone in its own condition, so a generic plan resolves it
-- once per execution instead of filtering every row.
WITH user_source_ids AS (
    SELECT cp.channel_id::text AS source_id
    FROM comms_channel_participants cp
    WHERE cp.user_id = $1 AND cp.left_at IS NULL
    UNION ALL
    SELECT t.team_id::text AS source_id
    FROM team_user t
    WHERE t.user_id = $1
    UNION ALL
    SELECT $1 AS source_id
),
-- The calls a filter names: the call id filter's (CRM associations), or else
-- the channel filter's channels' calls. Empty without either filter.
named AS (
    SELECT unnest($6::uuid[]) AS call_id
    WHERE $5::bool
    UNION ALL
    SELECT cr.id FROM call_records cr
    WHERE NOT $5::bool AND $3::bool AND cr.channel_id = ANY($4)
    UNION ALL
    SELECT c.id FROM calls c
    WHERE NOT $5::bool AND $3::bool AND c.channel_id = ANY($4)
    UNION ALL
    SELECT ce.id FROM call_entities ce
    WHERE NOT $5::bool AND $3::bool AND ce.channel_id = ANY($4) AND ce.created_via <> 'native'
),
-- Calls the viewer holds a grant on, and whether one of those grants is the
-- viewer's own: standalone calls need it, so a team or channel grant can't
-- add them. One arm runs. With a filter, read the named calls' grants and
-- keep those from the viewer's sources; the sources are a jsonb object so
-- each check is a key lookup that no join order can turn into a scan of
-- every source per grant. Without one, read the grants the viewer's sources
-- hold from the index alone, and the viewer's own user grants separately.
granted AS (
    SELECT ea.entity_id AS call_id,
           bool_or(ea.source_type = 'user' AND ea.source_id = $1) AS own_grant
    FROM entity_access ea
    WHERE ($5::bool OR $3::bool)
      AND ea.entity_id = ANY(ARRAY(SELECT call_id FROM named))
      AND ea.entity_type = 'call'
      AND (SELECT jsonb_object_agg(source_id, true) FROM user_source_ids) ? ea.source_id
    GROUP BY ea.entity_id
    UNION ALL
    SELECT g.entity_id, bool_or(g.own_grant)
    FROM (
        SELECT ea.entity_id, false AS own_grant
        FROM entity_access ea
        WHERE NOT ($5::bool OR $3::bool)
          AND ea.source_id = ANY(ARRAY(SELECT source_id FROM user_source_ids))
          AND ea.entity_type = 'call'
        UNION ALL
        SELECT ea.entity_id, true
        FROM entity_access ea
        WHERE NOT ($5::bool OR $3::bool)
          AND ea.source_id = $1
          AND ea.entity_type = 'call'
          AND ea.source_type = 'user'
    ) g
    GROUP BY g.entity_id
),
-- Each granted call's row: archived, live, or imported. The lateral join
-- reads the tables by primary key once per granted call, so its cost follows
-- the viewer's calls whatever the planner estimates for them. A call is in
-- exactly one table (archiving moves the live row in one transaction, and
-- imports get their own ids), so the first row found ends the lookup.
candidates AS (
    SELECT x.*, g.own_grant
    FROM granted g
    CROSS JOIN LATERAL (
        SELECT cr.id AS call_id, cr.channel_id, cr.room_name, cr.created_by,
               cr.started_at, cr.ended_at, cr.duration_ms, cr.egress_id,
               cr.recording_key, cr.preview_url, cr.recording_started_at,
               NULL::uuid AS meeting_id, cr.custom_name, cr.summary,
               NULL::bool AS share_with_team, cr.share_permission_id,
               false AS is_active, false AS is_imported
        FROM call_records cr
        WHERE cr.id = g.call_id
        UNION ALL
        SELECT c.id, c.channel_id, c.room_name, c.created_by,
               c.created_at, NULL::timestamptz, NULL::bigint, c.egress_id,
               c.recording_key, c.preview_url, c.recording_started_at,
               c.meeting_id, NULL::text, NULL::text,
               c.share_with_team, c.share_permission_id,
               true, false
        FROM calls c
        WHERE c.id = g.call_id
        UNION ALL
        -- Imported calls (e.g. Granola) exist only as call entities; native
        -- calls are mirrored there too, so exclude them.
        SELECT ce.id, ce.channel_id, NULL::text, ce.user_id,
               COALESCE(ce.started_at, ce.created_at), ce.ended_at, ce.duration_ms,
               NULL::text, NULL::text, NULL::text, NULL::timestamptz,
               NULL::uuid, ce.title, NULL::text,
               NULL::bool, ce.share_permission_id,
               false, true
        FROM call_entities ce
        WHERE ce.id = g.call_id AND ce.created_via <> 'native'
        LIMIT 1
    ) x
),
-- Every visible call in page order. The fence keeps the status probes below
-- out of this scan, so they run only for the rows the page reads.
sorted AS (
    SELECT candidates.*,
           CASE WHEN $14 THEN started_at ELSE COALESCE(ended_at, started_at) END AS sort_at
    FROM candidates
    WHERE (channel_id IS NOT NULL OR own_grant)
      AND ($3::bool IS FALSE OR channel_id = ANY($4))
      -- Soup's keyset: calls sort by start, or by last activity.
      AND (
          $15::timestamptz IS NULL
          OR (
              CASE WHEN $14 THEN started_at ELSE COALESCE(ended_at, started_at) END,
              call_id::text
          ) < ($15, $16::text)
      )
      -- Property conditions in conjunctive normal form: every clause needs a
      -- term the call satisfies. Tags (no definition) match any property
      -- value; entity references match their definition's value.
      AND NOT EXISTS (
          SELECT 1
          FROM generate_series(0, $9::int - 1) AS clause(idx)
          WHERE NOT EXISTS (
              SELECT 1
              FROM UNNEST($10::int[], $11::bool[], $12::uuid[], $13::text[])
                  AS term(clause_idx, negated, definition_id, value)
              WHERE term.clause_idx = clause.idx
                AND term.negated <> EXISTS (
                    SELECT 1 FROM entity_properties ep
                    WHERE ep.entity_id = candidates.call_id::text
                      AND ep.entity_type = 'CALL_RECORD'
                      AND jsonb_typeof(ep.values -> 'value') = 'array'
                      AND CASE
                          WHEN term.definition_id IS NULL
                              THEN jsonb_exists(ep.values -> 'value', term.value)
                          ELSE ep.property_definition_id = term.definition_id
                              AND ep.values -> 'value' @> jsonb_build_array(
                                  jsonb_build_object('entity_id', term.value)
                              )
                      END
                )
          )
      )
    ORDER BY sort_at DESC, call_id::text DESC
    OFFSET 0
),
-- The viewer attended a call they joined (an import's importer attended
-- it), missed a call in a channel they're in, and otherwise didn't attend.
with_status AS (
    SELECT sorted.*,
        CASE
            WHEN is_imported THEN
                CASE WHEN created_by = $1 THEN 'ATTENDED'::text ELSE 'UNATTENDED'::text END
            WHEN is_active AND EXISTS (
                SELECT 1 FROM call_participants cp
                WHERE cp.call_id = sorted.call_id AND cp.user_id = $1
            ) THEN 'ATTENDED'::text
            WHEN NOT is_active AND EXISTS (
                SELECT 1 FROM call_record_participants crp
                WHERE crp.call_record_id = sorted.call_id AND crp.user_id = $1
            ) THEN 'ATTENDED'::text
            WHEN EXISTS (
                SELECT 1 FROM comms_channel_participants ccp
                WHERE ccp.channel_id = sorted.channel_id
                  AND ccp.user_id = $1
                  AND ccp.left_at IS NULL
            ) THEN 'MISSED'::text
            ELSE 'UNATTENDED'::text
        END AS status
    FROM sorted
    OFFSET 0
),
page AS (
    SELECT *
    FROM with_status
    WHERE ($7::bool IS FALSE OR status = ANY($8::text[]))
    LIMIT $2
)
SELECT
    p.call_id AS "call_id!",
    p.channel_id AS "channel_id?",
    p.room_name,
    p.created_by AS "created_by!",
    p.started_at AS "started_at!",
    p.ended_at,
    p.duration_ms,
    p.egress_id,
    p.recording_key,
    p.preview_url,
    p.recording_started_at,
    CASE
        WHEN p.is_active THEN (SELECT m.title FROM call_meetings m WHERE m.id = p.meeting_id)
        ELSE p.custom_name
    END AS custom_name,
    CASE
        WHEN p.is_imported THEN (
            SELECT s.metadata ->> 'summary' FROM call_entity_sources s
            WHERE s.call_id = p.call_id
            ORDER BY s.synced_at DESC NULLS LAST
            LIMIT 1
        )
        ELSE p.summary
    END AS summary,
    -- A live call carries its pending intent; afterwards the shared
    -- permission's team level is the source of truth.
    CASE
        WHEN p.is_active THEN p.share_with_team
        ELSE sp.team_share_access_level IS NOT NULL
    END AS "share_with_team!",
    sp.team_share_access_level AS "team_share_access_level?: AccessLevel",
    p.is_active AS "is_active!",
    p.is_imported AS "is_imported!",
    p.status AS "status!",
    (SELECT d.discussion FROM call_entities d WHERE d.id = p.call_id) AS discussion
-- The share permission is a required foreign key, so joining it after the
-- limit drops no row the page counted.
FROM page p
JOIN "SharePermission" sp ON sp.id = p.share_permission_id
ORDER BY p.sort_at DESC, p.call_id::text DESC
