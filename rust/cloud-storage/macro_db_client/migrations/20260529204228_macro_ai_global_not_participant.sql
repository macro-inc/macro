-- Macro AI is a global, system-level bot rather than a per-channel participant.
-- It is implicitly available in every channel (mention @macro to trigger it) and
-- does not occupy a participant row. Remove the rows seeded by the previous
-- migration; the bot identity itself (public.bots) is kept.
DELETE FROM public.comms_channel_participants
WHERE user_id = 'bot|00000000-0000-0000-0000-00000000a1a1';
