-- How many reminder emails an unanswered team invite has sent. The reminder
-- sweep stops at two; accepting or revoking an invite deletes the row.
ALTER TABLE team_invite ADD COLUMN reminders_sent SMALLINT NOT NULL DEFAULT 0;
