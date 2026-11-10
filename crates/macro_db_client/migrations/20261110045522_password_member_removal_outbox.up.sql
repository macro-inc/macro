CREATE TABLE password_member_removals (
    id UUID PRIMARY KEY,
    team_id UUID NOT NULL REFERENCES team(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('prepared','finished','rolled_back')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX password_member_removals_prepared ON password_member_removals(team_id,user_id) WHERE state='prepared';
ALTER TABLE password_item_entities ADD COLUMN member_removal_id UUID REFERENCES password_member_removals(id);
ALTER TABLE password_item_entities ADD COLUMN member_removal_created BOOLEAN NOT NULL DEFAULT false;
