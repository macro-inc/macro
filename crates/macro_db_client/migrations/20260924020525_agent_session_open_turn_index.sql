-- The abandoned-turn sweep runs on every harness replica and only ever wants
-- sessions whose turn is still open, which is a handful of rows out of the
-- whole table. Without this it reads them all to find them.
CREATE INDEX agent_session_open_turn_idx
    ON agent_session (id)
    WHERE turn_state IN ('starting', 'running', 'stopping', 'blocked');
