-- Whether a bot runs a sandboxed coding agent. Mentioning such a bot opens an
-- agent session (see agent_session) instead of a chat reply, so the trigger
-- path needs a database fact to tell agent bots apart from ordinary ones.
ALTER TABLE bots
    ADD COLUMN has_agent boolean NOT NULL DEFAULT false;

-- Seed the "Macro Coder" system bot (bot_id::MACRO_CODER_BOT_ID).
INSERT INTO bots (id, kind, name, handle, has_agent)
VALUES ('00000000-0000-0000-0000-00000000a9e7', 'system', 'Macro Coder', 'coder', true)
ON CONFLICT (id) DO NOTHING;
