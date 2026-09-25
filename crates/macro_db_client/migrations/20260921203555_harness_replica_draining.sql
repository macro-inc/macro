-- When a harness replica published that it is going away.
--
-- A replica's heartbeat answers "is it alive", which is not the question a
-- router needs during a rolling deploy: a task keeps heartbeating normally
-- for the whole drain window, so peers go on resolving it as a session's
-- live manager and forwarding it commands it will not live to finish. This
-- column is the replica saying so itself, the moment SIGTERM lands - NULL
-- while it is serving, set once while it drains, never cleared (a restarted
-- process is a new replica with a new row).
ALTER TABLE harness_replica
    ADD COLUMN draining_at TIMESTAMPTZ;
