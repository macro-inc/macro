-- Time a person logged on a task, and the one timer a person may have running.
-- The foreign keys briefly lock "Document" and "User" against writes; keep this file short.
SET LOCAL lock_timeout = '3s';

CREATE TYPE time_entry_source AS ENUM ('manual', 'timer');

CREATE TABLE time_entry (
    id UUID PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES "Document" (id) ON DELETE CASCADE,
    -- No foreign key: an entry is a record of work and outlives the account, like
    -- activity_events.subject_id and comms_messages.sender_id.
    user_id TEXT NOT NULL,
    -- The logger's own calendar day, chosen by the client. Never derived from a timestamp on read.
    entry_date DATE NOT NULL,
    -- The longest entry allowed is the time tracking domain's rule, not a constraint here.
    minutes INTEGER NOT NULL,
    note TEXT,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    source time_entry_source NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT time_entry_minutes_positive CHECK (minutes > 0),
    CONSTRAINT time_entry_note_max_length CHECK (note IS NULL OR length(note) <= 2000),
    CONSTRAINT time_entry_span_both_or_neither CHECK ((started_at IS NULL) = (ended_at IS NULL)),
    CONSTRAINT time_entry_span_ordered CHECK (started_at IS NULL OR ended_at > started_at)
);

-- Carries minutes so the per-task sum every entry write runs reads the index only.
CREATE INDEX time_entry_task_date ON time_entry (task_id, entry_date DESC, id DESC) INCLUDE (minutes);

CREATE TABLE time_timer (
    user_id TEXT PRIMARY KEY REFERENCES "User" (id) ON DELETE CASCADE,
    -- Chosen by the client; becomes the time_entry id when the timer stops,
    -- so no two running timers share it.
    id UUID NOT NULL CONSTRAINT time_timer_id_key UNIQUE,
    task_id TEXT NOT NULL REFERENCES "Document" (id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ NOT NULL
);

-- Serves only the cascade from "Document".
CREATE INDEX time_timer_task ON time_timer (task_id);
