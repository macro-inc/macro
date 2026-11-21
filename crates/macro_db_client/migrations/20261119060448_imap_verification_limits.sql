SET LOCAL lock_timeout = '5s';

-- Only salted scope digests and attempt counts; no addresses or credentials.
CREATE TABLE imap_verification_limits (
    scope_hash TEXT NOT NULL,
    window_start TIMESTAMPTZ NOT NULL,
    attempts INTEGER NOT NULL CHECK (attempts > 0),
    PRIMARY KEY (scope_hash, window_start)
);
CREATE INDEX imap_verification_limits_expiry ON imap_verification_limits(window_start);
