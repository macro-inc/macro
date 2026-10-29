-- The machine operator's local consent to permission bypass, as the daemon
-- last reported it on connect. NULL: the daemon has never reported it.
ALTER TABLE harnesses
    ADD COLUMN operator_allows_bypass boolean;
