-- Which harness replica holds a session's live actor, as a lease.
--
-- One row per booted harness participant, heartbeated while it lives. A
-- replica that stops heartbeating is dead by definition: its claims become
-- claimable by anyone, so a crashed process releases everything at once
-- without per-session cleanup.
CREATE TABLE harness_replica (
    id                UUID        PRIMARY KEY,
    started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The lease itself lives on the session so claiming and deleting are
-- transactional with the row they protect. manager_fence is a takeover
-- counter: every successful claim increments it, and live-actor log appends
-- are conditioned on the fence they were attached under, so a replica that
-- stalls past its heartbeat and gets superseded has its writes rejected by
-- the store rather than interleaved (fencing tokens). The fence never
-- resets - ON DELETE SET NULL frees the claim but keeps the counter.
ALTER TABLE agent_session
    ADD COLUMN manager_replica_id UUID REFERENCES harness_replica(id) ON DELETE SET NULL,
    ADD COLUMN manager_fence BIGINT NOT NULL DEFAULT 0;
