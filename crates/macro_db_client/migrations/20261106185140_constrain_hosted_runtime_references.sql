SET LOCAL lock_timeout = '5s';

-- Preserve enrollment/billing attribution until the computer or team is deleted.
ALTER TABLE hosted_runtime
    ADD CONSTRAINT hosted_runtime_harness_id_fkey
        FOREIGN KEY (harness_id) REFERENCES harnesses (id) ON DELETE SET NULL NOT VALID,
    ADD CONSTRAINT hosted_runtime_created_by_fkey
        FOREIGN KEY (created_by) REFERENCES "User" (id) ON DELETE RESTRICT NOT VALID;

ALTER TABLE hosted_runtime_waitlist
    ADD CONSTRAINT hosted_runtime_waitlist_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES "User" (id) ON DELETE CASCADE NOT VALID;

CREATE INDEX hosted_runtime_created_by_idx ON hosted_runtime (created_by);
CREATE INDEX hosted_runtime_waitlist_user_idx ON hosted_runtime_waitlist (user_id);
