-- Create new enum for the team users tier
-- Ordered from lowest tier to highest tier
CREATE TYPE "team_user_tier" AS ENUM ('haiku', 'sonnet', 'opus');

-- Add in a new tier associated with each team member
-- NOTE: we will keep track of the owners tier this way as well as they are stored in the team_user table
ALTER TABLE "team_user" ADD COLUMN tier "team_user_tier" NOT NULL DEFAULT 'haiku';
