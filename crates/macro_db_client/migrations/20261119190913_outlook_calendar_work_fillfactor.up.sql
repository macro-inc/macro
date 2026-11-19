SET LOCAL lock_timeout = '1s';

-- Every Outlook claim and release rewrites a work row. With room left on its
-- page, and no indexed column changed, the new version stays on that page
-- (HOT) and adds no index entry, so the claim's per-account index reads stay
-- about one entry per row while dead versions can't be vacuumed. The table
-- holds one row per Outlook account and calendar. Existing pages fill to this
-- as their rows move.
ALTER TABLE calendar_outlook_work SET (fillfactor = 10);
