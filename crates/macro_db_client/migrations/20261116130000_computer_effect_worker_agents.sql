-- The worker that takes back an agent teammate whose computer's charge was
-- declined; it runs beside the agent teammates domain.
ALTER TYPE computer_effect_worker ADD VALUE IF NOT EXISTS 'agents';
