-- Each sqlx::test has a fresh private database; fixtures intentionally own its schema.
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
CREATE TABLE email_links (
    id UUID PRIMARY KEY,
    macro_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    sync_generation BIGINT NOT NULL DEFAULT 1,
    grant_generation BIGINT NOT NULL DEFAULT 1,
    disconnect_requested_at TIMESTAMPTZ,
    deleting_at TIMESTAMPTZ,
    is_sync_active BOOLEAN NOT NULL DEFAULT true,
    needs_reauth BOOLEAN NOT NULL DEFAULT false
);
