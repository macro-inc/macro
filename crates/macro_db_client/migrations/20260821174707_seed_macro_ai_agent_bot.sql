-- Seed the "Macro" system bot (bot_id::MACRO_AI_BOT_ID) as an agent bot.
--
-- The bot has always been code-defined with no row of its own; agent sessions
-- reference bots(id), so mentioning it can only open a session once it exists
-- here. Its sessions run in-process inside the harness service (no sandbox)
-- and answer with the Macro product toolset, unlike the Macro Coder bot's,
-- which run in a provisioned sandbox.
INSERT INTO bots (id, kind, name, handle, has_agent)
VALUES ('00000000-0000-0000-0000-00000000a1a1', 'system', 'Macro', 'macro', true)
ON CONFLICT (id) DO UPDATE SET has_agent = true;
