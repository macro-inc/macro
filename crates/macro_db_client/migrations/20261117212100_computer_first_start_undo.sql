-- The outbox worker that takes back the agent teammate a released computer
-- was bought for; it runs beside the agent teammates domain.
ALTER TYPE computer_effect_worker ADD VALUE IF NOT EXISTS 'agents';
-- The timer that fails an agent computer's start when the agent hasn't
-- reported online within its deadline after macrod connected.
ALTER TYPE computer_timer_kind ADD VALUE IF NOT EXISTS 'agent_start_due';
