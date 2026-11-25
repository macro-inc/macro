-- Outlook discovery marks a calendar the mailbox subscribed to from the web,
-- which shows as a subscription. Google's calendars added by URL are
-- recognized by their calendar id instead. A constant default makes this a
-- catalog-only change, with no table rewrite.
SET LOCAL lock_timeout = '1s';
ALTER TABLE calendars ADD COLUMN web_subscription boolean NOT NULL DEFAULT false;
