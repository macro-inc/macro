SET LOCAL lock_timeout = '5s';

-- The timer that hands an agent computer's agent over again until it reports
-- online.
ALTER TYPE computer_timer_kind ADD VALUE IF NOT EXISTS 'agent_redeliver';
