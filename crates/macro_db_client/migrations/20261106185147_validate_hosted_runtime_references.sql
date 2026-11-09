SET LOCAL lock_timeout = '5s';

ALTER TABLE hosted_runtime VALIDATE CONSTRAINT hosted_runtime_harness_id_fkey;
ALTER TABLE hosted_runtime VALIDATE CONSTRAINT hosted_runtime_created_by_fkey;
ALTER TABLE hosted_runtime_waitlist VALIDATE CONSTRAINT hosted_runtime_waitlist_user_id_fkey;
