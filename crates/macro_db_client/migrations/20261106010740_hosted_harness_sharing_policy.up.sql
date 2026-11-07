-- Classify the computer independently of its enrollment link: a pending or
-- missing team-agent link must never make a persona computer a User runtime.
CREATE FUNCTION harness_is_agent_computer(p_harness uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (
        SELECT 1 FROM harnesses h
        JOIN hosted_runtime c ON c.id = h.computer_id
        WHERE h.id = p_harness
          AND (c.persona IS NOT NULL OR EXISTS (
              SELECT 1 FROM team_agents a WHERE a.computer_id = c.id
          ))
    )
$$;

-- Normalize grants at their shared storage boundary, including grants offered
-- by team invitations. This does not grant access or choose a recipient.
CREATE FUNCTION harness_grant_level(p_harness uuid, p_level "AccessLevel")
RETURNS "AccessLevel" LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN p_level IS NOT NULL AND harness_is_agent_computer(p_harness)
        THEN 'view'::"AccessLevel" ELSE p_level END
$$;

-- Hosted computers always have a team grant in addition to their human owner.
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
SELECT h.id, 'harness', c.team_id::text, 'team', harness_grant_level(h.id, 'edit')
FROM harnesses h JOIN hosted_runtime c ON c.id = h.computer_id
WHERE h.deleted_at IS NULL
ON CONFLICT (entity_id, entity_type, source_id, source_type)
    WHERE granted_from_project_id IS NULL DO NOTHING;

UPDATE entity_access ea
SET access_level = 'view'
WHERE ea.entity_type = 'harness' AND harness_is_agent_computer(ea.entity_id);

-- The one effective-access rule. Dedicated agent computers are bounded to
-- their own team. Their assigned account is a resident, never a host user;
-- the recorded human owner and team administrators retain control.
CREATE OR REPLACE FUNCTION harness_access_level(p_harness uuid, p_user text)
RETURNS "AccessLevel" LANGUAGE sql STABLE AS $$
    SELECT CASE
        WHEN COALESCE(h.owner_user_id, h.created_by) = p_user
            THEN 'owner'::"AccessLevel"
        WHEN harness_is_agent_computer(h.id) AND NOT (
            EXISTS (SELECT 1 FROM team_user tu WHERE tu.team_id = c.team_id AND tu.user_id = p_user)
            OR EXISTS (SELECT 1 FROM team t WHERE t.id = c.team_id AND t.owner_id = p_user)
        ) THEN NULL
        WHEN harness_is_agent_computer(h.id) AND EXISTS (
            SELECT 1 FROM team_agents a
            WHERE a.computer_id = c.id AND a.team_id = c.team_id AND a.user_id = p_user
        ) THEN 'view'::"AccessLevel"
        WHEN harness_is_agent_computer(h.id) AND (
            EXISTS (SELECT 1 FROM team t WHERE t.id = c.team_id AND t.owner_id = p_user)
            OR EXISTS (SELECT 1 FROM team_user tu WHERE tu.team_id = c.team_id
                AND tu.user_id = p_user AND tu.team_role IN ('admin', 'owner'))
        ) THEN 'owner'::"AccessLevel"
        ELSE harness_grant_level(h.id, (
            SELECT max(ea.access_level)
            FROM entity_access ea
            WHERE ea.entity_id = h.id AND ea.entity_type = 'harness'
              AND (
                  (ea.source_type = 'team' AND (
                      ea.source_id IN (SELECT tu.team_id::text FROM team_user tu WHERE tu.user_id = p_user)
                      OR ea.source_id IN (SELECT t.id::text FROM team t WHERE t.owner_id = p_user)
                  ))
                  OR (ea.source_type = 'user' AND ea.source_id = p_user AND EXISTS (
                      SELECT 1 FROM team_user mine
                      JOIN team_user theirs ON theirs.team_id = mine.team_id
                      WHERE mine.user_id = p_user
                        AND theirs.user_id = COALESCE(h.owner_user_id, h.created_by)
                  ))
              )
        ))
    END
    FROM harnesses h
    LEFT JOIN hosted_runtime c ON c.id = h.computer_id
    WHERE h.id = p_harness AND h.deleted_at IS NULL
$$;
