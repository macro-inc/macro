-- Add a way to assign a custom tier to a team member on invite
ALTER TABLE "team_invite" ADD COLUMN tier "team_user_tier" NOT NULL DEFAULT 'haiku';
