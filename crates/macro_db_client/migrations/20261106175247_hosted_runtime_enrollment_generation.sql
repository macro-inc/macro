SET lock_timeout = '5s';

ALTER TABLE hosted_runtime
    ADD COLUMN enrollment_generation BIGINT NOT NULL DEFAULT 0
    CHECK (enrollment_generation BETWEEN 0 AND 4294967295);
