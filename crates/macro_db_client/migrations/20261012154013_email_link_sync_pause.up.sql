-- email_links is hot and cascading mailbox deletes hold its row locks for a long
-- time; fail fast instead of queueing every sync query behind this ALTER.
SET LOCAL lock_timeout = '5s';

ALTER TABLE email_links
    -- Set while the retention sweep has paused an idle link's sync. A paused link
    -- also has is_sync_active = false, so every sync path that gates on that flag
    -- skips it; this column tells a retention pause apart from a link being torn down.
    ADD COLUMN sync_paused_at TIMESTAMPTZ,
    -- Last time someone who can access the link opened the app. The default is
    -- evaluated once here, so existing links start a full retention window at
    -- deploy time, and new links start it at creation.
    ADD COLUMN last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
