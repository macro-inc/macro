-- The image each computer's root disk was built from, and the one before its
-- last update (the rollback target). Both are NULL until the first creation
-- finishes; images are versioned aliases such as `macro-box/2026-11-10`.

SET LOCAL lock_timeout = '5s';

ALTER TABLE hosted_runtime
    ADD COLUMN image TEXT,
    ADD COLUMN previous_image TEXT;
