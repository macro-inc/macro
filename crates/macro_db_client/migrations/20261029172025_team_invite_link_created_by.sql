-- Who created (or last reset) a team's invite link, so joins through it can
-- reward them. NULL for links created before this column existed.
ALTER TABLE team_invite_link ADD COLUMN created_by TEXT;
