-- Record which client a user triggered an agent-authored message through.
--
-- A user's MCP client (for example Claude Code) writes through the public MCP
-- as the Macro bot on the user's behalf. `triggered_by_user_id` names the
-- user; this column keeps the client's self-reported registration name so
-- clients can render "from <user> via <client>". A display label only.
--
-- Nullable with no default: every other message leaves it NULL, and the
-- column adds without a table rewrite or backfill.
SET lock_timeout = '5s';

ALTER TABLE public.comms_messages
    ADD COLUMN IF NOT EXISTS triggered_via text;
