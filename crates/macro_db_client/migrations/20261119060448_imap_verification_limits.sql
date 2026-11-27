SET LOCAL lock_timeout = '5s';

-- Public-host hashes and keyed owner/login pseudonyms with attempt counts; no raw credentials.
CREATE TABLE imap_verification_limits (
    scope_hash TEXT NOT NULL,
    window_start TIMESTAMPTZ NOT NULL,
    attempts INTEGER NOT NULL CHECK (attempts > 0),
    PRIMARY KEY (scope_hash, window_start)
);
CREATE INDEX imap_verification_limits_expiry ON imap_verification_limits(window_start);
