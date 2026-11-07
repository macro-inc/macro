-- Teams inside a workspace (a `team` row). They nest one level: a team may
-- sit under a top-level team. Deleting a parent moves its teams to the top.
CREATE TYPE subteam_color AS ENUM ('violet', 'blue', 'teal', 'cyan', 'orange', 'pink', 'lime');

-- Who may join without being added by a manager.
CREATE TYPE subteam_join_policy AS ENUM ('open', 'invite_only');

CREATE TYPE subteam_role AS ENUM ('member', 'manager');

CREATE TABLE subteam (
    id UUID PRIMARY KEY,
    team_id UUID NOT NULL REFERENCES team (id) ON DELETE CASCADE,
    parent_id UUID REFERENCES subteam (id) ON DELETE SET NULL,
    name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),
    description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 200),
    color subteam_color NOT NULL,
    join_policy subteam_join_policy NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (parent_id <> id),
    UNIQUE (team_id, id)
);

CREATE INDEX subteam_parent_id_idx ON subteam (parent_id);

-- Members must be on the workspace: leaving it removes them from its teams.
CREATE TABLE subteam_member (
    subteam_id UUID NOT NULL,
    team_id UUID NOT NULL,
    user_id TEXT NOT NULL,
    role subteam_role NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (subteam_id, user_id),
    FOREIGN KEY (team_id, subteam_id) REFERENCES subteam (team_id, id) ON DELETE CASCADE,
    FOREIGN KEY (user_id, team_id) REFERENCES team_user (user_id, team_id) ON DELETE CASCADE
);

CREATE INDEX subteam_member_team_id_idx ON subteam_member (team_id);
CREATE INDEX subteam_member_user_id_team_id_idx ON subteam_member (user_id, team_id);
