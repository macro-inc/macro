-- When each person last opened their suggestions feed: a suggestion proposed
-- since then shows as new. One row per person who has opened it.
SET LOCAL lock_timeout = '5s';

CREATE TABLE suggestion_feed_view (
    user_id text PRIMARY KEY REFERENCES "User"(id) ON DELETE CASCADE,
    viewed_at timestamptz NOT NULL
);
