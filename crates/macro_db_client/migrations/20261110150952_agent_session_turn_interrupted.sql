-- Whether the session's turn was still open when it disconnected: set when
-- the turn projection moves from starting, running, stopping or blocked to
-- disconnected, cleared by any other projection. A runtime's dial restores
-- such a session at once, since its agent may still be working.
-- Replicas on older code never set it, which reads as no unfinished turn.
SET LOCAL lock_timeout = '5s';
ALTER TABLE agent_session
    ADD COLUMN IF NOT EXISTS turn_interrupted BOOLEAN NOT NULL DEFAULT false;
