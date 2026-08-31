-- Sender assignment grows a third surface (Feed). is_important stays as
-- Signal vs not-Signal so existing mute/promote paths keep working.
-- email_threads.is_feed is the denormalized Feed listing flag.

ALTER TABLE email_filters
    ADD COLUMN surface TEXT;

UPDATE email_filters
SET surface = CASE WHEN is_important THEN 'signal' ELSE 'noise' END;

ALTER TABLE email_filters
    ALTER COLUMN surface SET DEFAULT 'noise',
    ALTER COLUMN surface SET NOT NULL,
    ADD CONSTRAINT email_filters_surface_chk
        CHECK (surface IN ('signal', 'feed', 'noise'));

ALTER TABLE email_threads
    ADD COLUMN IF NOT EXISTS is_feed BOOLEAN NOT NULL DEFAULT false;
