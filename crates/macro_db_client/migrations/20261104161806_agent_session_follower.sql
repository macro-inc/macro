-- People who prompted a session directly, from the session itself rather than
-- by mentioning its agent in a thread. A hidden session (one started from a
-- thread) lists for them in Home, Recent and Agents while they can still read
-- it. Grants nothing: access stays with entity_access.
CREATE TABLE agent_session_follower (
    agent_session_id UUID NOT NULL REFERENCES agent_session (id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES "User" (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (agent_session_id, user_id)
);
