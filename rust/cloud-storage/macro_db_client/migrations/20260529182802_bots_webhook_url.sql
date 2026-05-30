-- Add a webhook delivery URL for external bots (e.g. Linear, Datadog).
--
-- System bots (like Macro Agent) are defined in application code, identified by
-- a stable id (`bot_id::MACRO_AI_BOT_ID`), and require no database row. External
-- bots are stored in `public.bots` and receive triggers at this webhook.
ALTER TABLE public.bots
    ADD COLUMN IF NOT EXISTS webhook_url text;
