-- Focus: one relevance classification per signal email thread, written by the
-- email focus worker and read by the Focus view. Results only; the worker
-- classifies on each new message and an hourly sweep reclassifies stale rows.
-- Rows go away with their thread, and threads go away with their link.
-- The foreign key briefly locks email_threads; fail rather than queue writes.
SET LOCAL lock_timeout = '5s';

CREATE TABLE email_thread_focus (
    thread_id UUID PRIMARY KEY REFERENCES email_threads (id) ON DELETE CASCADE,
    link_id UUID NOT NULL,
    classified_message_id UUID NOT NULL,
    classified_message_ts TIMESTAMPTZ NOT NULL,
    is_focus BOOLEAN NOT NULL,
    category TEXT NOT NULL,
    importance SMALLINT NOT NULL CHECK (importance BETWEEN 0 AND 100),
    needs_reply BOOLEAN NOT NULL,
    needs_follow_up BOOLEAN NOT NULL,
    scores JSONB NOT NULL,
    model TEXT NOT NULL,
    classified_at TIMESTAMPTZ NOT NULL
);

-- The Focus list: one inbox's Focus threads, most important first.
CREATE INDEX email_thread_focus_list_idx
    ON email_thread_focus (link_id, importance DESC)
    WHERE is_focus;
