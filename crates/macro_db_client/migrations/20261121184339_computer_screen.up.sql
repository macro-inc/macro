-- Watching and driving an agent teammate's computer screen
-- (crates/computer_screen). Every table is new and empty, so nothing locks
-- existing rows.

-- One-time WebSocket tickets: single use, short lived, stored hashed.
CREATE TABLE computer_screen_tickets (
    token_hash  BYTEA PRIMARY KEY,
    harness_id  UUID        NOT NULL,
    computer_id UUID        NOT NULL,
    -- The agent teammate the computer runs, if any.
    agent_user_id TEXT,
    user_id     TEXT        NOT NULL,
    transport   TEXT        NOT NULL CHECK (transport IN ('vnc')),
    surface     TEXT        NOT NULL CHECK (surface IN ('desktop')),
    mode        TEXT        NOT NULL CHECK (mode IN ('view', 'drive')),
    expires_at  TIMESTAMPTZ NOT NULL,
    -- W3C context of the request that issued it, so the socket joins its trace.
    traceparent TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Expired tickets are swept by age.
CREATE INDEX computer_screen_tickets_expires_at ON computer_screen_tickets (expires_at);

-- The audit: one row per socket that watched or drove a computer. Kept when
-- the computer or the user is gone.
CREATE TABLE computer_screen_sessions (
    id                UUID PRIMARY KEY,
    harness_id        UUID        NOT NULL,
    computer_id       UUID        NOT NULL,
    user_id           TEXT        NOT NULL,
    transport         TEXT        NOT NULL CHECK (transport IN ('vnc')),
    surface           TEXT        NOT NULL CHECK (surface IN ('desktop')),
    mode              TEXT        NOT NULL CHECK (mode IN ('view', 'drive')),
    started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at          TIMESTAMPTZ,
    end_reason        TEXT CHECK (end_reason IN ('stopped', 'computerOff', 'accessRevoked', 'shutdown', 'error', 'lost', 'idle')),
    bytes_to_viewer   BIGINT      NOT NULL DEFAULT 0,
    bytes_from_viewer BIGINT      NOT NULL DEFAULT 0,
    -- Bumped while the socket is open, so a row a crashed process left open
    -- stops counting as someone watching.
    seen_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Open sockets per computer: hibernation's in-use check, the socket caps
-- and the end of rows a gone process left open.
CREATE INDEX computer_screen_sessions_open ON computer_screen_sessions (computer_id, seen_at)
    WHERE ended_at IS NULL;

-- The audit of driving: one row per take-over, from take-over to hand-back
-- or lapse. Moving the lease to another tab of the same user keeps the row
-- and points it at the newer socket.
CREATE TABLE computer_screen_drives (
    id          UUID PRIMARY KEY,
    computer_id UUID        NOT NULL,
    session_id  UUID        NOT NULL REFERENCES computer_screen_sessions (id),
    user_id     TEXT        NOT NULL,
    started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at    TIMESTAMPTZ,
    end_reason  TEXT CHECK (end_reason IN ('handBack', 'lapsed', 'refused', 'unpaused')),
    -- The agent's thaw after the drive: settled when the guest answered (or
    -- it stopped mattering); until then the harness retries, least recently
    -- tried first.
    thaw_settled_at TIMESTAMPTZ,
    thaw_settled    TEXT CHECK (thaw_settled IN ('thawed', 'superseded', 'deadMan', 'expired')),
    thaw_tried_at   TIMESTAMPTZ,
    -- Thaws that failed while the computer ran.
    thaw_failures   INTEGER     NOT NULL DEFAULT 0
);

-- Ended drives whose thaw isn't settled, in the order the harness retries
-- them.
CREATE INDEX computer_screen_drives_thaw_owed
    ON computer_screen_drives (thaw_tried_at NULLS FIRST, ended_at)
    WHERE ended_at IS NOT NULL AND thaw_settled_at IS NULL;

-- At most one open drive per computer, the one its lease belongs to.
CREATE UNIQUE INDEX computer_screen_drives_open ON computer_screen_drives (computer_id)
    WHERE ended_at IS NULL;

-- The one driver of a computer. A row past expires_at is released by
-- whoever next reads it, which records the hand-back.
CREATE TABLE computer_screen_driver_leases (
    computer_id   UUID PRIMARY KEY,
    harness_id    UUID        NOT NULL,
    session_id    UUID        NOT NULL REFERENCES computer_screen_sessions (id),
    user_id       TEXT        NOT NULL,
    driver_name   TEXT,
    agent_user_id TEXT,
    started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ NOT NULL
);

-- The agent's held brain requests look their computer's lease up by agent.
CREATE INDEX computer_screen_driver_leases_agent ON computer_screen_driver_leases (agent_user_id)
    WHERE agent_user_id IS NOT NULL;

-- Take-over and hand-back notices, waiting for the agent's next brain
-- request that succeeds, which deletes them. One an agent hasn't picked up
-- within a day is swept.
CREATE TABLE computer_screen_agent_notices (
    id            UUID PRIMARY KEY,
    computer_id   UUID        NOT NULL,
    agent_user_id TEXT        NOT NULL,
    payload       JSONB       NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Set while one brain request carries it; past it, the notice is free
    -- for the next (that request failed without saying so).
    claimed_until TIMESTAMPTZ
);

CREATE INDEX computer_screen_agent_notices_pending ON computer_screen_agent_notices (agent_user_id, created_at);
CREATE INDEX computer_screen_agent_notices_created ON computer_screen_agent_notices (created_at);
