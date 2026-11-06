CREATE OR REPLACE FUNCTION harness_access_level(p_harness uuid, p_user text)
RETURNS "AccessLevel"
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
        WHEN COALESCE(h.owner_user_id, h.created_by) = p_user THEN 'owner'::"AccessLevel"
        ELSE (
            SELECT max(ea.access_level)
            FROM entity_access ea
            WHERE ea.entity_id = h.id
              AND ea.entity_type = 'harness'
              AND (
                (
                    ea.source_type = 'team'
                    AND ea.source_id IN (
                        SELECT tu.team_id::text FROM team_user tu WHERE tu.user_id = p_user
                    )
                )
                OR (
                    ea.source_type = 'user'
                    AND ea.source_id = p_user
                    AND EXISTS (
                        SELECT 1
                        FROM team_user mine
                        JOIN team_user theirs ON theirs.team_id = mine.team_id
                        WHERE mine.user_id = p_user
                          AND theirs.user_id = COALESCE(h.owner_user_id, h.created_by)
                    )
                )
              )
        )
    END
    FROM harnesses h
    WHERE h.id = p_harness AND h.deleted_at IS NULL
$$;

DROP FUNCTION harness_grant_level(uuid, "AccessLevel");
DROP FUNCTION harness_is_agent_computer(uuid);
