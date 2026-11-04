-- Agent accounts: set once when the account is created. A pending team invite
-- can ask for one, so the signup that redeems it creates an agent.
SET LOCAL lock_timeout = '5s';

ALTER TABLE "User"
    ADD COLUMN "isAgent" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE team_invite
    ADD COLUMN is_agent BOOLEAN NOT NULL DEFAULT FALSE;
