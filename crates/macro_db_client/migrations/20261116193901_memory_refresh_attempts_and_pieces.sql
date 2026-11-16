-- Count claims of a user's current day so a day that keeps failing is given up
-- after a bounded number of attempts instead of being retried forever.
-- Constant defaults: no table rewrite. Claims lock job rows, so wait briefly.
SET LOCAL lock_timeout = '5s';

ALTER TABLE memory_refresh_job
    ADD COLUMN attempt_date DATE,
    ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;

-- Components of the user's next day that already passed review, so a later
-- failure does not throw them away. At most one row per component; the
-- generation commit deletes them.
CREATE TABLE memory_refresh_piece (
    user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    piece TEXT NOT NULL CHECK (piece IN ('day', 'week', 'month', 'summary', 'profile')),
    date DATE NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL CHECK (period_end >= period_start),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, piece)
);
