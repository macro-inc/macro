-- Everyone on a page of calls, earliest joiner first: account participants of
-- live ($1) and archived ($2) calls, and guests of live, archived, and
-- imported ($3) calls. Each arm reads its table's call id index.
SELECT
    cp.call_id AS "call_id!",
    cp.user_id AS "user_id?",
    NULL::uuid AS "guest_id?",
    NULL::text AS "display_name?",
    NULL::text AS "email?",
    cp.joined_at AS "joined_at!",
    cp.left_at
FROM call_participants cp
WHERE cp.call_id = ANY($1)
UNION ALL
SELECT crp.call_record_id, crp.user_id, NULL, NULL, NULL, crp.joined_at, crp.left_at
FROM call_record_participants crp
WHERE crp.call_record_id = ANY($2)
UNION ALL
SELECT cg.call_id, NULL, cg.id, cg.display_name, NULL, cg.joined_at, cg.left_at
FROM call_guests cg
WHERE cg.call_id = ANY($1)
UNION ALL
SELECT crg.call_record_id, NULL, crg.id, crg.display_name, NULL, crg.joined_at, crg.left_at
FROM call_record_guests crg
WHERE crg.call_record_id = ANY($2)
UNION ALL
-- Imported attendees all joined when the call started, so they keep their
-- id order.
SELECT p.call_id, NULL, p.id, p.display_name, p.email,
       COALESCE(ce.started_at, ce.created_at), ce.ended_at
FROM call_entity_participants p
JOIN call_entities ce ON ce.id = p.call_id
WHERE p.call_id = ANY($3)
ORDER BY 6, 3, 2
