-- Personal content belongs to the account; team content belongs to the team.
-- Creator attribution is cleared on account deletion without deleting team content.
SET LOCAL lock_timeout = '5s';
CREATE TABLE task_template (
    id uuid PRIMARY KEY,
    user_id text REFERENCES "User"(id) ON DELETE CASCADE,
    team_id uuid REFERENCES team(id) ON DELETE CASCADE,
    creator_id text REFERENCES "User"(id) ON DELETE SET NULL,
    name text NOT NULL,
    configuration jsonb NOT NULL,
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT task_template_owner_check CHECK ((user_id IS NULL) <> (team_id IS NULL))
);
CREATE INDEX task_template_personal_idx ON task_template (user_id, created_at, id) WHERE user_id IS NOT NULL;
CREATE INDEX task_template_team_idx ON task_template (team_id, created_at, id) WHERE team_id IS NOT NULL;
