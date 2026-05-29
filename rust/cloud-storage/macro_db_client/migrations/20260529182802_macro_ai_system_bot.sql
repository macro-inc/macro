-- Macro AI: a first-party system bot that is a participant in every channel.

-- External bots (e.g. Linear, Datadog) deliver triggers to a webhook. System
-- bots (like Macro AI) leave this null and run in-process.
ALTER TABLE public.bots
    ADD COLUMN IF NOT EXISTS webhook_url text;

-- Seed the stable Macro AI system bot. The id is mirrored by
-- `bot_id::MACRO_AI_BOT_ID` so services can recognize it without a lookup.
INSERT INTO public.bots (id, kind, name, handle, description)
VALUES (
    '00000000-0000-0000-0000-00000000a1a1',
    'system',
    'Macro AI',
    'macro',
    'Macro''s built-in AI assistant. Mention @macro in any channel to ask for help.'
)
ON CONFLICT (id) DO NOTHING;

-- Macro AI is automatically a member of every existing channel. New channels
-- add it at creation time in application code.
INSERT INTO public.comms_channel_participants (channel_id, user_id, role)
SELECT c.id, 'bot|00000000-0000-0000-0000-00000000a1a1', 'member'::comms_participant_role
FROM public.comms_channels c
ON CONFLICT (channel_id, user_id) DO NOTHING;
