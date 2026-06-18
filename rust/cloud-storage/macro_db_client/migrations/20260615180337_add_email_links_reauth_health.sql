-- Per-link sync health. `needs_reauth` is set when a link's Google grant stops
-- yielding a token (revoked / missing) and cleared on the next successful token
-- fetch; `last_sync_error_at` records when the failure was last observed.
ALTER TABLE email_links
    ADD COLUMN needs_reauth        boolean NOT NULL DEFAULT false,
    ADD COLUMN last_sync_error_at  timestamptz;
