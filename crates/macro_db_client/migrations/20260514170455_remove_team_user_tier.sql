-- Remove the tier column from team_user
ALTER TABLE "team_user" DROP COLUMN tier;

-- Remove the tier from team_invite
ALTER TABLE "team_invite" DROP COLUMN tier;
