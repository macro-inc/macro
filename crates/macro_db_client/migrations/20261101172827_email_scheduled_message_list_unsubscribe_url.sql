-- The one-click unsubscribe URL a sequence step sends in its List-Unsubscribe
-- header. Nullable, so workers deployed before this column keep writing
-- ordinary schedules, and older workers send steps with the footer link only.
SET LOCAL lock_timeout = '5s';

ALTER TABLE email_scheduled_messages ADD COLUMN list_unsubscribe_url TEXT;
