-- Seed the "Macro Agent" system bot (bot_id::MACRO_AGENT_BOT_ID).
--
-- Mentioning it opens an agent session, like the Macro Coder bot, but its
-- sessions run in-process inside the harness service (no sandbox) and answer
-- with the Macro product toolset.
INSERT INTO bots (id, kind, name, handle, has_agent)
VALUES ('00000000-0000-0000-0000-00000000a6e0', 'system', 'Macro Agent', 'agent', true)
ON CONFLICT (id) DO NOTHING;
