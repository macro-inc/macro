-- Access checks match each grant's source against the viewer's memberships by
-- index, instead of binding the viewer's whole source list (every team and
-- channel they are in) into the statement.
--
-- A viewer is a user (scope_team NULL) or a bot acting in its team
-- (scope_team set; the caller has already checked the bot is active). The
-- sources are the ones entity_access has always used:
--   user: themself, their teams, and the channels they have not left;
--   bot:  itself, its team, the team's team channels, and the channels it has
--         not left that are not a direct agent conversation.
--
-- The uuid comparisons only cast a source shaped like a lowercase uuid, so a
-- source that is not one never matches and never raises. That is the same as
-- comparing text with channel_id::text, which is always lowercase.

-- One row when `source` is one of the viewer's sources, none otherwise. Called
-- as EXISTS (SELECT FROM entity_access_source_matches(x, viewer, scope)), which
-- the planner inlines.
CREATE FUNCTION entity_access_source_matches(source text, viewer text, scope_team uuid)
RETURNS SETOF boolean LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT true WHERE source = viewer
        OR (scope_team IS NULL AND EXISTS (
            SELECT 1 FROM team_user tu WHERE tu.user_id = viewer AND tu.team_id::text = source))
        OR source = scope_team::text
        OR EXISTS (
            SELECT 1 FROM comms_channel_participants cp
            WHERE cp.channel_id = CASE WHEN source ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN source::uuid END
              AND cp.user_id = viewer AND cp.left_at IS NULL
              AND (scope_team IS NULL OR NOT EXISTS (
                  SELECT 1 FROM comms_channel_agents ca WHERE ca.channel_id = cp.channel_id AND ca.kind = 'direct')))
        OR (scope_team IS NOT NULL AND EXISTS (
            SELECT 1 FROM comms_channels c
            WHERE c.id = CASE WHEN source ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN source::uuid END
              AND c.channel_type = 'team' AND c.team_id = scope_team))
$$;

-- The same sources as rows, for listings that start from the viewer's sources.
CREATE FUNCTION entity_access_viewer_sources(viewer text, scope_team uuid)
RETURNS SETOF text LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT viewer
    UNION ALL
    SELECT tu.team_id::text FROM team_user tu WHERE scope_team IS NULL AND tu.user_id = viewer
    UNION ALL
    SELECT scope_team::text WHERE scope_team IS NOT NULL
    UNION ALL
    SELECT c.id::text FROM comms_channels c WHERE c.channel_type = 'team' AND c.team_id = scope_team
    UNION ALL
    SELECT cp.channel_id::text FROM comms_channel_participants cp
    WHERE cp.user_id = viewer AND cp.left_at IS NULL
      AND (scope_team IS NULL OR NOT EXISTS (
          SELECT 1 FROM comms_channel_agents ca WHERE ca.channel_id = cp.channel_id AND ca.kind = 'direct'))
$$;

-- external_chat_access_level(uuid, text[]) for a viewer instead of a source
-- list. The text[] form and external_chat_sources stay for the code deployed
-- before this migration.
CREATE FUNCTION external_chat_access_level(chat_id uuid, viewer text, scope_team uuid) RETURNS "AccessLevel"
LANGUAGE sql STABLE AS $$
    SELECT max(level) FROM (
        SELECT ea.access_level AS level FROM entity_access ea
        WHERE ea.entity_id = chat_id AND ea.entity_type = 'external_chat'
          AND EXISTS (SELECT FROM entity_access_source_matches(ea.source_id, viewer, scope_team))
        UNION ALL
        SELECT sp."linkShareAccessLevel" FROM external_chat c JOIN "SharePermission" sp ON sp.id = c.share_permission_id
        WHERE c.id = chat_id AND sp."linkShareAccessLevel" IS NOT NULL
          AND (sp."linkShare" = 'PUBLIC' OR (sp."linkShare" = 'TEAM' AND EXISTS (
              SELECT 1 FROM team_user owner_team
              WHERE owner_team.user_id = c.user_id
                AND EXISTS (SELECT FROM entity_access_source_matches(owner_team.team_id::text, viewer, scope_team)))))
    ) levels
$$;

-- Same answers as before (external_chat_sources listed the same user sources).
CREATE OR REPLACE FUNCTION external_chat_can_view(chat_id uuid, viewer text) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT external_chat_access_level(chat_id, viewer, NULL::uuid) IS NOT NULL
$$;
