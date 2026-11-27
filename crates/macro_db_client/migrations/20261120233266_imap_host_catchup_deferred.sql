SET LOCAL lock_timeout = '5s';

-- Retrying a locked stream must not first acquire that stream's FK lock.
-- Only opaque ids are retained; missing/ineligible ids are removed on retry.
CREATE TABLE email_imap_host_catchup_deferred (
    stream_id UUID PRIMARY KEY,
    available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX email_imap_host_catchup_deferred_due
    ON email_imap_host_catchup_deferred (available_at, stream_id);
