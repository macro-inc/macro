-- A runtime always has one person as its owner; "team runtime" becomes a team
-- grant. The owner XOR stays valid, so replicas still on the previous release
-- read migrated rows as private ones until they roll.
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
SELECT id, 'harness', team_id::text, 'team', 'edit'
FROM harnesses
WHERE team_id IS NOT NULL AND deleted_at IS NULL
ON CONFLICT (entity_id, entity_type, source_id, source_type)
    WHERE granted_from_project_id IS NULL
    DO NOTHING;

UPDATE harnesses
SET owner_user_id = created_by, team_id = NULL
WHERE team_id IS NOT NULL;

-- The database's one rule for who may use a runtime. A direct grant counts only
-- while its holder shares a team with the owner, so leaving the team ends access
-- without anything having to clean the grant up.
CREATE FUNCTION harness_access_level(p_harness uuid, p_user text)
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

-- Who may run agents on a runtime: its owner and its users, not its readers.
CREATE FUNCTION harness_can_run(p_harness uuid, p_user text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(harness_access_level(p_harness, p_user) IN ('edit', 'owner'), false)
$$;

-- The agent that asked on its user's behalf, shown to whoever reviews it.
ALTER TABLE entity_access_request ADD COLUMN requested_by_agent uuid;

-- Runtimes an inviter offers with a team invite, granted when it is accepted.
-- Cancelling the invite or removing the runtime drops the offer with it.
CREATE TABLE team_invite_harness_grant (
    team_invite_id uuid NOT NULL REFERENCES team_invite (id) ON DELETE CASCADE,
    harness_id uuid NOT NULL REFERENCES harnesses (id) ON DELETE CASCADE,
    PRIMARY KEY (team_invite_id, harness_id)
);

CREATE INDEX team_invite_harness_grant_harness_id_idx
    ON team_invite_harness_grant (harness_id);
