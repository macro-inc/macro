-- Macro Agent is a code-defined system bot: it is recognized by its stable id
-- in application code and requires no database row. Remove the seeded row (the
-- bots table and webhook_url column remain, for external bots).
DELETE FROM public.bots
WHERE id = '00000000-0000-0000-0000-00000000a1a1';
