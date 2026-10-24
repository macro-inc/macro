-- Each adopted WhatsApp group is its adopter's own entity, shared like any
-- other: two people adding the same WhatsApp group get two entities, and the
-- name follows WhatsApp. Channel members can view a group shared with the
-- channel. Sends carry the trace of the request that recorded them.
SET lock_timeout = '5s';

DROP INDEX whatsapp_group_active_group;
ALTER TABLE whatsapp_group DROP COLUMN team_id;
CREATE UNIQUE INDEX whatsapp_group_active_group ON whatsapp_group(user_id, group_jid) WHERE state <> 'detached';

-- W3C trace context of the request that recorded the send; the dispatch joins
-- that trace.
ALTER TABLE whatsapp_send ADD COLUMN traceparent text CHECK (octet_length(traceparent) <= 256);

CREATE OR REPLACE FUNCTION whatsapp_group_can_view(group_id uuid, viewer text) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT EXISTS (
        SELECT 1 FROM entity_access ea
        WHERE ea.entity_id = group_id AND ea.entity_type = 'whatsapp_group'
          AND (ea.source_id = viewer
            OR ea.source_id IN (SELECT team_id::text FROM team_user WHERE user_id = viewer)
            OR ea.source_id IN (SELECT channel_id::text FROM comms_channel_participants WHERE user_id = viewer AND left_at IS NULL))
    ) OR EXISTS (
        SELECT 1 FROM whatsapp_group g JOIN "SharePermission" sp ON sp.id = g.share_permission_id
        WHERE g.id = group_id AND sp."linkShareAccessLevel" IS NOT NULL
          AND (sp."linkShare" = 'PUBLIC' OR (sp."linkShare" = 'TEAM' AND EXISTS (
              SELECT 1 FROM team_user mine JOIN team_user owner_team ON owner_team.team_id = mine.team_id
              WHERE mine.user_id = viewer AND owner_team.user_id = g.user_id)))
    )
$$;
