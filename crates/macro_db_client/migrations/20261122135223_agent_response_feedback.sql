-- Ratings people give agent responses, for internal evals (owned by
-- crates/agent_feedback). A new table; its foreign key briefly locks "User",
-- so fail fast rather than queue that table's writers.

SET LOCAL lock_timeout = '3s';

-- What was rated: one reply turn of an agent session, an agent's message in a
-- channel, DM, thread or discussion, or one run of a routine.
CREATE TYPE agent_response_feedback_subject AS ENUM ('agent_session_turn', 'message', 'routine_run');
CREATE TYPE agent_response_rating AS ENUM ('up', 'down');
-- Where the person saw the response; the only context the client reports.
CREATE TYPE agent_response_feedback_surface AS ENUM
    ('agents_view', 'agent_block', 'message_timeline', 'message_thread', 'routine_run');
-- What produced the response: a first-party bot, a user- or team-owned bot,
-- or an agent teammate posting as its own account.
CREATE TYPE agent_response_agent_kind AS ENUM ('system_bot', 'owned_bot', 'teammate');

-- Append-only: one row per rating, change or retraction. A person's current
-- feedback on a response is their newest row for it; a NULL rating is a
-- retraction. Rows outlive the rated session, message or run on purpose, as
-- eval history; they go with the person who wrote them.
CREATE TABLE agent_response_feedback (
    -- Minted by the client per action, so a retried request is recognized.
    id UUID PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES "User" (id) ON DELETE CASCADE,
    subject_kind agent_response_feedback_subject NOT NULL,
    -- Agent session id, message parent id, or routine id.
    container_id TEXT NOT NULL,
    -- Agent session id, message id, or routine run id.
    subject_id UUID NOT NULL,
    -- The reply's turn; agent_session_turn only.
    turn INTEGER CHECK (turn >= 0),
    rating agent_response_rating,
    note TEXT CHECK (char_length(note) <= 4000),
    surface agent_response_feedback_surface NOT NULL,
    -- Context read server-side when the row was written, never from the client.
    -- message only: channel, document, call, ...
    message_parent_type TEXT,
    -- The turn's session, a message's linked session, or a run's session.
    agent_session_id UUID,
    -- bots.id, when a bot produced the response.
    agent_bot_id UUID,
    -- The teammate's account, when one produced it. No foreign key: the
    -- rating outlives the account.
    agent_user_id TEXT,
    agent_kind agent_response_agent_kind,
    -- agent_session.harness and agent_session.model when the row was written.
    harness TEXT,
    model TEXT,
    -- Trace of the rating request itself.
    trace_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((subject_kind = 'agent_session_turn') = (turn IS NOT NULL)),
    CHECK (rating IS NOT NULL OR note IS NULL)
);

-- One person's current feedback per response in one container (the render
-- path), and the latest row for one response inside a write.
CREATE INDEX agent_response_feedback_user_container_idx
    ON agent_response_feedback (user_id, subject_kind, container_id, subject_id, turn, created_at DESC, id DESC);
-- The export's keyset.
CREATE INDEX agent_response_feedback_created_idx ON agent_response_feedback (created_at, id);
