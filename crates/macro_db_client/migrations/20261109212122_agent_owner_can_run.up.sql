-- Whether an agent's own owner may run agents on the runtime it is bound to: a
-- person through harness_can_run, a team through a grant to that team. A
-- resident (a bound non-coding agent) runs only while this holds.
CREATE FUNCTION agent_owner_can_run(p_bot uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE((
        SELECT CASE
            WHEN b.owner_user_id IS NOT NULL
                THEN harness_can_run(ac.harness_id, b.owner_user_id)
            ELSE EXISTS (
                SELECT 1
                FROM entity_access ea
                WHERE ea.entity_id = ac.harness_id
                  AND ea.entity_type = 'harness'
                  AND ea.source_type = 'team'
                  AND ea.source_id = b.team_id::text
            )
        END
        FROM agent_configs ac
        JOIN bots b ON b.id = ac.bot_id
        WHERE ac.bot_id = p_bot AND ac.harness_id IS NOT NULL
    ), false)
$$;
