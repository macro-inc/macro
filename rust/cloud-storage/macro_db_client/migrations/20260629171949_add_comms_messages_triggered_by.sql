-- Record which user triggered an agent-authored channel message.
--
-- AI/agent messages are sent as the Macro agent bot (`Sender::Bot`), so the
-- `sender_id` identifies the bot, not the person who prompted it. This column
-- persists the triggering user's id so clients can render a "from <user>" pill
-- on the agent's message.
--
-- Nullable with no default: human messages and channel/system bots leave it
-- NULL, and the column adds without a table rewrite or backfill.
ALTER TABLE public.comms_messages
    ADD COLUMN IF NOT EXISTS triggered_by_user_id text;
