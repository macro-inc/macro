-- Adds a new boolean to the teams table defaulting to false
ALTER TABLE team
    ADD COLUMN paying BOOLEAN NOT NULL DEFAULT false;

-- For all existing teams we should set paying to true if they have a subscription id in `subscription_id` field
UPDATE team
SET paying = true
WHERE subscription_id IS NOT NULL;
