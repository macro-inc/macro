-- Deploy only after T4.2 is live; user deletion no longer relies on cascade for these tables.
-- Keep the NOT NULL owner columns as denormalized principal strings.
ALTER TABLE "Document" DROP CONSTRAINT "Document_owner_fkey";
ALTER TABLE "Project" DROP CONSTRAINT "Project_userId_fkey";
ALTER TABLE "Chat" DROP CONSTRAINT "Chat_userId_fkey";
ALTER TABLE agent_session DROP CONSTRAINT agent_session_owner_id_fkey;
ALTER TABLE scheduled_action DROP CONSTRAINT scheduled_action_owner_fkey;
