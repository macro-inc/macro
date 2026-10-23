-- A call whose only connected person is one Macro user ends on its own: the
-- sweeper records when they became alone, warns them after a while, and ends
-- the call if they do not choose to stay. Both columns are NULL while the call
-- has company; rows live only as long as the active call.
SET LOCAL lock_timeout = '5s';

ALTER TABLE calls
    ADD COLUMN alone_since TIMESTAMPTZ,
    ADD COLUMN alone_warned_at TIMESTAMPTZ;
