-- Dropping the foreign key locks "User" against reads and writes; fail fast
-- rather than queue its readers behind a long transaction.
SET LOCAL lock_timeout = '3s';

DROP TABLE user_last_seen;
